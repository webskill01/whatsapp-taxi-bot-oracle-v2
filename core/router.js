// =============================================================================
// router.js — Path A, Path B routing logic + sequential send loop.
// This file owns: target building, target shuffling (A3), send sequencing,
// human-like delays (A1, A5), circuit breaker checks during send, stats tracking.
//
// NOTHING HERE changes what a "valid ride" is. That decision is made in filter.js
// before this file is ever called.
//
// FINGERPRINT FIX:
// ✅ Returns true/false to indicate if message was successfully processed
// ✅ Fingerprint only saved if return value is true
// =============================================================================

import {
  isTaxiRequest,
  extractFirstCity,
  hasPhoneNumber,
  containsBlockedNumber,
} from './filter.js';

import {
  HUMAN_DELAYS,
  RATE_LIMITS,
  CACHE,
  CIRCUIT_BREAKER,
  SEND_COOLDOWN_MS,
} from './globalDefaults.js';

// -----------------------------------------------------------------------------
// UTILITY: Random delay generators
// -----------------------------------------------------------------------------

/**
 * Generates a random integer in [min, max] inclusive.
 */
function getRandomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * A5 LOCKED: Weighted random biased toward the lower end of the range.
 * Uses the BETWEEN_WEIGHT factor from globalDefaults.
 * 65% of outputs land in [min, min + weight*(max-min)].
 * 35% land in the upper band up to max.
 * This mimics natural human pause distribution (short pauses are common,
 * long pauses are occasional).
 */
function getWeightedDelay(min, max, weight) {
  const range = max - min;
  if (Math.random() < weight) {
    // Lower band (more common)
    return Math.floor(min + Math.random() * (range * weight));
  }
  // Upper band (less common)
  return Math.floor(min + (range * weight) + Math.random() * (range * (1 - weight)));
}

/**
 * A1 LOCKED: Typing delay scaled by message length.
 * Clamps output to [TYPING_MIN, TYPING_MAX] (1.0s – 1.8s).
 * Short messages (~30 chars) → ~1.0s
 * Long messages (~200+ chars) → ~1.8s
 */
function getTypingDelay(textLength) {
  const raw = textLength * HUMAN_DELAYS.TYPING_BASE_PER_CHAR;
  return Math.min(Math.max(raw, HUMAN_DELAYS.TYPING_MIN), HUMAN_DELAYS.TYPING_MAX);
}

/**
 * A3 LOCKED: Fisher-Yates shuffle. Randomizes target order in-place.
 * Called after target array is built, before sending.
 */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// -----------------------------------------------------------------------------
// ROUTER STATE — passed in from index.js, not owned here
// -----------------------------------------------------------------------------
// The router receives a "context" object on each call that contains:
//   ctx.sock              — Baileys socket (for sendMessage)
//   ctx.stats             — stats object (mutated in place)
//   ctx.messageCount      — { hourly, daily } (mutated)
//   ctx.circuitBreaker    — { isOpen, failureCount, ... } (mutated)
//   ctx.inFlightSends     — Map<groupId, timestamp> (mutated)
//   ctx.log               — bot logger
//   ctx.config            — merged config from configLoader
//   ctx.fingerprintSet    — the global dedup Set (read-only here; index.js adds)
//   ctx.markDirty         — (owned by index.js; not called here)

// -----------------------------------------------------------------------------
// CIRCUIT BREAKER HELPERS
// -----------------------------------------------------------------------------

function handleSendFailure(ctx) {
  ctx.circuitBreaker.failureCount++;
  ctx.circuitBreaker.lastFailureTime = Date.now();

  if (ctx.circuitBreaker.failureCount >= CIRCUIT_BREAKER.MAX_FAILURES) {
    if (!ctx.circuitBreaker.isOpen) {
      ctx.circuitBreaker.isOpen = true;
      ctx.log.error(`🔴 CIRCUIT BREAKER OPEN — pausing ${CIRCUIT_BREAKER.RESET_DURATION / 1000}s`);

      ctx.circuitBreaker.resetTimeout = setTimeout(() => {
        ctx.circuitBreaker.isOpen = false;
        ctx.circuitBreaker.failureCount = 0;
        ctx.log.info('🟢 CIRCUIT BREAKER RESET');
      }, CIRCUIT_BREAKER.RESET_DURATION);
    }
  }
}

function handleSendSuccess(ctx) {
  if (ctx.circuitBreaker.failureCount > 0) {
    ctx.circuitBreaker.failureCount = Math.max(0, ctx.circuitBreaker.failureCount - 1);
  }
}

// -----------------------------------------------------------------------------
// C1: FINGERPRINT BATCH CLEANUP — shared helper, called by both paths
// -----------------------------------------------------------------------------
// index.js owns the ADD. This function owns only the overflow trim.
// When the set exceeds MAX_FINGERPRINTS we delete down to 80% in one pass
// (not one-by-one per message) so the cost is amortised across many messages.

function cleanupFingerprintSetIfNeeded(ctx) {
  if (ctx.fingerprintSet.size > CACHE.MAX_FINGERPRINTS) {
    const targetSize = Math.floor(CACHE.MAX_FINGERPRINTS * CACHE.CLEANUP_TARGET_RATIO);
    const toDelete   = ctx.fingerprintSet.size - targetSize;
    const iterator   = ctx.fingerprintSet.values();
    for (let i = 0; i < toDelete; i++) {
      const val = iterator.next().value;
      if (val) ctx.fingerprintSet.delete(val);
    }
    ctx.log.info(`🧹 Fingerprint cleanup: deleted ${toDelete}, remaining ${ctx.fingerprintSet.size}`);
  }
}

// -----------------------------------------------------------------------------
// RATE LIMIT CHECK (preserved logic from original)
// -----------------------------------------------------------------------------

function checkRateLimit(ctx) {
  const now = Date.now();

  if (now - ctx.messageCount.lastHourReset > 3600000) {
    ctx.log.info(`♻️  Hourly reset: ${ctx.messageCount.hourly} msgs sent`);
    ctx.messageCount.hourly = 0;
    ctx.messageCount.lastHourReset = now;
  }

  if (now - ctx.messageCount.lastDayReset > 86400000) {
    ctx.log.info(`♻️  Daily reset: ${ctx.messageCount.daily} msgs sent`);
    ctx.messageCount.daily = 0;
    ctx.messageCount.lastDayReset = now;
  }

  const allowed = ctx.messageCount.hourly < RATE_LIMITS.HOURLY &&
                  ctx.messageCount.daily  < RATE_LIMITS.DAILY;

  if (!allowed) {
    ctx.log.warn(`🚫 Rate limit: ${ctx.messageCount.hourly}/${RATE_LIMITS.HOURLY}h, ${ctx.messageCount.daily}/${RATE_LIMITS.DAILY}d`);
  }

  return allowed;
}

// -----------------------------------------------------------------------------
// SEND LOOP — sequential delivery with human-like delays
// Preserved structure from original sendToMultipleGroupsSequential.
// The only changes are the delay values (A1, A5) and that sock.sendMessage
// is called directly instead of through WAHAClient HTTP.
// -----------------------------------------------------------------------------

/**
 * Sends text to multiple target groups sequentially.
 * Respects circuit breaker, per-group cooldowns, and human-like delay pacing.
 *
 * @param {string[]} targets  - deduplicated target group IDs (already shuffled)
 * @param {string}   text     - message body
 * @param {object}   ctx      - router context
 * @returns {{ successCount: number, totalTargets: number }}
 */
async function sendToMultipleGroupsSequential(targets, text, ctx) {
  if (ctx.circuitBreaker.isOpen) {
    ctx.log.warn('🔴 Circuit breaker OPEN — aborting send');
    return { successCount: 0, totalTargets: targets.length };
  }

  // Filter out groups still in cooldown
  const readyTargets = targets.filter(groupId => {
    const lastSend = ctx.inFlightSends.get(groupId);
    return !lastSend || (Date.now() - lastSend) >= SEND_COOLDOWN_MS;
  });

  if (readyTargets.length === 0) {
    ctx.log.warn('⚠️  All targets in cooldown');
    return { successCount: 0, totalTargets: 0 };
  }

  ctx.log.info(`📤 Sending SEQUENTIALLY to ${readyTargets.length} target(s)...`);

  let successCount = 0;
  const pathStartTime = Date.now();

  for (let i = 0; i < readyTargets.length; i++) {
    // Mid-loop circuit breaker check (preserved from original)
    if (ctx.circuitBreaker.isOpen) {
      ctx.log.warn('🔴 Circuit breaker opened mid-send — stopping');
      break;
    }

    const targetGroup = readyTargets[i];
    const shortId = targetGroup.substring(0, 18);

    // A1: Typing delay before the FIRST message only (length-scaled)
    if (i === 0) {
      const typingDelay = getTypingDelay(text.length);
      ctx.log.info(`⌨️  Typing: ${(typingDelay / 1000).toFixed(1)}s`);
      await new Promise(r => setTimeout(r, typingDelay));
    }

    // A5: Between-group delay before messages 2, 3, 4...
    if (i > 0) {
      // 15% chance of a random pause instead of the normal weighted delay
      if (Math.random() < HUMAN_DELAYS.RANDOM_PAUSE_CHANCE) {
        const pauseDuration = getRandomDelay(HUMAN_DELAYS.RANDOM_PAUSE_MIN, HUMAN_DELAYS.RANDOM_PAUSE_MAX);
        ctx.log.info(`☕ Random pause: ${(pauseDuration / 1000).toFixed(1)}s`);
        ctx.stats.humanPausesTriggered++;
        await new Promise(r => setTimeout(r, pauseDuration));
      } else {
        const gap = getWeightedDelay(HUMAN_DELAYS.BETWEEN_MIN, HUMAN_DELAYS.BETWEEN_MAX, HUMAN_DELAYS.BETWEEN_WEIGHT);
        ctx.log.info(`⏳ Gap: ${(gap / 1000).toFixed(1)}s`);
        await new Promise(r => setTimeout(r, gap));
      }
    }

    // Mark cooldown timestamp for this group
    ctx.inFlightSends.set(targetGroup, Date.now());
    const sendStartTime = Date.now();

    try {
      // Direct Baileys send with 15s timeout (preserved timeout logic from original)
      const sendPromise = ctx.sock.sendMessage(targetGroup, { text });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout 15s')), 15000)
      );

      await Promise.race([sendPromise, timeoutPromise]);

      const sendTime = ((Date.now() - sendStartTime) / 1000).toFixed(2);
      ctx.log.info(`✅ → ${shortId}... (${sendTime}s)`);

      handleSendSuccess(ctx);
      ctx.stats.sendSuccesses++;
      successCount++;

    } catch (error) {
      const sendTime = ((Date.now() - sendStartTime) / 1000).toFixed(2);

      // Single retry on timeout (preserved from original)
      if (error.message.includes('Timeout') && sendTime < 16) {
        try {
          await new Promise(r => setTimeout(r, 1000));
          await ctx.sock.sendMessage(targetGroup, { text });
          ctx.log.info(`✅ → ${shortId}... (retry OK)`);
          handleSendSuccess(ctx);
          ctx.stats.sendSuccesses++;
          successCount++;
        } catch (retryError) {
          ctx.log.error(`❌ → ${shortId}... FAILED (retry)`);
          handleSendFailure(ctx);
          ctx.stats.sendFailures++;
        }
      } else {
        ctx.log.error(`❌ → ${shortId}... ${error.message}`);
        handleSendFailure(ctx);
        ctx.stats.sendFailures++;
      }

      // Clean cooldown on failure so it can be retried next time
      ctx.inFlightSends.delete(targetGroup);
    }
  }

  const totalTime = ((Date.now() - pathStartTime) / 1000).toFixed(1);
  ctx.log.info(`⏱️  Delivery time: ${totalTime}s`);

  return { successCount, totalTargets: readyTargets.length };
}

// -----------------------------------------------------------------------------
// PATH A — Source Groups → Paid + City + Free
// ✅ NOW RETURNS: true if succeeded (sent messages), false if rejected
// -----------------------------------------------------------------------------
// Target build order: paid → city → free (locked change)
// Then shuffled (A3) before sending.
// Filter gate order preserved: blocked → taxi → phone → rateLimit

export async function processPathA(text, sourceGroup, fingerprint, ctx) {
  ctx.log.info('🔵 PATH A: Source → Paid + City + Free');
  ctx.log.info(`🔵 Source: ${sourceGroup.substring(0, 18)}...`);

  // Gate 1: Blocked number
  if (containsBlockedNumber(text, ctx.config.blockedPhoneNumbers)) {
    ctx.stats.rejectedBlockedNumber++;
    ctx.log.info('🚫 BLOCKED NUMBER — rejected');
    return false;
  }

  // Gate 2: Is taxi request?
  if (!isTaxiRequest(text, ctx.config.requestKeywords, ctx.config.ignoreIfContains, [])) {
    ctx.stats.rejectedNotTaxi++;
    ctx.log.info('⛔ NOT TAXI — rejected');
    return false;
  }

  // Gate 3: Has phone number?
  if (!hasPhoneNumber(text)) {
    ctx.stats.rejectedNoPhone++;
    ctx.log.info('📵 NO PHONE — rejected');
    return false;
  }

  // Gate 4: Rate limit
  if (!checkRateLimit(ctx)) {
    ctx.stats.rejectedRateLimit++;
    return false;
  }

  // ── Build target list: paid → city → free ──
  const targets = [];

  // 1. Paid groups first
  if (Array.isArray(ctx.config.paidCommonGroupId)) {
    targets.push(...ctx.config.paidCommonGroupId);
  } else {
    targets.push(ctx.config.paidCommonGroupId);
  }

  // 2. City group second
  const firstCity = extractFirstCity(text, ctx.config.configuredCities);
  if (firstCity) {
    ctx.log.info(`🎯 City detected: ${firstCity}`);
    const cityGroupId = ctx.config.cityTargetGroups[firstCity];
    if (cityGroupId && cityGroupId.trim() !== '') {
      targets.push(cityGroupId);
      ctx.log.info(`   ✅ City group: ${cityGroupId.substring(0, 18)}...`);
    } else {
      ctx.log.warn(`   ⚠️  No group configured for ${firstCity}`);
    }
  } else {
    ctx.log.info('⚪ No city detected');
  }

  // 3. Free common group last
  targets.push(ctx.config.freeCommonGroupId);

  // Deduplicate + A3 shuffle
  const uniqueTargets = shuffleArray([...new Set(targets)]);

  ctx.log.info(`🎯 PATH A targets: ${uniqueTargets.length} (paid=${Array.isArray(ctx.config.paidCommonGroupId) ? ctx.config.paidCommonGroupId.length : 1}, city=${firstCity || 'none'}, free=1)`);

  // NOTE: fingerprint add + markDirty is done by index.js AFTER this function
  // returns true. Do NOT duplicate it here.

  // Send
  const { successCount, totalTargets } = await sendToMultipleGroupsSequential(uniqueTargets, text, ctx);

  if (successCount > 0) {
    ctx.messageCount.hourly++;
    ctx.messageCount.daily++;
    ctx.stats.pathAProcessed++;
    ctx.stats.totalMessagesSent += successCount;
  }

  ctx.log.info(`✅ PATH A DONE: ${successCount}/${totalTargets} delivered | City: ${firstCity || 'none'} | ${ctx.messageCount.hourly}/${RATE_LIMITS.HOURLY}h`);

  // C1: Batch cleanup if fingerprint set exceeds cap
  cleanupFingerprintSetIfNeeded(ctx);

  return successCount > 0;
}

// -----------------------------------------------------------------------------
// PATH B — Free Common → Paid + City
// ✅ NOW RETURNS: true if succeeded (sent messages), false if rejected
// -----------------------------------------------------------------------------
// Target build order: paid → city (free is the SOURCE, not a target here)
// Then shuffled (A3) before sending.
// Filter gate order preserved: blocked → taxi → phone → rateLimit

export async function processPathB(text, sourceGroup, fingerprint, ctx) {
  ctx.log.info('🟢 PATH B: Free Common → Paid + City');
  ctx.log.info(`🟢 Source: ${sourceGroup.substring(0, 18)}...`);

  // Gate 1: Blocked number
  if (containsBlockedNumber(text, ctx.config.blockedPhoneNumbers)) {
    ctx.stats.rejectedBlockedNumber++;
    ctx.log.info('🚫 BLOCKED NUMBER — rejected');
    return false;
  }

  // Gate 2: Is taxi request?
  if (!isTaxiRequest(text, ctx.config.requestKeywords, ctx.config.ignoreIfContains, [])) {
    ctx.stats.rejectedNotTaxi++;
    ctx.log.info('⛔ NOT TAXI — rejected');
    return false;
  }

  // Gate 3: Has phone number?
  if (!hasPhoneNumber(text)) {
    ctx.stats.rejectedNoPhone++;
    ctx.log.info('📵 NO PHONE — rejected');
    return false;
  }

  // Gate 4: Rate limit
  if (!checkRateLimit(ctx)) {
    ctx.stats.rejectedRateLimit++;
    return false;
  }

  // ── Build target list: paid → city ──
  const targets = [];

  // 1. Paid groups first
  if (Array.isArray(ctx.config.paidCommonGroupId)) {
    targets.push(...ctx.config.paidCommonGroupId);
  } else {
    targets.push(ctx.config.paidCommonGroupId);
  }

  // 2. City group second
  const firstCity = extractFirstCity(text, ctx.config.configuredCities);
  if (firstCity) {
    ctx.log.info(`🎯 City detected: ${firstCity}`);
    const cityGroupId = ctx.config.cityTargetGroups[firstCity];
    if (cityGroupId && cityGroupId.trim() !== '') {
      targets.push(cityGroupId);
      ctx.log.info(`   ✅ City group: ${cityGroupId.substring(0, 18)}...`);
    } else {
      ctx.log.warn(`   ⚠️  No group configured for ${firstCity}`);
    }
  } else {
    ctx.log.info('⚪ No city detected');
  }

  // Deduplicate + A3 shuffle
  const uniqueTargets = shuffleArray([...new Set(targets)]);

  ctx.log.info(`🎯 PATH B targets: ${uniqueTargets.length} (paid=${Array.isArray(ctx.config.paidCommonGroupId) ? ctx.config.paidCommonGroupId.length : 1}, city=${firstCity || 'none'})`);

  // NOTE: fingerprint add + markDirty is done by index.js AFTER this function
  // returns true. Do NOT duplicate it here.

  // Send
  const { successCount, totalTargets } = await sendToMultipleGroupsSequential(uniqueTargets, text, ctx);

  if (successCount > 0) {
    ctx.messageCount.hourly++;
    ctx.messageCount.daily++;
    ctx.stats.pathBProcessed++;
    ctx.stats.totalMessagesSent += successCount;
  }

  ctx.log.info(`✅ PATH B DONE: ${successCount}/${totalTargets} delivered | City: ${firstCity || 'none'} | ${ctx.messageCount.hourly}/${RATE_LIMITS.HOURLY}h`);

  // C1: Batch cleanup if fingerprint set exceeds cap
  cleanupFingerprintSetIfNeeded(ctx);

  return successCount > 0;
}