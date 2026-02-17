/**
 * ============================================================================
 * LOGGER
 * ============================================================================
 * Bot-2 pattern: transport created once at module level (shared across bots).
 * Every log line is prefixed with [botId] for instant identification in
 * merged PM2 log streams.
 * ============================================================================
 */

import pino from "pino";

// Transport created once — shared across all createLogger() calls
const transport = pino.transport({
  target: "pino-pretty",
  options: { translateTime: true, colorize: true },
});

/**
 * Creates a logger instance bound to a specific bot identity.
 *
 * @param {string} botId - e.g. "bot-admin", "bot-taxi"
 * @returns {{ info: Function, warn: Function, error: Function }}
 */
export function createLogger(botId) {
  const prefix = `[${botId}]`;
  const pinoInstance = pino({ level: "info" }, transport);

  return {
    info:  (...args) => pinoInstance.info( `${prefix} ${args[0]}`, ...args.slice(1)),
    warn:  (...args) => pinoInstance.warn( `${prefix} ${args[0]}`, ...args.slice(1)),
    error: (...args) => pinoInstance.error(`${prefix} ${args[0]}`, ...args.slice(1)),
  };
}

/**
 * Hard-kill the process with a logged error.
 * @param {Error}  err
 * @param {string} context
 */
export function panic(err, context = "fatal-error") {
  console.error(`[PANIC] ${context} —`, err);
  process.exit(1);
}