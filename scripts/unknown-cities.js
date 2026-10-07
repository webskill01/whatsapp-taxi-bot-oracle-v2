/**
 * Report place-like words from rides the bot forwarded WITHOUT a city, so missing
 * aliases (misspellings, unlisted towns) can be added to core/cityAliases.merged.js.
 *
 *   node scripts/unknown-cities.js [--bot bot-taxi] [--days 3] [--top 40]
 *   node scripts/unknown-cities.js --backfill   # after adding aliases: fix old "unknown" rides
 *
 * Reads bots/<bot>/unknown-cities.jsonl (written by router.js logRide). Only words
 * next to a route word (to / from / drop / pickup …) count, once per message.
 * "nearest" is the closest existing alias by edit distance — a likely misspelling.
 * Nothing is changed: a human (or Claude) reviews the list and edits the alias file.
 */
import { readFileSync, writeFileSync, renameSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { CITY_ALIASES } from "../core/cityAliases.merged.js";
import { normalizeText, extractPickupCity, ALL_CITIES } from "../core/filter.js";
import { GLOBAL_CONFIG } from "../core/globalConfig.js";

const ROUTE = new Set(["to", "from", "drop", "pickup", "pick", "up", "se", "current", "location", "point", "via"]);
// Words that sit next to route words but are never places.
const STOP = new Set([
  "need", "needs", "needed", "required", "require", "urgent", "taxi", "cab", "car", "cars", "booking",
  "sedan", "suv", "innova", "crysta", "ertiga", "dzire", "swift", "etios", "xylo", "tempo", "traveller",
  "carrier", "seater", "vehicle", "today", "tomorrow", "tonight", "morning", "evening", "night", "time",
  "date", "round", "trip", "oneway", "way", "one", "any", "only", "with", "without", "and", "the", "for",
  "airport", "railway", "station", "home", "hotel", "bus", "stand", "road", "near", "city", "side",
  "call", "contact", "number", "fare", "rate", "price", "budget", "ac", "non", "available", "ready",
  "please", "sir", "ji", "bhai", "hai", "ke", "ki", "ka", "ko", "me", "mein", "aur", "wala", "wali",
  "jana", "jaana", "chahiye", "abhi", "kal", "aaj", "baje", "phone", "duty", "guest", "passenger",
  "pax", "person", "persons", "luggage", "drop", "pickup", "point", "location", "current",
]);
for (const k of GLOBAL_CONFIG.requestKeywords || []) STOP.add(String(k).toLowerCase());

const KNOWN = new Set([
  ...Object.keys(CITY_ALIASES).map((k) => k.toLowerCase()),
  ...Object.values(CITY_ALIASES).map((v) => v.toLowerCase()),
]);
const SINGLE_ALIASES = [...KNOWN].filter((k) => !k.includes(" "));

/** Place-like words beside a route word; deduped per message. */
export function candidates(text) {
  const words = normalizeText(text).replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  const out = new Set();
  words.forEach((w, i) => {
    if (w.length < 4 || STOP.has(w) || ROUTE.has(w) || KNOWN.has(w)) return;
    const near = words.slice(Math.max(0, i - 2), i + 3).some((n) => ROUTE.has(n));
    if (near) out.add(w);
  });
  return [...out];
}

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Closest existing alias if it's a plausible misspelling, else null. */
export function nearest(word) {
  const max = word.length <= 5 ? 1 : 2;
  let best = null;
  for (const alias of SINGLE_ALIASES) {
    if (Math.abs(alias.length - word.length) > max) continue;
    const dist = editDistance(word, alias);
    if (dist <= max && (!best || dist < best.dist)) best = { alias, dist };
  }
  if (!best) return null;
  const city = CITY_ALIASES[best.alias] || best.alias;
  return `${best.alias} → ${city[0].toUpperCase()}${city.slice(1)}`;
}

/**
 * Re-resolve "unknown" lines in rides.jsonl using the saved texts (matched on t),
 * after new aliases were added. Returns [newRidesContent, fixedCount].
 */
export function backfill(ridesContent, unknownContent) {
  const cityAt = new Map();
  for (const line of unknownContent.split("\n")) {
    let r; try { r = JSON.parse(line); } catch { continue; }
    const city = extractPickupCity(r.text, ALL_CITIES);
    if (city) cityAt.set(r.t, city);
  }
  let fixed = 0;
  const out = ridesContent.split("\n").map((line) => {
    if (!line.includes('"unknown"')) return line;
    let r; try { r = JSON.parse(line); } catch { return line; }
    const city = cityAt.get(r.t);
    if (!city) return line;
    fixed++;
    return JSON.stringify({ ...r, city });
  });
  return [out.join("\n"), fixed];
}

function main() {
  const arg = (name, def) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 ? process.argv[i + 1] : def;
  };
  const bot = arg("bot", "bot-taxi");
  const days = Number(arg("days", 3));
  const top = Number(arg("top", 40));
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const file = join(root, "bots", bot, "unknown-cities.jsonl");
  if (!existsSync(file)) {
    console.log(`No ${file} yet — it fills as the bot forwards rides without a city.`);
    return;
  }

  if (process.argv.includes("--backfill")) {
    const ridesFile = join(root, "bots", bot, "rides.jsonl");
    const before = readFileSync(ridesFile, "utf8");
    const [after, fixed] = backfill(before, readFileSync(file, "utf8"));
    // ponytail: the bot appends while we work; keep any lines it added since the read
    const tail = readFileSync(ridesFile, "utf8").slice(before.length);
    writeFileSync(ridesFile + ".tmp", after + tail);
    renameSync(ridesFile + ".tmp", ridesFile);
    console.log(`Backfilled ${fixed} "unknown" rides in ${ridesFile}`);
    return;
  }

  const since = Date.now() - days * 86_400_000;
  const counts = new Map();
  let rides = 0;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (r.t < since) continue;
    rides++;
    for (const w of candidates(r.text)) {
      const e = counts.get(w) || { n: 0, example: r.text };
      e.n++;
      counts.set(w, e);
    }
  }

  console.log(`${rides} no-city rides in the last ${days} day(s) — top ${top} unknown words:\n`);
  const rows = [...counts.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, top);
  for (const [w, { n, example }] of rows) {
    const hint = nearest(w);
    console.log(`${String(n).padStart(4)}  ${w.padEnd(18)} ${hint ? `nearest: ${hint}` : "(new place?)"}`);
    console.log(`        e.g. ${example.replace(/\s+/g, " ").slice(0, 110)}`);
  }
}

// exit explicitly: globalConfig.js keeps a watchFile timer alive
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { main(); process.exit(0); }
