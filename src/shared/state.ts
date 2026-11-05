import type { UserFacingError } from "./errors";

export type DictationPhase =
  | "idle"
  | "arming"
  | "listening"
  | "transcribing"
  | "inserting"
  | "success"
  | "error";

export interface DictationSession {
  sessionId: string;
  tabId: number;
  targetFrameId: number;
  phase: DictationPhase;
  startedAt: number;
  error?: UserFacingError;
}

/** Fases en las que hay una sesión viva (micrófono o petición en curso). */
export const ACTIVE_PHASES: ReadonlySet<DictationPhase> = new Set([
  "arming",
  "listening",
  "transcribing",
  "inserting",
]);

const TRANSITIONS: Record<DictationPhase, DictationPhase[]> = {
  idle: ["arming", "error"],
  arming: ["listening", "idle", "error"],
  listening: ["transcribing", "idle", "error"],
  transcribing: ["inserting", "idle", "error"],
  inserting: ["success", "error"],
  success: ["idle"],
  error: ["idle"],
};

export function canTransition(from: DictationPhase, to: DictationPhase): boolean {
  return TRANSITIONS[from].includes(to);
}
