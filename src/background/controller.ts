import { asUserFacing, DictationError, isAbortError, toUserFacing, type UserFacingError } from "../shared/errors";
import { resolveLanguage } from "../shared/languages";
import { createLogger } from "../shared/logger";
import type { AutoStopReason, BackgroundToContent, InsertResult } from "../shared/messages";
import type { CaptureStrategy, Settings } from "../shared/settings";
import { ACTIVE_PHASES, type DictationPhase, type DictationSession } from "../shared/state";
import { UI_STRINGS } from "../shared/strings";
import { extensionForMime } from "../recorder/mime";
import type { CapturedAudio } from "../recorder/recorder";
import { shouldTryNextStrategy, strategiesFor, type CaptureHost } from "./capture";
import type { FocusRecord } from "./focus-registry";
import { filterHallucinations } from "./stt/hallucinations";
import type { SttProvider } from "./stt/provider";

const log = createLogger("controller");
export const MIN_SPEECH_MS = 300;

export interface ControllerDeps {
  getSettings(): Promise<Settings>;
  getApiKey(): Promise<string>;
  getFocus(tabId: number): Promise<FocusRecord | undefined>;
  sendToFrame(tabId: number, frameId: number, msg: BackgroundToContent): Promise<unknown>;
  broadcast(tabId: number, msg: BackgroundToContent): Promise<unknown>;
  createCaptureHost(strategy: CaptureStrategy, tabId: number): CaptureHost;
  createProvider(settings: Settings, apiKey: string): SttProvider;
  writeClipboard(text: string): Promise<boolean>;
  saveSession(session: DictationSession | null): Promise<void>;
  newId(): string;
}

/** Máquina de estados del dictado. Una sola sesión activa en todo el navegador. */
export class DictationController {
  private session: DictationSession | null = null;
  private capture: CaptureHost | null = null;
  private abort: AbortController | null = null;

  constructor(private readonly deps: ControllerDeps) {}

  get current(): DictationSession | null {
    return this.session;
  }

  /** Se usa también desde el popup y el atajo. */
  async toggle(tabId: number): Promise<void> {
    const s = this.session;
    if (!s || s.tabId !== tabId) return this.start(tabId);
    switch (s.phase) {
      case "listening":
        return this.stop(s.sessionId);
      case "arming":
      case "transcribing":
        this.cancel("user");
        return;
      default:
        return;
    }
  }

  async start(tabId: number): Promise<void> {
    if (this.session) this.cancel("replaced");

    const focus = await this.deps.getFocus(tabId);
    if (!focus) {
      await this.toast(tabId, UI_STRINGS.toastFocusField, "info");
      return;
    }
    const settings = await this.deps.getSettings();
    const apiKey = await this.deps.getApiKey();
    const session: DictationSession = {
      sessionId: this.deps.newId(),
      tabId,
      targetFrameId: focus.frameId,
      phase: "idle",
      startedAt: Date.now(),
    };
    this.session = session;

    if (!apiKey) {
      await this.failWith(session, toUserFacing("missing-api-key"));
      return;
    }

    await this.setPhase(session, "arming");
    await this.deps.sendToFrame(tabId, focus.frameId, { type: "target/snapshot", sessionId: session.sessionId }).catch(
      () => undefined,
    );

    const opts = {
      autoStop: settings.autoStop,
      ...(settings.deviceId ? { deviceId: settings.deviceId } : {}),
    };
    let lastError: unknown = null;
    for (const strategy of strategiesFor(settings.captureStrategy)) {
      if (!this.isCurrent(session.sessionId)) return;
      const host = this.deps.createCaptureHost(strategy, tabId);
      try {
        await host.start(session.sessionId, opts, {
          onLevel: (level) => {
            if (this.isCurrent(session.sessionId)) {
              void this.deps.sendToFrame(tabId, 0, { type: "ui/level", level }).catch(() => undefined);
            }
          },
          onAutoStop: (reason) => void this.onAutoStop(session.sessionId, reason),
        });
        if (!this.isCurrent(session.sessionId)) {
          host.cancel(session.sessionId);
          return;
        }
        log.info("Captura iniciada con la estrategia", strategy);
        if (__E2E__) (globalThis as { __dictadoLastStrategy?: string }).__dictadoLastStrategy = strategy;
        this.capture = host;
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        log.warn(`La estrategia ${strategy} falló`, err);
        if (!shouldTryNextStrategy(err)) break;
      }
    }

    if (!this.isCurrent(session.sessionId)) return;
    if (!this.capture) {
      await this.failWith(session, asUserFacing(lastError ?? new DictationError("internal")));
      return;
    }
    await this.setPhase(session, "listening");
  }

  async onAutoStop(sessionId: string, reason: AutoStopReason): Promise<void> {
    if (!this.isCurrent(sessionId) || this.session?.phase !== "listening") return;
    if (reason === "no-speech") {
      const s = this.session;
      this.cancel("user");
      await this.toast(s.tabId, toUserFacing("no-speech").message, "info");
      return;
    }
    await this.stop(sessionId);
  }

  async stop(sessionId: string): Promise<void> {
    const session = this.session;
    if (!session || session.sessionId !== sessionId || session.phase !== "listening") return;
    const capture = this.capture;
    this.capture = null;
    await this.setPhase(session, "transcribing");

    let audio: CapturedAudio;
    try {
      if (!capture) throw new DictationError("internal", "Sin captura activa");
      audio = await capture.stop(sessionId);
    } catch (err) {
      if (this.isCurrent(sessionId)) await this.failWith(session, asUserFacing(err));
      return;
    }
    if (!this.isCurrent(sessionId)) return;
    if (audio.speechMs < MIN_SPEECH_MS) {
      await this.failWith(session, toUserFacing("no-speech"));
      return;
    }

    let text: string;
    try {
      text = await this.transcribe(audio);
    } catch (err) {
      if (isAbortError(err) || !this.isCurrent(sessionId)) return;
      await this.failWith(session, asUserFacing(err));
      return;
    }
    if (!this.isCurrent(sessionId)) return;
    if (!text) {
      await this.failWith(session, toUserFacing("no-speech"));
      return;
    }

    await this.setPhase(session, "inserting");
    let result: InsertResult | null = null;
    try {
      result = (await this.deps.sendToFrame(session.tabId, session.targetFrameId, {
        type: "inject/text",
        sessionId,
        text,
      })) as InsertResult | null;
    } catch (err) {
      log.warn("El frame objetivo no respondió a inject/text", err);
    }
    if (!this.isCurrent(sessionId)) return;

    if (result?.inserted) {
      await this.finish(session, "success");
    } else if (result?.copiedToClipboard) {
      await this.toast(session.tabId, UI_STRINGS.toastCopied, "info");
      await this.finish(session, "success");
    } else {
      await this.deps.writeClipboard(text);
      await this.failWith(session, toUserFacing("insert-failed"));
    }
  }

  /** Transcribe audio fuera de una sesión (botón "Probar dictado" de Opciones). */
  async transcribeStandalone(audio: CapturedAudio): Promise<string> {
    if (audio.speechMs < MIN_SPEECH_MS) throw new DictationError("no-speech");
    const text = await this.transcribe(audio);
    if (!text) throw new DictationError("no-speech");
    return text;
  }

  private async transcribe(audio: CapturedAudio): Promise<string> {
    const settings = await this.deps.getSettings();
    const apiKey = await this.deps.getApiKey();
    const provider = this.deps.createProvider(settings, apiKey);
    this.abort = new AbortController();
    const lang = resolveLanguage(settings.language, settings.prompt);
    try {
      const req = {
        audio: audio.blob,
        mimeType: audio.mimeType,
        filename: `audio.${extensionForMime(audio.mimeType)}`,
        durationMs: audio.durationMs,
        language: lang.language ?? "auto",
        ...(lang.prompt ? { prompt: lang.prompt } : {}),
      };
      const result = await provider.transcribe(req, this.abort.signal);
      log.info(`Transcripción en ${result.latencyMs} ms`);
      return settings.hallucinationFilter
        ? filterHallucinations(result, audio.speechMs, lang.prompt)
        : result.text.replace(/\s+/g, " ").trim();
    } finally {
      this.abort = null;
    }
  }

  cancel(reason: "user" | "tab-closed" | "replaced"): void {
    const session = this.session;
    if (!session) return;
    log.info("Dictado cancelado:", reason);
    this.capture?.cancel(session.sessionId);
    this.capture = null;
    this.abort?.abort();
    this.abort = null;
    this.session = null;
    void this.deps.saveSession(null);
    if (reason !== "tab-closed") {
      void this.notify(session, "idle");
    }
  }

  /** Recupera una sesión que quedó a medias si la event page se reinició. */
  async recoverInterrupted(stale: DictationSession | null): Promise<void> {
    if (!stale || !ACTIVE_PHASES.has(stale.phase)) return;
    await this.deps.saveSession(null);
    await this.notify(stale, "idle");
    await this.toast(stale.tabId, UI_STRINGS.toastInterrupted, "error");
  }

  private isCurrent(sessionId: string): boolean {
    return this.session?.sessionId === sessionId;
  }

  private async setPhase(session: DictationSession, phase: DictationPhase): Promise<void> {
    session.phase = phase;
    await this.deps.saveSession(ACTIVE_PHASES.has(phase) ? session : null);
    await this.notify(session, phase);
  }

  private async notify(session: DictationSession, phase: DictationPhase, error?: UserFacingError): Promise<void> {
    const msg: BackgroundToContent = { type: "ui/state", phase, sessionId: session.sessionId };
    if (error) msg.error = error;
    await this.deps.sendToFrame(session.tabId, 0, msg).catch(() => undefined);
    await this.deps
      .broadcast(session.tabId, {
        type: "session/active",
        active: ACTIVE_PHASES.has(phase),
        sessionId: session.sessionId,
      })
      .catch(() => undefined);
  }

  private async finish(session: DictationSession, phase: "success"): Promise<void> {
    this.session = null;
    session.phase = phase;
    await this.deps.saveSession(null);
    await this.notify(session, phase);
  }

  private async failWith(session: DictationSession, error: UserFacingError): Promise<void> {
    this.capture?.cancel(session.sessionId);
    this.capture = null;
    if (this.session?.sessionId === session.sessionId) this.session = null;
    session.phase = "error";
    session.error = error;
    await this.deps.saveSession(null);
    await this.notify(session, "error", error);
  }

  private async toast(tabId: number, message: string, variant: "info" | "error" | "success"): Promise<void> {
    await this.deps.sendToFrame(tabId, 0, { type: "ui/toast", message, variant }).catch(() => undefined);
  }
}
