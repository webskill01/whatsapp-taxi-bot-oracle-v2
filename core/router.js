/**
 * ============================================================================
 * router.js — Path A / Path B Routing
 * ============================================================================
 * ROUTING (Bot-1):
 *   Path A: source group → paidCommonGroupId[] + cityTargetGroup + freeCommonGroupId
 *   Path B: freeCommonGroupId → paidCommonGroupId[] + cityTargetGroup (NOT free)
 *
 * STABILITY:
 *   ✅ Module-level state (circuit breaker, rate limiter, cooldowns)
 *   ✅ Sliding-window rate limiter (accurate, no reset skew)
 *   ✅ Circuit breaker (opens at 10 failures, resets after 60s)
 *   ✅ inFlightSends.delete on ALL failure paths (fixes stuck cooldown)
 *   ✅ Returns { wasRouted: boolean, path: "A"|"B"|"none" }
 *
 * ANTI-BAN:
 *   ✅ A1: Length-scaled typing delay (1.0-1.8s, before first send only)
 *   ✅ A3: Fisher-Yates shuffle (target randomization)
 *   ✅ A5: Weighted between-group gaps (0.8-1.5s, 65% low-end bias)
 *   ✅ Per-group send cooldown (1s)
 *   ✅ 15s send timeout with single retry
 *
 * LOGGING:
 *   ✅ Every gate logs its decision (pass or reject)
 *   ✅ Improved no-phone log: shows potential number patterns found
 * ============================================================================
 */

import {
  isTaxiRequest,
  extractPickupCity,
  hasPhoneNumber,
  containsBlockedNumber,
} from "./filter.js";

import { GLOBAL_CONFIG } from "./globalConfig.js";

// =============================================================================
// MODULE-LEVEL STATE (one per process, shared across reconnects)
// =============================================================================

// Sliding-window rate limiter
const rateLimitTimestamps = { hourly: [], daily: [] };

// Per-group send cooldown
const inFlightSends = new Map();

// Circuit breaker
const circuitBreaker = {
  failureCount: 0,
  isOpen:       false,
  resetTimeout: null,
};

// =============================================================================
// RATE LIMITING (sliding window — no top-of-hour reset skew)
// =============================================================================

function isRateLimited(log) {
  const now = Date.now();

  rateLimitTimestamps.hourly = rateLimitTimestamps.hourly.filter((t) => now - t < 3_600_000);
  rateLimitTimestamps.daily  = rateLimitTimestamps.daily.filter( (t) => now - t < 86_400_000);

  if (rateLimitTimestamps.hourly.length >= GLOBAL_CONFIG.rateLimits.hourly) {
    log.warn(`⚠️  Rate limit (hourly): ${rateLimitTimestamps.hourly.length}/${GLOBAL_CONFIG.rateLimits.hourly}`);
    return true;
  }
  if (rateLimitTimestamps.daily.length >= GLOBAL_CONFIG.rateLimits.daily) {
    log.warn(`⚠️  Rate limit (daily): ${rateLimitTimestamps.daily.length}/${GLOBAL_CONFIG.rateLimits.daily}`);
    return true;
  }

  rateLimitTimestamps.hourly.push(now);
  rateLimitTimestamps.daily.push(now);
  return false;
}

// =============================================================================
// CIRCUIT BREAKER
// =============================================================================

function handleSendSuccess() {
  if (circuitBreaker.failureCount > 0) {
    circuitBreaker.failureCount = Math.max(0, circuitBreaker.failureCount - 1);
  }
}

function handleSendFailure(log) {
  circuitBreaker.failureCount++;
  if (
    circuitBreaker.failureCount >= GLOBAL_CONFIG.circuitBreaker.maxFailures &&
    !circuitBreaker.isOpen
  ) {
    circuitBreaker.isOpen = true;
    log.error(`🔴 CIRCUIT BREAKER OPEN — pausing ${GLOBAL_CONFIG.circuitBreaker.breakDuration / 1000}s`);
    circuitBreaker.resetTimeout = setTimeout(() => {
      circuitBreaker.isOpen       = false;
      circuitBreaker.failureCount = 0;
      log.info("🟢 CIRCUIT BREAKER RESET");
    }, GLOBAL_CONFIG.circuitBreaker.breakDuration);
  }
}

// =============================================================================
// DELAY UTILITIES
// =============================================================================

/** Uniform random in [min, max] */
function getRandomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** A5: Biased toward lower end (65% in lower band) */
function getWeightedDelay(min, max, weight) {
  const range = max - min;
  if (Math.random() < weight) {
    return Math.floor(min + Math.random() * (range * weight));
  }
  return Math.floor(min + range * weight + Math.random() * (range * (1 - weight)));
}

/** A1: Typing delay scaled by text length, clamped to [typingMin, typingMax] */
function getTypingDelay(textLength) {
  const raw = textLength * GLOBAL_CONFIG.humanBehavior.typingBasePerChar;
  return Math.min(
    Math.max(raw, GLOBAL_CONFIG.humanBehavior.typingMin),
    GLOBAL_CONFIG.humanBehavior.typingMax
  );
}

/** A3: Fisher-Yates shuffle — returns a NEW array, does not mutate */
function shuffleArray(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// =============================================================================
// SEQUENTIAL SEND LOOP
// =============================================================================

async function sendToMultipleGroupsSequential(sock, targets, text, label, stats, log) {
  if (circuitBreaker.isOpen) {
    log.warn("🔴 Circuit breaker OPEN — aborting send");
    return { successCount: 0, totalTargets: targets.length };
  }

  const now          = Date.now();
  const readyTargets = targets.filter((id) => {
    const lastSend = inFlightSends.get(id);
    return !lastSend || now - lastSend >= GLOBAL_CONFIG.deduplication.sendCooldown;
  });

  if (readyTargets.length === 0) {
    log.warn(`⏭️  [${label}] All targets in cooldown`);
    return { successCount: 0, totalTargets: 0 };
  }

  log.info(`📤 [${label}] Sending to ${readyTargets.length} target(s)...`);

  let successCount   = 0;
  const startTime    = Date.now();

  for (let i = 0; i < readyTargets.length; i++) {
    if (circuitBreaker.isOpen) {
      log.warn("🔴 Circuit breaker opened mid-send — stopping");
      break;
    }

    const groupId = readyTargets[i];
    const shortId = groupId.substring(0, 18);

    // A1: Typing delay before first message only
    if (i === 0) {
      const typingDelay = getTypingDelay(text.length);
      log.info(`⌨️  Typing: ${(typingDelay / 1000).toFixed(1)}s`);
      await new Promise((r) => setTimeout(r, typingDelay));
    }

    // A5: Between-group gap for messages 2+
    if (i > 0) {
      if (Math.random() < GLOBAL_CONFIG.humanBehavior.randomPauseChance) {
        const pause = getRandomDelay(
          GLOBAL_CONFIG.humanBehavior.randomPauseMin,
          GLOBAL_CONFIG.humanBehavior.randomPauseMax
        );
        log.info(`☕ Random pause: ${(pause / 1000).toFixed(1)}s`);
        await new Promise((r) => setTimeout(r, pause));
      } else {
        const gap = getWeightedDelay(
          GLOBAL_CONFIG.humanBehavior.betweenMin,
          GLOBAL_CONFIG.humanBehavior.betweenMax,
          GLOBAL_CONFIG.humanBehavior.betweenWeight
        );
        log.info(`⏳ Gap: ${(gap / 1000).toFixed(1)}s`);
        await new Promise((r) => setTimeout(r, gap));
      }
    }

    inFlightSends.set(groupId, Date.now());
    const sendStart = Date.now();

    try {
      await Promise.race([
        sock.sendMessage(groupId, { text }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timeout 15s")), 15_000)
        ),
      ]);

      log.info(`✅ → ${shortId}... (${((Date.now() - sendStart) / 1000).toFixed(2)}s)`);
      handleSendSuccess();
      stats.sendSuccesses++;
      successCount++;

    } catch (error) {
      if (error.message.includes("Timeout")) {
        // Single retry on timeout
        try {
          await new Promise((r) => setTimeout(r, 1_000));
          await sock.sendMessage(groupId, { text });
          log.info(`✅ → ${shortId}... (retry OK)`);
          handleSendSuccess();
          stats.sendSuccesses++;
          successCount++;
        } catch (retryErr) {
          log.error(`❌ → ${shortId}... FAILED (retry) ${retryErr.message}`);
          handleSendFailure(log);
          stats.sendFailures++;
          inFlightSends.delete(groupId); // clear stuck cooldown on retry fail
        }
      } else {
        log.error(`❌ → ${shortId}... ${error.message}`);
        handleSendFailure(log);
        stats.sendFailures++;
        inFlightSends.delete(groupId); // clear stuck cooldown on direct fail
      }
    }
  }

  log.info(`⏱️  [${label}] Delivery: ${((Date.now() - startTime) / 1000).toFixed(1)}s | ${successCount}/${readyTargets.length} OK`);
  return { successCount, totalTargets: readyTargets.length };
}

// =============================================================================
// PATH A — Source group → Paid[] + City + Free
// =============================================================================

async function processPathA(sock, text, sourceGroup, config, stats, log) {
  // Gate 1: Blocked number
  if (containsBlockedNumber(text, config.blockedPhoneNumbers)) {
    log.warn(`🚫 BLOCKED NUMBER (Path A)`);
    stats.rejectedBlockedNumber++;
    return { wasRouted: false };
  }

  // Gate 2: Taxi request filter
  if (!isTaxiRequest(text, config.requestKeywords, config.ignoreIfContains, config.blockedPhoneNumbers)) {
    log.info(`❌ NOT TAXI REQUEST (Path A) | ${text.substring(0, 40)}...`);
    stats.rejectedNotTaxi++;
    return { wasRouted: false };
  }

  // Gate 3: Phone number required — improved debug log shows what was found
  if (!hasPhoneNumber(text)) {
    const phonePattern    = /(\+?\d[\d\s\-().]{6,}\d)/g;
    const potentialPhones = text.match(phonePattern);
    if (potentialPhones) {
      log.warn(`📵 NO VALID PHONE (Path A) — found: [${potentialPhones.join(", ")}] | ${text.substring(0, 40)}...`);
    } else {
      log.warn(`📵 NO PHONE (Path A) | ${text.substring(0, 40)}...`);
    }
    stats.rejectedNoPhone++;
    return { wasRouted: false };
  }

  // Gate 4: Rate limit
  if (isRateLimited(log)) {
    stats.rejectedRateLimit = (stats.rejectedRateLimit || 0) + 1;
    return { wasRouted: false };
  }

  // City extraction
  const detectedCity = extractPickupCity(text, config.configuredCities);
  const cityGroupId  = detectedCity ? config.cityTargetGroups[detectedCity] : null;

  log.info(`✅ PATH A PASS | City: ${detectedCity || "none"} | Source: ${sourceGroup.substring(0, 18)}...`);

  // Build targets: paid[] + city (if found) + free
  const targets  = [
    ...config.paidCommonGroupId,
    ...(cityGroupId ? [cityGroupId] : []),
    config.freeCommonGroupId,
  ];
  const shuffled = shuffleArray([...new Set(targets)]);

  const { successCount } = await sendToMultipleGroupsSequential(
    sock, shuffled, text, `PathA-${detectedCity || "noCity"}`, stats, log
  );

  log.info(`✅ PATH A DONE: ${successCount}/${shuffled.length} | City: ${detectedCity || "none"} | ${rateLimitTimestamps.hourly.length}/${GLOBAL_CONFIG.rateLimits.hourly}h`);
  return { wasRouted: successCount > 0 };
}

// =============================================================================
// PATH B — Free common group → Paid[] + City (NOT free — it's the source)
// =============================================================================

async function processPathB(sock, text, config, stats, log) {
  // Gate 1: Blocked number
  if (containsBlockedNumber(text, config.blockedPhoneNumbers)) {
    log.warn(`🚫 BLOCKED NUMBER (Path B)`);
    stats.rejectedBlockedNumber++;
    return { wasRouted: false };
  }

  // Gate 2: Taxi request filter
  if (!isTaxiRequest(text, config.requestKeywords, config.ignoreIfContains, config.blockedPhoneNumbers)) {
    log.info(`❌ NOT TAXI REQUEST (Path B) | ${text.substring(0, 40)}...`);
    stats.rejectedNotTaxi++;
    return { wasRouted: false };
  }

  // Gate 3: Phone number required — improved debug log
  if (!hasPhoneNumber(text)) {
    const phonePattern    = /(\+?\d[\d\s\-().]{6,}\d)/g;
    const potentialPhones = text.match(phonePattern);
    if (potentialPhones) {
      log.warn(`📵 NO VALID PHONE (Path B) — found: [${potentialPhones.join(", ")}] | ${text.substring(0, 40)}...`);
    } else {
      log.warn(`📵 NO PHONE (Path B) | ${text.substring(0, 40)}...`);
    }
    stats.rejectedNoPhone++;
    return { wasRouted: false };
  }

  // Gate 4: Rate limit
  if (isRateLimited(log)) {
    stats.rejectedRateLimit = (stats.rejectedRateLimit || 0) + 1;
    return { wasRouted: false };
  }

  // City extraction
  const detectedCity = extractPickupCity(text, config.configuredCities);
  const cityGroupId  = detectedCity ? config.cityTargetGroups[detectedCity] : null;

  log.info(`✅ PATH B PASS | City: ${detectedCity || "none"}`);

  // Build targets: paid[] + city — free is source, do NOT echo back
  const targets  = [
    ...config.paidCommonGroupId,
    ...(cityGroupId ? [cityGroupId] : []),
  ];
  const shuffled = shuffleArray([...new Set(targets)]);

  const { successCount } = await sendToMultipleGroupsSequential(
    sock, shuffled, text, `PathB-${detectedCity || "noCity"}`, stats, log
  );

  log.info(`✅ PATH B DONE: ${successCount}/${shuffled.length} | City: ${detectedCity || "none"} | ${rateLimitTimestamps.hourly.length}/${GLOBAL_CONFIG.rateLimits.hourly}h`);
  return { wasRouted: successCount > 0 };
}

// =============================================================================
// MAIN EXPORT
//
// Receives pre-extracted text and path from index.js (not the raw message
// object) — eliminates double-parse silent-fail bug.
//
// Signature: processMessage(sock, text, sourceGroup, isPathA, config, stats, log)
// Returns:   { wasRouted: boolean, path: "A"|"B"|"none" }
// =============================================================================

export async function processMessage(sock, text, sourceGroup, isPathA, config, stats, log) {
  try {
    if (!text || text.trim() === "") {
      log.warn(`⚠️  processMessage called with empty text — skipping`);
      return { wasRouted: false, path: "none" };
    }

    log.info(`🔀 Router: Path ${isPathA ? "A" : "B"} | ${sourceGroup.substring(0, 18)}...`);

    if (isPathA) {
      const result = await processPathA(sock, text, sourceGroup, config, stats, log);
      return { ...result, path: "A" };
    }

    // Path B — freeCommonGroup
    const result = await processPathB(sock, text, config, stats, log);
    return { ...result, path: "B" };

  } catch (error) {
    log.error(`❌ Router error: ${error.message}`);
    return { wasRouted: false, path: "none" };
  }
}

// =============================================================================
// CLEANUP — purge stale cooldown entries every 30s
// =============================================================================
setInterval(() => {
  const now = Date.now();
  for (const [groupId, timestamp] of inFlightSends.entries()) {
    if (now - timestamp > 30_000) inFlightSends.delete(groupId);
  }
}, 30_000);