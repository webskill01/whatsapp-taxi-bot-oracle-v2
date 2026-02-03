// =============================================================================
// logger.js — E1: Bot identity prefix on every log line.
// Usage: import { createLogger } from '../core/logger.js';
//        const log = createLogger('bot-1');
//        log.info('Starting...');  →  [bot-1] Starting...
// =============================================================================

import pino from "pino";

/**
 * Creates a logger instance bound to a specific bot identity.
 * Every log line is prefixed with [botId] for instant identification
 * when multiple bots output to the same PM2 log stream.
 *
 * @param {string} botId - e.g. "bot-1", "bot-2"
 * @returns {{ info: Function, warn: Function, error: Function }}
 */
export function createLogger(botId) {
  const prefix = `[${botId}]`;

  const transport = pino.transport({
    target: "pino-pretty",
    options: { translateTime: true, colorize: true }
  });

  const pinoInstance = pino({ level: "info" }, transport);

  // Wrap each method to inject the prefix into the message
  return {
    info:  (...args) => pinoInstance.info(`${prefix} ${args[0]}`, ...args.slice(1)),
    warn:  (...args) => pinoInstance.warn(`${prefix} ${args[0]}`, ...args.slice(1)),
    error: (...args) => pinoInstance.error(`${prefix} ${args[0]}`, ...args.slice(1)),
  };
}

/**
 * Kills the process with a logged error. Preserved exactly from original.
 * @param {Error} err
 * @param {string} context
 * @param {{ info: Function, error: Function }} [log] - pass the bot logger if available
 */
export function panic(err, context = "fatal-error", log = null) {
  if (log) {
    log.error(`[PANIC] ${context} — ${err?.message || err}`);
  } else {
    console.error(`[PANIC] ${context} —`, err);
  }
  process.exit(1);
}