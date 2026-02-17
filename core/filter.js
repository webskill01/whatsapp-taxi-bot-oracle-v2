/**
 * ============================================================================
 * FILTER — Message Validation & City Extraction
 * ============================================================================
 * Bot-1 routing logic PRESERVED:
 *   - extractPickupCity() used to pick which cityTargetGroup to send to
 *   - isTaxiRequest(), hasPhoneNumber(), containsBlockedNumber() unchanged
 *   - getMessageFingerprint() unchanged
 *
 * Bot-2 improvements applied:
 *   - City alias map imported from cityAliases.js (not inline)
 *   - normalizeText() as standalone (no emoji unicode ranges missed)
 *   - All functions individually exported for testability
 * ============================================================================
 */

import { CITY_ALIASES } from "./cityAliases.js";

// =============================================================================
// ROUTE PATTERNS  — used in isTaxiRequest() as secondary gate
// =============================================================================

const ROUTE_PATTERNS = [
  /\bfrom\b.+\bto\b/i,
  /\bto\b.+\bfrom\b/i,
  /\b\w+\s+to\s+\w+/i,
  /pickup/i,
  /drop/i,
];

// =============================================================================
// TEXT NORMALIZATION
// =============================================================================

export function normalizeText(text) {
  if (!text) return "";

  return text
    // Strip common emoji unicode blocks
    .replace(/[\u{1F600}-\u{1F64F}]/gu, "")
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, "")
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, "")
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, "")
    .replace(/[\u{2600}-\u{26FF}]/gu, "")
    .replace(/[\u{2700}-\u{27BF}]/gu, "")
    .replace(/[\u{FE00}-\u{FE0F}]/gu, "")
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// =============================================================================
// PHONE NUMBER DETECTION
// =============================================================================

export function hasPhoneNumber(text) {
  if (!text) return false;

  const digitsOnly = text.replace(/[\s\-\(\)\+\.]/g, "");
  const digitCount = (digitsOnly.match(/\d/g) || []).length;

  if (digitCount < 8) return false;

  const phonePatterns = [
    /\d{10}/,
    /\d{5}\s*\d{5}/,
    /\d{5}[-]\d{5}/,
    /\+?\d{2}\s*\d{10}/,
    /\+?\d{2}[-\s]\d{5}[-\s]\d{5}/,
    /\d{3}[-\s]?\d{3}[-\s]?\d{4}/,
    /\(\d{3}\)\s*\d{3}[-\s]?\d{4}/,
    /\d{2,4}[-\s]\d{6,8}/,
    /\d{4}[-\s]\d{6}/,
    /\d{2}[-\s]\d{8}/,
    /\d{3}[-]\d{3}[-]\d{4}/,
    /\b\d{10,12}\b/,
  ];

  return phonePatterns.some((pattern) => pattern.test(text));
}

// =============================================================================
// BLOCKED NUMBER CHECK
// =============================================================================

export function containsBlockedNumber(text, blockedNumbers) {
  if (!text || !blockedNumbers || blockedNumbers.length === 0) return false;

  const normalizedText = text.replace(/\D/g, "");

  for (const blockedNumber of blockedNumbers) {
    const normalizedBlocked = blockedNumber.replace(/\D/g, "");
    if (!normalizedBlocked) continue;

    if (normalizedText.includes(normalizedBlocked)) return true;

    const withCountryCode = "91" + normalizedBlocked;
    if (normalizedText.includes(withCountryCode)) return true;
  }

  return false;
}

// =============================================================================
// CITY EXTRACTION (Bot-1 pickup-first priority logic, preserved exactly)
// =============================================================================

/**
 * Extracts the PICKUP city from message text using 4-pass priority:
 *   1. "from X to Y" → X
 *   2. "X to Y"      → X
 *   3. "pickup: X"   → X
 *   4. Word scan     → first city found (fallback)
 *
 * @param {string}   text            - Raw message text
 * @param {string[]} configuredCities - List of canonical city names to match against
 * @returns {string|null}
 */
export function extractPickupCity(text, configuredCities) {
  if (!text) return null;
  if (!configuredCities || !Array.isArray(configuredCities) || configuredCities.length === 0) {
    return null;
  }

  const normalized = normalizeText(text);

  function isConfiguredCity(word) {
    const wordLower = word.toLowerCase().trim();

    // Direct canonical name match
    for (const city of configuredCities) {
      if (city.toLowerCase() === wordLower) return city;
    }

    // Alias map lookup
    const mapped = CITY_ALIASES[wordLower];
    if (mapped && configuredCities.includes(mapped)) return mapped;

    return null;
  }

  function scanWords(phrase, maxWords = 3) {
    const words = phrase.trim().split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      // 1-word
      const c1 = isConfiguredCity(words[i]);
      if (c1) return c1;
      // 2-word
      if (i < words.length - 1) {
        const c2 = isConfiguredCity(words[i] + " " + words[i + 1]);
        if (c2) return c2;
      }
      // 3-word
      if (maxWords >= 3 && i < words.length - 2) {
        const c3 = isConfiguredCity(words[i] + " " + words[i + 1] + " " + words[i + 2]);
        if (c3) return c3;
      }
    }
    return null;
  }

  // Pass 1: "from X to Y" → extract X
  const fromToMatch = normalized.match(/\bfrom\s+([a-z\s]+?)\s+to\s+([a-z\s]+?)(?:\s|$|[^a-z])/i);
  if (fromToMatch) {
    const city = scanWords(fromToMatch[1]);
    return city; // null if not found — don't fall through on this pattern
  }

  // Pass 2: "X to Y" → extract X
  const toMatch = normalized.match(/\b([a-z\s]+?)\s+to\s+([a-z\s]+?)(?:\s|$|[^a-z])/i);
  if (toMatch) {
    const city = scanWords(toMatch[1]);
    return city;
  }

  // Pass 3: "pickup: X" or "pickup X"
  const pickupMatch = normalized.match(
    /\bpickup\s*:?\s*([a-z\s]+?)(?:\s*drop|\s*to|\s*-|\s*phone|\s*\d|$)/i
  );
  if (pickupMatch) {
    const city = scanWords(pickupMatch[1].slice(0, 3));  // max 3 words
    return city;
  }

  // Pass 4: Scan all words (fallback)
  return scanWords(normalized);
}

// Alias for backward compatibility
export const extractFirstCity = extractPickupCity;

// =============================================================================
// TAXI REQUEST GATE
// =============================================================================

/**
 * Returns true if message passes all filters and looks like a taxi request.
 */
export function isTaxiRequest(text, keywords, ignoreList, blockedNumbers = []) {
  if (!text) return false;

  const normalized   = normalizeText(text);
  const originalLower = text.toLowerCase();

  // Blocked number check
  if (blockedNumbers.length > 0 && containsBlockedNumber(text, blockedNumbers)) {
    return false;
  }

  // Ignore keyword check (against raw lowercase — catches unicode/Punjabi/Hindi)
  for (const ignoreWord of ignoreList) {
    if (originalLower.includes(ignoreWord.toLowerCase())) return false;
  }

  // Must have taxi keyword OR route pattern
  const hasKeyword = keywords.some((kw) => normalized.includes(kw.toLowerCase()));
  const hasRoute   = ROUTE_PATTERNS.some((pattern) => pattern.test(normalized));

  return hasKeyword || hasRoute;
}

// =============================================================================
// FINGERPRINT (Bot-1 logic preserved exactly)
// =============================================================================

/**
 * Generates a deduplication fingerprint for a message.
 * Same content within the same 5-minute window → identical fingerprint.
 *
 * @param {string} text
 * @param {string|null} messageId    - Unused but kept for API compat
 * @param {number|null} timestamp    - Unix ms; defaults to Date.now()
 * @returns {string}
 */
export function getMessageFingerprint(text, messageId = null, timestamp = null) {
  if (!text) return "";

  const normalized = text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s]/g, "")
    .replace(/\d{10,}/g, "PHONE")
    .trim()
    .substring(0, 300);

  // Java-style String.hashCode()
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // force 32-bit integer
  }
  const textHash = Math.abs(hash).toString(36);

  const now        = timestamp || Date.now();
  const timeWindow = Math.floor(now / 300000); // 5-minute bucket

  return `fp-${textHash}-${timeWindow}`;
}