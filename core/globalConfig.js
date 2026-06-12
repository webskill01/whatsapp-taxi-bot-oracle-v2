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