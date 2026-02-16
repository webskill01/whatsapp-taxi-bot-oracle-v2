// =============================================================================
// core/index.js — Baileys connection + message handler + stats server.
// ✅ ENHANCEMENTS ADDED (no breaking changes):
//    1. Message age validation (5-minute max)
//    2. Stable fingerprint filename (botId + phone)
//    3. Processing delay randomization (2-7s)
//    4. /health endpoint for monitoring
// =============================================================================

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import express from "express";
import pino from "pino";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";

import { getMessageFingerprint } from "./filter.js";
import { processPathA, processPathB } from "./router.js";
import {
  CACHE,
  RECONNECT,
  BAILEYS,
  SEND_COOLDOWN_CLEANUP_INTERVAL,
  STATS,
  MESSAGE,
  RATE_LIMITS,
  CIRCUIT_BREAKER,
} from "./globalDefaults.js";
import { panic } from "./logger.js";

// =============================================================================
// ✅ NEW CONSTANTS FOR ENHANCEMENTS
// =============================================================================
const MAX_MESSAGE_AGE = 5 * 60 * 1000; // 5 minutes
const PROCESSING_DELAY_MIN = 2000;     // 2 seconds
const PROCESSING_DELAY_MAX = 7000;     // 7 seconds

// -----------------------------------------------------------------------------
// MAIN EXPORT
// -----------------------------------------------------------------------------

export async function startBot(config, log, authDir) {
  // ---------------------------------------------------------------------------
  // STATE
  // ---------------------------------------------------------------------------

  let sock = null;
  let reconnectAttempts = 0;

  const fingerprintSet = new Set();
  const pendingFingerprints = new Map();

  const cleanupPendingFingerprints = () => {
    setImmediate(() => {
      const now = Date.now();
      const staleTimeout = 60000;
      let cleaned = 0;

      for (const [fp, timestamp] of pendingFingerprints.entries()) {
        if (now - timestamp > staleTimeout) {
          pendingFingerprints.delete(fp);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        log.warn(`🧹 Cleaned ${cleaned} stale pending fingerprints`);
      }
    });
  };

  setInterval(cleanupPendingFingerprints, 30000);

  const replayIdSet = new Set();
  const inFlightSends = new Map();

  const messageCount = {
    hourly: 0,
    daily: 0,
    lastHourReset: Date.now(),
    lastDayReset: Date.now(),
  };

  const circuitBreaker = {
    failureCount: 0,
    lastFailureTime: 0,
    isOpen: false,
    resetTimeout: null,
  };

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
    rejectedTooOld: 0, // ✅ NEW: Track old message rejections
    humanPausesTriggered: 0,
    sendSuccesses: 0,
    sendFailures: 0,
    reconnectCount: 0,
    racePrevented: 0,
  };

  let lastReconnectTime = 0;
  let botFullyOperational = false;
  let needsSettlingDelay = true;
  let fingerprintDirty = false;
  let saveDebounceTimer = null;
  let isSaving = false;

  const BOT_START_TIME = Date.now();

  // =========================================================================
  // ✅ ENHANCEMENT #2: STABLE FINGERPRINT FILENAME (botId + phone)
  // =========================================================================
  const BOT_ID = config.botId || "unknown";
  const PHONE = config.botPhone?.replace(/\D/g, "") || "noPhone";

  const NEW_FINGERPRINT_FILENAME = `fingerprints_${BOT_ID}_${PHONE}.json`;
  const OLD_FINGERPRINT_FILENAME = `fingerprints_${PHONE}.json`;

  const NEW_FINGERPRINT_FILE = path.join(process.cwd(), NEW_FINGERPRINT_FILENAME);
  const OLD_FINGERPRINT_FILE = path.join(process.cwd(), OLD_FINGERPRINT_FILENAME);

  // Migrate old fingerprint file to new stable format (backward compatibility)
  if (fsSync.existsSync(OLD_FINGERPRINT_FILE) && !fsSync.existsSync(NEW_FINGERPRINT_FILE)) {
    try {
      fsSync.renameSync(OLD_FINGERPRINT_FILE, NEW_FINGERPRINT_FILE);
      log.info(`📂 Migrated fingerprint file: ${OLD_FINGERPRINT_FILENAME} → ${NEW_FINGERPRINT_FILENAME}`);
    } catch (err) {
      log.warn(`⚠️  Fingerprint migration failed: ${err.message}`);
    }
  }

  const FINGERPRINT_FILE = NEW_FINGERPRINT_FILE;
  const BOT_FINGERPRINT_FILENAME = NEW_FINGERPRINT_FILENAME;

  // ---------------------------------------------------------------------------
  // FINGERPRINT PERSISTENCE (async, non-blocking)
  // ---------------------------------------------------------------------------

  function loadFingerprints() {
    try {
      if (fsSync.existsSync(FINGERPRINT_FILE)) {
        const data = JSON.parse(fsSync.readFileSync(FINGERPRINT_FILE, "utf8"));
        const cutoff = Date.now() - CACHE.FINGERPRINT_TTL_MS;

        let loaded = 0;
        for (const item of data) {
          if (item.timestamp > cutoff) {
            fingerprintSet.add(item.fingerprint);
            loaded++;
          }
        }
        log.info(`📂 Loaded ${loaded} fingerprints (2h TTL) from ${BOT_FINGERPRINT_FILENAME}`);
      } else {
        fsSync.writeFileSync(FINGERPRINT_FILE, JSON.stringify([]), "utf8");
        log.info(`📂 Created per-bot fingerprint file: ${BOT_FINGERPRINT_FILENAME}`);
      }
    } catch (err) {
      log.warn(`⚠️  Fingerprint load failed: ${err.message}`);
    }
  }

  async function saveFingerprints() {
    if (isSaving) {
      log.info("⏭️  Save already in progress, skipping");
      return;
    }

    isSaving = true;

    try {
      const data = Array.from(fingerprintSet).map((fp) => ({
        fingerprint: fp,
        timestamp: Date.now(),
      }));

      await fs.writeFile(
        FINGERPRINT_FILE,
        JSON.stringify(data.slice(-CACHE.FINGERPRINT_SAVE_CAP)),
        "utf8"
      );

      fingerprintDirty = false;
      log.info(
        `📂 Fingerprints saved (${Math.min(data.length, CACHE.FINGERPRINT_SAVE_CAP)} entries) to ${BOT_FINGERPRINT_FILENAME}`
      );
    } catch (err) {
      log.warn(`⚠️  Fingerprint save failed: ${err.message}`);
    } finally {
      isSaving = false;
    }
  }

  function markDirty() {
    fingerprintDirty = true;
    if (!saveDebounceTimer) {
      saveDebounceTimer = setTimeout(() => {
        saveFingerprints();
        saveDebounceTimer = null;
      }, CACHE.SAVE_DEBOUNCE_MS);
    }
  }

  // ---------------------------------------------------------------------------
  // UTILITY
  // ---------------------------------------------------------------------------

  function normalizePhone(p) {
    return p.replace(/\D/g, "").slice(-10);
  }

  function trackReplayId(msgId) {
    replayIdSet.add(msgId);
    if (replayIdSet.size > CACHE.MAX_REPLAY_IDS) {
      const first = replayIdSet.values().next().value;
      replayIdSet.delete(first);
    }
  }

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
  // MESSAGE HANDLER
  // ---------------------------------------------------------------------------

  async function handleMessage(msg) {
    if (!msg.key.remoteJid?.endsWith("@g.us")) return;

    if (msg.key.fromMe === true) {
      stats.rejectedFromMe++;
      return;
    }

    const msgId = msg.key.id;
    const sourceGroup = msg.key.remoteJid;
    const messageTimestamp = msg.messageTimestamp;
    const messageTimestampMs = messageTimestamp * 1000;

    // =========================================================================
    // ✅ ENHANCEMENT #1: MESSAGE AGE VALIDATION (5-minute max)
    // =========================================================================
    const messageAge = Date.now() - messageTimestampMs;

    if (messageAge > MAX_MESSAGE_AGE) {
      stats.rejectedTooOld++;
      log.warn(`⏰ Old message dropped: ${Math.floor(messageAge / 1000)}s old (max ${MAX_MESSAGE_AGE / 1000}s)`);
      return;
    }

    // B1: Reconnect age gate (existing logic preserved)
    const timeSinceReconnect = Date.now() - lastReconnectTime;
    if (
      lastReconnectTime > 0 &&
      timeSinceReconnect < RECONNECT.STRICT_WINDOW_DURATION
    ) {
      const reconnectMessageAge = Date.now() - messageTimestampMs;
      if (reconnectMessageAge > RECONNECT.STRICT_AGE_MS) {
        stats.rejectedByReconnectAgeGate++;
        return;
      }
    }

    // B2: Replay ID check
    if (replayIdSet.has(msgId)) {
      stats.replayIdsSkipped++;
      return;
    }

    // Extract text
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

    // Bot self-send check
    const senderPhone = sourceGroup.split("@")[0] || "";
    const participantPhone = (msg.key.participant || "").split("@")[0] || "";

    if (
      normalizePhone(senderPhone) === normalizePhone(config.botPhone) ||
      normalizePhone(participantPhone) === normalizePhone(config.botPhone)
    ) {
      stats.rejectedBotSender++;
      return;
    }

    // Min length check
    if (text.length < MESSAGE.MIN_LENGTH) {
      stats.rejectedTooShort++;
      return;
    }

    // Path detection
    const isPathA = config.sourceGroupIds.includes(sourceGroup);
    const isPathB = sourceGroup === config.freeCommonGroupId;

    if (!isPathA && !isPathB) {
      stats.rejectedNotMonitored++;
      return;
    }
    trackReplayId(msgId);

    // Fingerprint generation
    const timeBucket = Math.floor(messageTimestampMs / (5 * 60 * 1000));
    const fingerprint = getMessageFingerprint(text, null, timeBucket);

    // Duplicate check (permanent)
    if (fingerprintSet.has(fingerprint)) {
      stats.duplicatesSkipped++;
      return;
    }

    // Duplicate check (pending - race prevention)
    if (pendingFingerprints.has(fingerprint)) {
      stats.duplicatesSkipped++;
      stats.racePrevented++;
      return;
    }

    // Optimistic lock
    pendingFingerprints.set(fingerprint, Date.now());

    // A4: Settling delay (existing logic preserved)
    if (needsSettlingDelay) {
      needsSettlingDelay = false;
      const settleDuration =
        RECONNECT.SETTLING_MIN +
        Math.floor(
          Math.random() * (RECONNECT.SETTLING_MAX - RECONNECT.SETTLING_MIN)
        );
      log.info(
        `⏳ Settling delay: ${(settleDuration / 1000).toFixed(1)}s (first message after connect)`
      );
      await new Promise((r) => setTimeout(r, settleDuration));
    }

    // =========================================================================
    // ✅ ENHANCEMENT #3: PROCESSING DELAY RANDOMIZATION (2-7 seconds)
    // =========================================================================
    const processingDelay =
      Math.floor(Math.random() * (PROCESSING_DELAY_MAX - PROCESSING_DELAY_MIN)) +
      PROCESSING_DELAY_MIN;

    log.info(`⏳ Processing delay: ${(processingDelay / 1000).toFixed(1)}s`);
    await new Promise((r) => setTimeout(r, processingDelay));

    // Circuit breaker gate
    if (circuitBreaker.isOpen) {
      log.warn("🔴 Circuit breaker OPEN — message dropped");
      pendingFingerprints.delete(fingerprint);
      return;
    }

    // Logging (reduced verbosity)
    log.info(
      `📥 MSG #${stats.totalMessagesSent} | ${isPathA ? "A" : "B"} | ${sourceGroup.substring(0, 15)}... | ${text.substring(0, 40)}...`
    );

    const ctx = buildRouterContext();

    // Process path
    let pathSucceeded = false;

    try {
      if (isPathA) {
        pathSucceeded = await processPathA(text, sourceGroup, fingerprint, ctx);
      } else {
        pathSucceeded = await processPathB(text, sourceGroup, fingerprint, ctx);
      }
    } catch (err) {
      log.error(`❌ Routing error: ${err.message}`);
      pathSucceeded = false;
    }

    // Decision point
    if (pathSucceeded) {
      pendingFingerprints.delete(fingerprint);
      fingerprintSet.add(fingerprint);
      markDirty();
    } else {
      pendingFingerprints.delete(fingerprint);
    }
  }

  // ---------------------------------------------------------------------------
  // BAILEYS CONNECTION
  // ---------------------------------------------------------------------------

  async function connectToWhatsApp() {
    try {
      const { state, saveCreds } = await useMultiFileAuthState(authDir);
      const { version } = await fetchLatestBaileysVersion();

      log.info(
        `🔌 Connecting... (attempt ${reconnectAttempts + 1}/${BAILEYS.MAX_RECONNECT_ATTEMPTS})`
      );

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
                msg.includes("failed to decrypt"))
            ) {
              return;
            }
            method.apply(this, inputArgs);
          },
        },
      });

      sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
        },
        logger: baileysLogger,
        printQRInTerminal: true,
        browser: ["Taxi Bot", "Chrome", "120.0"],
        markOnlineOnConnect: false,
        syncFullHistory: false,
        getMessage: async () => undefined,
        defaultQueryTimeoutMs: BAILEYS.QUERY_TIMEOUT_MS,
        connectTimeoutMs: BAILEYS.CONNECT_TIMEOUT_MS,
        keepAliveIntervalMs: BAILEYS.KEEP_ALIVE_MS,
      });

      sock.ev.on("creds.update", saveCreds);

      sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          log.info("📱 QR Code generated — scan with WhatsApp");
          const qrcodeTerminal = (await import("qrcode-terminal")).default;
          qrcodeTerminal.generate(qr, { small: true });
        }

        if (connection === "close") {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const isLoggedOut = statusCode === DisconnectReason.loggedOut;

          log.warn(
            `⚠️  Connection closed | statusCode=${statusCode} | loggedOut=${isLoggedOut}`
          );

          if (isLoggedOut) {
            log.error(
              "❌ LOGGED OUT — delete baileys_auth/ and restart to re-scan QR"
            );
            process.exit(1);
          }

          if (reconnectAttempts < BAILEYS.MAX_RECONNECT_ATTEMPTS) {
            const delay = Math.min(
              BAILEYS.BACKOFF_BASE_MS * Math.pow(2, reconnectAttempts),
              BAILEYS.BACKOFF_CAP_MS
            );
            reconnectAttempts++;
            stats.reconnectCount++;

            log.info(
              `⏳ Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${reconnectAttempts}/${BAILEYS.MAX_RECONNECT_ATTEMPTS})...`
            );
            await new Promise((r) => setTimeout(r, delay));

            lastReconnectTime = Date.now();
            needsSettlingDelay = true;

            connectToWhatsApp();
          } else {
            log.error(
              "❌ Max reconnect attempts reached — exiting for PM2 restart"
            );
            process.exit(1);
          }
        }

        if (connection === "open") {
          log.info("✅ WhatsApp connected");
          reconnectAttempts = 0;

          if (!botFullyOperational) {
            lastReconnectTime = Date.now();
            needsSettlingDelay = true;
            botFullyOperational = true;

            log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            log.info("🎉 BOT FULLY OPERATIONAL");
            log.info(`   📍 Source groups:  ${config.sourceGroupIds.length}`);
            log.info(
              `   🆓 Free common:   ${config.freeCommonGroupId.substring(0, 20)}...`
            );
            log.info(
              `   💎 Paid groups:   ${Array.isArray(config.paidCommonGroupId) ? config.paidCommonGroupId.length : 1}`
            );
            log.info(
              `   🏙️  City groups:   ${config.configuredCities.length} (${config.configuredCities.join(", ")})`
            );
            log.info(
              `   🚫 Blocked nums:  ${config.blockedPhoneNumbers.length}`
            );
            log.info(`   ⏰ Max msg age:   ${MAX_MESSAGE_AGE / 1000}s`);
            log.info(`   ⏱️  Process delay: ${PROCESSING_DELAY_MIN / 1000}-${PROCESSING_DELAY_MAX / 1000}s`);
            log.info(`   ⚡ Race prevention: ACTIVE`);
            log.info(`   📂 Fingerprint file: ${BOT_FINGERPRINT_FILENAME}`);
            log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
          }
        }
      });

      sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;

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
        log.info(
          `⏳ Retry in ${(delay / 1000).toFixed(1)}s (attempt ${reconnectAttempts}/${BAILEYS.MAX_RECONNECT_ATTEMPTS})`
        );
        await new Promise((r) => setTimeout(r, delay));
        connectToWhatsApp();
      } else {
        log.error("❌ Max attempts reached — exiting for PM2 restart");
        process.exit(1);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // STATS SERVER
  // ---------------------------------------------------------------------------

  function startStatsServer() {
    const statsPort = parseInt(process.env.STATS_PORT || STATS.DEFAULT_PORT, 10);
    const app = express();

    app.use((req, res, next) => {
      res.setTimeout(10000, () => {
        log.warn(`⏱️  Request timeout: ${req.path}`);
        res.status(408).json({ error: "Request timeout" });
      });
      next();
    });

    app.get("/ping", (_, res) => res.send("ALIVE"));

    // =========================================================================
    // ✅ ENHANCEMENT #4: /health ENDPOINT FOR MONITORING
    // =========================================================================
    app.get("/health", (_, res) => {
      const healthy =
        botFullyOperational &&
        !circuitBreaker.isOpen &&
        sock?.user;

      const failureRate =
        stats.sendSuccesses + stats.sendFailures > 0
          ? stats.sendFailures / (stats.sendSuccesses + stats.sendFailures)
          : 0;

      res.status(healthy ? 200 : 503).json({
        status: healthy ? "healthy" : "degraded",
        uptime: Date.now() - BOT_START_TIME,
        connected: botFullyOperational,
        circuitBreakerOpen: circuitBreaker.isOpen,
        reconnects: stats.reconnectCount,
        failures: stats.sendFailures,
        successes: stats.sendSuccesses,
        failureRate: failureRate.toFixed(3),
        lastReconnect: lastReconnectTime
          ? new Date(lastReconnectTime).toISOString()
          : null,
      });
    });

    app.get("/stats", (_, res) => {
      res.json({
        bot: {
          id: config.botId,
          phone: config.botPhone,
        },
        uptime:
          ((Date.now() - BOT_START_TIME) / 1000 / 60).toFixed(1) + " minutes",
        operational: botFullyOperational,
        stats,
        messageCount,
        cache: {
          fingerprintSet: fingerprintSet.size,
          pendingFingerprints: pendingFingerprints.size,
          replayIdSet: replayIdSet.size,
          dirty: fingerprintDirty,
          isSaving: isSaving,
          fingerprintFile: BOT_FINGERPRINT_FILENAME,
        },
        circuitBreaker: {
          isOpen: circuitBreaker.isOpen,
          failureCount: circuitBreaker.failureCount,
        },
        reconnect: {
          lastReconnectTime: lastReconnectTime
            ? new Date(lastReconnectTime).toISOString()
            : null,
          totalReconnects: stats.reconnectCount,
        },
        config: {
          sourceGroupCount: config.sourceGroupIds.length,
          paidGroupCount: Array.isArray(config.paidCommonGroupId)
            ? config.paidCommonGroupId.length
            : 1,
          cityGroups: config.configuredCities,
          blockedNumbers: config.blockedPhoneNumbers.length,
          hourlyLimit: RATE_LIMITS.HOURLY,
          dailyLimit: RATE_LIMITS.DAILY,
        },
        enhancements: {
          maxMessageAge: `${MAX_MESSAGE_AGE / 1000}s`,
          processingDelay: `${PROCESSING_DELAY_MIN / 1000}-${PROCESSING_DELAY_MAX / 1000}s`,
          stableFingerprintFile: true,
        },
      });
    });

    // Groups endpoint (existing, preserved)
    app.get("/groups", async (req, res) => {
      if (!sock || !botFullyOperational) {
        return res.status(503).json({
          error: "Bot not connected to WhatsApp",
          operational: botFullyOperational,
        });
      }

      try {
        log.info("📋 Fetching group list (non-blocking)...");

        const groupChats = await sock.groupFetchAllParticipating();
        const allGroupIds = Object.keys(groupChats);

        log.info(`📋 Found ${allGroupIds.length} groups`);

        const allGroups = [];
        const BATCH_SIZE = 20;
        const BATCH_DELAY = 100;

        for (let i = 0; i < allGroupIds.length; i += BATCH_SIZE) {
          const batch = allGroupIds.slice(i, i + BATCH_SIZE);

          const batchPromises = batch.map(async (groupId) => {
            try {
              let groupName = groupChats[groupId]?.subject || null;
              let participantsCount = groupChats[groupId]?.participants?.length || 0;
              let createdAt = groupChats[groupId]?.creation
                ? new Date(groupChats[groupId].creation * 1000).toISOString()
                : null;

              if (!groupName || groupName === "Unknown") {
                try {
                  const metadata = await Promise.race([
                    sock.groupMetadata(groupId),
                    new Promise((_, reject) =>
                      setTimeout(() => reject(new Error("Metadata timeout")), 2000)
                    ),
                  ]);
                  groupName = metadata.subject || "Unknown Group";
                  participantsCount = metadata.participants?.length || 0;
                  createdAt = metadata.creation
                    ? new Date(metadata.creation * 1000).toISOString()
                    : null;
                } catch (fetchErr) {
                  groupName = groupName || `Group ${groupId.substring(0, 8)}...`;
                }
              }

              return {
                id: groupId,
                name: groupName,
                participantsCount,
                createdAt,
              };
            } catch (err) {
              return null;
            }
          });

          const batchResults = await Promise.all(batchPromises);
          allGroups.push(...batchResults.filter(Boolean));

          if (i + BATCH_SIZE < allGroupIds.length) {
            await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY));
          }
        }

        log.info(`✅ Processed ${allGroups.length}/${allGroupIds.length} groups`);

        const sourceSet = new Set(config.sourceGroupIds);
        const paidSet = new Set(
          Array.isArray(config.paidCommonGroupId)
            ? config.paidCommonGroupId
            : [config.paidCommonGroupId]
        );
        const citySet = new Set(Object.values(config.cityTargetGroups || {}));
        const freeSet = new Set(
          config.freeCommonGroupId ? [config.freeCommonGroupId] : []
        );

        const categorized = allGroups.map((g) => {
          let type = "other";
          let category = "Unmonitored";

          if (sourceSet.has(g.id)) {
            type = "source";
            category = "Source Group";
          } else if (paidSet.has(g.id)) {
            type = "paid";
            category = "Paid Group";
          } else if (citySet.has(g.id)) {
            const cityName = Object.keys(config.cityTargetGroups).find(
              (city) => config.cityTargetGroups[city] === g.id
            );
            type = "city";
            category = `City Group${cityName ? `: ${cityName}` : ""}`;
          } else if (freeSet.has(g.id)) {
            type = "free_common";
            category = "Free Common Group";
          }

          return { ...g, type, category };
        });

        const sortOrder = {
          source: 1,
          free_common: 2,
          paid: 3,
          city: 4,
          other: 5,
        };

        categorized.sort((a, b) => {
          const orderA = sortOrder[a.type] || 99;
          const orderB = sortOrder[b.type] || 99;
          if (orderA !== orderB) return orderA - orderB;
          return (a.name || "").localeCompare(b.name || "");
        });

        res.json({
          success: true,
          bot: config.botId,
          connectedAs: sock.user?.id || "Unknown",
          totalGroups: categorized.length,
          breakdown: {
            source: categorized.filter((g) => g.type === "source").length,
            freeCommon: categorized.filter((g) => g.type === "free_common").length,
            paid: categorized.filter((g) => g.type === "paid").length,
            city: categorized.filter((g) => g.type === "city").length,
            unmonitored: categorized.filter((g) => g.type === "other").length,
          },
          groups: categorized,
        });
      } catch (err) {
        log.error(`❌ /groups error: ${err.message}`);
        res.status(500).json({
          success: false,
          error: err.message,
        });
      }
    });

    app.listen(statsPort, "0.0.0.0", () => {
      log.info(`📊 Stats server: http://0.0.0.0:${statsPort}/stats`);
      log.info(`💚 Health check: http://0.0.0.0:${statsPort}/health`);
      log.info(`👥 Groups API: http://0.0.0.0:${statsPort}/groups`);
    });
  }

  // ---------------------------------------------------------------------------
  // CLEANUP INTERVALS
  // ---------------------------------------------------------------------------

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

    await saveFingerprints();

    if (saveDebounceTimer) {
      clearTimeout(saveDebounceTimer);
      saveDebounceTimer = null;
    }

    if (circuitBreaker.resetTimeout) {
      clearTimeout(circuitBreaker.resetTimeout);
    }

    if (sock) {
      try {
        sock.ev.removeAllListeners();
        sock.ws.close();
        log.info("✅ Socket closed");
      } catch (err) {
        log.warn(`⚠️  Socket close error: ${err.message}`);
      }
    }

    log.info("📊 Final stats:");
    log.info(`   Messages:    ${stats.totalMessagesSent}`);
    log.info(`   Path A:      ${stats.pathAProcessed}`);
    log.info(`   Path B:      ${stats.pathBProcessed}`);
    log.info(`   Duplicates:  ${stats.duplicatesSkipped}`);
    log.info(`   Too old:     ${stats.rejectedTooOld}`);
    log.info(`   Races:       ${stats.racePrevented} (prevented)`);
    log.info(`   Replays:     ${stats.replayIdsSkipped}`);
    log.info(`   Reconnects:  ${stats.reconnectCount}`);
    log.info(`   Sends OK:    ${stats.sendSuccesses}`);
    log.info(`   Sends FAIL:  ${stats.sendFailures}`);

    process.exit(0);
  }

  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGHUP", () => {
    log.info("🔄 SIGHUP (PM2 reload) — cleaning up timers");
    if (saveDebounceTimer) {
      clearTimeout(saveDebounceTimer);
      saveDebounceTimer = null;
    }
    if (circuitBreaker.resetTimeout) {
      clearTimeout(circuitBreaker.resetTimeout);
    }
  });

  // ---------------------------------------------------------------------------
  // BOOT SEQUENCE
  // ---------------------------------------------------------------------------

  log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  log.info("🚀 TAXI BOT STARTING (ENHANCED)");
  log.info("   ✅ Message age validation (5min max)");
  log.info("   ✅ Stable fingerprint filename");
  log.info("   ✅ Processing delay randomization");
  log.info("   ✅ /health endpoint added");
  log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  loadFingerprints();
  startStatsServer();
  await connectToWhatsApp();
}