// =============================================================================
// globalDefaults.js — Single source of truth for all constants.
// Change a value here and it propagates everywhere. No magic numbers elsewhere.
// =============================================================================

// -----------------------------------------------------------------------------
// TIMING BUDGET — All values tuned to deliver 4 targets in 12-15s max.
//
// Budget math (4 targets, worst case):
//   Typing delay (before first send):     1.0 – 1.8s   (length-scaled, A1)
//   sock.sendMessage × 4:                 0.8 – 2.0s   (0.2-0.5s each)
//   Between-group gaps × 3:               2.4 – 4.5s   (0.8-1.5s each, A5)
//   Occasional random pause (15% chance): 0   – 3.0s
//   ─────────────────────────────────────────────────
//   TOTAL RANGE:                          4.2 – 11.3s  (fits 12-15s window)
// -----------------------------------------------------------------------------

export const HUMAN_DELAYS = {
  // Typing delay — scales with message length (A1 locked)
  // Short messages (~30 chars):  ~1.0s
  // Long messages (~200+ chars): ~1.8s
  TYPING_BASE_PER_CHAR: 4,         // ms per character (base)
  TYPING_MIN: 1000,                // absolute floor: 1.0s
  TYPING_MAX: 1800,                // absolute ceiling: 1.8s

  // Between-group delay — weighted toward lower end (A5 locked)
  // Most gaps land 0.8-1.1s. Occasionally up to 1.5s.
  BETWEEN_MIN: 800,                // 0.8s floor
  BETWEEN_MAX: 1500,               // 1.5s ceiling
  BETWEEN_WEIGHT: 0.65,            // bias factor — 65% of range is "normal" band

  // Random pause (mimics human hesitation) — 15% chance per gap
  RANDOM_PAUSE_CHANCE: 0.15,
  RANDOM_PAUSE_MIN: 1500,          // 1.5s
  RANDOM_PAUSE_MAX: 3000,          // 3.0s
};

// -----------------------------------------------------------------------------
// RATE LIMITS — Conservative, WhatsApp-safe
// -----------------------------------------------------------------------------
export const RATE_LIMITS = {
  HOURLY: 100,
  DAILY: 1000,
};

// -----------------------------------------------------------------------------
// MESSAGE VALIDATION
// -----------------------------------------------------------------------------
export const MESSAGE = {
  MIN_LENGTH: 10,                  // reject messages shorter than this
};

// -----------------------------------------------------------------------------
// DEDUPLICATION & CACHE
// -----------------------------------------------------------------------------
export const CACHE = {
  // Fingerprint set hard cap
  MAX_FINGERPRINTS: 2000,

  // C1: When cap is hit, delete down to this fraction (not one-by-one)
  CLEANUP_TARGET_RATIO: 0.80,      // drop to 80% of max on overflow

  // Disk persistence
  FINGERPRINT_FILE: '.forwarded-messages.json',
  FINGERPRINT_TTL_MS: 7200000,     // 2 hours — entries older than this are not loaded
  FINGERPRINT_SAVE_CAP: 1000,      // max entries written to disk

  // C2: Debounced disk write — flush interval when dirty flag is set
  SAVE_DEBOUNCE_MS: 30000,         // 30 seconds

  // B2: Rolling message-ID set for reconnect replay dedup
  MAX_REPLAY_IDS: 200,
};

// -----------------------------------------------------------------------------
// RECONNECT PROTECTION (B1, B2, A4)
// -----------------------------------------------------------------------------
export const RECONNECT = {
  // B1: Strict age window enforced for first STRICT_WINDOW_DURATION after reconnect.
  // Only messages younger than STRICT_AGE_MS are processed during this window.
  // After the window expires, normal processing resumes (no age gate beyond fromMe/fingerprint).
  STRICT_AGE_MS: 10000,            // 10 seconds — only accept messages < 10s old
  STRICT_WINDOW_DURATION: 30000,   // enforce strict age for 30s after reconnect

  // A4: Settling delay on first message after reconnect or state change.
  // Bot pauses this long before processing the very first message.
  SETTLING_MIN: 5000,              // 5s
  SETTLING_MAX: 15000,             // 15s
};

// -----------------------------------------------------------------------------
// CIRCUIT BREAKER
// -----------------------------------------------------------------------------
export const CIRCUIT_BREAKER = {
  MAX_FAILURES: 10,                // trip after this many consecutive failures
  RESET_DURATION: 60000,           // stay open for 60s then auto-reset
};

// -----------------------------------------------------------------------------
// SEND COOLDOWN — per-group minimum gap between sends
// -----------------------------------------------------------------------------
export const SEND_COOLDOWN_MS = 1000;                // 1s minimum between sends to same group
export const SEND_COOLDOWN_CLEANUP_INTERVAL = 30000; // clean stale cooldown entries every 30s

// -----------------------------------------------------------------------------
// BAILEYS CONNECTION
// -----------------------------------------------------------------------------
export const BAILEYS = {
  CONNECT_TIMEOUT_MS: 60000,
  KEEP_ALIVE_MS: 30000,
  QUERY_TIMEOUT_MS: 60000,
  MAX_RECONNECT_ATTEMPTS: 10,
  // Exponential backoff: 3s, 6s, 12s, 24s, 48s, cap at 60s
  BACKOFF_BASE_MS: 3000,
  BACKOFF_CAP_MS: 60000,
};

// -----------------------------------------------------------------------------
// STATS SERVER
// -----------------------------------------------------------------------------
export const STATS = {
  DEFAULT_PORT: 3010,              // override per bot via .env STATS_PORT
};