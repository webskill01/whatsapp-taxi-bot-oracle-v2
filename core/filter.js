// =============================================================================
// FILTER.JS — Core intelligence. DO NOT modify decision rules.
// Changes from original: F1 (extractAllCities removed - dead code),
//                        F2 ("Kharad" → "kharad" - was silently dead due to case)
// =============================================================================

const ROUTE_PATTERNS = [
  /\bfrom\b.+\bto\b/i,
  /\bto\b.+\bfrom\b/i,
  /\b\w+\s+to\s+\w+/i,
  /pickup/i,
  /drop/i,
];

function normalizeText(text) {
  if (!text) return "";

  return text
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

function normalizePhoneNumber(phoneNumber) {
  if (!phoneNumber) return "";
  return phoneNumber.replace(/\D/g, "");
}

/**
 * Check if text contains any blocked phone number.
 * Separate validation step — called before isTaxiRequest in the main flow.
 */
export function containsBlockedNumber(text, blockedNumbers) {
  if (!text || !blockedNumbers || blockedNumbers.length === 0) return false;

  const normalizedText = text.replace(/\D/g, "");

  for (const blockedNumber of blockedNumbers) {
    const normalizedBlocked = normalizePhoneNumber(blockedNumber);

    if (!normalizedBlocked) continue;

    // Check exact match
    if (normalizedText.includes(normalizedBlocked)) {
      return true;
    }

    // Check with country code (91 for India)
    const withCountryCode = "91" + normalizedBlocked;
    if (normalizedText.includes(withCountryCode)) {
      return true;
    }
  }

  return false;
}

function getCityAliasMap() {
  return {
    // Delhi + Airports + NCR
    "dli": "Delhi",
    "dehli": "Delhi",
    "dilli": "Delhi",
    "new delhi": "Delhi",
    "t3": "Delhi",
    "t2": "Delhi",
    "t1": "Delhi",
    "terminal 3": "Delhi",
    "terminal 2": "Delhi",
    "terminal 1": "Delhi",
    "igi": "Delhi",
    "igi airport": "Delhi",
    "delhi airport": "Delhi",
    "isbt delhi": "Delhi",
    "kashmere gate": "Delhi",
    "kashmiri gate": "Delhi",
    "dwarka": "Delhi",
    "connaught place": "Delhi",
    "aerocity": "Delhi",

    // Gurgaon
    "ggn": "Gurgaon",
    "gurgoan": "Gurgaon",
    "gurugram": "Gurgaon",
    "grg": "Gurgaon",
    "cyber city": "Gurgaon",
    "golf course road": "Gurgaon",
    "sohna": "Gurgaon",
    "manesar": "Gurgaon",

    // Noida
    "noida sector": "Noida",
    "nioda": "Noida",
    "greater noida": "Noida",
    "faridabad": "Noida",
    "ghaziabad": "Noida",

    // Ambala
    "amb": "Ambala",
    "ambl": "Ambala",
    "ambala cantt": "Ambala",
    "ambala city": "Ambala",
    "ambala cantonment": "Ambala",
    "ambala railway station": "Ambala",

    // Patiala
    "ptl": "Patiala",
    "pti": "Patiala",
    "patiyala": "Patiala",
    "sirhind": "Patiala",
    "rajpura": "Patiala",
    "nabha": "Patiala",
    "samana": "Patiala",

    // Chandigarh + Tricity
    "chd": "Chandigarh",
    "chandi": "Chandigarh",
    "chandhigarh": "Chandigarh",
    "chandigarh sector": "Chandigarh",
    "sector": "Chandigarh",
    "sec 17": "Chandigarh",
    "sec 35": "Chandigarh",
    "isbt 17": "Chandigarh",
    "isbt 43": "Chandigarh",
    "panchkula": "Chandigarh",
    "isbt chandigarh": "Chandigarh",
    "chandigarh airport": "Chandigarh",

    // Zirakpur
    "zkp": "Zirakpur",
    "zirkpur": "Zirakpur",
    "jerkpur": "Zirakpur",
    "zirkapur": "Zirakpur",
    "dera basi": "Zirakpur",
    "dera bassi": "Zirakpur",
    "derabassi": "Zirakpur",
    "dhakoli": "Zirakpur",

    // Mohali
    "mhl": "Mohali",
    "mohali sector": "Mohali",
    "sahibzada ajit singh nagar": "Mohali",
    "sas nagar": "Mohali",
    "kharar": "Mohali",
    "khrar": "Mohali",
    "kahrar": "Mohali",
    "kharad": "Mohali",          // ← F2 FIX: was "Kharad" (capital K), never matched
    "kurali": "Mohali",
    "mohali phase": "Mohali",
    "phase 11": "Mohali",
    "phase 10": "Mohali",
    "mohali airport": "Mohali",
    "landran": "Mohali",

    // Amritsar
    "asr": "Amritsar",
    "amritser": "Amritsar",
    "amritsarr": "Amritsar",
    "golden temple": "Amritsar",
    "wagah border": "Amritsar",
    "amritsar airport": "Amritsar",

    // Ludhiana
    "ldh": "Ludhiana",
    "ludhiyana": "Ludhiana",
    "ludhianaa": "Ludhiana",

    // Jalandhar
    "jld": "Jalandhar",
    "jalandar": "Jalandhar",
    "jullundur": "Jalandhar",
    "phagwara": "Jalandhar",
  };
}

/**
 * Extracts PICKUP city from text (not drop city).
 * Pattern priority enforces pickup-first:
 *   1. "from X to Y" → X
 *   2. "X to Y"      → X
 *   3. "pickup: X"   → X
 *   4. Word scan     → first city found (fallback)
 */
export function extractPickupCity(text, cities) {
  if (!text) return null;

  if (!cities || !Array.isArray(cities) || cities.length === 0) {
    return null;
  }

  const normalized = normalizeText(text);
  const aliasMap = getCityAliasMap();

  function isConfiguredCity(word, cities) {
    const wordLower = word.toLowerCase().trim();

    for (const city of cities) {
      if (city.toLowerCase() === wordLower) {
        return city;
      }
    }

    if (aliasMap[wordLower]) {
      const mappedCity = aliasMap[wordLower];
      if (cities.includes(mappedCity)) {
        return mappedCity;
      }
    }

    return null;
  }

  // Pattern 1: "from X to Y" - extract X as pickup
  const fromToPattern = /\bfrom\s+([a-z\s]+?)\s+to\s+([a-z\s]+?)(?:\s|$|[^a-z])/i;
  const fromToMatch = normalized.match(fromToPattern);

  if (fromToMatch) {
    const sourceWords = fromToMatch[1].trim().split(/\s+/);

    for (let i = 0; i < sourceWords.length; i++) {
      const city = isConfiguredCity(sourceWords[i], cities);
      if (city) return city;

      if (i < sourceWords.length - 1) {
        const twoWords = sourceWords[i] + " " + sourceWords[i + 1];
        const city = isConfiguredCity(twoWords, cities);
        if (city) return city;
      }

      if (i < sourceWords.length - 2) {
        const threeWords = sourceWords[i] + " " + sourceWords[i + 1] + " " + sourceWords[i + 2];
        const city = isConfiguredCity(threeWords, cities);
        if (city) return city;
      }
    }

    return null;
  }

  // Pattern 2: "X to Y" - extract X as pickup
  const toPattern = /\b([a-z\s]+?)\s+to\s+([a-z\s]+?)(?:\s|$|[^a-z])/i;
  const toMatch = normalized.match(toPattern);

  if (toMatch) {
    const sourceWords = toMatch[1].trim().split(/\s+/);

    for (let i = 0; i < sourceWords.length; i++) {
      const city = isConfiguredCity(sourceWords[i], cities);
      if (city) return city;

      if (i < sourceWords.length - 1) {
        const twoWords = sourceWords[i] + " " + sourceWords[i + 1];
        const city = isConfiguredCity(twoWords, cities);
        if (city) return city;
      }
    }

    return null;
  }

  // Pattern 3: "pickup: X" or "pickup X"
  const pickupPattern = /\bpickup\s*:?\s*([a-z\s]+?)(?:\s*drop|\s*to|\s*-|\s*phone|\s*\d|$)/i;
  const pickupMatch = normalized.match(pickupPattern);

  if (pickupMatch) {
    const pickupWords = pickupMatch[1].trim().split(/\s+/).slice(0, 3);

    for (let i = 0; i < pickupWords.length; i++) {
      const city = isConfiguredCity(pickupWords[i], cities);
      if (city) return city;

      if (i < pickupWords.length - 1) {
        const twoWords = pickupWords[i] + " " + pickupWords[i + 1];
        const city = isConfiguredCity(twoWords, cities);
        if (city) return city;
      }
    }

    return null;
  }

  // Pattern 4: Scan all words (fallback)
  const words = normalized.split(/\s+/);

  for (let i = 0; i < words.length; i++) {
    const city = isConfiguredCity(words[i], cities);
    if (city) return city;

    if (i < words.length - 1) {
      const twoWords = words[i] + " " + words[i + 1];
      const city = isConfiguredCity(twoWords, cities);
      if (city) return city;
    }

    if (i < words.length - 2) {
      const threeWords = words[i] + " " + words[i + 1] + " " + words[i + 2];
      const city = isConfiguredCity(threeWords, cities);
      if (city) return city;
    }
  }

  return null;
}

/**
 * Alias for extractPickupCity (backward compatibility)
 */
export function extractFirstCity(text, cities) {
  return extractPickupCity(text, cities);
}

// F1: extractAllCities REMOVED — was exported but never called anywhere in
// the routing pipeline (index.js, poller.js, router.js). Dead code confirmed
// across full codebase read. If needed in future, restore from git history.

/**
 * Checks if message is a valid taxi request.
 * Gate order in main flow: containsBlockedNumber → isTaxiRequest → hasPhoneNumber
 * The blockedNumbers param here is kept for backward compat but the main flow
 * calls containsBlockedNumber separately BEFORE this function.
 */
export function isTaxiRequest(text, keywords, ignoreList, blockedNumbers = []) {
  if (!text) return false;

  const normalized = normalizeText(text);
  const originalLower = text.toLowerCase();

  // Backward compat: if blockedNumbers passed directly, check here too
  if (blockedNumbers && blockedNumbers.length > 0) {
    if (containsBlockedNumber(text, blockedNumbers)) {
      return false;
    }
  }

  // Check ignore list (runs on raw lowercase — intentional, see F5 analysis)
  for (const ignoreWord of ignoreList) {
    if (originalLower.includes(ignoreWord.toLowerCase())) {
      return false;
    }
  }

  // Check for taxi keywords
  const hasKeyword = keywords.some((keyword) =>
    normalized.includes(keyword.toLowerCase())
  );

  // Check for route patterns (from/to)
  const hasRoute = ROUTE_PATTERNS.some((pattern) => pattern.test(normalized));

  return hasKeyword || hasRoute;
}

/**
 * Generates a text-based fingerprint for deduplication.
 * Same message within the same 5-minute window produces identical fingerprint.
 * Phone numbers are replaced with placeholder before hashing so minor
 * formatting differences in the same number don't break dedup.
 */
export function getMessageFingerprint(text, messageId = null, timestamp = null) {
  if (!text) return "";

  const normalized = text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .replace(/\d{10,}/g, 'PHONE')
    .trim()
    .substring(0, 300);

  // Simple hash (Java String.hashCode equivalent)
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }

  const textHash = Math.abs(hash).toString(36);

  // 5-minute time windows (300000ms)
  const now = timestamp || Date.now();
  const timeWindow = Math.floor(now / 300000);

  return `fp-${textHash}-${timeWindow}`;
}