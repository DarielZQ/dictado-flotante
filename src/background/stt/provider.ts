export interface TranscriptionRequest {
  audio: Blob;
  mimeType: string;
  filename: string;
  language: string;
  prompt?: string;
  durationMs: number;
}

export interface TranscriptionSegment {
  text: string;
  start: number;
  end: number;
  noSpeechProb?: number;
  avgLogprob?: number;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  segments?: TranscriptionSegment[];
  provider: string;
  model: string;
  latencyMs: number;
}

/** Interfaz común de motores de transcripción (nube hoy; Whisper local en el futuro). */
export interface SttProvider {
  readonly id: string;
  transcribe(req: TranscriptionRequest, signal: AbortSignal): Promise<TranscriptionResult>;
  testConnection(signal: AbortSignal): Promise<void>;
}
