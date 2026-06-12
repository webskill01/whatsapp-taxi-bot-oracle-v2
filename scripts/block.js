#!/usr/bin/env node
/**
 * ============================================================================
 * block.js — CLI to manage the gitignored core/blocked-data.json
 * ============================================================================
 * Adds / checks blocked phone numbers, blocked senders, and ignore phrases.
 * Dedup-safe: never adds a duplicate. Saves the file exactly once at the end.
 *
 * USAGE
 *   node scripts/block.js <numbers...>             Add blocked phone number(s)
 *   node scripts/block.js --sender <numbers...>    Add blocked sender(s)
 *   node scripts/block.js --ignore <phrase...>     Add ignore phrase(s)
 *
 *   node scripts/block.js --check <numbers...>     Check if number(s) are blocked
 *   node scripts/block.js --sender --check <num>   Check blocked sender(s)
 *   node scripts/block.js --ignore --check <text>  Check ignore phrase(s)
 *
 *   node scripts/block.js --list                   List counts (+ --sender/--ignore)
 *
 * NUMBER FORMATS ACCEPTED (quoted OR split across shell args, comma-separated):
 *   9053648269            +918920836257           "+91 77079 30908"
 *   +91 77079 30908       09053648269             9053648269, +91 8920836257
 * All normalized to bare 10 digits. A greedy multi-chunk parser resolves a run
 * of digits at 10 (as-is), 11 (leading 0), or 12 (leading 91) — so a real
 * 10-digit number that happens to start with "91" is NOT mis-stripped.
 * ============================================================================
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "..", "core", "blocked-data.json");

const KEYS = ["blockedPhoneNumbers", "blockedSenders", "ignoreIfContains"];

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------

function load() {
  if (!fs.existsSync(DATA_FILE)) {
    console.error(`❌ blocked-data.json not found at ${DATA_FILE}`);
    console.error(`   This file is gitignored and must exist on this machine.`);
    process.exit(1);
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (err) {
    console.error(`❌ blocked-data.json is not valid JSON: ${err.message}`);
    process.exit(1);
  }
  for (const k of KEYS) {
    if (!Array.isArray(data[k])) {
      console.error(`❌ blocked-data.json key "${k}" must be an array.`);
      process.exit(1);
    }
  }
  return data;
}

function save(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Greedy multi-chunk phone number parser
// ---------------------------------------------------------------------------
// Input: the raw positional args (already split by the shell). We re-join them,
// turn commas into separators, extract every maximal run of digits, then walk
// those chunks left-to-right accumulating into a buffer. The buffer resolves to
// one number the moment it reaches a terminal length:
//   - 10 digits            → use as-is        (e.g. 9053648269)
//   - 11 digits, leading 0 → drop the 0       (e.g. 09053648269 → 9053648269)
//   - 12 digits, leading 91→ drop the 91      (e.g. 918920836257 → 8920836257)
// Resolving at 10 FIRST means a genuine 10-digit number starting with 91 is
// kept intact instead of being truncated to 8 digits.

function parseNumbers(args) {
  const joined = args.join(" ").replace(/,/g, " ");
  const chunks = joined.match(/\d+/g) || [];

  const valid = [];
  const invalid = [];
  let buf = "";
  let bufParts = [];

  const flushInvalid = () => {
    if (buf.length > 0) invalid.push(bufParts.join(" "));
    buf = "";
    bufParts = [];
  };

  for (const chunk of chunks) {
    buf += chunk;
    bufParts.push(chunk);

    if (buf.length === 10) {
      valid.push(buf);
      buf = ""; bufParts = [];
    } else if (buf.length === 11 && buf[0] === "0") {
      valid.push(buf.slice(1));
      buf = ""; bufParts = [];
    } else if (buf.length === 12 && buf.startsWith("91")) {
      valid.push(buf.slice(2));
      buf = ""; bufParts = [];
    } else if (buf.length > 12) {
      // Overshot every terminal length without resolving — junk.
      flushInvalid();
    }
  }
  // Anything left in the buffer never resolved to a valid number.
  flushInvalid();

  // Final sanity: Indian mobile numbers are 10 digits starting 6-9.
  const clean = [];
  for (const n of valid) {
    if (/^[6-9]\d{9}$/.test(n)) clean.push(n);
    else invalid.push(n);
  }
  return { valid: clean, invalid };
}

// ---------------------------------------------------------------------------
// Ignore-phrase parsing
// ---------------------------------------------------------------------------
// Phrases may contain spaces, so we split ONLY on commas. Each phrase is
// NFC-normalized + lowercased to match how the bot compares them.

function parsePhrases(args) {
  return args
    .join(" ")
    .split(",")
    .map((p) => p.normalize("NFC").trim().toLowerCase())
    .filter((p) => p.length > 0);
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const positional = argv.filter((a) => !a.startsWith("--"));

const isSender = flags.has("--sender");
const isIgnore = flags.has("--ignore");
const isCheck = flags.has("--check");
const isList = flags.has("--list");

const targetKey = isIgnore
  ? "ignoreIfContains"
  : isSender
  ? "blockedSenders"
  : "blockedPhoneNumbers";

const label = isIgnore
  ? "ignore phrase"
  : isSender
  ? "blocked sender"
  : "blocked number";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const data = load();

// ---- LIST ----
if (isList) {
  const list = data[targetKey];
  console.log(`📋 ${targetKey}: ${list.length} entr${list.length === 1 ? "y" : "ies"}`);
  for (const item of list) console.log(`   ${item}`);
  process.exit(0);
}

// Parse the inputs for the chosen target
let inputs, invalid = [];
if (isIgnore) {
  inputs = parsePhrases(positional);
} else {
  const parsed = parseNumbers(positional);
  inputs = parsed.valid;
  invalid = parsed.invalid;
}

if (inputs.length === 0 && invalid.length === 0) {
  console.error(`❌ No ${label}s provided.`);
  console.error(`   Try: node scripts/block.js ${isIgnore ? '--ignore "phrase"' : isSender ? "--sender 9876543210" : "9876543210"}`);
  process.exit(1);
}

const existing = new Set(data[targetKey]);

// ---- CHECK ----
if (isCheck) {
  for (const item of inputs) {
    console.log(existing.has(item) ? `🔴 BLOCKED   ${item}` : `🟢 not listed ${item}`);
  }
  for (const bad of invalid) console.log(`⚠️  invalid    "${bad}"`);
  process.exit(0);
}

// ---- ADD (dedup-safe, single save) ----
const added = [];
const already = [];

for (const item of inputs) {
  if (existing.has(item)) {
    already.push(item);
  } else {
    existing.add(item);
    data[targetKey].push(item);
    added.push(item);
  }
}

if (added.length > 0) save(data);

console.log(`\n📊 ${label} — results:`);
if (added.length)   console.log(`   ✅ added (${added.length}):          ${added.join(", ")}`);
if (already.length) console.log(`   ⏭️  already present (${already.length}): ${already.join(", ")}`);
if (invalid.length) console.log(`   ⚠️  invalid (${invalid.length}):        ${invalid.map((x) => `"${x}"`).join(", ")}`);
console.log(`   📁 ${targetKey} now has ${data[targetKey].length} entries`);
if (added.length === 0) console.log(`   (file not rewritten — nothing new)`);
