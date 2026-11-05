import type { AutoStopReason } from "../shared/messages";

export interface VadConfig {
  frameMs: number;
  calibrationMs: number;
  minThresholdDb: number;
  marginDb: number;
  hysteresisDb: number;
  speechConfirmMs: number;
  silenceMs: number;
  maxDurationMs: number;
  noSpeechTimeoutMs: number;
  autoStopEnabled: boolean;
}

export type VadEvent = { type: "speech-start" } | { type: "auto-stop"; reason: AutoStopReason };

export const DEFAULT_VAD: Omit<VadConfig, "silenceMs" | "maxDurationMs" | "noSpeechTimeoutMs" | "autoStopEnabled"> = {
  frameMs: 50,
  calibrationMs: 300,
  minThresholdDb: -55,
  marginDb: 12,
  hysteresisDb: 3,
  speechConfirmMs: 150,
};

/** Convierte muestras PCM (-1..1) en dBFS. */
export function rmsToDb(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] ?? 0;
    sum += s * s;
  }
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  return rms > 0 ? 20 * Math.log10(rms) : -100;
}

/**
 * Detector de voz por energía con umbral adaptativo.
 * Lógica pura: se alimenta con un valor en dB cada `frameMs`.
 */
export class VoiceActivityDetector {
  private elapsed = 0;
  private speech = 0;
  private silenceRun = 0;
  private speechStarted = false;
  private calibration: number[] = [];
  private threshold: number;
  private lastDb = -100;
  private stopped = false;

  constructor(private readonly cfg: VadConfig) {
    this.threshold = cfg.minThresholdDb;
  }

  push(db: number): VadEvent | null {
    if (this.stopped) return null;
    const { frameMs } = this.cfg;
    this.elapsed += frameMs;
    this.lastDb = db;

    if (this.elapsed <= this.cfg.calibrationMs) {
      this.calibration.push(db);
      const sorted = [...this.calibration].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] ?? this.cfg.minThresholdDb;
      this.threshold = Math.max(median + this.cfg.marginDb, this.cfg.minThresholdDb);
    }

    let event: VadEvent | null = null;
    const isSpeech = db > this.threshold;
    const isSilence = db < this.threshold - this.cfg.hysteresisDb;

    if (isSpeech) {
      this.speech += frameMs;
      this.silenceRun = 0;
      if (!this.speechStarted && this.speech >= this.cfg.speechConfirmMs) {
        this.speechStarted = true;
        event = { type: "speech-start" };
      }
    } else if (isSilence) {
      this.silenceRun += frameMs;
    }

    if (this.elapsed >= this.cfg.maxDurationMs) return this.finish("max-duration");
    if (this.cfg.autoStopEnabled) {
      if (this.speechStarted && this.silenceRun >= this.cfg.silenceMs) return this.finish("silence");
      if (!this.speechStarted && this.elapsed >= this.cfg.noSpeechTimeoutMs) return this.finish("no-speech");
    }
    return event;
  }

  private finish(reason: AutoStopReason): VadEvent {
    this.stopped = true;
    return { type: "auto-stop", reason };
  }

  get speechMs(): number {
    return this.speech;
  }

  get elapsedMs(): number {
    return this.elapsed;
  }

  get hasSpeech(): boolean {
    return this.speechStarted;
  }

  /** Nivel 0..1 normalizado entre -60 dB y -10 dB. */
  get level(): number {
    return Math.min(1, Math.max(0, (this.lastDb + 60) / 50));
  }
}
