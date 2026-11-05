import { describe, expect, it } from "vitest";
import { DEFAULT_VAD, rmsToDb, VoiceActivityDetector, type VadConfig } from "../../src/recorder/vad";

const cfg = (over: Partial<VadConfig> = {}): VadConfig => ({
  ...DEFAULT_VAD,
  silenceMs: 2500,
  maxDurationMs: 120000,
  noSpeechTimeoutMs: 8000,
  autoStopEnabled: true,
  ...over,
});

function feed(vad: VoiceActivityDetector, db: number, ms: number) {
  const events = [];
  for (let t = 0; t < ms; t += 50) {
    const e = vad.push(db);
    if (e) events.push(e);
  }
  return events;
}

describe("VoiceActivityDetector", () => {
  it("detecta voz y para tras el silencio configurado", () => {
    const vad = new VoiceActivityDetector(cfg());
    feed(vad, -70, 300); // calibración con ruido de fondo
    expect(feed(vad, -25, 1000)).toEqual([{ type: "speech-start" }]);
    expect(feed(vad, -70, 2400)).toEqual([]);
    expect(feed(vad, -70, 200)).toEqual([{ type: "auto-stop", reason: "silence" }]);
    expect(vad.speechMs).toBe(1000);
  });

  it("cancela si no hay voz en el tiempo límite", () => {
    const vad = new VoiceActivityDetector(cfg({ noSpeechTimeoutMs: 2000 }));
    const events = feed(vad, -70, 2100);
    expect(events).toEqual([{ type: "auto-stop", reason: "no-speech" }]);
  });

  it("respeta la duración máxima aunque la auto-parada esté desactivada", () => {
    const vad = new VoiceActivityDetector(cfg({ autoStopEnabled: false, maxDurationMs: 10000 }));
    feed(vad, -70, 300);
    const events = feed(vad, -25, 10000);
    expect(events.at(-1)).toEqual({ type: "auto-stop", reason: "max-duration" });
  });

  it("sin auto-parada no corta por silencio", () => {
    const vad = new VoiceActivityDetector(cfg({ autoStopEnabled: false }));
    feed(vad, -70, 300);
    feed(vad, -25, 500);
    expect(feed(vad, -70, 5000)).toEqual([]);
  });

  it("los picos breves no cuentan como voz", () => {
    const vad = new VoiceActivityDetector(cfg());
    feed(vad, -70, 300);
    expect(feed(vad, -20, 100)).toEqual([]);
    expect(vad.hasSpeech).toBe(false);
  });

  it("el umbral se adapta al ruido de fondo", () => {
    const vad = new VoiceActivityDetector(cfg());
    feed(vad, -40, 300); // sala ruidosa: umbral ≈ -28 dB
    expect(feed(vad, -35, 500)).toEqual([]);
    expect(feed(vad, -15, 500)).toEqual([{ type: "speech-start" }]);
  });

  it("rmsToDb", () => {
    expect(rmsToDb(new Float32Array(100))).toBe(-100);
    expect(rmsToDb(new Float32Array(100).fill(1))).toBeCloseTo(0);
    expect(rmsToDb(new Float32Array(100).fill(0.1))).toBeCloseTo(-20);
  });
});
