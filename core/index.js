// =============================================================================
// core/index.js — Baileys connection + message handler + stats server.
// Called by bots/bot-N/start.js with a config object.
// This file does NOT own filter logic or routing decisions.
// It owns: connection lifecycle, message intake, dedup gating, path dispatch.
// =============================================================================

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import express from 'express';
import pino from 'pino';
import fs from 'fs';
import path from 'path';

import { getMessageFingerprint } from './filter.js';
import { processPathA, processPathB } from './router.js';
import {
  CACHE,
  RECONNECT,
  BAILEYS,
  SEND_COOLDOWN_CLEANUP_INTERVAL,
  STATS,
  MESSAGE,
  RATE_LIMITS,
  CIRCUIT_BREAKER,
} from './globalDefaults.js';
import { panic } from './logger.js';

// -----------------------------------------------------------------------------
// MAIN EXPORT — the single function each bot calls
// -----------------------------------------------------------------------------

/**
 * Starts this bot instance: loads auth, connects Baileys, handles messages,
 * runs stats server. Blocks forever (the process stays alive on the event loop).
 *
 * @param {object} config  — merged config from configLoader (botPhone, sourceGroupIds, etc.)
 * @param {object} log     — bot logger from createLogger(botId)
 * @param {string} authDir — absolute path to this bot's baileys_auth/ folder
 */
export async function startBot(config, log, authDir) {
  // ---------------------------------------------------------------------------
  // STATE — all mutable state for this bot instance lives here
  // ---------------------------------------------------------------------------

  let sock = null;
  let reconnectAttempts = 0;

  // Fingerprint dedup — single consolidated set (replaces processedFingerprints
  // + pathAFingerprints + pathBFingerprints from the old system)
  const fingerprintSet = new Set();

  // B2: Rolling message-ID set — catches Baileys replays on reconnect specifically.
  // Separate from fingerprint dedup. Max 200 entries, FIFO eviction.
  const replayIdSet = new Set();

  // Per-group send cooldown map
  const inFlightSends = new Map();

  // Rate counters
  const messageCount = {
    hourly: 0,
    daily: 0,
    lastHourReset: Date.now(),
    lastDayReset: Date.now(),
  };

  // Circuit breaker
  const circuitBreaker = {
    failureCount: 0,
    lastFailureTime: 0,
    isOpen: false,
    resetTimeout: null,
  };

  // Stats (E2: included in /stats response with botId)
  const stats = {
    totalMessagesSent: 0,
    pathAProcessed: 0,
    pathBProcessed: 0,
    duplicatesSkipped: 0,
    replayIdsSkipped: 0,
    rejectedNoPhone: 0,
    rejectedNotTaxi: 0,
    rejectedTooShort: 0,
    rejectedRateLimit: 0,
    rejectedEmptyBody: 0,
    rejectedNotMonitored: 0,
    rejectedFromMe: 0,
    rejectedBotSender: 0,
    rejectedBlockedNumber: 0,
    rejectedByReconnectAgeGate: 0,
    humanPausesTriggered: 0,
    sendSuccesses: 0,
    sendFailures: 0,
    reconnectCount: 0,
  };

  // B1: Reconnect state tracking
  let lastReconnectTime = 0;       // timestamp of last reconnect event
  let botFullyOperational = false; // false until first connection is open

  // A4: Settling state — true until first message after connect/reconnect is processed
  let needsSettlingDelay = true;

  // C2: Debounced disk write state
  let fingerprintDirty = false;
  let saveDebounceTimer = null;

  const BOT_START_TIME = Date.now();

  // Fingerprint file path — lives in the bot's own directory (passed via config or derived)
  // We use process.cwd() which PM2 sets to the bot folder via the ecosystem config
  const FINGERPRINT_FILE = path.join(process.cwd(), CACHE.FINGERPRINT_FILE);

  // ---------------------------------------------------------------------------
  // FINGERPRINT DISK PERSISTENCE (C2 debounced)
  // ---------------------------------------------------------------------------

  function loadFingerprints() {
    try {
      if (fs.existsSync(FINGERPRINT_FILE)) {
        const data = JSON.parse(fs.readFileSync(FINGERPRINT_FILE, 'utf8'));
        const cutoff = Date.now() - CACHE.FINGERPRINT_TTL_MS; // 2-hour TTL

        let loaded = 0;
        for (const item of data) {
          if (item.timestamp > cutoff) {
            fingerprintSet.add(item.fingerprint);
            loaded++;
          }
        }
        log.info(`📂 Loaded ${loaded} fingerprints (2h cache)`);
      } else {
        fs.writeFileSync(FINGERPRINT_FILE, JSON.stringify([]), 'utf8');
        log.info('📂 Created fingerprint cache file');
      }
    } catch (err) {
      log.warn(`⚠️  Fingerprint load failed: ${err.message}`);
    }
  }

  function saveFingerprints() {
    try {
      const data = Array.from(fingerprintSet).map(fp => ({
        fingerprint: fp,
        timestamp: Date.now(),
      }));
      // Cap entries on disk to SAVE_CAP (1000)
      fs.writeFileSync(FINGERPRINT_FILE, JSON.stringify(data.slice(-CACHE.FINGERPRINT_SAVE_CAP)), 'utf8');
      fingerprintDirty = false;
      log.info(`📂 Fingerprints saved (${Math.min(data.length, CACHE.FINGERPRINT_SAVE_CAP)} entries)`);
    } catch (err) {
      log.warn(`⚠️  Fingerprint save failed: ${err.message}`);
    }
  }

  /**
   * C2: Mark dirty and arm the debounce timer if not already armed.
   * Actual write happens at most once per SAVE_DEBOUNCE_MS (30s).
   */
  function markDirty() {
    fingerprintDirty = true;
    if (!saveDebounceTimer) {
      saveDebounceTimer = setTimeout(() => {
        if (fingerprintDirty) {
          saveFingerprints();
        }
        saveDebounceTimer = null;
      }, CACHE.SAVE_DEBOUNCE_MS);
    }
  }

  // ---------------------------------------------------------------------------
  // UTILITY
  // ---------------------------------------------------------------------------

  function normalizePhone(p) {
    return p.replace(/\D/g, '').slice(-10);
  }

  // B2: Add a message ID to the replay set. Evicts oldest if over cap.
  function trackReplayId(msgId) {
    replayIdSet.add(msgId);
    if (replayIdSet.size > CACHE.MAX_REPLAY_IDS) {
      const first = replayIdSet.values().next().value;
      replayIdSet.delete(first);
    }
  }

  // ---------------------------------------------------------------------------
  // ROUTER CONTEXT — assembled fresh per message, passed to processPathA/B
  // ---------------------------------------------------------------------------

  function buildRouterContext() {
    return {
      sock,
      stats,
      messageCount,
      circuitBreaker,
      inFlightSends,
      log,
      config,
      fingerprintSet,
      markDirty,
    };
  }

  // ---------------------------------------------------------------------------
  // MESSAGE HANDLER — replaces the old /webhook POST endpoint entirely
  // ---------------------------------------------------------------------------

  async function handleMessage(msg) {
    // Only care about group messages
    if (!msg.key.remoteJid?.endsWith('@g.us')) return;

    // Skip messages sent by this bot (fromMe)
    if (msg.key.fromMe === true) {
      stats.rejectedFromMe++;
      return;
    }

    const msgId = msg.key.id;
    const sourceGroup = msg.key.remoteJid;
    const messageTimestamp = msg.messageTimestamp; // seconds (Baileys native)
    const messageTimestampMs = messageTimestamp * 1000;

    // ── B1: Reconnect age gate ──
    // For the first 30s after a reconnect, only accept messages < 10s old.
    // This prevents the replay flood that Baileys fires on reconnect.
    const timeSinceReconnect = Date.now() - lastReconnectTime;
    if (lastReconnectTime > 0 && timeSinceReconnect < RECONNECT.STRICT_WINDOW_DURATION) {
      const messageAge = Date.now() - messageTimestampMs;
      if (messageAge > RECONNECT.STRICT_AGE_MS) {
        stats.rejectedByReconnectAgeGate++;
        return; // silently drop — this is a replay
      }
    }

    // ── B2: Replay ID check ──
    if (replayIdSet.has(msgId)) {
      stats.replayIdsSkipped++;
      return;
    }
    trackReplayId(msgId);

    // ── Extract text ──
    const text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      '';

    if (!text || text.trim() === '') {
      stats.rejectedEmptyBody++;
      return;
    }

    // ── Bot self-send check (phone-level, not just fromMe) ──
    // Preserved from original: checks both group sender and participant fields
    const senderPhone     = sourceGroup.split('@')[0] || '';
    const participantPhone = (msg.key.participant || '').split('@')[0] || '';

    if (
      normalizePhone(senderPhone)     === normalizePhone(config.botPhone) ||
      normalizePhone(participantPhone) === normalizePhone(config.botPhone)
    ) {
      stats.rejectedBotSender++;
      log.info('🤖 Bot own sender — skipped');
      return;
    }

    // ── Min length check ──
    if (text.length < MESSAGE.MIN_LENGTH) {
      stats.rejectedTooShort++;
      return;
    }

    // ── Fingerprint dedup ──
    const fingerprint = getMessageFingerprint(text, null, messageTimestampMs);

    if (fingerprintSet.has(fingerprint)) {
      stats.duplicatesSkipped++;
      log.info('🔁 Duplicate fingerprint — skipped');
      return;
    }

    // Add to set NOW (before path processing) — same as original.
    // Prevents the same message arriving on two source groups from being
    // processed twice in the same event loop tick.
    fingerprintSet.add(fingerprint);
    markDirty();

    // ── A4: Settling delay — one-time pause after connect/reconnect ──
    if (needsSettlingDelay) {
      needsSettlingDelay = false;
      const settleDuration = RECONNECT.SETTLING_MIN +
        Math.floor(Math.random() * (RECONNECT.SETTLING_MAX - RECONNECT.SETTLING_MIN));
      log.info(`⏳ Settling delay: ${(settleDuration / 1000).toFixed(1)}s (first message after connect)`);
      await new Promise(r => setTimeout(r, settleDuration));
    }

    // ── Circuit breaker gate ──
    if (circuitBreaker.isOpen) {
      log.warn('🔴 Circuit breaker OPEN — message dropped');
      return;
    }

    // ── Path detection ──
    const isPathA = config.sourceGroupIds.includes(sourceGroup);
    const isPathB = sourceGroup === config.freeCommonGroupId;

    log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    log.info(`📥 MSG #${stats.totalMessagesSent} | ${isPathA ? 'PATH A' : isPathB ? 'PATH B' : 'UNMONITORED'}`);
    log.info(`   From: ${sourceGroup.substring(0, 20)}...`);
    log.info(`   Text: "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"`);
    log.info(`   Fingerprint: ${fingerprint}`);

    const ctx = buildRouterContext();

    if (isPathA) {
      await processPathA(text, sourceGroup, fingerprint, ctx);
    } else if (isPathB) {
      await processPathB(text, sourceGroup, fingerprint, ctx);
    } else {
      stats.rejectedNotMonitored++;
      log.warn('🚫 Unmonitored group — skipped');
    }
  }

  // ---------------------------------------------------------------------------
  // BAILEYS CONNECTION
  // ---------------------------------------------------------------------------

  async function connectToWhatsApp() {
    try {
      const { state, saveCreds } = await useMultiFileAuthState(authDir);
      const { version } = await fetchLatestBaileysVersion();

      log.info(`🔌 Connecting... (attempt ${reconnectAttempts + 1}/${BAILEYS.MAX_RECONNECT_ATTEMPTS})`);

      const baileysLogger = pino({
        level: 'warn', // suppress Baileys' own verbose info/debug
        transport: { target: 'pino-pretty', options: { translateTime: true, colorize: true } }
      });

      sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
        },
        logger: baileysLogger,
        printQRInTerminal: true,
        browser: ['Taxi Bot', 'Chrome', '120.0'],
        markOnlineOnConnect: false,
        syncFullHistory: false,
        getMessage: async () => undefined,
        defaultQueryTimeoutMs: BAILEYS.QUERY_TIMEOUT_MS,
        connectTimeoutMs:      BAILEYS.CONNECT_TIMEOUT_MS,
        keepAliveIntervalMs:   BAILEYS.KEEP_ALIVE_MS,
      });

      sock.ev.on('creds.update', saveCreds);

      // ── Connection lifecycle ──
      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          log.info('📱 QR Code generated — scan with WhatsApp');
          // Print QR to terminal for scanning
          const qrcodeTerminal = (await import('qrcode-terminal')).default;
          qrcodeTerminal.generate(qr, { small: true });
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const isLoggedOut  = statusCode === DisconnectReason.loggedOut;

          log.warn(`⚠️  Connection closed | statusCode=${statusCode} | loggedOut=${isLoggedOut}`);

          if (isLoggedOut) {
            log.error('❌ LOGGED OUT — delete baileys_auth/ and restart to re-scan QR');
            process.exit(1);
          }

          if (reconnectAttempts < BAILEYS.MAX_RECONNECT_ATTEMPTS) {
            // Exponential backoff: 3s, 6s, 12s, 24s, 48s, cap 60s
            const delay = Math.min(
              BAILEYS.BACKOFF_BASE_MS * Math.pow(2, reconnectAttempts),
              BAILEYS.BACKOFF_CAP_MS
            );
            reconnectAttempts++;
            stats.reconnectCount++;

            log.info(`⏳ Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${reconnectAttempts}/${BAILEYS.MAX_RECONNECT_ATTEMPTS})...`);
            await new Promise(r => setTimeout(r, delay));

            // B1: Mark reconnect time so the age gate activates
            lastReconnectTime = Date.now();
            // A4: Next message after reconnect needs settling delay
            needsSettlingDelay = true;

            connectToWhatsApp();
          } else {
            log.error('❌ Max reconnect attempts reached — exiting for PM2 restart');
            process.exit(1);
          }
        }

        if (connection === 'open') {
          log.info('✅ WhatsApp connected');
          reconnectAttempts = 0; // reset on successful connection

          if (!botFullyOperational) {
            // First connection ever — mark reconnect time for B1, set settling for A4
            lastReconnectTime = Date.now();
            needsSettlingDelay = true;
            botFullyOperational = true;

            log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            log.info('🎉 BOT FULLY OPERATIONAL');
            log.info(`   📍 Source groups:  ${config.sourceGroupIds.length}`);
            log.info(`   🆓 Free common:   ${config.freeCommonGroupId.substring(0, 20)}...`);
            log.info(`   💎 Paid groups:   ${Array.isArray(config.paidCommonGroupId) ? config.paidCommonGroupId.length : 1}`);
            log.info(`   🏙️  City groups:   ${config.configuredCities.length} (${config.configuredCities.join(', ')})`);
            log.info(`   🚫 Blocked nums:  ${config.blockedPhoneNumbers.length}`);
            log.info(`   🔵 Path A order:  Paid → City → Free (shuffled)`);
            log.info(`   🟢 Path B order:  Paid → City (shuffled)`);
            log.info(`   🔒 Dedup:         Text fingerprint (5-min windows)`);
            log.info(`   ⏱️  Delivery:      4 targets in 12-15s max`);
            log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          }
        }
      });

      // ── Message event — THE entry point for all incoming messages ──
      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        // type === 'notify' means genuinely new messages (not history sync)
        if (type !== 'notify') return;

        for (const msg of messages) {
          try {
            await handleMessage(msg);
          } catch (err) {
            log.error(`❌ Error handling message: ${err.message}`);
          }
        }
      });

    } catch (err) {
      log.error(`❌ Connection error: ${err.message}`);

      if (reconnectAttempts < BAILEYS.MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        const delay = Math.min(5000 * reconnectAttempts, 30000);
        log.info(`⏳ Retry in ${(delay / 1000).toFixed(1)}s (attempt ${reconnectAttempts}/${BAILEYS.MAX_RECONNECT_ATTEMPTS})`);
        await new Promise(r => setTimeout(r, delay));
        connectToWhatsApp();
      } else {
        log.error('❌ Max attempts reached — exiting for PM2 restart');
        process.exit(1);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // STATS SERVER (minimal Express — /stats, /ping, /groups only)
  // E2: bot identity is included in the JSON response
  // ---------------------------------------------------------------------------

  function startStatsServer() {
    const statsPort = parseInt(process.env.STATS_PORT || STATS.DEFAULT_PORT, 10);
    const app = express();

    app.get('/ping', (_, res) => res.send('ALIVE'));

    // E2: /stats includes botId and full runtime state
    app.get('/stats', (_, res) => {
      res.json({
        bot: {
          id:    config.botId,
          phone: config.botPhone,
        },
        uptime: ((Date.now() - BOT_START_TIME) / 1000 / 60).toFixed(1) + ' minutes',
        operational: botFullyOperational,
        stats,
        messageCount,
        cache: {
          fingerprintSet: fingerprintSet.size,
          replayIdSet:    replayIdSet.size,
          dirty:          fingerprintDirty,
        },
        circuitBreaker: {
          isOpen:       circuitBreaker.isOpen,
          failureCount: circuitBreaker.failureCount,
        },
        reconnect: {
          lastReconnectTime: lastReconnectTime ? new Date(lastReconnectTime).toISOString() : null,
          totalReconnects:   stats.reconnectCount,
        },
        config: {
          sourceGroupCount: config.sourceGroupIds.length,
          paidGroupCount:   Array.isArray(config.paidCommonGroupId) ? config.paidCommonGroupId.length : 1,
          cityGroups:       config.configuredCities,
          blockedNumbers:   config.blockedPhoneNumbers.length,
          hourlyLimit:      RATE_LIMITS.HOURLY,
          dailyLimit:       RATE_LIMITS.DAILY,
        },
      });
    });

    // /groups — lists all groups this bot is a member of (useful for config setup)
    app.get('/groups', async (_, res) => {
      if (!sock) return res.status(503).json({ error: 'Not connected' });
      try {
        const groupChats = await sock.groupFetchAllParticipating();
        const groups = Object.values(groupChats).map(chat => ({
          id:   chat.id,
          name: chat.subject || 'Unknown',
          participants: chat.participants?.length || 0,
        }));
        res.json({ bot: config.botId, count: groups.length, groups });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.listen(statsPort, () => {
      log.info(`📊 Stats server: http://localhost:${statsPort}/stats`);
    });
  }

  // ---------------------------------------------------------------------------
  // CLEANUP INTERVALS
  // ---------------------------------------------------------------------------

  // Cleanup stale cooldown entries every 30s
  setInterval(() => {
    const now = Date.now();
    for (const [groupId, timestamp] of inFlightSends.entries()) {
      if (now - timestamp > 30000) {
        inFlightSends.delete(groupId);
      }
    }
  }, SEND_COOLDOWN_CLEANUP_INTERVAL);

  // ---------------------------------------------------------------------------
  // GRACEFUL SHUTDOWN
  // ---------------------------------------------------------------------------

  async function gracefulShutdown(signal) {
    log.info(`👋 ${signal} received — shutting down gracefully`);

    // Final fingerprint save (flush regardless of dirty flag)
    saveFingerprints();

    // Clear debounce timer
    if (saveDebounceTimer) {
      clearTimeout(saveDebounceTimer);
      saveDebounceTimer = null;
    }

    // Clear circuit breaker timer
    if (circuitBreaker.resetTimeout) {
      clearTimeout(circuitBreaker.resetTimeout);
    }

    // Close socket cleanly
    if (sock) {
      try {
        sock.ev.removeAllListeners();
        sock.ws.close();
        log.info('✅ Socket closed');
      } catch (err) {
        log.warn(`⚠️  Socket close error: ${err.message}`);
      }
    }

    log.info('📊 Final stats:');
    log.info(`   Messages:    ${stats.totalMessagesSent}`);
    log.info(`   Path A:      ${stats.pathAProcessed}`);
    log.info(`   Path B:      ${stats.pathBProcessed}`);
    log.info(`   Duplicates:  ${stats.duplicatesSkipped}`);
    log.info(`   Replays:     ${stats.replayIdsSkipped}`);
    log.info(`   Reconnects:  ${stats.reconnectCount}`);
    log.info(`   Sends OK:    ${stats.sendSuccesses}`);
    log.info(`   Sends FAIL:  ${stats.sendFailures}`);

    process.exit(0);
  }

  process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGHUP',  () => {
    log.info('🔄 SIGHUP (PM2 reload) — cleaning up timers');
    if (saveDebounceTimer) { clearTimeout(saveDebounceTimer); saveDebounceTimer = null; }
    if (circuitBreaker.resetTimeout) { clearTimeout(circuitBreaker.resetTimeout); }
  });

  // ---------------------------------------------------------------------------
  // BOOT SEQUENCE
  // ---------------------------------------------------------------------------

  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log.info('🚀 TAXI BOT STARTING');
  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // 1. Load cached fingerprints from disk
  loadFingerprints();

  // 2. Start stats HTTP server (non-blocking)
  startStatsServer();

  // 3. Connect to WhatsApp (blocks on event loop — process stays alive)
  await connectToWhatsApp();
}