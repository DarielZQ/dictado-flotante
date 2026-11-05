import { DictationError, isAbortError } from "../../shared/errors";
import { createLogger } from "../../shared/logger";
import type { SttProvider, TranscriptionRequest, TranscriptionResult, TranscriptionSegment } from "./provider";

const log = createLogger("stt");
const TIMEOUT_MS = 30000;
const RETRY_DELAY_MS = 800;

export interface OpenAiCompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  responseFormat: "verbose_json" | "json";
  /** Se llama si el proveedor no acepta verbose_json y se cambia a json. */
  onResponseFormatFallback?: () => void;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

interface RawSegment {
  text?: unknown;
  start?: unknown;
  end?: unknown;
  no_speech_prob?: unknown;
  avg_logprob?: unknown;
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Lee la espera recomendada de las cabeceras de un 429. */
export function parseRetryAfter(headers: Headers): number {
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(1, Math.ceil(seconds));
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.max(1, Math.ceil((date - Date.now()) / 1000));
  }
  // Groq: x-ratelimit-reset-requests / -tokens con formato "2m59.56s", "7.66s", "120ms".
  for (const name of ["x-ratelimit-reset-requests", "x-ratelimit-reset-tokens", "x-ratelimit-reset-audio-seconds"]) {
    const value = headers.get(name);
    if (!value) continue;
    const match = /^(?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)s)?(?:([\d.]+)ms)?$/.exec(value.trim());
    if (match) {
      const [, h, m, s, ms] = match;
      const total = Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0) + Number(ms ?? 0) / 1000;
      if (total > 0) return Math.max(1, Math.ceil(total));
    }
  }
  return 60;
}

async function readErrorText(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text) as { error?: { message?: string } };
      return json.error?.message ?? text;
    } catch {
      return text;
    }
  } catch {
    return "";
  }
}

/** Cliente para /audio/transcriptions de APIs compatibles con OpenAI (Groq por defecto). */
export class OpenAiCompatibleProvider implements SttProvider {
  readonly id = "openai-compatible";
  private responseFormat: "verbose_json" | "json";
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly cfg: OpenAiCompatibleConfig) {
    this.responseFormat = cfg.responseFormat;
    this.fetchImpl = cfg.fetchImpl ?? ((...args) => fetch(...args));
    this.sleep = cfg.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async testConnection(signal: AbortSignal): Promise<void> {
    this.requireKey();
    const res = await this.request(`${this.cfg.baseUrl}/models`, { method: "GET" }, signal);
    if (!res.ok) throw await this.httpError(res);
  }

  async transcribe(req: TranscriptionRequest, signal: AbortSignal): Promise<TranscriptionResult> {
    this.requireKey();
    const started = performance.now();
    let attempt = 0;
    let formatFallbackDone = false;

    for (;;) {
      try {
        const res = await this.request(
          `${this.cfg.baseUrl}/audio/transcriptions`,
          { method: "POST", body: this.buildForm(req) },
          signal,
        );
        if (res.ok) return this.parse(await res.json(), performance.now() - started);

        if (res.status === 400 && !formatFallbackDone && this.responseFormat === "verbose_json") {
          const text = await readErrorText(res);
          if (/response_format/i.test(text)) {
            log.info("El proveedor no acepta verbose_json; se usa json");
            this.responseFormat = "json";
            formatFallbackDone = true;
            this.cfg.onResponseFormatFallback?.();
            continue;
          }
          throw new DictationError("bad-request", text.slice(0, 300));
        }
        const error = await this.httpError(res);
        if (error.code === "provider-unavailable" && attempt === 0) {
          attempt++;
          await this.sleep(RETRY_DELAY_MS);
          continue;
        }
        throw error;
      } catch (err) {
        if (err instanceof DictationError && err.code === "network" && attempt === 0) {
          attempt++;
          await this.sleep(RETRY_DELAY_MS);
          continue;
        }
        throw err;
      }
    }
  }

  private requireKey(): void {
    if (!this.cfg.apiKey) throw new DictationError("missing-api-key");
  }

  private buildForm(req: TranscriptionRequest): FormData {
    const form = new FormData();
    form.append("file", new File([req.audio], req.filename, { type: req.mimeType }));
    form.append("model", this.cfg.model);
    if (req.language && req.language !== "auto") form.append("language", req.language);
    form.append("response_format", this.responseFormat);
    form.append("temperature", "0");
    if (req.prompt) form.append("prompt", req.prompt);
    return form;
  }

  private async request(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const combined = AbortSignal.any([signal, timeout]);
    try {
      return await this.fetchImpl(url, {
        ...init,
        headers: { Authorization: `Bearer ${this.cfg.apiKey}` },
        signal: combined,
      });
    } catch (err) {
      if (signal.aborted) throw err; // cancelación del usuario: se propaga tal cual
      if (timeout.aborted || (err instanceof DOMException && err.name === "TimeoutError")) {
        throw new DictationError("timeout");
      }
      if (isAbortError(err)) throw err;
      throw new DictationError("network", err instanceof Error ? err.message : String(err));
    }
  }

  private async httpError(res: Response): Promise<DictationError> {
    const detail = (await readErrorText(res)).slice(0, 300);
    if (res.status === 401 || res.status === 403) return new DictationError("invalid-api-key", detail);
    if (res.status === 413) return new DictationError("payload-too-large", detail);
    if (res.status === 429) {
      return new DictationError("rate-limited", detail, undefined, parseRetryAfter(res.headers));
    }
    if (res.status >= 500) return new DictationError("provider-unavailable", detail);
    return new DictationError("bad-request", detail, { status: res.status });
  }

  private parse(json: unknown, latencyMs: number): TranscriptionResult {
    const body = (typeof json === "object" && json !== null ? json : {}) as {
      text?: unknown;
      language?: unknown;
      segments?: unknown;
    };
    const result: TranscriptionResult = {
      text: typeof body.text === "string" ? body.text : "",
      provider: this.id,
      model: this.cfg.model,
      latencyMs: Math.round(latencyMs),
    };
    if (typeof body.language === "string") result.language = body.language;
    if (Array.isArray(body.segments)) {
      result.segments = (body.segments as RawSegment[]).map((s) => {
        const seg: TranscriptionSegment = {
          text: typeof s.text === "string" ? s.text : "",
          start: num(s.start) ?? 0,
          end: num(s.end) ?? 0,
        };
        const nsp = num(s.no_speech_prob);
        const alp = num(s.avg_logprob);
        if (nsp !== undefined) seg.noSpeechProb = nsp;
        if (alp !== undefined) seg.avgLogprob = alp;
        return seg;
      });
    }
    return result;
  }
}
