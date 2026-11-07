import { describe, expect, it, vi } from "vitest";
import { filterHallucinations } from "../../src/background/stt/hallucinations";
import { FloatingButton } from "../../src/content/ui/floating-button";
import {
  isKnownLanguage,
  LANGUAGES,
  MIXED_ES_EN,
  MIXED_PROMPT,
  resolveLanguage,
  shortLabel,
} from "../../src/shared/languages";
import { DEFAULT_SETTINGS, migrate } from "../../src/shared/settings";

describe("resolveLanguage", () => {
  it("idioma fijo: se envía tal cual", () => {
    expect(resolveLanguage("en")).toEqual({ language: "en" });
  });

  it("automático: no se envía language", () => {
    expect(resolveLanguage("auto", "Kubernetes")).toEqual({ prompt: "Kubernetes" });
  });

  it("mixto: español con la pista bilingüe y el vocabulario del usuario", () => {
    expect(resolveLanguage(MIXED_ES_EN)).toEqual({ language: "es", prompt: MIXED_PROMPT });
    expect(resolveLanguage(MIXED_ES_EN, "  Groq  ").prompt).toBe(`${MIXED_PROMPT} Groq`);
  });
});

describe("lista de idiomas", () => {
  it("códigos únicos, etiqueta corta y el mixto sobrevive a la migración", () => {
    expect(new Set(LANGUAGES.map((l) => l.code)).size).toBe(LANGUAGES.length);
    expect(shortLabel(MIXED_ES_EN)).toBe("ES+EN");
    expect(migrate({ language: MIXED_ES_EN }).language).toBe(MIXED_ES_EN);
  });

  it("isKnownLanguage rechaza valores fuera de la lista", () => {
    expect(isKnownLanguage("es")).toBe(true);
    expect(isKnownLanguage("xx")).toBe(false);
    expect(isKnownLanguage({ language: "es" })).toBe(false);
  });
});

describe("eco de la pista", () => {
  const result = (text: string) => ({ text, provider: "t", model: "m", latencyMs: 1 });

  it("descarta la pista repetida con poco audio", () => {
    expect(filterHallucinations(result("I will send you the link."), 1200, MIXED_PROMPT)).toBe("");
  });

  it("conserva la misma frase si hubo voz de sobra", () => {
    expect(filterHallucinations(result("I will send you the link."), 4000, MIXED_PROMPT)).toBe("I will send you the link.");
  });

  it("no descarta palabras sueltas que también estén en la pista", () => {
    expect(filterHallucinations(result("Perfecto."), 900, MIXED_PROMPT)).toBe("Perfecto.");
  });
});

describe("FloatingButton: idioma", () => {
  function mount(language = "es") {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: "open" });
    const onSelectLanguage = vi.fn();
    const button = new FloatingButton({
      root,
      initialPosition: null,
      sizePx: 44,
      language,
      onActivate: vi.fn(),
      onSelectLanguage,
      onHideForSite: vi.fn(),
      onOpenOptions: vi.fn(),
      onPositionChange: vi.fn(),
    });
    return { root, button, onSelectLanguage };
  }

  it("muestra la etiqueta y cambia de idioma desde el menú", () => {
    const { root, onSelectLanguage } = mount("es");
    const badge = () => root.querySelector('[data-testid="dictado-language"]')?.textContent;
    expect(badge()).toBe("ES");
    const items = [...root.querySelectorAll<HTMLButtonElement>("button.df-lang")];
    expect(items.map((b) => b.dataset.lang)).toEqual(["es", "en", MIXED_ES_EN, "auto"]);
    expect(items[0]?.getAttribute("aria-checked")).toBe("true");
    items.find((b) => b.dataset.lang === MIXED_ES_EN)?.click();
    expect(onSelectLanguage).toHaveBeenCalledWith(MIXED_ES_EN);
    expect(badge()).toBe("ES+EN");
    expect(root.querySelector('button.df-lang[aria-checked="true"]')?.getAttribute("data-lang")).toBe(MIXED_ES_EN);
  });

  it("añade al menú el idioma actual si no es de los rápidos", () => {
    const { root, button } = mount("fr");
    expect(root.querySelector('[data-testid="dictado-language"]')?.textContent).toBe("FR");
    expect(root.querySelectorAll("button.df-lang")).toHaveLength(5);
    button.setLanguage("en");
    expect(root.querySelectorAll("button.df-lang")).toHaveLength(4);
  });
});

it("el idioma por defecto sigue siendo español", () => {
  expect(DEFAULT_SETTINGS.language).toBe("es");
});
