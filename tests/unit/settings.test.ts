import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  deepMerge,
  getApiKey,
  loadSettings,
  migrate,
  normalizeBaseUrl,
  saveSettings,
  setApiKey,
  toPublic,
} from "../../src/shared/settings";

describe("settings", () => {
  it("migrate devuelve los valores por defecto con basura", () => {
    expect(migrate(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(migrate("x")).toEqual(DEFAULT_SETTINGS);
    expect(migrate({ autoStop: "nope", ui: 3 })).toEqual(DEFAULT_SETTINGS);
  });

  it("migrate limita rangos y descarta valores inválidos", () => {
    const s = migrate({
      autoStop: { silenceMs: 50, maxDurationMs: 99999999, noSpeechTimeoutMs: "8" },
      captureStrategy: "telepatía",
      ui: { buttonSizePx: 500, hiddenHosts: ["a.com", "a.com", 3, ""], positions: { "b.com": { xPct: 150, yPct: -3 } } },
    });
    expect(s.autoStop.silenceMs).toBe(800);
    expect(s.autoStop.maxDurationMs).toBe(600000);
    expect(s.autoStop.noSpeechTimeoutMs).toBe(8000);
    expect(s.captureStrategy).toBe("auto");
    expect(s.ui.buttonSizePx).toBe(72);
    expect(s.ui.hiddenHosts).toEqual(["a.com"]);
    expect(s.ui.positions["b.com"]).toEqual({ xPct: 100, yPct: 0 });
  });

  it("normalizeBaseUrl solo acepta https o localhost", () => {
    expect(normalizeBaseUrl("https://api.openai.com/v1/")).toBe("https://api.openai.com/v1");
    expect(normalizeBaseUrl("http://localhost:8080/v1")).toBe("http://localhost:8080/v1");
    expect(normalizeBaseUrl("http://evil.example/v1")).toBe("https://api.groq.com/openai/v1");
    expect(normalizeBaseUrl("no es url")).toBe("https://api.groq.com/openai/v1");
  });

  it("deepMerge sustituye positions y arrays completos", () => {
    const merged = deepMerge(DEFAULT_SETTINGS, { ui: { hiddenHosts: ["x.com"] }, autoStop: { enabled: false } });
    expect(merged.ui.hiddenHosts).toEqual(["x.com"]);
    expect(merged.ui.buttonSizePx).toBe(44);
    expect(merged.autoStop.enabled).toBe(false);
    expect(merged.autoStop.silenceMs).toBe(2500);
  });

  it("guarda y carga ajustes y clave por separado", async () => {
    await saveSettings({ language: "en" });
    expect((await loadSettings()).language).toBe("en");
    await setApiKey("  gsk_secreta  ");
    expect(await getApiKey()).toBe("gsk_secreta");
    expect(JSON.stringify(await loadSettings())).not.toContain("gsk_secreta");
  });

  it("toPublic no expone el proveedor ni la clave", () => {
    const pub = toPublic(DEFAULT_SETTINGS);
    expect(Object.keys(pub).sort()).toEqual(["language", "smartFormatting", "ui"]);
  });
});
