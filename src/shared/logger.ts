export type LogLevel = "error" | "warn" | "info" | "debug";

const ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };
let current: LogLevel = typeof __DEV__ !== "undefined" && __DEV__ ? "debug" : "warn";

export function setLogLevel(level: LogLevel): void {
  current = level;
}

function emit(level: LogLevel, scope: string, args: unknown[]): void {
  if (ORDER[level] > ORDER[current]) return;
  const fn = level === "debug" ? console.debug : console[level];
  fn(`[Dictado:${scope}]`, ...args);
}

/** Logger con ámbito. Nunca registres claves, audio ni texto dictado salvo en debug. */
export function createLogger(scope: string) {
  return {
    error: (...a: unknown[]) => emit("error", scope, a),
    warn: (...a: unknown[]) => emit("warn", scope, a),
    info: (...a: unknown[]) => emit("info", scope, a),
    debug: (...a: unknown[]) => emit("debug", scope, a),
  };
}
