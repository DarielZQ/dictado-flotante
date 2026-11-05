import { describe, expect, it } from "vitest";
import { filterHallucinations } from "../../src/background/stt/hallucinations";
import type { TranscriptionResult } from "../../src/background/stt/provider";

const r = (text: string, segments?: TranscriptionResult["segments"]): TranscriptionResult => ({
  text,
  provider: "test",
  model: "m",
  latencyMs: 1,
  ...(segments ? { segments } : {}),
});

describe("filterHallucinations", () => {
  it("descarta la frase típica de Amara", () => {
    expect(filterHallucinations(r("Subtítulos realizados por la comunidad de Amara.org"), 2000)).toBe("");
  });

  it("descarta «Gracias por ver el vídeo»", () => {
    expect(filterHallucinations(r(" ¡Gracias por ver el vídeo! "), 3000)).toBe("");
  });

  it("conserva un «gracias» real si hubo voz suficiente", () => {
    expect(filterHallucinations(r("Gracias."), 2000)).toBe("Gracias.");
    expect(filterHallucinations(r("Gracias."), 800)).toBe("");
  });

  it("no toca frases normales que contienen las palabras", () => {
    expect(filterHallucinations(r("Gracias por ver el informe, Ana."), 3000)).toBe("Gracias por ver el informe, Ana.");
  });

  it("elimina segmentos con alta probabilidad de silencio", () => {
    const res = r(" Hola equipo. Suscríbete.", [
      { text: " Hola equipo.", start: 0, end: 1.2, noSpeechProb: 0.05, avgLogprob: -0.2 },
      { text: " Suscríbete.", start: 1.2, end: 3, noSpeechProb: 0.9, avgLogprob: -1.4 },
    ]);
    expect(filterHallucinations(res, 1500)).toBe("Hola equipo.");
  });

  it("devuelve vacío si solo hay puntuación", () => {
    expect(filterHallucinations(r(" ... "), 1000)).toBe("");
  });
});
