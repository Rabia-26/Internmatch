/**
 * Lightweight logger that respects LOG_LEVEL / DEBUG env vars.
 *
 * Levels: debug < info < warn < error
 * Set LOG_LEVEL=debug or DEBUG=true to enable verbose output.
 */

type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function currentLevel(): number {
  const envLevel = (process.env.LOG_LEVEL || "").toLowerCase() as Level;
  if (envLevel && envLevel in LEVELS) return LEVELS[envLevel];
  if (process.env.DEBUG === "true") return LEVELS.debug;
  return LEVELS.info;
}

function should(level: Level): boolean {
  return LEVELS[level] >= currentLevel();
}

export const logger = {
  debug: (...args: unknown[]) => {
    if (should("debug")) console.log(...args);
  },
  info: (...args: unknown[]) => {
    if (should("info")) console.log(...args);
  },
  warn: (...args: unknown[]) => {
    if (should("warn")) console.warn(...args);
  },
  error: (...args: unknown[]) => {
    if (should("error")) console.error(...args);
  },
};
