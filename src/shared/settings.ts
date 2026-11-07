import type { LogLevel } from "./logger";

export type CaptureStrategy = "background" | "extension-iframe" | "content-script";

export interface Settings {
  schemaVersion: 1;
  provider: {
    kind: "openai-compatible";
    baseUrl: string;
    model: string;
    responseFormat: "verbose_json" | "json";
  };
  language: string;
  prompt: string;
  autoStop: {
    enabled: boolean;
    silenceMs: number;
    maxDurationMs: number;
    noSpeechTimeoutMs: number;
  };
  smartFormatting: boolean;
  hallucinationFilter: boolean;
  captureStrategy: "auto" | CaptureStrategy;
  deviceId: string;
  ui: {
    hiddenHosts: string[];
    positions: Record<string, { xPct: number; yPct: number }>;
    buttonSizePx: number;
  };
  logLevel: LogLevel;
}

/** Subconjunto de ajustes que puede leer un content script (sin secretos). */
export type PublicSettings = Pick<Settings, "language" | "smartFormatting" | "ui">;

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<unknown>
    ? T[K]
    : T[K] extends Record<string, unknown>
      ? DeepPartial<T[K]>
      : T[K];
};

export const SETTINGS_STORAGE = "settings";
export const SECRET_KEY_STORAGE = "secret.apiKey";
export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

export { LANGUAGES } from "./languages";

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 1,
  provider: {
    kind: "openai-compatible",
    baseUrl: GROQ_BASE_URL,
    model: "whisper-large-v3-turbo",
    responseFormat: "verbose_json",
  },
  language: "es",
  prompt: "",
  autoStop: {
    enabled: true,
    silenceMs: 2500,
    maxDurationMs: 120000,
    noSpeechTimeoutMs: 8000,
  },
  smartFormatting: true,
  hallucinationFilter: true,
  captureStrategy: "auto",
  deviceId: "",
  ui: {
    hiddenHosts: [],
    positions: {},
    buttonSizePx: 44,
  },
  logLevel: "warn",
};

const CAPTURE_VALUES = ["auto", "background", "extension-iframe", "content-script"] as const;
const LOG_LEVELS = ["error", "warn", "info", "debug"] as const;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function clamp(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function str(value: unknown, fallback: string, maxLen = 2000): string {
  return typeof value === "string" ? value.slice(0, maxLen) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Normaliza la URL base: sin barra final y solo https (o http para localhost). */
export function normalizeBaseUrl(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return GROQ_BASE_URL;
  try {
    const url = new URL(value.trim());
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return GROQ_BASE_URL;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return GROQ_BASE_URL;
  }
}

/** Convierte cualquier valor guardado en un Settings válido (tolerante). */
export function migrate(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  const r = isObject(raw) ? raw : {};
  const provider = isObject(r.provider) ? r.provider : {};
  const autoStop = isObject(r.autoStop) ? r.autoStop : {};
  const ui = isObject(r.ui) ? r.ui : {};

  const positions: Settings["ui"]["positions"] = {};
  if (isObject(ui.positions)) {
    for (const [host, pos] of Object.entries(ui.positions)) {
      if (isObject(pos) && typeof pos.xPct === "number" && typeof pos.yPct === "number") {
        positions[host] = {
          xPct: Math.min(100, Math.max(0, pos.xPct)),
          yPct: Math.min(100, Math.max(0, pos.yPct)),
        };
      }
    }
  }

  const hiddenHosts = Array.isArray(ui.hiddenHosts)
    ? [...new Set(ui.hiddenHosts.filter((h): h is string => typeof h === "string" && h.length > 0))]
    : [];

  return {
    schemaVersion: 1,
    provider: {
      kind: "openai-compatible",
      baseUrl: normalizeBaseUrl(provider.baseUrl),
      model: str(provider.model, d.provider.model, 200).trim() || d.provider.model,
      responseFormat: oneOf(provider.responseFormat, ["verbose_json", "json"] as const, d.provider.responseFormat),
    },
    language: str(r.language, d.language, 10).trim() || d.language,
    prompt: str(r.prompt, d.prompt, 800),
    autoStop: {
      enabled: bool(autoStop.enabled, d.autoStop.enabled),
      silenceMs: clamp(autoStop.silenceMs, 800, 10000, d.autoStop.silenceMs),
      maxDurationMs: clamp(autoStop.maxDurationMs, 10000, 600000, d.autoStop.maxDurationMs),
      noSpeechTimeoutMs: clamp(autoStop.noSpeechTimeoutMs, 2000, 30000, d.autoStop.noSpeechTimeoutMs),
    },
    smartFormatting: bool(r.smartFormatting, d.smartFormatting),
    hallucinationFilter: bool(r.hallucinationFilter, d.hallucinationFilter),
    captureStrategy: oneOf(r.captureStrategy, CAPTURE_VALUES, d.captureStrategy),
    deviceId: str(r.deviceId, "", 500),
    ui: {
      hiddenHosts,
      positions,
      buttonSizePx: clamp(ui.buttonSizePx, 32, 72, d.ui.buttonSizePx),
    },
    logLevel: oneOf(r.logLevel, LOG_LEVELS, d.logLevel),
  };
}

/** Mezcla profunda: los arrays y valores primitivos del parche sustituyen a los existentes. */
export function deepMerge<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!isObject(patch)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const prev = out[key];
    out[key] = isObject(prev) && isObject(value) && key !== "positions" ? deepMerge(prev, value) : value;
  }
  return out as T;
}

export function toPublic(s: Settings): PublicSettings {
  return { language: s.language, smartFormatting: s.smartFormatting, ui: s.ui };
}

// ---- Acceso a storage (solo background y páginas de la extensión) ----

export async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(SETTINGS_STORAGE);
  return migrate(stored[SETTINGS_STORAGE]);
}

export async function saveSettings(patch: DeepPartial<Settings>): Promise<Settings> {
  const current = await loadSettings();
  const next = migrate(deepMerge(current, patch));
  await browser.storage.local.set({ [SETTINGS_STORAGE]: next });
  return next;
}

/** SOLO background. */
export async function getApiKey(): Promise<string> {
  const stored = await browser.storage.local.get(SECRET_KEY_STORAGE);
  const key = stored[SECRET_KEY_STORAGE];
  return typeof key === "string" ? key : "";
}

/** SOLO background. */
export async function setApiKey(key: string): Promise<void> {
  await browser.storage.local.set({ [SECRET_KEY_STORAGE]: key.trim() });
}
