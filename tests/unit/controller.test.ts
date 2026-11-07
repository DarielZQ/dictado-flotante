import { describe, expect, it, vi } from "vitest";
import type { CaptureHost } from "../../src/background/capture";
import { DictationController, type ControllerDeps } from "../../src/background/controller";
import type { SttProvider } from "../../src/background/stt/provider";
import { DictationError } from "../../src/shared/errors";
import type { BackgroundToContent } from "../../src/shared/messages";
import { DEFAULT_SETTINGS } from "../../src/shared/settings";
import type { AudioRecorderEvents } from "../../src/recorder/recorder";

function setup(over: Partial<ControllerDeps> = {}, captureOver: Partial<CaptureHost> = {}, text = "Hola mundo.") {
  const sent: Array<{ frameId: number; msg: BackgroundToContent }> = [];
  let events: AudioRecorderEvents | null = null;
  const capture: CaptureHost = {
    strategy: "background",
    start: vi.fn(async (_id, _o, ev) => {
      events = ev;
    }),
    stop: vi.fn(async () => ({ blob: new Blob(["a"]), mimeType: "audio/webm", durationMs: 2000, speechMs: 1500 })),
    cancel: vi.fn(),
    ...captureOver,
  };
  const provider: SttProvider = {
    id: "fake",
    transcribe: vi.fn(async () => ({ text, provider: "fake", model: "m", latencyMs: 5 })),
    testConnection: vi.fn(async () => undefined),
  };
  let n = 0;
  const deps: ControllerDeps = {
    getSettings: async () => DEFAULT_SETTINGS,
    getApiKey: async () => "key",
    getFocus: async () => ({ frameId: 3, kind: "input", at: 1 }),
    sendToFrame: vi.fn(async (_tab, frameId, msg) => {
      sent.push({ frameId, msg });
      if (msg.type === "inject/text") return { inserted: true, strategy: "execCommand", copiedToClipboard: false };
      return undefined;
    }),
    broadcast: vi.fn(async () => undefined),
    createCaptureHost: vi.fn(() => capture),
    createProvider: vi.fn(() => provider),
    writeClipboard: vi.fn(async () => true),
    saveSession: vi.fn(async () => undefined),
    newId: () => `s${++n}`,
    ...over,
  };
  const controller = new DictationController(deps);
  const phases = () => sent.filter((s) => s.msg.type === "ui/state").map((s) => (s.msg as { phase: string }).phase);
  return { controller, deps, capture, provider, sent, phases, events: () => events };
}

describe("DictationController", () => {
  it("flujo completo: arming → listening → transcribing → inserting → success", async () => {
    const t = setup();
    await t.controller.toggle(7);
    expect(t.controller.current?.phase).toBe("listening");
    expect(t.sent.find((s) => s.msg.type === "target/snapshot")?.frameId).toBe(3);
    await t.controller.toggle(7);
    expect(t.phases()).toEqual(["arming", "listening", "transcribing", "inserting", "success"]);
    const inject = t.sent.find((s) => s.msg.type === "inject/text");
    expect(inject?.frameId).toBe(3);
    expect((inject?.msg as { text: string }).text).toBe("Hola mundo.");
    expect(t.controller.current).toBeNull();
  });

  it("sin campo enfocado muestra un aviso y no graba", async () => {
    const t = setup({ getFocus: async () => undefined });
    await t.controller.start(7);
    expect(t.capture.start).not.toHaveBeenCalled();
    expect(t.sent[0]?.msg.type).toBe("ui/toast");
  });

  it("sin clave muestra error con acción abrir opciones", async () => {
    const t = setup({ getApiKey: async () => "" });
    await t.controller.start(7);
    const err = t.sent.find((s) => s.msg.type === "ui/state")?.msg as { phase: string; error?: { code: string; action: string } };
    expect(err.phase).toBe("error");
    expect(err.error?.code).toBe("missing-api-key");
    expect(err.error?.action).toBe("open-options");
  });

  it("en modo auto prueba la siguiente estrategia si se deniega el micrófono", async () => {
    const strategies: string[] = [];
    let calls = 0;
    const t = setup({
      createCaptureHost: vi.fn((strategy) => {
        strategies.push(strategy);
        return {
          strategy,
          start: vi.fn(async () => {
            if (calls++ === 0) throw new DictationError("mic-permission-denied");
          }),
          stop: vi.fn(),
          cancel: vi.fn(),
        } as unknown as CaptureHost;
      }),
    });
    await t.controller.start(7);
    expect(strategies).toEqual(["background", "extension-iframe"]);
    expect(t.controller.current?.phase).toBe("listening");
  });

  it("no envía el audio si casi no hubo voz", async () => {
    const t = setup({}, {
      stop: vi.fn(async () => ({ blob: new Blob(["a"]), mimeType: "audio/webm", durationMs: 2000, speechMs: 100 })),
    });
    await t.controller.start(7);
    await t.controller.stop("s1");
    expect(t.provider.transcribe).not.toHaveBeenCalled();
    expect(t.phases().at(-1)).toBe("error");
  });

  it("la auto-parada por silencio transcribe; la de «sin voz» cancela", async () => {
    const t = setup();
    await t.controller.start(7);
    await t.controller.onAutoStop("s1", "silence");
    expect(t.provider.transcribe).toHaveBeenCalledOnce();

    await t.controller.start(7);
    await t.controller.onAutoStop("s2", "no-speech");
    expect(t.capture.cancel).toHaveBeenCalled();
    expect(t.controller.current).toBeNull();
  });

  it("descarta alucinaciones y avisa de que no hubo voz", async () => {
    const t = setup({}, {}, "Subtítulos realizados por la comunidad de Amara.org");
    await t.controller.start(7);
    await t.controller.stop("s1");
    expect(t.sent.some((s) => s.msg.type === "inject/text")).toBe(false);
    expect(t.phases().at(-1)).toBe("error");
  });

  it("si el frame no puede insertar, copia al portapapeles y muestra error", async () => {
    const t = setup({
      sendToFrame: vi.fn(async (_t, _f, msg) =>
        msg.type === "inject/text" ? { inserted: false, strategy: "none", copiedToClipboard: false } : undefined,
      ),
    });
    await t.controller.start(7);
    await t.controller.stop("s1");
    expect(t.deps.writeClipboard).toHaveBeenCalledWith("Hola mundo.");
  });

  it("cancelar durante la transcripción descarta el resultado", async () => {
    let release!: () => void;
    const t = setup();
    (t.provider.transcribe as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ text: "tarde", provider: "f", model: "m", latencyMs: 1 });
        }),
    );
    await t.controller.start(7);
    const stopping = t.controller.stop("s1");
    await new Promise((r) => setTimeout(r, 0));
    await t.controller.toggle(7); // en transcribing → cancela
    release();
    await stopping;
    expect(t.sent.some((s) => s.msg.type === "inject/text")).toBe(false);
    expect(t.controller.current).toBeNull();
  });

  it("empezar en otra pestaña cancela la sesión anterior", async () => {
    const t = setup();
    await t.controller.start(7);
    await t.controller.start(8);
    expect(t.capture.cancel).toHaveBeenCalled();
    expect(t.controller.current?.tabId).toBe(8);
  });
});

describe("DictationController: idioma", () => {
  it("en modo mixto envía language=es con la pista bilingüe y el vocabulario", async () => {
    const { MIXED_ES_EN, MIXED_PROMPT } = await import("../../src/shared/languages");
    const t = setup({ getSettings: async () => ({ ...DEFAULT_SETTINGS, language: MIXED_ES_EN, prompt: "Groq" }) });
    await t.controller.toggle(7);
    await t.controller.toggle(7);
    const req = (t.provider.transcribe as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { language: string; prompt: string };
    expect(req.language).toBe("es");
    expect(req.prompt).toBe(`${MIXED_PROMPT} Groq`);
  });
});
