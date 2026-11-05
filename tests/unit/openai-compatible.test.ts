import { describe, expect, it, vi } from "vitest";
import { OpenAiCompatibleProvider, parseRetryAfter } from "../../src/background/stt/openai-compatible";
import { DictationError } from "../../src/shared/errors";

const req = {
  audio: new Blob(["x"], { type: "audio/webm" }),
  mimeType: "audio/webm",
  filename: "audio.webm",
  language: "es",
  durationMs: 1000,
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function provider(fetchImpl: typeof fetch, over: Partial<ConstructorParameters<typeof OpenAiCompatibleProvider>[0]> = {}) {
  return new OpenAiCompatibleProvider({
    baseUrl: "https://api.groq.com/openai/v1",
    apiKey: "test-key",
    model: "whisper-large-v3-turbo",
    responseFormat: "verbose_json",
    fetchImpl,
    sleep: async () => undefined,
    ...over,
  });
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (err) {
    return err instanceof DictationError ? err.code : String(err);
  }
}

describe("OpenAiCompatibleProvider", () => {
  it("envía el formulario correcto y parsea verbose_json", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const form = init!.body as FormData;
      expect(form.get("model")).toBe("whisper-large-v3-turbo");
      expect(form.get("language")).toBe("es");
      expect(form.get("response_format")).toBe("verbose_json");
      expect(form.get("temperature")).toBe("0");
      expect((form.get("file") as File).name).toBe("audio.webm");
      expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
      return json({
        text: " Hola mundo.",
        language: "spanish",
        segments: [{ text: " Hola mundo.", start: 0, end: 1, no_speech_prob: 0.01, avg_logprob: -0.1 }],
      });
    });
    const res = await provider(fetchImpl as unknown as typeof fetch).transcribe(req, new AbortController().signal);
    expect(fetchImpl).toHaveBeenCalledWith("https://api.groq.com/openai/v1/audio/transcriptions", expect.anything());
    expect(res.text).toBe(" Hola mundo.");
    expect(res.segments?.[0]?.noSpeechProb).toBe(0.01);
  });

  it("omite language con «auto» y parsea json simple", async () => {
    const fetchImpl = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      expect((init!.body as FormData).has("language")).toBe(false);
      return json({ text: "hello" });
    });
    const res = await provider(fetchImpl as unknown as typeof fetch).transcribe(
      { ...req, language: "auto" },
      new AbortController().signal,
    );
    expect(res.text).toBe("hello");
  });

  it.each([
    [401, "invalid-api-key"],
    [403, "invalid-api-key"],
    [413, "payload-too-large"],
    [422, "bad-request"],
  ])("HTTP %i → %s", async (status, code) => {
    const fetchImpl = vi.fn(async () => json({ error: { message: "x" } }, status));
    expect(await codeOf(provider(fetchImpl as unknown as typeof fetch).transcribe(req, new AbortController().signal))).toBe(code);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("429 devuelve rate-limited con la espera de retry-after", async () => {
    const fetchImpl = vi.fn(async () => json({ error: { message: "limit" } }, 429, { "retry-after": "17" }));
    try {
      await provider(fetchImpl as unknown as typeof fetch).transcribe(req, new AbortController().signal);
      expect.fail("debía lanzar");
    } catch (err) {
      expect(err).toBeInstanceOf(DictationError);
      expect((err as DictationError).code).toBe("rate-limited");
      expect((err as DictationError).retryAfterSeconds).toBe(17);
      expect((err as DictationError).toUserFacing().message).toContain("17");
    }
  });

  it("reintenta una vez ante 5xx", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ error: { message: "boom" } }, 503))
      .mockResolvedValueOnce(json({ text: "ok" }));
    const res = await provider(fetchImpl as unknown as typeof fetch).transcribe(req, new AbortController().signal);
    expect(res.text).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("5xx repetido → provider-unavailable", async () => {
    const fetchImpl = vi.fn(async () => json({}, 500));
    expect(await codeOf(provider(fetchImpl as unknown as typeof fetch).transcribe(req, new AbortController().signal))).toBe(
      "provider-unavailable",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("error de red → reintento y luego network", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("NetworkError when attempting to fetch resource.");
    });
    expect(await codeOf(provider(fetchImpl as unknown as typeof fetch).transcribe(req, new AbortController().signal))).toBe(
      "network",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("sin clave → missing-api-key sin llamar a la red", async () => {
    const fetchImpl = vi.fn();
    expect(
      await codeOf(provider(fetchImpl as unknown as typeof fetch, { apiKey: "" }).transcribe(req, new AbortController().signal)),
    ).toBe("missing-api-key");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("si no acepta verbose_json, reintenta con json y avisa", async () => {
    const onFallback = vi.fn();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ error: { message: "response_format verbose_json is not supported" } }, 400))
      .mockImplementationOnce(async (_u: RequestInfo | URL, init?: RequestInit) => {
        expect((init!.body as FormData).get("response_format")).toBe("json");
        return json({ text: "vale" });
      });
    const res = await provider(fetchImpl as unknown as typeof fetch, { onResponseFormatFallback: onFallback }).transcribe(
      req,
      new AbortController().signal,
    );
    expect(res.text).toBe("vale");
    expect(onFallback).toHaveBeenCalledOnce();
  });

  it("la cancelación del usuario se propaga como AbortError", async () => {
    const ctrl = new AbortController();
    const fetchImpl = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      ctrl.abort();
      throw init!.signal!.reason ?? new DOMException("Aborted", "AbortError");
    });
    await expect(provider(fetchImpl as unknown as typeof fetch).transcribe(req, ctrl.signal)).rejects.toHaveProperty(
      "name",
      "AbortError",
    );
  });

  it("testConnection usa GET /models", async () => {
    const fetchImpl = vi.fn(async () => json({ data: [] }));
    await provider(fetchImpl as unknown as typeof fetch).testConnection(new AbortController().signal);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.groq.com/openai/v1/models",
      expect.objectContaining({ method: "GET" }),
    );
  });
});

describe("parseRetryAfter", () => {
  it.each([
    [{ "retry-after": "5" }, 5],
    [{ "x-ratelimit-reset-requests": "2m59.56s" }, 180],
    [{ "x-ratelimit-reset-requests": "7.66s" }, 8],
    [{ "x-ratelimit-reset-requests": "120ms" }, 1],
    [{}, 60],
  ])("%o → %i", (headers, expected) => {
    expect(parseRetryAfter(new Headers(headers))).toBe(expected);
  });
});
