// =============================================================================
// bots/bot-admin/start.js — PM2 entry point for bot-admin.
// This file owns ONLY: .env loading, path resolution, wiring.
// All logic lives in core/.
// =============================================================================

import path            from 'path';
import { fileURLToPath } from 'url';
import dotenv          from 'dotenv';

// ---------------------------------------------------------------------------
// PATH RESOLUTION — everything relative to THIS file, not process.cwd().
// PM2 sets cwd to this folder (ecosystem.config.cjs), but we resolve via
// __filename so the file works correctly even if run manually from elsewhere.
// ---------------------------------------------------------------------------
const __filename  = fileURLToPath(import.meta.url);
const BOT_DIR     = path.dirname(__filename);                   // bots/bot-admin/
const PROJECT_ROOT = path.resolve(BOT_DIR, '..', '..');         // whatsapp-admin-bot-multibot/
const CONFIG_PATH = path.join(BOT_DIR, 'config.json');          // bots/bot-admin/config.json
const AUTH_DIR    = path.join(BOT_DIR, 'baileys_auth');         // bots/bot-admin/baileys_auth/

// ---------------------------------------------------------------------------
// .env — load BEFORE anything reads process.env (STATS_PORT lives here)
// ---------------------------------------------------------------------------
dotenv.config({ path: path.join(BOT_DIR, '.env') });

// ---------------------------------------------------------------------------
// BOT IDENTITY
// ---------------------------------------------------------------------------
const BOT_ID = 'bot-admin';

// ---------------------------------------------------------------------------
// DYNAMIC IMPORTS — resolved via PROJECT_ROOT so they work no matter what
// cwd PM2 has set.  Top-level await is fine — Node 18+ with "type":"module".
// ---------------------------------------------------------------------------
const { createLogger } = await import(path.join(PROJECT_ROOT, 'core', 'logger.js'));
const { loadConfig }   = await import(path.join(PROJECT_ROOT, 'core', 'configLoader.js'));
const { startBot }     = await import(path.join(PROJECT_ROOT, 'core', 'index.js'));

// ---------------------------------------------------------------------------
// BOOT
// ---------------------------------------------------------------------------
const log = createLogger(BOT_ID);

log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
log.info(`🟢 ${BOT_ID} — entry point`);
log.info(`   Config : ${CONFIG_PATH}`);
log.info(`   Auth   : ${AUTH_DIR}`);
log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// Load + validate merged config — throws on any problem, PM2 restarts
const config = loadConfig(CONFIG_PATH, BOT_ID, log);

// Hand off to the main event loop (never returns)
await startBot(config, log, AUTH_DIR);