import type { TranscriptionResult } from "./provider";

/** Frases que Whisper suele inventar con silencio o ruido (normalizadas). */
const KNOWN_HALLUCINATIONS = new Set([
  "subtitulos realizados por la comunidad de amara org",
  "subtitulos por la comunidad de amara org",
  "subtitulado por la comunidad de amara org",
  "gracias por ver el video",
  "gracias por ver",
  "suscribete",
  "thank you for watching",
  "thanks for watching",
  "you",
]);

export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Devuelve el texto final o "" si todo es una alucinación. */
export function filterHallucinations(result: TranscriptionResult, speechMs: number, prompt?: string): string {
  let text = result.text;
  if (result.segments && result.segments.length > 0) {
    const kept = result.segments.filter(
      (s) => !((s.noSpeechProb ?? 0) > 0.6 && (s.avgLogprob ?? 0) < -1.0),
    );
    if (kept.length !== result.segments.length) {
      text = kept.map((s) => s.text).join("");
    }
  }
  text = text.replace(/\s+/g, " ").trim();
  const normalized = normalizeForMatch(text);
  if (normalized === "") return "";
  if (KNOWN_HALLUCINATIONS.has(normalized)) return "";
  if (normalized === "gracias" && speechMs < 1500) return "";
  // Con poco audio, Whisper a veces repite la pista (prompt) en lugar de transcribir.
  if (prompt && speechMs < 3000 && normalized.split(" ").length >= 3 && normalizeForMatch(prompt).includes(normalized)) {
    return "";
  }
  return text;
}
