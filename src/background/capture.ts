import { DictationError } from "../shared/errors";
import { createLogger } from "../shared/logger";
import {
  RECORDER_PORT_PREFIX,
  type BackgroundToContent,
  type CaptureOptions,
  type RecorderCommand,
  type RecorderEvent,
} from "../shared/messages";
import type { CaptureStrategy, Settings } from "../shared/settings";
import { AudioRecorder, type AudioRecorderEvents, type CapturedAudio } from "../recorder/recorder";

const log = createLogger("capture");
const READY_TIMEOUT_MS = 6000;
const START_TIMEOUT_MS = 20000; // incluye el tiempo que el usuario tarda en aceptar el permiso
const AUDIO_TIMEOUT_MS = 10000;

/** Orden por defecto para la estrategia "auto" (ver docs/DECISIONS.md). */
export const AUTO_ORDER: CaptureStrategy[] = ["background", "extension-iframe", "content-script"];

export interface CaptureHost {
  readonly strategy: CaptureStrategy;
  start(sessionId: string, opts: CaptureOptions, events: AudioRecorderEvents): Promise<void>;
  stop(sessionId: string): Promise<CapturedAudio>;
  cancel(sessionId: string): void;
}

/** Errores tras los que tiene sentido probar la siguiente estrategia. */
export function shouldTryNextStrategy(err: unknown): boolean {
  return (
    err instanceof DictationError &&
    ["mic-permission-denied", "mic-blocked-by-site", "internal", "timeout"].includes(err.code)
  );
}

export function strategiesFor(setting: Settings["captureStrategy"]): CaptureStrategy[] {
  return setting === "auto" ? AUTO_ORDER : [setting];
}

// ---------- Estrategia "background": graba en la propia event page ----------
export class BackgroundCaptureHost implements CaptureHost {
  readonly strategy = "background" as const;
  private recorder: AudioRecorder | null = null;

  async start(_sessionId: string, opts: CaptureOptions, events: AudioRecorderEvents): Promise<void> {
    this.recorder = new AudioRecorder(events);
    try {
      await this.recorder.start(opts);
    } catch (err) {
      this.recorder = null;
      throw err;
    }
  }

  async stop(): Promise<CapturedAudio> {
    const rec = this.recorder;
    this.recorder = null;
    if (!rec) throw new DictationError("internal", "Sin grabación");
    return rec.stop();
  }

  cancel(): void {
    this.recorder?.cancel();
    this.recorder = null;
  }
}

// ---------- Estrategias remotas: iframe de la extensión o content script ----------
type PortWaiter = (port: browser.runtime.Port) => void;
const portWaiters = new Map<string, PortWaiter>();

/** Llamar desde runtime.onConnect. Devuelve true si el puerto era de un grabador. */
export function handleRecorderPort(port: browser.runtime.Port): boolean {
  if (!port.name.startsWith(RECORDER_PORT_PREFIX)) return false;
  const sessionId = port.name.slice(RECORDER_PORT_PREFIX.length);
  const waiter = portWaiters.get(sessionId);
  if (!waiter) {
    port.disconnect();
    return true;
  }
  portWaiters.delete(sessionId);
  waiter(port);
  return true;
}

function withTimeout<T>(promise: Promise<T>, ms: number, code: "timeout" | "internal" = "timeout"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new DictationError(code, `Tiempo de espera agotado (${ms} ms)`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export class RemoteCaptureHost implements CaptureHost {
  readonly strategy: CaptureStrategy;
  private port: browser.runtime.Port | null = null;
  private pending: { resolve: (e: RecorderEvent) => void; types: RecorderEvent["type"][] } | null = null;
  private events: AudioRecorderEvents | null = null;

  constructor(
    private readonly tabId: number,
    private readonly mode: "iframe" | "content",
    private readonly sendToTop: (tabId: number, msg: BackgroundToContent) => Promise<unknown>,
  ) {
    this.strategy = mode === "iframe" ? "extension-iframe" : "content-script";
  }

  async start(sessionId: string, opts: CaptureOptions, events: AudioRecorderEvents): Promise<void> {
    this.events = events;
    const portPromise = new Promise<browser.runtime.Port>((resolve) => portWaiters.set(sessionId, resolve));
    try {
      await this.sendToTop(this.tabId, { type: "recorder/mount", sessionId, mode: this.mode });
      this.port = await withTimeout(portPromise, READY_TIMEOUT_MS, "internal");
    } catch (err) {
      portWaiters.delete(sessionId);
      throw err;
    }

    this.port.onMessage.addListener((raw: unknown) => this.onEvent(raw as RecorderEvent));
    this.port.onDisconnect.addListener(() => {
      this.port = null;
      this.pending?.resolve({
        type: "recorder/error",
        sessionId,
        error: new DictationError("internal", "El grabador se desconectó").toUserFacing(),
      });
    });

    const reply = await withTimeout(
      this.waitFor(["recorder/started", "recorder/error"], () =>
        this.post({ type: "recorder/start", sessionId, options: opts }),
      ),
      START_TIMEOUT_MS,
    ).catch((err) => {
      this.cancel(sessionId);
      throw err;
    });
    if (reply.type === "recorder/error") {
      this.cancel(sessionId);
      throw new DictationError(reply.error.code, reply.error.message);
    }
  }

  async stop(sessionId: string): Promise<CapturedAudio> {
    const reply = await withTimeout(
      this.waitFor(["recorder/audio", "recorder/error"], () => this.post({ type: "recorder/stop", sessionId })),
      AUDIO_TIMEOUT_MS,
    ).finally(() => this.unmount(sessionId));
    if (reply.type === "recorder/error") throw new DictationError(reply.error.code, reply.error.message);
    if (reply.type !== "recorder/audio") throw new DictationError("internal");
    return {
      blob: new Blob([reply.audio], { type: reply.mimeType }),
      mimeType: reply.mimeType,
      durationMs: reply.durationMs,
      speechMs: reply.speechMs,
    };
  }

  cancel(sessionId: string): void {
    this.post({ type: "recorder/cancel", sessionId });
    try {
      this.port?.disconnect();
    } catch {
      // ignorar
    }
    this.port = null;
    this.unmount(sessionId);
  }

  private unmount(sessionId: string): void {
    void this.sendToTop(this.tabId, { type: "recorder/unmount", sessionId }).catch(() => undefined);
  }

  private post(msg: RecorderCommand): void {
    try {
      this.port?.postMessage(msg);
    } catch (err) {
      log.warn("No se pudo enviar al grabador", err);
    }
  }

  private waitFor(types: RecorderEvent["type"][], send: () => void): Promise<RecorderEvent> {
    return new Promise<RecorderEvent>((resolve) => {
      this.pending = { resolve, types };
      send();
    });
  }

  private onEvent(msg: RecorderEvent): void {
    if (msg.type === "recorder/level") {
      this.events?.onLevel(msg.level);
      return;
    }
    if (msg.type === "recorder/auto-stop") {
      this.events?.onAutoStop(msg.reason);
      return;
    }
    if (this.pending && this.pending.types.includes(msg.type)) {
      const { resolve } = this.pending;
      this.pending = null;
      resolve(msg);
    }
  }
}

export function createCaptureHost(
  strategy: CaptureStrategy,
  tabId: number,
  sendToTop: (tabId: number, msg: BackgroundToContent) => Promise<unknown>,
): CaptureHost {
  switch (strategy) {
    case "background":
      return new BackgroundCaptureHost();
    case "extension-iframe":
      return new RemoteCaptureHost(tabId, "iframe", sendToTop);
    case "content-script":
      return new RemoteCaptureHost(tabId, "content", sendToTop);
  }
}
