/**
 * One-shot merge of a peer's block list into this server's blocked-data.json.
 * Use it once per VPS to converge two lists that drifted apart; after that the
 * panels mirror every write to each other automatically.
 *
 *   node scripts/sync-blocked-data.js <peer-name-from-peers.json>
 *   node scripts/sync-blocked-data.js <peer-url> <peer-admin-token>
 *
 * The first form reuses control-panel/peers.json (including any Cloudflare
 * Access headers), so there is one place to get the config right.
 *
 * Union only — nothing is ever deleted. Run it on BOTH servers (each pointing at
 * the other) and the two files end up identical.
 */
import { readFileSync, existsSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { readData, writeData } from "../core/blockData.js";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const [target, tokenArg] = process.argv.slice(2);
if (!target) {
  console.error("usage: node scripts/sync-blocked-data.js <peer-name> | <peer-url> <peer-admin-token>");
  process.exit(1);
}

// Resolve the peer from peers.json when given a name (or when the URL matches one).
const peersPath = join(ROOT, "control-panel", "peers.json");
const peers = existsSync(peersPath) ? JSON.parse(readFileSync(peersPath, "utf8")) : [];
const peer =
  peers.find((p) => p.name === target) ||
  peers.find((p) => String(p.url).replace(/\/$/, "") === String(target).replace(/\/$/, "")) ||
  (tokenArg ? { name: target, url: target, token: tokenArg } : null);

if (!peer) {
  console.error(`no peer "${target}" in control-panel/peers.json, and no token given`);
  console.error(peers.length ? `known peers: ${peers.map((p) => p.name).join(", ")}` : "peers.json is empty or missing");
  process.exit(1);
}

const base = String(peer.url).replace(/\/$/, "");
const headers = { "x-token": peer.token, ...(peer.headers || {}) };

async function get(path) {
  const r = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(15000) });
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  if (!body) {
    console.error(`${path}: peer replied with a web page, not the panel API`);
    console.error("An auth proxy (Cloudflare Access) is in front of it — add a service token under \"headers\" in peers.json.");
    process.exit(1);
  }
  if (!r.ok) {
    console.error(`${path}: HTTP ${r.status}${body.error ? ` — ${body.error}` : ""}`);
    process.exit(1);
  }
  return body;
}

// Identify both ends first — a peers.json pointing back at this same server
// merges a file with itself and looks like success.
const localBots = require("../ecosystem.config.cjs").apps
  .filter((a) => typeof a.script === "string" && a.script.includes("bots/"))
  .map((a) => a.name);
const peerBots = ((await get("/api/bots")).bots || []).map((b) => b.id);

console.log(`this server runs: ${localBots.join(", ") || "?"}`);
console.log(`peer  "${peer.name}" runs: ${peerBots.join(", ") || "?"}`);
if (peerBots.length && peerBots.join() === localBots.join()) {
  console.error(`\n❌ ${base} IS this server — point it at the other VPS's panel instead.`);
  process.exit(1);
}

const { data: peerData } = await get("/api/block/list");
if (!peerData) {
  console.error("peer sent counts only — that token is not an admin token");
  process.exit(1);
}

const local = readData();
let added = 0;
for (const field of ["blockedPhoneNumbers", "blockedSenders", "ignoreIfContains"]) {
  const before = new Set(local[field]);
  for (const v of peerData[field] || []) if (!before.has(v)) { local[field].push(v); added++; }
  console.log(`${field}: ${before.size} local + ${(peerData[field] || []).length} peer -> ${local[field].length}`);
}
if (added) writeData(local);
console.log(added ? `✅ merged ${added} new entries` : "✅ already in sync");
process.exit(0);
