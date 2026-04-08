/**
 * Structured pino logger for WikiRecall.
 *
 * Outputs JSON logs with configurable level sourced from getConfig().
 * Uses sonic-boom for reliable async writes.
 */

import pino from "pino";
import { getConfig } from "./config.js";

/**
 * Creates a configured pino logger instance.
 *
 * Call this when you need a logger — it reads the current config each time,
 * which allows tests to reset config and get a fresh logger.
 */
export function createLogger(name = "wikirecall"): pino.Logger {
  const config = getConfig();

  return pino({
    name,
    level: config.logLevel,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label: string) {
        return { level: label };
      },
    },
  });
}

/** Default logger instance for convenience imports. */
const logger = createLogger();
export default logger;
