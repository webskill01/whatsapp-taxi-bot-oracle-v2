// =============================================================================
// core/index.js — WhatsApp Bot Core (Bot-1 OPTIMIZED)
// =============================================================================
// ✅ CRITICAL FIX APPLIED: Processing delay moved AFTER validation
// ✅ All Bot-2 improvements merged while preserving Path A/B routing
// ✅ Pickup-only city extraction (no dual city routing)
//
// STABILITY:
//   ✅ Auth state loaded ONCE (closure) — fixes Bad MAC death loop
//   ✅ isConnecting guard — no concurrent socket creation
//   ✅ Named listener removal on destroySocket (no ghost listeners)
//   ✅ Exponential backoff: 3s→6s→12s→24s→48s cap 60s, max 10 attempts
//   ✅ Hard exit on loggedOut / Bad MAC / No session (PM2 restarts cleanly)
//   ✅ Prekey errors → extended backoff (not hard exit)
//   ✅ B1: Reconnect age gate (30s window, 10s max msg age)
//   ✅ B2: Replay ID dedup (rolling 200)
//   ✅ A4: Settling delay (5-15s after connect)
//   ✅ C1: Batch fingerprint cleanup on overflow (trim to 80%)
//   ✅ C2: Debounced disk write (30s)
//   ✅ Stale pending fingerprint cleanup (60s timeout → purge, runs every 30s)
//   ✅ QR code HTTP endpoint — dynamic import (won't crash if qrcode missing)
//   ✅ QR also printed to terminal (fallback)
//   ✅ /ping /health /stats /status /groups HTTP endpoints
//   ✅ PM2 graceful shutdown (SIGINT / SIGTERM / SIGHUP)
//   ✅ 5-minute message age gate (logs rejection with age in seconds)
//   ✅ Stable per-bot fingerprint filename (botId + phone, auto-migrates old)
//
// ROUTING (Bot-1):
//   ✅ Path A: source group → paid[] + city + free
//   ✅ Path B: freeCommonGroup → paid[] + city (no free echo)
//   ✅ /groups shows source / paid / city / free_common / other
// =============================================================================

import {
  makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";

import express from "express";
import pino     from "pino";
import fs       from "fs";
import path     from "path";

import { getMessageFingerprint } from "./filter.js";
import { processMessage, resetCircuitBreaker } from "./router.js";
import { GLOBAL_CONFIG }         from "./globalConfig.js";

// =============================================================================
// CONSTANTS
// =============================================================================
const MAX_MESSAGE_AGE = 5 * 60 * 1000;  // 5 minutes

// =============================================================================
// MAIN EXPORT
// =============================================================================

export async function startBot(config, log, authDir) {

  // ===========================================================================
  // STATE
  // ===========================================================================

  let sock              = null;
  let reconnectAttempts = 0;
  let reconnectTimer    = null;
  let isShuttingDown    = false;
  let isConnecting      = false;

  // Auth loaded ONCE — stored in closure (critical for Bad MAC fix)
  let authState = null;
  let saveCreds = null;

  // QR code state for HTTP endpoint
  let latestQR    = null;
  let qrTimestamp = null;

  // Deduplication
  const fingerprintSet      = new Set();
  const pendingFingerprints = new Map();  // optimistic lock
  const replayIdSet         = new Set();  // B2

  // Stats
  const stats = {
    totalProcessed:             0,
    duplicatesSkipped:          0,
    replayIdsSkipped:           0,
    rejectedNoPhone:            0,
    rejectedNotTaxi:            0,
    rejectedTooShort:           0,
    rejectedEmptyBody:          0,
    rejectedFromMe:             0,
    rejectedBotSender:          0,
    rejectedBlockedNumber:      0,
    rejectedBlockedSender:      0,
    rejectedByReconnectAgeGate: 0,
    rejectedNotMonitored:       0,
    rejectedRateLimit:          0,
    rejectedTooOld:             0,
    rejectedNoCity:             0,
    sendsByGroup:               {},
    sendSuccesses:              0,
    sendFailures:               0,
    reconnectCount:             0,
    pathARouted:                0,
    pathBRouted:                0,
    cryptoErrors:               0,
    racePrevented:              0,
  };

  // B1 reconnect state
  let lastReconnectTime   = 0;
  let botFullyOperational = false;

  // A4 settling flag
  let needsSettlingDelay = true;

  // C2 debounce
  let fingerprintDirty  = false;
  let saveDebounceTimer = null;

  const BOT_START_TIME = Date.now();

  // ===========================================================================
  // STABLE FINGERPRINT FILE (botId + phone → survives rename)
  // ===========================================================================

  const BOT_ID = config.botId || path.basename(config.botDir || process.cwd());
  const PHONE  = (config.botPhone || "").replace(/\D/g, "") || "noPhone";

  const NEW_FP_FILENAME = `fingerprints_${BOT_ID}_${PHONE}.json`;
  const OLD_FP_FILENAME = `fingerprints_${PHONE}.json`;
  const NEW_FP_FILE     = path.join(config.botDir || process.cwd(), NEW_FP_FILENAME);
  const OLD_FP_FILE     = path.join(config.botDir || process.cwd(), OLD_FP_FILENAME);

  // Migrate old filename on first run
  if (fs.existsSync(OLD_FP_FILE) && !fs.existsSync(NEW_FP_FILE)) {
    try {
      fs.renameSync(OLD_FP_FILE, NEW_FP_FILE);
      log.info(`📂 Fingerprint migrated: ${OLD_FP_FILENAME} → ${NEW_FP_FILENAME}`);
    } catch (err) {
      log.warn(`⚠️  Fingerprint migration failed: ${err.message}`);
    }
  }

  const FINGERPRINT_FILE = NEW_FP_FILE;

  // ===========================================================================
  // STALE PENDING FINGERPRINT CLEANUP
  // ===========================================================================

  setInterval(() => {
    const now          = Date.now();
    const staleTimeout = 60_000;
    for (const [fp, timestamp] of pendingFingerprints.entries()) {
      if (now - timestamp > staleTimeout) {
        pendingFingerprints.delete(fp);
        log.warn(`🧹 Removed stale pending fingerprint: ${fp}`);
      }
    }
  }, 30_000);

  // ===========================================================================
  // C2: FINGERPRINT PERSISTENCE
  // ===========================================================================

  function loadFingerprints() {
    try {
      if (fs.existsSync(FINGERPRINT_FILE)) {
        const data   = JSON.parse(fs.readFileSync(FINGERPRINT_FILE, "utf8"));
        const cutoff = Date.now() - GLOBAL_CONFIG.deduplication.fingerprintTTL;
        let loaded   = 0;
        for (const item of data) {
          if (item.timestamp > cutoff) {
            fingerprintSet.add(item.fingerprint);
            loaded++;
          }
        }
        log.info(`📂 Loaded ${loaded} fingerprints (2h TTL) from ${NEW_FP_FILENAME}`);
      } else {
        fs.writeFileSync(FINGERPRINT_FILE, JSON.stringify([]), "utf8");
        log.info(`📂 Created fingerprint file: ${NEW_FP_FILENAME}`);
      }
    } catch (err) {
      log.warn(`⚠️  Fingerprint load failed: ${err.message}`);
    }
  }

  function saveFingerprints() {
    try {
      const data = Array.from(fingerprintSet).map((fp) => ({
        fingerprint: fp,
        timestamp:   Date.now(),
      }));
      fs.writeFileSync(
        FINGERPRINT_FILE,
        JSON.stringify(data.slice(-GLOBAL_CONFIG.deduplication.fingerprintSaveCap)),
        "utf8"
      );
      fingerprintDirty = false;
      log.info(`📂 Saved ${Math.min(data.length, GLOBAL_CONFIG.deduplication.fingerprintSaveCap)} fingerprints to ${NEW_FP_FILENAME}`);
    } catch (err) {
      log.warn(`⚠️  Fingerprint save failed: ${err.message}`);
    }
  }

  function markDirty() {
    fingerprintDirty = true;
    if (!saveDebounceTimer) {
      saveDebounceTimer = setTimeout(() => {
        if (fingerprintDirty) saveFingerprints();
        saveDebounceTimer = null;
      }, GLOBAL_CONFIG.deduplication.saveDebounceMs);
    }
  }

  // ===========================================================================
  // UTILITY
  // ===========================================================================

  function normalizePhone(p) {
    return p.replace(/\D/g, "").slice(-10);
  }

  function trackReplayId(msgId) {
    replayIdSet.add(msgId);
    if (replayIdSet.size > GLOBAL_CONFIG.deduplication.maxReplayIds) {
      const first = replayIdSet.values().next().value;
      replayIdSet.delete(first);
    }
  }

  // ===========================================================================
  // MESSAGE HANDLER (OPTIMIZED: delay moved to router AFTER validation)
  // ===========================================================================

  async function handleMessage(msg) {
    // Only group messages
    if (!msg.key.remoteJid?.endsWith("@g.us")) return;

    // Skip own messages
    if (msg.key.fromMe === true) {
      stats.rejectedFromMe++;
      return;
    }

    const msgId              = msg.key.id;
    const sourceGroup        = msg.key.remoteJid;
    const messageTimestampMs = (msg.messageTimestamp || 0) * 1000;

    // ── Message age gate (5 min) — logs age on rejection ──
    const messageAge = Date.now() - messageTimestampMs;
    if (messageAge > MAX_MESSAGE_AGE) {
      stats.rejectedTooOld++;
      log.warn(`⏰ Old message dropped: ${Math.floor(messageAge / 1000)}s old (max ${MAX_MESSAGE_AGE / 1000}s)`);
      return;
    }

    // ── B1: Reconnect age gate ──
    const timeSinceReconnect = Date.now() - lastReconnectTime;
    if (
      lastReconnectTime > 0 &&
      timeSinceReconnect < GLOBAL_CONFIG.reconnect.strictWindowDuration
    ) {
      if (Date.now() - messageTimestampMs > GLOBAL_CONFIG.reconnect.strictAgeMs) {
        stats.rejectedByReconnectAgeGate++;
        return;
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
      "";

    if (!text || text.trim() === "") {
      stats.rejectedEmptyBody++;
      return;
    }

    // ── Bot self-send check ──
    const participantPhone = (msg.key.participant || "").split("@")[0] || "";
    const botPhone         = config.botPhone || "";
    if (
      participantPhone &&
      botPhone &&
      normalizePhone(participantPhone) === normalizePhone(botPhone)
    ) {
      stats.rejectedBotSender++;
      return;
    }

    // ── Blocked sender check (before any text processing) ──
    if (participantPhone && config.blockedSenders && config.blockedSenders.length > 0) {
      const normalizedSender = normalizePhone(participantPhone);
      if (config.blockedSenders.some(blocked => normalizePhone(blocked) === normalizedSender)) {
        stats.rejectedBlockedSender = (stats.rejectedBlockedSender || 0) + 1;
        log.warn(`BLOCKED SENDER: ${participantPhone}`);
        return;
      }
    }

    // ── Min length ──
    if (text.length < GLOBAL_CONFIG.validation.minMessageLength) {
      stats.rejectedTooShort++;
      return;
    }

    // ── Path detection (Bot-1 logic) ──
    const isPathA = config.sourceGroupIds.includes(sourceGroup);
    const isPathB = sourceGroup === config.freeCommonGroupId;

    if (!isPathA && !isPathB) {
      stats.rejectedNotMonitored++;
      return;
    }

    // ── Fingerprint dedup ──
    const timeBucket  = Math.floor(messageTimestampMs / (5 * 60 * 1000));
    const fingerprint = getMessageFingerprint(text, null, timeBucket);

    if (fingerprintSet.has(fingerprint)) {
      stats.duplicatesSkipped++;
      log.info(`🔁 Duplicate (saved) — skipped: ${fingerprint}`);
      return;
    }

    if (pendingFingerprints.has(fingerprint)) {
      stats.duplicatesSkipped++;
      stats.racePrevented++;
      log.warn(`⚡ Race prevented: ${fingerprint}`);
      return;
    }

    // Optimistic lock
    pendingFingerprints.set(fingerprint, Date.now());

    // ── A4: Settling delay (first message after connect) ──
    if (needsSettlingDelay) {
      needsSettlingDelay = false;
      const settleDuration =
        GLOBAL_CONFIG.reconnect.settlingMin +
        Math.floor(Math.random() * (GLOBAL_CONFIG.reconnect.settlingMax - GLOBAL_CONFIG.reconnect.settlingMin));
      log.info(`⏳ Settling: ${(settleDuration / 1000).toFixed(1)}s (first message after connect)`);
      await new Promise((r) => setTimeout(r, settleDuration));
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // FIX: Log BEFORE validation (no processing delay wasted on rejected msgs)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    stats.totalProcessed++;
    log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    log.info(`📥 MSG #${stats.totalProcessed} | Path ${isPathA ? "A" : "B"} | ${sourceGroup.substring(0, 18)}...`);
    log.info(`   "${text.substring(0, 60)}${text.length > 60 ? "..." : ""}"`);
    log.info(`   FP: ${fingerprint}`);

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // FIX: Pass pre-extracted text to router (not raw msg object)
    // Processing delay happens INSIDE router AFTER validation passes
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    let routingResult;
    try {
      routingResult = await processMessage(sock, text, sourceGroup, isPathA, config, stats, log);
    } catch (err) {
      log.error(`❌ Routing error: ${err.message}`);
      routingResult = { wasRouted: false, path: "none" };
    }

    // ── Commit or discard fingerprint ──
    if (routingResult?.wasRouted) {
      pendingFingerprints.delete(fingerprint);
      fingerprintSet.add(fingerprint);
      markDirty();

      if (routingResult.path === "A") stats.pathARouted++;
      if (routingResult.path === "B") stats.pathBRouted++;

      log.info(`✅ Fingerprint saved permanently: ${fingerprint}`);

      // C1: Cleanup on overflow (trim to 80%)
      if (fingerprintSet.size > GLOBAL_CONFIG.deduplication.maxFingerprintCache) {
        const targetSize = Math.floor(
          GLOBAL_CONFIG.deduplication.maxFingerprintCache *
          GLOBAL_CONFIG.deduplication.cleanupTargetRatio
        );
        const toDelete = fingerprintSet.size - targetSize;
        const iterator = fingerprintSet.values();
        for (let i = 0; i < toDelete; i++) {
          const val = iterator.next().value;
          if (val) fingerprintSet.delete(val);
        }
        log.info(`🧹 FP cleanup: deleted ${toDelete}, remaining ${fingerprintSet.size}`);
      }
    } else {
      pendingFingerprints.delete(fingerprint);
      log.info(`🔓 Fingerprint unlocked (rejected): ${fingerprint}`);
    }
  }

  // ===========================================================================
  // SOCKET TEARDOWN — named listener removal prevents ghost listeners
  // ===========================================================================

  function destroySocket(reason) {
    if (!sock) return;
    log.info(`🔌 Destroying socket: ${reason}`);
    try {
      sock.ev.removeAllListeners("connection.update");
      sock.ev.removeAllListeners("creds.update");
      sock.ev.removeAllListeners("messages.upsert");
      sock.ev.removeAllListeners();
      sock.end(undefined);
    } catch (err) {
      log.warn(`⚠️  Socket teardown error: ${err.message}`);
    }
    sock = null;
    log.info("✅ Socket destroyed");
  }

  // ===========================================================================
  // RECONNECT
  // ===========================================================================

  function scheduleReconnect(reason) {
    if (isShuttingDown) {
      log.info("⚠️  Shutdown in progress — skipping reconnect");
      return;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    const BACKOFF_BASE = 3_000;
    const BACKOFF_CAP  = 60_000;
    const MAX_ATTEMPTS = 10;

    const delay = Math.min(BACKOFF_BASE * Math.pow(2, reconnectAttempts), BACKOFF_CAP);
    reconnectAttempts++;

    if (reconnectAttempts > MAX_ATTEMPTS) {
      log.error("❌ Max reconnect attempts reached — exiting");
      process.exit(1);
    }

    log.info(`🔄 Reconnect in ${(delay / 1000).toFixed(1)}s (attempt ${reconnectAttempts}/${MAX_ATTEMPTS}) [${reason}]`);
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      await connectToWhatsApp();
    }, delay);
  }

  // ===========================================================================
  // BAILEYS CONNECTION
  // ===========================================================================

  async function connectToWhatsApp() {
    if (isConnecting) {
      log.warn("⚠️  Already connecting — skipped");
      return;
    }
    isConnecting = true;

    if (sock) destroySocket("reconnect");

    try {
      // ── Auth ONCE (key stability fix) ──
      if (!authState) {
        log.info("🔐 Loading auth state (ONCE per process)...");
        const { state, saveCreds: sc } = await useMultiFileAuthState(authDir);
        authState = state;
        saveCreds = sc;
        log.info("✅ Auth loaded and locked in closure");
      }

      const { version } = await fetchLatestBaileysVersion();
      log.info(`📦 Baileys version: ${version.join(".")}`);

      // Suppress crypto noise (normal for large groups)
      const baileysLogger = pino({
        level: "warn",
        hooks: {
          logMethod(inputArgs, method) {
            const msg = inputArgs[0];
            if (
              typeof msg === "string" &&
              (msg.includes("closing session") ||
               msg.includes("decrypt") ||
               msg.includes("bad mac") ||
               msg.includes("failed to decrypt") ||
               msg.includes("InvalidMessageException") ||
               msg.includes("No session found"))
            ) {
              stats.cryptoErrors++;
              return;
            }
            method.apply(this, inputArgs);
          },
        },
      });

      sock = makeWASocket({
        version,
        auth: {
          creds: authState.creds,
          keys: makeCacheableSignalKeyStore(authState.keys, baileysLogger),
        },
        logger:                baileysLogger,
        printQRInTerminal:     false,       // QR served via HTTP; also printed below
        browser:               ["Taxi Bot", "Chrome", "120.0"],
        markOnlineOnConnect:   false,
        syncFullHistory:       false,
        getMessage:            async () => undefined,
        defaultQueryTimeoutMs: 60_000,
        connectTimeoutMs:      60_000,
        keepAliveIntervalMs:   30_000,
      });

      log.info("✅ Socket created");

      // creds.update
      sock.ev.on("creds.update", async () => {
        if (saveCreds) await saveCreds();
      });

      // connection.update
      sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          latestQR    = qr;
          qrTimestamp = Date.now();
          log.info("📱 QR ready — scan at /qr or in terminal below");
          // Print to terminal as fallback
          try {
            const qrcodeTerminal = (await import("qrcode-terminal")).default;
            qrcodeTerminal.generate(qr, { small: true });
          } catch (_) { /* optional dep */ }
        }

        if (connection === "open") {
          latestQR           = null;
          qrTimestamp        = null;
          reconnectAttempts  = 0;
          lastReconnectTime  = Date.now();
          needsSettlingDelay = true;
          resetCircuitBreaker(log);

          log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
          log.info("✅ WhatsApp connected");
          log.info(`📱 Connected as: ${sock.user?.id || "unknown"}`);
          log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

          if (!botFullyOperational) {
            botFullyOperational = true;
            log.info("🎉 BOT FULLY OPERATIONAL (OPTIMIZED)");
            log.info(`   📍 Source groups:  ${config.sourceGroupIds.length}`);
            log.info(`   🆓 Free common:   ${config.freeCommonGroupId.substring(0, 20)}...`);
            log.info(`   💎 Paid groups:   ${config.paidCommonGroupId.length}`);
            log.info(`   🏙️  City groups:   ${config.configuredCities.length} (${config.configuredCities.join(", ")})`);
            log.info(`   🚫 Blocked nums:  ${config.blockedPhoneNumbers.length}`);
            log.info(`   ⏰ Max msg age:   ${MAX_MESSAGE_AGE / 1000}s`);
            log.info(`   ⚡ Race prevention: ACTIVE`);
            log.info(`   📂 Fingerprint file: ${NEW_FP_FILENAME}`);
            log.info(`   🔀 Routing: Pickup-only city detection (Path A/B)`);
            log.info(`   ⏱️  Processing delay: AFTER validation (optimized)`);
            log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
          }
        }

        if (connection === "close") {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const errorMsg   = lastDisconnect?.error?.message || "";

          log.warn("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
          log.warn(`⚠️  CONNECTION CLOSED`);
          log.warn(`   Status: ${statusCode || "undefined"}`);
          log.warn(`   Error:  ${errorMsg || "none"}`);
          log.warn("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

          destroySocket("connection closed");

          // Hard exit on unrecoverable states — PM2 will restart cleanly
          if (statusCode === DisconnectReason.loggedOut) {
            log.error("❌ LOGGED OUT — delete baileys_auth/ and restart");
            process.exit(1);
          }

          if (errorMsg.includes("Bad MAC") || errorMsg.includes("Decryption error")) {
            log.error("❌ Crypto session unrecoverable — exiting for clean restart");
            process.exit(1);
          }

          // "No session found" on the stream itself (not individual messages) = unrecoverable
          if (errorMsg.includes("No session found") && statusCode !== 515) {
            log.error("❌ No session found (stream level) — exiting for clean restart");
            process.exit(1);
          }

          // Prekey / statusCode 440 / 515 → extended backoff, NOT hard exit
          if (
            errorMsg.includes("prekey") ||
            statusCode === 440 ||
            statusCode === 515
          ) {
            log.warn("⚠️  Crypto/stream error — applying extended backoff");
            reconnectAttempts = Math.max(reconnectAttempts, 2);
          }

          stats.reconnectCount++;
          scheduleReconnect(`statusCode=${statusCode}`);
        }
      });

      // messages.upsert
      sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;
        for (const msg of messages) {
          try {
            await handleMessage(msg);
          } catch (err) {
            log.error(`❌ handleMessage error: ${err.message}`);
          }
        }
      });

    } catch (err) {
      log.error(`❌ Connection error: ${err.message}`);
      scheduleReconnect("connection error");
    } finally {
      isConnecting = false;
    }
  }

  // ===========================================================================
  // STATS / HTTP SERVER (keeping existing /groups endpoint with improvements)
  // ===========================================================================

  function startStatsServer() {
    const statsPort = parseInt(
      process.env.STATS_PORT || process.env.QR_SERVER_PORT || "3001",
      10
    );
    const app = express();
    app.use(express.static("public"));

    // Ping
    app.get("/ping", (_, res) => res.send("ALIVE"));

    // Health — binary up/down for monitoring
    app.get("/health", (_, res) => {
      const healthy     = botFullyOperational && !!sock?.user;
      const total       = stats.sendSuccesses + stats.sendFailures;
      const failureRate = total > 0 ? (stats.sendFailures / total).toFixed(3) : "0.000";

      res.status(healthy ? 200 : 503).json({
        status:       healthy ? "healthy" : "degraded",
        uptime:       Date.now() - BOT_START_TIME,
        connected:    botFullyOperational,
        reconnects:   stats.reconnectCount,
        failures:     stats.sendFailures,
        successes:    stats.sendSuccesses,
        failureRate,
        lastReconnect: lastReconnectTime
          ? new Date(lastReconnectTime).toISOString()
          : null,
      });
    });

    // Status — legacy compatibility endpoint
    app.get("/status", (_, res) => {
      res.json({
        connected:    botFullyOperational,
        qrAvailable:  !!latestQR,
        botName:      process.env.BOT_NAME || "unknown",
      });
    });

    // Stats — full runtime state
    app.get("/stats", (_, res) => {
      res.json({
        bot: {
          name:  process.env.BOT_NAME || "unknown",
          phone: config.botPhone || "unknown",
        },
        uptime:      ((Date.now() - BOT_START_TIME) / 60_000).toFixed(1) + " minutes",
        operational: botFullyOperational,
        qrAvailable: !!latestQR,
        stats,
        cache: {
          fingerprintSet:      fingerprintSet.size,
          pendingFingerprints: pendingFingerprints.size,
          replayIdSet:         replayIdSet.size,
          dirty:               fingerprintDirty,
          fingerprintFile:     NEW_FP_FILENAME,
        },
        reconnect: {
          lastReconnect:   lastReconnectTime
            ? new Date(lastReconnectTime).toISOString()
            : null,
          totalReconnects: stats.reconnectCount,
        },
        config: {
          sourceGroups:     config.sourceGroupIds.length,
          paidGroups:       config.paidCommonGroupId.length,
          cityGroups:       config.configuredCities.length,
          freeCommonGroup:  config.freeCommonGroupId,
          configuredCities: config.configuredCities,
        },
        enhancements: {
          maxMessageAge:       `${MAX_MESSAGE_AGE / 1000}s`,
          processingDelay:     "AFTER validation (optimized)",
          stableFpFile:        true,
          namedListeners:      true,
          pickupOnlyRouting:   true,
        },
      });
    });

    // Groups — enriched with full metadata + Bot-1 path categorisation (IMPROVED)
    app.get("/groups", async (req, res) => {
  if (!sock || !botFullyOperational) {
    return res.status(503).json({ 
      error: "Bot not connected", 
      operational: botFullyOperational 
    });
  }

  try {
    // Step 1: Fetch all groups the bot is actively in
    const groupChats = await sock.groupFetchAllParticipating();
    const fetchedGroups = Object.values(groupChats);

    // Step 2: Build a map of fetched group data
    const groupDataMap = new Map(
      fetchedGroups.map((chat) => [
        chat.id,
        {
          id:               chat.id,
          name:             chat.subject || "Unknown Group",
          participantCount: chat.participants?.length || 0,
          isFetched:        true,
        },
      ])
    );

    // Step 3: Collect ALL group IDs from config (even if bot was removed)
    const allConfiguredGroupIds = new Set([
      ...config.sourceGroupIds,
      ...config.paidCommonGroupId,
      config.freeCommonGroupId,
      ...Object.values(config.cityTargetGroups),
    ]);

    // Step 4: For each configured group not in fetched set, try to fetch metadata
    const missingGroupIds = [...allConfiguredGroupIds].filter(
      (id) => !groupDataMap.has(id)
    );

    // Attempt to fetch metadata for missing groups (may fail if bot was removed)
    for (const groupId of missingGroupIds) {
      try {
        const metadata = await sock.groupMetadata(groupId);
        groupDataMap.set(groupId, {
          id:               groupId,
          name:             metadata.subject || "Unknown Group",
          participantCount: metadata.participants?.length || 0,
          isFetched:        false,
          status:           "not_participating",
        });
      } catch (err) {
        groupDataMap.set(groupId, {
          id:               groupId,
          name:             "⚠️ Unknown / Removed Group",
          participantCount: 0,
          isFetched:        false,
          status:           "unavailable",
        });
        log.warn(`⚠️  Failed to fetch metadata for ${groupId}: ${err.message}`);
      }
    }

    // Step 4b: Re-fetch configured groups that the bulk call returned with incomplete data
    // (empty subject or 0 participants). Done in small batches to avoid rate-limiting.
    const incompleteGroupIds = [...allConfiguredGroupIds].filter((id) => {
      const g = groupDataMap.get(id);
      return g && g.isFetched && (g.name === "Unknown Group" || g.participantCount === 0);
    });

    const REFETCH_BATCH = 5;
    const REFETCH_DELAY = 400; // ms between batches

    for (let i = 0; i < incompleteGroupIds.length; i += REFETCH_BATCH) {
      const batch = incompleteGroupIds.slice(i, i + REFETCH_BATCH);
      await Promise.all(
        batch.map(async (groupId) => {
          try {
            const metadata = await sock.groupMetadata(groupId);
            if (metadata?.subject) {
              groupDataMap.set(groupId, {
                id:               groupId,
                name:             metadata.subject,
                participantCount: metadata.participants?.length || 0,
                isFetched:        true,
              });
            }
          } catch (err) {
            log.warn(`⚠️  Failed to re-fetch incomplete group ${groupId}: ${err.message}`);
          }
        })
      );
      if (i + REFETCH_BATCH < incompleteGroupIds.length) {
        await new Promise((r) => setTimeout(r, REFETCH_DELAY));
      }
    }

    // Step 5: Categorize ALL groups
    const allGroups = Array.from(groupDataMap.values());

    const sourceSet  = new Set(config.sourceGroupIds);
    const paidSet    = new Set(config.paidCommonGroupId);
    const cityRevMap = new Map(
      Object.entries(config.cityTargetGroups).map(([city, gid]) => [gid, city])
    );

    const categorized = allGroups.map((group) => {
      let category = "other";
      let label    = "Unmonitored";
      let meta     = null;

      if (sourceSet.has(group.id)) {
        category = "source";
        label    = "Source Group (Path A)";
      } else if (group.id === config.freeCommonGroupId) {
        category = "free_common";
        label    = "Free Common (Path A dest + Path B source)";
      } else if (paidSet.has(group.id)) {
        category = "paid";
        label    = "Paid Common";
      } else if (cityRevMap.has(group.id)) {
        category = "city";
        label    = `City: ${cityRevMap.get(group.id)}`;
        meta     = { city: cityRevMap.get(group.id) };
      }

      if (category !== "other" && group.status === "not_participating") {
        label += " ⚠️ (Bot Not In Group)";
      } else if (category !== "other" && group.status === "unavailable") {
        label += " ❌ (Group Unavailable)";
      }

      return { ...group, category, label, meta };
    });

    // Step 6: Sort by category
    const sortOrder = { source: 1, paid: 2, city: 3, free_common: 4, other: 5 };
    categorized.sort((a, b) => {
      const oa = sortOrder[a.category] || 9;
      const ob = sortOrder[b.category] || 9;
      if (oa !== ob) return oa - ob;
      return (a.name || "").localeCompare(b.name || "");
    });

    // Step 7: Health warnings
    const healthWarnings = [];
    
    const missingSource = config.sourceGroupIds.filter(
      (id) => groupDataMap.get(id)?.status !== undefined
    );
    const missingPaid = config.paidCommonGroupId.filter(
      (id) => groupDataMap.get(id)?.status !== undefined
    );
    const missingCity = Object.entries(config.cityTargetGroups)
      .filter(([_, gid]) => groupDataMap.get(gid)?.status !== undefined)
      .map(([city, gid]) => ({ city, groupId: gid }));

    if (missingSource.length > 0) {
      healthWarnings.push({
        type: "missing_source_groups",
        count: missingSource.length,
        groupIds: missingSource,
      });
    }
    if (missingPaid.length > 0) {
      healthWarnings.push({
        type: "missing_paid_groups",
        count: missingPaid.length,
        groupIds: missingPaid,
      });
    }
    if (missingCity.length > 0) {
      healthWarnings.push({
        type: "missing_city_groups",
        count: missingCity.length,
        cities: missingCity,
      });
    }

    res.json({
      success: true,
      bot: {
        name:  process.env.BOT_NAME || "unknown",
        phone: sock.user?.id || "unknown",
      },
      totalGroups: categorized.length,
      breakdown: {
        source:      categorized.filter((g) => g.category === "source").length,
        paid:        categorized.filter((g) => g.category === "paid").length,
        city:        categorized.filter((g) => g.category === "city").length,
        freeCommon:  categorized.filter((g) => g.category === "free_common").length,
        unmonitored: categorized.filter((g) => g.category === "other").length,
      },
      health: {
        allConfiguredGroupsAccessible: healthWarnings.length === 0,
        warnings: healthWarnings,
      },
      routing: {
        pathA:  "source group → paid[] + city + free",
        pathB:  "freeCommon → paid[] + city",
        cities: config.configuredCities,
        cityDetection: "pickup-only",
      },
      groups: categorized,
    });
  } catch (err) {
    log.error(`❌ /groups error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

    // QR PNG — dynamic import
    app.get("/qr", async (req, res) => {
      if (!latestQR) {
        return res.status(404).send("QR not available. Bot may already be connected.");
      }
      if (Date.now() - (qrTimestamp || 0) > 20_000) {
        return res.status(410).send("QR expired. Wait for a new one (~20s).");
      }
      try {
        const QRCode = (await import("qrcode")).default;
        const buf = await QRCode.toBuffer(latestQR, {
          type: "png", width: 400, margin: 2,
          color: { dark: "#000000", light: "#FFFFFF" },
        });
        res.type("png").send(buf);
      } catch (err) {
        if (err.code === "ERR_MODULE_NOT_FOUND") {
          return res.status(503).send("QR image unavailable: run 'npm install' to add the qrcode package.");
        }
        res.status(500).send("QR generation failed");
      }
    });

    // QR base64
    app.get("/qr/base64", async (req, res) => {
      if (!latestQR) {
        return res.status(404).json({ error: "QR not available", qrAvailable: false });
      }
      if (Date.now() - (qrTimestamp || 0) > 20_000) {
        return res.status(410).json({ error: "QR expired", qrAvailable: false });
      }
      try {
        const QRCode  = (await import("qrcode")).default;
        const dataURL = await QRCode.toDataURL(latestQR, { width: 400, margin: 2 });
        res.json({ qr: dataURL, qrAvailable: true, timestamp: qrTimestamp });
      } catch (err) {
        if (err.code === "ERR_MODULE_NOT_FOUND") {
          return res.status(503).json({ error: "qrcode package not installed. Run npm install.", qrAvailable: false });
        }
        res.status(500).json({ error: "QR generation failed" });
      }
    });

    app.listen(statsPort, "0.0.0.0", () => {
      log.info(`📊 Stats:   http://0.0.0.0:${statsPort}/stats`);
      log.info(`💚 Health:  http://0.0.0.0:${statsPort}/health`);
      log.info(`📱 QR:      http://0.0.0.0:${statsPort}/qr`);
      log.info(`👥 Groups:  http://0.0.0.0:${statsPort}/groups`);
    });
  }

  // ===========================================================================
  // GRACEFUL SHUTDOWN
  // ===========================================================================

  async function gracefulShutdown(signal) {
    log.info(`👋 ${signal} — shutting down`);
    isShuttingDown = true;

    if (reconnectTimer)    { clearTimeout(reconnectTimer);   reconnectTimer   = null; }
    if (saveDebounceTimer) { clearTimeout(saveDebounceTimer); saveDebounceTimer = null; }

    saveFingerprints();
    destroySocket("shutdown");

    log.info("📊 Final stats:");
    log.info(`   Processed:   ${stats.totalProcessed}`);
    log.info(`   Path A:      ${stats.pathARouted}`);
    log.info(`   Path B:      ${stats.pathBRouted}`);
    log.info(`   Duplicates:  ${stats.duplicatesSkipped}`);
    log.info(`   Too old:     ${stats.rejectedTooOld}`);
    log.info(`   Replays:     ${stats.replayIdsSkipped}`);
    log.info(`   Races:       ${stats.racePrevented} (prevented)`);
    log.info(`   Crypto:      ${stats.cryptoErrors} (normal)`);
    log.info(`   Reconnects:  ${stats.reconnectCount}`);
    log.info(`   Sends OK:    ${stats.sendSuccesses}`);
    log.info(`   Sends FAIL:  ${stats.sendFailures}`);

    log.info("✅ Shutdown complete");
    process.exit(0);
  }

  process.on("SIGINT",  () => gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGHUP",  () => gracefulShutdown("SIGHUP"));

  // ===========================================================================
  // BOOT
  // ===========================================================================

  log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  log.info("🚀 TAXI BOT v4 STARTING (Path A/B OPTIMIZED)");
  log.info("   ✅ Processing delay AFTER validation (saves 2-7s)");
  log.info("   ✅ Auth-once (Bad MAC fix)");
  log.info("   ✅ Named listener removal");
  log.info("   ✅ QR via HTTP + terminal fallback");
  log.info("   ✅ 5-min message age gate");
  log.info("   ✅ /health + /status + /stats + /groups");
  log.info("   ✅ Pickup-only city routing (Path A/B)");
  log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  loadFingerprints();
  startStatsServer();
  await connectToWhatsApp();
}