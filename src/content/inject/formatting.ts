export interface InsertionContext {
  /** Hasta 3 caracteres antes del cursor ("" al inicio). */
  before: string;
  /** Hasta 3 caracteres después del cursor ("" al final). */
  after: string;
}

const OPENING = new Set(["(", "[", "{", "¿", "¡", "«", '"', "'", "“", "‘", "/", "-"]);
const SENTENCE_END = new Set([".", "!", "?", "…", ":", "\n"]);
const TRAILING_PUNCT = new Set([".", ",", ";", ":", "!", "?"]);

function lastNonBlank(s: string): string | null {
  const trimmed = s.replace(/[ \t ]+$/, "");
  return trimmed.length ? trimmed[trimmed.length - 1]! : null;
}

function isAcronymOrI(word: string): boolean {
  if (word === "I" || /^I['’]/.test(word)) return true;
  const letters = word.replace(/[^\p{L}]/gu, "");
  return letters.length >= 2 && letters.slice(0, 2) === letters.slice(0, 2).toUpperCase() && /\p{Lu}/u.test(letters[1]!);
}

/** Ajusta espacios y mayúsculas del texto según lo que rodea al cursor. */
export function formatForInsertion(raw: string, ctx: InsertionContext, smart: boolean): string {
  let text = raw.replace(/[ \t ]+/g, " ").replace(/\s+$/, "").replace(/^\s+/, "");
  if (!smart || text === "") return text;

  const prev = lastNonBlank(ctx.before);
  const beforeLastChar = ctx.before.length ? ctx.before[ctx.before.length - 1]! : null;

  // (c) minúscula inicial a mitad de frase
  if (prev !== null && !SENTENCE_END.has(prev)) {
    const firstWord = text.split(/\s/)[0] ?? "";
    if (!isAcronymOrI(firstWord)) {
      text = text.charAt(0).toLocaleLowerCase() + text.slice(1);
    }
  }
  // (d) mayúscula al inicio del campo, tras fin de frase o tras salto de línea
  if (prev === null || [".", "!", "?", "…", "\n"].includes(prev)) {
    text = text.charAt(0).toLocaleUpperCase() + text.slice(1);
  }
  // (f) evitar doble puntuación, y no cerrar la frase si continúa en minúscula
  const afterFirst = ctx.after.charAt(0);
  const afterWord = ctx.after.trimStart().charAt(0);
  const continuesLowercase = afterWord !== "" && afterWord !== afterWord.toLocaleUpperCase();
  if ((TRAILING_PUNCT.has(afterFirst) || continuesLowercase) && text.endsWith(".")) {
    text = text.slice(0, -1);
  }
  // (b) espacio inicial
  if (beforeLastChar !== null && !/\s/.test(beforeLastChar) && !OPENING.has(beforeLastChar)) {
    text = " " + text;
  }
  // (e) espacio final
  if (/^[\p{L}\p{N}]/u.test(afterFirst)) {
    text = text + " ";
  }
  return text;
}
