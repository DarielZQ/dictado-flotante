import { ERROR_MESSAGES } from "./strings";

export type ErrorCode =
  | "mic-permission-denied"
  | "mic-not-found"
  | "mic-busy"
  | "mic-blocked-by-site"
  | "no-speech"
  | "missing-api-key"
  | "invalid-api-key"
  | "rate-limited"
  | "payload-too-large"
  | "bad-request"
  | "provider-unavailable"
  | "network"
  | "timeout"
  | "no-target"
  | "insert-failed"
  | "unsupported-page"
  | "internal";

export interface UserFacingError {
  code: ErrorCode;
  message: string;
  retryAfterSeconds?: number;
  action?: "open-options" | "retry" | "none";
}

const ACTIONS: Partial<Record<ErrorCode, UserFacingError["action"]>> = {
  "missing-api-key": "open-options",
  "invalid-api-key": "open-options",
  "mic-permission-denied": "open-options",
  "mic-blocked-by-site": "open-options",
  "rate-limited": "retry",
  network: "retry",
  timeout: "retry",
  "provider-unavailable": "retry",
};

export function toUserFacing(code: ErrorCode, retryAfterSeconds?: number): UserFacingError {
  const template = ERROR_MESSAGES[code];
  const message = template.replace("{n}", String(retryAfterSeconds ?? 60));
  const error: UserFacingError = { code, message, action: ACTIONS[code] ?? "none" };
  if (retryAfterSeconds !== undefined) error.retryAfterSeconds = retryAfterSeconds;
  return error;
}

export class DictationError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
    public readonly details?: Record<string, unknown>,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message ?? code);
    this.name = "DictationError";
  }

  toUserFacing(): UserFacingError {
    return toUserFacing(this.code, this.retryAfterSeconds);
  }
}

/** Convierte cualquier excepción en un error presentable. */
export function asUserFacing(err: unknown): UserFacingError {
  if (err instanceof DictationError) return err.toUserFacing();
  if (isUserFacingError(err)) return err;
  return toUserFacing("internal");
}

export function isUserFacingError(value: unknown): value is UserFacingError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as UserFacingError).code === "string" &&
    typeof (value as UserFacingError).message === "string"
  );
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}
