/**
 * ============================================================================
 * blockData.js — shared, dedup-safe editor for core/blocked-data.json
 * ============================================================================
 * Single source of truth for reading/parsing/adding block data, used by BOTH
 * scripts/block.js (CLI) and the control panel (HTTP). The bots themselves only
 * READ the file (and hot-reload it via globalConfig.js) — they never import this.
 *
 * Number parsing handles every real-world format operators paste:
 *   9053648269   +918920836257   "+91 77079 30908"   91 88207 36257
 *   leading-0 (079...)   comma/space/newline separated lists
 * All normalize to bare 10-digit numbers, with dedup against existing entries.
 * ============================================================================
 */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DATA_PATH = join(__dirname, "blocked-data.json");

export function readData() {
  return JSON.parse(readFileSync(DATA_PATH, "utf8"));
}

export function writeData(data) {
  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");
}

/**
 * Parse arbitrary user input (string or array of args) into bare 10-digit numbers.
 * Mirrors scripts/block.js parsing: flatten → split on commas/whitespace → strip
 * to digits → greedily accumulate until a number resolves (10 digits, 11 w/ leading
 * 0, or 12 w/ leading 91). Returns { numbers, invalid }.
 */
export function parseNumbers(input) {
  const rawArgs = Array.isArray(input) ? input : [String(input)];
  const chunks = rawArgs
    .flatMap((a) => String(a).split(/[\s,]+/))
    .map((t) => t.replace(/\D/g, ""))
    .filter(Boolean);

  const numbers = [];
  const invalid = [];
  let buf = "";

  for (const chunk of chunks) {
    buf += chunk;
    if (buf.length === 10) {
      numbers.push(buf); buf = "";
    } else if (buf.length === 11 && buf.startsWith("0")) {
      numbers.push(buf.slice(1)); buf = "";
    } else if (buf.length === 12 && buf.startsWith("91")) {
      numbers.push(buf.slice(2)); buf = "";
    } else if (buf.length > 12) {
      invalid.push(buf); buf = "";
    }
  }
  if (buf) invalid.push(buf);
  return { numbers, invalid };
}

/**
 * Add parsed numbers to a field (blockedPhoneNumbers | blockedSenders), dedup-safe.
 * Does NOT write — caller persists via writeData(). Returns a report.
 */
export function addNumbersToField(data, field, input) {
  const { numbers, invalid } = parseNumbers(input);
  const set = new Set(data[field]);
  const added = [];
  const dupes = [];
  for (const d of numbers) {
    if (set.has(d)) { dupes.push(d); continue; }
    set.add(d);
    added.push(d);
  }
  // Preserve insertion order (existing first, new appended) so the dashboard can
  // show most-recent additions first by reversing. No sort = recency kept.
  data[field] = [...set];
  return { added, dupes, invalid };
}

/** Add a single ignore phrase, dedup-safe (NFC + lowercase comparison). */
export function addIgnorePhrase(data, phrase) {
  const trimmed = String(phrase || "").trim();
  if (!trimmed) return { added: false, reason: "empty" };
  const key = trimmed.normalize("NFC").toLowerCase();
  const exists = data.ignoreIfContains.some(
    (k) => k.normalize("NFC").toLowerCase() === key
  );
  if (exists) return { added: false, reason: "duplicate", phrase: trimmed };
  data.ignoreIfContains.push(trimmed);
  return { added: true, phrase: trimmed };
}

/** Check whether a number is already present in either number list. */
export function checkNumber(data, input) {
  const { numbers } = parseNumbers(input);
  if (numbers.length !== 1) return null;
  const d = numbers[0];
  return {
    number: d,
    inBlockedPhoneNumbers: data.blockedPhoneNumbers.includes(d),
    inBlockedSenders: data.blockedSenders.includes(d),
  };
}
