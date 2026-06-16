/**
 * ============================================================================
 * GLOBAL CONFIGURATION
 * ============================================================================
 * ES module replacing globalConfig.json + globalDefaults.js
 * Shared across ALL bot instances running in this project.
 *
 * Bot-2 pattern: single source of truth for keywords, anti-ban constants,
 * rate limits, and all tunable defaults.
 * ============================================================================
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { watchFile } from "fs";

// =============================================================================
// VOLATILE BLOCK / IGNORE DATA — loaded from gitignored core/blocked-data.json
// =============================================================================
// This file is NOT committed (it changes constantly and is identical across all
// bots/VMs). It MUST exist and contain three arrays. We FAIL CLOSED: if the file
// is missing or malformed, we throw rather than fall back to empty lists —
// empty lists would silently let the bot forward spam to paid groups.
// =============================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BLOCKED_DATA_FILE = path.join(__dirname, "blocked-data.json");

function loadBlockedData() {
  if (!fs.existsSync(BLOCKED_DATA_FILE)) {
    throw new Error(
      `[globalConfig] FATAL: blocked-data.json not found at ${BLOCKED_DATA_FILE}\n` +
      `   This file is gitignored and must be copied onto this machine manually.\n` +
      `   Refusing to start with empty block/ignore lists (would forward spam).`
    );
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(BLOCKED_DATA_FILE, "utf8"));
  } catch (err) {
    throw new Error(`[globalConfig] FATAL: blocked-data.json is not valid JSON: ${err.message}`);
  }

  for (const key of ["blockedPhoneNumbers", "blockedSenders", "ignoreIfContains"]) {
    if (!Array.isArray(raw[key])) {
      throw new Error(
        `[globalConfig] FATAL: blocked-data.json key "${key}" must be an array (got ${typeof raw[key]}).\n` +
        `   Refusing to start — fail closed rather than forward spam.`
      );
    }
  }

  return raw;
}

const BLOCKED_DATA = loadBlockedData();

export const GLOBAL_CONFIG = {
  // ==========================================================================
  // TAXI REQUEST KEYWORDS (normalized to lowercase at definition time)
  // ==========================================================================
  requestKeywords: [
    "need",
    "tu",
    "pickup",
    "pik",
    "pick",
    "urgent",
    "carrier",
    "time",
    "drop",
    "cab",
    "car",
    "taxi",
    "ride",
    "sedan",
    "sadan",
    "crysta",
    "dezire",
    "honda",
    "crunt",
    "small",
    "aura",
    "suv",
    "innova",
    "ertiga",
    "dzire",
    "etios",
    "current",
    "tempo",
    "parcel",
    "airport",
    "outstation",
  ].map((k) => k.toLowerCase()),

  // ==========================================================================
  // IGNORE KEYWORDS — drop message if any of these found in raw text
  // Loaded from gitignored core/blocked-data.json (see loader above).
  // NFC-normalized + lowercased so Hindi/Punjabi precomposed and decomposed
  // (nukta) forms both match against incoming text.
  // ==========================================================================
  ignoreIfContains: BLOCKED_DATA.ignoreIfContains.map((k) => k.normalize("NFC").toLowerCase()),

  // ==========================================================================
  // GLOBALLY BLOCKED PHONE NUMBERS — loaded from gitignored core/blocked-data.json
  // Add 10-digit numbers via `node scripts/block.js <number>`.
  // Country code variants checked automatically.
  // ==========================================================================
  blockedPhoneNumbers: BLOCKED_DATA.blockedPhoneNumbers,

  // ==========================================================================
  // GLOBALLY BLOCKED SENDERS — loaded from gitignored core/blocked-data.json
  // Messages from these WhatsApp numbers are completely ignored by all bots.
  // Unlike blockedPhoneNumbers (which checks message text), this blocks the
  // SENDER — every message they send from any group is dropped before processing.
  // Add via `node scripts/block.js --sender <number>`.
  // Format: 10-digit number only. Country code 91 handled automatically.
  // ==========================================================================
  blockedSenders: BLOCKED_DATA.blockedSenders,

  // ==========================================================================
  // 🔒 RATE LIMITS
  // ==========================================================================
  rateLimits: {
    hourly: 100,
    daily: 1500,
  },

  // ==========================================================================
  // VALIDATION
  // ==========================================================================
  validation: {
    minMessageLength: 10,
    requirePhoneNumber: true,
  },

  // ==========================================================================
  // 🔒 A1 + A5: Human behavior delays
  // ==========================================================================
  humanBehavior: {
    // A1: Length-scaled typing delay
    typingBasePerChar: 4,   // ms per character
    typingMin: 800,        // 0.8s floor
    typingMax: 1800,        // 1.8s ceiling

    // A5: Weighted between-group gaps (Bot-1 tighter values preserved)
    betweenMin: 800,
    betweenMax: 1500,
    betweenWeight: 0.65,    // 65% bias toward low end

    // Random pauses
    randomPauseChance: 0.15,
    randomPauseMin: 1500,
    randomPauseMax: 3000,
  },

  // ==========================================================================
  // 🔒 CIRCUIT BREAKER
  // ==========================================================================
  circuitBreaker: {
    maxFailures: 10,
    breakDuration: 60000,   // 60s cooldown
  },

  // ==========================================================================
  // 🔒 C1 + C2: Deduplication & cache
  // ==========================================================================
  deduplication: {
    maxFingerprintCache: 2000,
    cleanupTargetRatio: 0.8,     // C1: Trim to 80% on overflow
    sendCooldown: 1000,          // 1s per-group cooldown
    fingerprintTTL: 7200000,     // 2h TTL
    fingerprintSaveCap: 1000,
    saveDebounceMs: 30000,       // C2: 30s debounced writes
    maxReplayIds: 200,           // B2: Rolling replay ID set
  },

  // ==========================================================================
  // 🔒 B1 + A4: Reconnect protection
  // ==========================================================================
  reconnect: {
    strictAgeMs: 10000,          // B1: 10s age window
    strictWindowDuration: 30000, // B1: Enforce for 30s after reconnect
    settlingMin: 5000,           // A4: 5s floor
    settlingMax: 15000,          // A4: 15s ceiling
  },
};

// ============================================================================
// HOT-RELOAD: apply blocked-data.json edits live, WITHOUT restarting the bot
// ============================================================================
// blocked-data.json is edited several times a day (scripts/block.js, the control
// dashboard, or friends submitting spam numbers). Re-reading it live lets every
// running bot pick up new blocks within ~1s — no restart, so no reconnect, no QR
// re-scan, and no B1 reconnect-age-gate churn.
//
// SAFETY:
//  • Only the DATA arrays are swapped IN PLACE. Every bot's mergedConfig holds the
//    SAME array references (see configLoader.js), and the validation path reads
//    config.blockedPhoneNumbers / blockedSenders / ignoreIfContains fresh on every
//    message — so an in-place mutation is visible on the very next message.
//  • Fail-SAFE (not fail-closed): unlike initial boot, a live reload of a
//    missing/malformed file KEEPS the current lists and logs a warning instead of
//    crashing a connected bot over a bad hand-edit.

/**
 * Replace the contents of GLOBAL_CONFIG's block/ignore arrays in place.
 * Mutates length + push so external references stay valid (no reassignment).
 */
function applyBlockedData(data) {
  for (const key of ["blockedPhoneNumbers", "blockedSenders", "ignoreIfContains"]) {
    if (!Array.isArray(data[key])) {
      throw new Error(`malformed or missing array: "${key}"`);
    }
  }

  GLOBAL_CONFIG.blockedPhoneNumbers.length = 0;
  GLOBAL_CONFIG.blockedPhoneNumbers.push(...data.blockedPhoneNumbers);

  GLOBAL_CONFIG.blockedSenders.length = 0;
  GLOBAL_CONFIG.blockedSenders.push(...data.blockedSenders);

  // ignoreIfContains is stored mixed-case/Unicode in the file but the matcher
  // expects NFC-normalized lowercase — re-apply the same transform as boot load.
  GLOBAL_CONFIG.ignoreIfContains.length = 0;
  GLOBAL_CONFIG.ignoreIfContains.push(
    ...data.ignoreIfContains.map((k) => k.normalize("NFC").toLowerCase())
  );
}

// watchFile (stat/mtime polling) is used instead of fs.watch because it is
// reliable across editors and atomic full-file rewrites (writeFileSync), which
// fs.watch reports inconsistently on Linux. 1s poll is plenty for a file edited
// a handful of times per day.
let _reloadDebounce = null;
try {
  watchFile(BLOCKED_DATA_FILE, { interval: 1000 }, (curr, prev) => {
    // Ignore spurious events where nothing actually changed.
    if (curr.mtimeMs === prev.mtimeMs) return;

    if (_reloadDebounce) clearTimeout(_reloadDebounce);
    _reloadDebounce = setTimeout(() => {
      try {
        const fresh = JSON.parse(fs.readFileSync(BLOCKED_DATA_FILE, "utf8"));
        applyBlockedData(fresh);
        console.log(
          `[globalConfig] 🔄 blocked-data.json reloaded live — ` +
            `${GLOBAL_CONFIG.blockedPhoneNumbers.length} numbers, ` +
            `${GLOBAL_CONFIG.blockedSenders.length} senders, ` +
            `${GLOBAL_CONFIG.ignoreIfContains.length} ignore phrases`
        );
      } catch (err) {
        console.warn(
          `[globalConfig] ⚠️  blocked-data.json reload FAILED — keeping previous lists: ${err.message}`
        );
      }
    }, 300); // settle briefly in case the writer emits multiple stat ticks
  });
} catch (err) {
  console.warn(
    `[globalConfig] ⚠️  could not watch blocked-data.json (hot-reload disabled, restart still applies edits): ${err.message}`
  );
}