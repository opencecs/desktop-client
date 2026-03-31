type LogLevel = "debug" | "info" | "warn" | "error";

const DEBUG_LOGGING_ENABLED = isTruthyEnv(import.meta.env.VITE_DEBUG_LOGGING);

export function createLogger(namespace: string) {
  return {
    debug(message: string, details?: unknown) {
      writeLog("debug", namespace, message, details);
    },
    info(message: string, details?: unknown) {
      writeLog("info", namespace, message, details);
    },
    warn(message: string, details?: unknown) {
      writeLog("warn", namespace, message, details);
    },
    error(message: string, details?: unknown) {
      writeLog("error", namespace, message, details);
    },
  };
}

function writeLog(level: LogLevel, namespace: string, message: string, details?: unknown) {
  if (!DEBUG_LOGGING_ENABLED) {
    return;
  }

  const prefix = `[${namespace}] ${message}`;
  const logger = console[level] ?? console.log;

  if (details === undefined) {
    logger.call(console, prefix);
    return;
  }

  logger.call(console, prefix, details);
}

function isTruthyEnv(value: unknown) {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}
