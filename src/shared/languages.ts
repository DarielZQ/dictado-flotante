/** Idiomas de dictado. "es+en" es el modo mixto español + inglés. */
export const MIXED_ES_EN = "es+en";

export interface LanguageOption {
  code: string;
  label: string;
  /** Etiqueta corta que se muestra sobre el botón flotante. */
  short: string;
}

export const LANGUAGES: ReadonlyArray<LanguageOption> = [
  { code: "es", label: "Español", short: "ES" },
  { code: "en", label: "Inglés", short: "EN" },
  { code: MIXED_ES_EN, label: "Español + Inglés (mixto)", short: "ES+EN" },
  { code: "pt", label: "Portugués", short: "PT" },
  { code: "fr", label: "Francés", short: "FR" },
  { code: "de", label: "Alemán", short: "DE" },
  { code: "it", label: "Italiano", short: "IT" },
  { code: "ca", label: "Catalán", short: "CA" },
  { code: "auto", label: "Detección automática", short: "AUTO" },
];

/** Idiomas que aparecen en el menú rápido del botón flotante. */
export const QUICK_LANGUAGES: readonly string[] = ["es", "en", MIXED_ES_EN, "auto"];

/**
 * Pista para el modo mixto. Un ejemplo que empieza en inglés y cambia al español
 * evita que Whisper traduzca la parte en inglés (calibrado con frases reales).
 */
export const MIXED_PROMPT =
  "Thanks, that sounds good. Nos vemos mañana en la oficina. I will send you the link. Perfecto, gracias por el feedback.";

export function findLanguage(code: string): LanguageOption | undefined {
  return LANGUAGES.find((l) => l.code === code);
}

export function isKnownLanguage(code: unknown): code is string {
  return typeof code === "string" && findLanguage(code) !== undefined;
}

export function shortLabel(code: string): string {
  return findLanguage(code)?.short ?? code.toUpperCase();
}

/** Traduce el ajuste de idioma a los parámetros de la API (language y prompt). */
export function resolveLanguage(code: string, userPrompt = ""): { language?: string; prompt?: string } {
  const extra = userPrompt.trim();
  if (code === MIXED_ES_EN) {
    return { language: "es", prompt: extra ? `${MIXED_PROMPT} ${extra}` : MIXED_PROMPT };
  }
  return {
    ...(code && code !== "auto" ? { language: code } : {}),
    ...(extra ? { prompt: extra } : {}),
  };
}
