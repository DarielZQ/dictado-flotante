import type { UserFacingError } from "./errors";
import type { DeepPartial, PublicSettings, Settings } from "./settings";
import type { DictationPhase } from "./state";

export type EditableKind = "input" | "textarea" | "contenteditable" | "google-docs";
export type AutoStopReason = "silence" | "max-duration" | "no-speech";
export type InsertStrategyName =
  | "execCommand"
  | "setRangeText"
  | "beforeInput"
  | "syntheticPaste"
  | "rangeInsert"
  | "googleDocsPaste";

export type Result<T> = { ok: true; data: T } | { ok: false; error: UserFacingError };

export interface InsertResult {
  inserted: boolean;
  strategy: InsertStrategyName | "clipboard" | "none";
  copiedToClipboard: boolean;
}

export interface AutoStopOptions {
  enabled: boolean;
  silenceMs: number;
  maxDurationMs: number;
  noSpeechTimeoutMs: number;
}

export interface CaptureOptions {
  deviceId?: string;
  autoStop: AutoStopOptions;
}

// ---------- Content script → Background (runtime.sendMessage) ----------
export type ContentToBackground =
  | { type: "focus/changed"; editable: boolean; kind: EditableKind | null; at: number }
  | { type: "dictation/toggle" }
  | { type: "dictation/cancel" }
  | { type: "session/heartbeat"; sessionId: string }
  | { type: "settings/get-public" }
  | { type: "ui/hide-host"; host: string }
  | { type: "ui/save-position"; host: string; xPct: number; yPct: number }
  | { type: "ui/set-language"; language: string }
  | { type: "clipboard/write"; text: string }
  | { type: "open-options" };

// ---------- Background → Content script (tabs.sendMessage) ----------
export type BackgroundToContent =
  | { type: "ping" }
  | { type: "ui/focus-state"; visible: boolean; kind: EditableKind | null }
  | { type: "ui/state"; phase: DictationPhase; sessionId: string | null; error?: UserFacingError }
  | { type: "ui/level"; level: number }
  | { type: "ui/toast"; message: string; variant: "info" | "error" | "success" }
  | { type: "ui/settings-changed"; settings: PublicSettings }
  | { type: "session/active"; active: boolean; sessionId: string | null }
  | { type: "target/snapshot"; sessionId: string }
  | { type: "inject/text"; sessionId: string; text: string }
  | { type: "recorder/mount"; sessionId: string; mode: "iframe" | "content" }
  | { type: "recorder/unmount"; sessionId: string };

// ---------- Grabador remoto (iframe o content script) ↔ Background (runtime.Port) ----------
export const RECORDER_PORT_PREFIX = "recorder:";

export type RecorderCommand =
  | { type: "recorder/start"; sessionId: string; options: CaptureOptions }
  | { type: "recorder/stop"; sessionId: string }
  | { type: "recorder/cancel"; sessionId: string };

export type RecorderEvent =
  | { type: "recorder/ready"; sessionId: string }
  | { type: "recorder/started"; sessionId: string }
  | { type: "recorder/level"; sessionId: string; level: number }
  | { type: "recorder/auto-stop"; sessionId: string; reason: AutoStopReason }
  | {
      type: "recorder/audio";
      sessionId: string;
      audio: ArrayBuffer;
      mimeType: string;
      durationMs: number;
      speechMs: number;
    }
  | { type: "recorder/error"; sessionId: string; error: UserFacingError };

// ---------- Opciones / Popup → Background ----------
export interface PopupStatus {
  phase: DictationPhase;
  host: string | null;
  hidden: boolean;
  supported: boolean;
  hasApiKey: boolean;
  hasAllSitesPermission: boolean;
}

export type UiToBackground =
  | { type: "settings/get" }
  | { type: "settings/save"; patch: DeepPartial<Settings> }
  | { type: "secret/set-api-key"; apiKey: string }
  | { type: "secret/has-api-key" }
  | { type: "provider/test" }
  | { type: "stt/transcribe-test"; audio: ArrayBuffer; mimeType: string; durationMs: number; speechMs: number }
  | { type: "popup/status"; tabId: number; url: string }
  | { type: "popup/start-dictation"; tabId: number }
  | { type: "popup/set-host-hidden"; host: string; hidden: boolean };

export type AnyToBackground = ContentToBackground | UiToBackground;

const BACKGROUND_TYPES = new Set<string>([
  "focus/changed",
  "dictation/toggle",
  "dictation/cancel",
  "session/heartbeat",
  "settings/get-public",
  "ui/hide-host",
  "ui/save-position",
  "ui/set-language",
  "clipboard/write",
  "open-options",
  "settings/get",
  "settings/save",
  "secret/set-api-key",
  "secret/has-api-key",
  "provider/test",
  "stt/transcribe-test",
  "popup/status",
  "popup/start-dictation",
  "popup/set-host-hidden",
]);

/** Mensajes que solo pueden venir de páginas de la extensión (no de content scripts). */
export const PRIVILEGED_TYPES = new Set<string>([
  "settings/get",
  "settings/save",
  "secret/set-api-key",
  "secret/has-api-key",
  "provider/test",
  "stt/transcribe-test",
  "popup/status",
  "popup/start-dictation",
  "popup/set-host-hidden",
]);

export function isBackgroundMessage(msg: unknown): msg is AnyToBackground {
  return (
    typeof msg === "object" &&
    msg !== null &&
    typeof (msg as { type?: unknown }).type === "string" &&
    BACKGROUND_TYPES.has((msg as { type: string }).type)
  );
}

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function fail(error: UserFacingError): Result<never> {
  return { ok: false, error };
}
