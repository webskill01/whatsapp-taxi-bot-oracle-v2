#!/usr/bin/env node
// =============================================================================
// start.js — PM2 Entry Point (Bot-2 pattern)
// =============================================================================

import path from "path";
import { fileURLToPath } from "url";
import { loadConfig  } from "../../core/configLoader.js";
import { startBot    } from "../../core/index.js";
import { createLogger } from "../../core/logger.js";

const __filename = fileURLToPath(import.meta.url);
const BOT_DIR    = path.dirname(__filename);
const AUTH_DIR   = path.join(BOT_DIR, "baileys_auth");

const BOT_NAME = process.env.BOT_NAME || path.basename(BOT_DIR);

const log = createLogger(BOT_NAME);

log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
log.info(`🟢 ${BOT_NAME} — entry point`);
log.info(`   Bot Dir : ${BOT_DIR}`);
log.info(`   Auth Dir: ${AUTH_DIR}`);
log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

const { config, ENV } = loadConfig(BOT_DIR);
config.botDir = BOT_DIR;

log.info("🛡️  Anti-ban protection: ACTIVE");
log.info("   • B1: Reconnect age gate (30s window)");
log.info("   • B2: Replay ID dedup (200 rolling)");
log.info("   • C1: Batch fingerprint cleanup");
log.info("   • C2: Debounced disk writes (30s)");
log.info("   • A4: Settling delay (5-15s)");
log.info("   • A1: Length-scaled typing (1.0-1.8s)");
log.info("   • A5: Weighted gaps (0.8-1.5s)");
log.info("   • A3: Fisher-Yates shuffle");
log.info("   • Circuit breaker (10 fails → 60s)");
log.info("   • Per-group cooldown (1s)");

await startBot(config, log, AUTH_DIR);