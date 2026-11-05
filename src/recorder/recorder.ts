import { DictationError } from "../shared/errors";
import { createLogger } from "../shared/logger";
import type { AutoStopReason, CaptureOptions } from "../shared/messages";
import { pickMimeType } from "./mime";
import { DEFAULT_VAD, rmsToDb, VoiceActivityDetector } from "./vad";

const log = createLogger("recorder");
const MAX_BYTES = 24 * 1024 * 1024;

export interface CapturedAudio {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  speechMs: number;
}

export interface AudioRecorderEvents {
  onLevel(level: number): void;
  onAutoStop(reason: AutoStopReason): void;
}

/** Traduce los errores de getUserMedia a códigos propios. */
export function mapMediaError(err: unknown): DictationError {
  const name = err instanceof DOMException || err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err);
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return /policy|feature/i.test(message)
        ? new DictationError("mic-blocked-by-site", message)
        : new DictationError("mic-permission-denied", message);
    case "NotFoundError":
    case "OverconstrainedError":
      return new DictationError("mic-not-found", message);
    case "NotReadableError":
    case "AbortError":
      return new DictationError("mic-busy", message);
    default:
      return new DictationError("internal", message);
  }
}

/**
 * Graba el micrófono con MediaRecorder y analiza el nivel para la auto-parada.
 * El mismo código se usa en el background, en el iframe grabador y en el content script.
 */
export class AudioRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private context: AudioContext | null = null;
  private chunks: Blob[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private vad: VoiceActivityDetector | null = null;
  private startedAt = 0;
  private mimeType = "";
  private autoStopFired = false;

  constructor(private readonly events: AudioRecorderEvents) {}

  get isRecording(): boolean {
    return this.recorder?.state === "recording";
  }

  async start(opts: CaptureOptions): Promise<void> {
    if (this.recorder) throw new DictationError("internal", "Grabación ya en curso");
    const audio: MediaTrackConstraints = {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    if (opts.deviceId) audio.deviceId = { exact: opts.deviceId };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio });
    } catch (err) {
      // Si el dispositivo guardado ya no existe, reintenta con el predeterminado.
      if (opts.deviceId && err instanceof DOMException && err.name === "OverconstrainedError") {
        delete audio.deviceId;
        try {
          this.stream = await navigator.mediaDevices.getUserMedia({ audio });
        } catch (err2) {
          throw mapMediaError(err2);
        }
      } else {
        throw mapMediaError(err);
      }
    }

    this.mimeType = pickMimeType();
    this.chunks = [];
    this.autoStopFired = false;
    this.recorder = new MediaRecorder(this.stream, { mimeType: this.mimeType, audioBitsPerSecond: 32000 });
    this.recorder.addEventListener("dataavailable", (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    });
    this.recorder.start(1000);
    this.startedAt = performance.now();

    this.vad = new VoiceActivityDetector({
      ...DEFAULT_VAD,
      silenceMs: opts.autoStop.silenceMs,
      maxDurationMs: opts.autoStop.maxDurationMs,
      noSpeechTimeoutMs: opts.autoStop.noSpeechTimeoutMs,
      autoStopEnabled: opts.autoStop.enabled,
    });

    // La duración máxima se respeta aunque el análisis de audio no funcione.
    this.maxTimer = setTimeout(() => this.fireAutoStop("max-duration"), opts.autoStop.maxDurationMs + 250);
    await this.startAnalysis();
  }

  private async startAnalysis(): Promise<void> {
    if (!this.stream || !this.vad) return;
    try {
      this.context = new AudioContext();
      if (this.context.state !== "running") await this.context.resume().catch(() => undefined);
      const source = this.context.createMediaStreamSource(this.stream);
      const analyser = this.context.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);
      const vad = this.vad;
      this.timer = setInterval(() => {
        analyser.getFloatTimeDomainData(buffer);
        const event = vad.push(rmsToDb(buffer));
        this.events.onLevel(vad.level);
        if (event?.type === "auto-stop") this.fireAutoStop(event.reason);
      }, DEFAULT_VAD.frameMs);
      if (this.context.state !== "running") {
        log.warn("AudioContext no está en ejecución; la auto-parada por silencio no funcionará", this.context.state);
      }
    } catch (err) {
      log.warn("No se pudo iniciar el análisis de audio", err);
    }
  }

  private fireAutoStop(reason: AutoStopReason): void {
    if (this.autoStopFired || !this.recorder) return;
    this.autoStopFired = true;
    this.events.onAutoStop(reason);
  }

  async stop(): Promise<CapturedAudio> {
    const recorder = this.recorder;
    if (!recorder) throw new DictationError("internal", "No hay grabación en curso");
    const durationMs = Math.round(performance.now() - this.startedAt);
    // Si no funciona el análisis, no se puede medir la voz: se asume que la hay.
    const speechMs = this.vad && this.context?.state === "running" ? this.vad.speechMs : durationMs;
    try {
      if (recorder.state !== "inactive") {
        await new Promise<void>((resolve) => {
          recorder.addEventListener("stop", () => resolve(), { once: true });
          recorder.stop();
        });
      }
      const blob = new Blob(this.chunks, { type: this.mimeType });
      if (blob.size > MAX_BYTES) throw new DictationError("payload-too-large");
      return { blob, mimeType: this.mimeType, durationMs, speechMs };
    } finally {
      this.release();
    }
  }

  cancel(): void {
    try {
      if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    } catch {
      // ignorar
    }
    this.release();
  }

  private release(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.maxTimer) clearTimeout(this.maxTimer);
    this.timer = null;
    this.maxTimer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.recorder = null;
    this.vad = null;
    this.chunks = [];
  }
}
