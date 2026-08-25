/**
 * ============================================================================
 * control-panel/server.js — admin + scoped-friend control dashboard
 * ============================================================================
 * A SEPARATE PM2 process (not inside any bot) that owns all control ACTIONS:
 *   • PM2 restart / stop / reset-auth for each bot
 *   • Pause / resume forwarding + disable a target group (writes runtime.json)
 *   • Dedup-safe blocked-number / ignore-phrase submission (hot-reloaded by bots)
 *   • Read-only Groups / Stats / QR views (proxied from each bot's own stats port)
 *
 * ACCESS (per the agreed model):
 *   • ADMIN token  → every bot + destructive ops (remove from block list, etc.)
 *   • Per-bot FRIEND token → ONLY their bot: restart, reset+QR, pause/resume,
 *     disable target, and (append-only) submit block numbers.
 * Tokens live in control-panel/tokens.json (gitignored, auto-generated on first
 * run). Put this whole panel behind your cf-tunnel with access auth.
 *
 * Bots are auto-discovered from ecosystem.config.cjs — names, dirs, and
 * STATS_PORTs are never hardcoded here.
 * ============================================================================
 */

import express from "express";
import { exec } from "child_process";
import { promisify } from "util";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import {
  dirname, join, resolve, basename,
} from "path";
import {
  existsSync, readFileSync, writeFileSync, rmSync, readdirSync, appendFileSync,
} from "fs";
import { randomBytes } from "crypto";

import {
  readData, writeData, addNumbersToField, addIgnorePhrase, checkNumber,
} from "../core/blockData.js";
import { validateGroupFields } from "../core/configLoader.js";
import { CITY_ALIASES } from "../core/cityAliases.merged.js";

// Canonical city names the routing engine understands. A city target group is
// only useful if its key matches one of these — otherwise extractPickupCity()
// can never return it and the group silently receives nothing.
const CANONICAL_CITIES = [...new Set(Object.values(CITY_ALIASES))].sort();

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

const PORT = parseInt(process.env.CONTROL_PORT || "3000", 10);
const TOKENS_PATH = join(__dirname, "tokens.json");
const AUDIT_PATH = join(__dirname, "audit.log");

// ============================================================================
// BOT DISCOVERY — read the PM2 manifest so the panel always matches reality
// ============================================================================
function discoverBots() {
  const ecosystem = require("../ecosystem.config.cjs");
  return ecosystem.apps
    .filter((a) => typeof a.script === "string" && a.script.includes("bots/"))
    .map((a) => ({
      id: a.name,                                   // pm2 process name
      dir: resolve(ROOT, dirname(a.script)),        // bots/bot-x absolute dir
      statsPort: parseInt(a.env?.STATS_PORT || "0", 10),
    }));
}
const BOTS = discoverBots();
const BOT_IDS = new Set(BOTS.map((b) => b.id));
const botById = (id) => BOTS.find((b) => b.id === id);

// ============================================================================
// TOKENS — load or generate. Admin token + one token per bot.
// ============================================================================
function loadOrCreateTokens() {
  if (existsSync(TOKENS_PATH)) {
    return JSON.parse(readFileSync(TOKENS_PATH, "utf8"));
  }
  const tokens = {
    admin: randomBytes(24).toString("hex"),
    bots: {},
  };
  for (const b of BOTS) tokens.bots[b.id] = randomBytes(16).toString("hex");
  writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2) + "\n", "utf8");
  return tokens;
}
const TOKENS = loadOrCreateTokens();
// Reverse lookup: token -> { role:'admin' } | { role:'friend', botId }
const tokenMap = new Map();
tokenMap.set(TOKENS.admin, { role: "admin" });
for (const [botId, tok] of Object.entries(TOKENS.bots || {})) {
  if (BOT_IDS.has(botId)) tokenMap.set(tok, { role: "friend", botId });
}

function audit(who, action, detail = "") {
  const line = `${new Date().toISOString()} | ${who} | ${action} | ${detail}\n`;
  try { appendFileSync(AUDIT_PATH, line); } catch { /* non-fatal */ }
}

// ============================================================================
// EXPRESS
// ============================================================================
const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, "public")));

// Resolve token (query ?token= or x-token header) into req.auth.
app.use((req, res, next) => {
  const token = req.query.token || req.headers["x-token"] || "";
  req.auth = tokenMap.get(String(token)) || null;
  next();
});

function requireAuth(req, res, next) {
  if (!req.auth) return res.status(401).json({ error: "Invalid or missing token" });
  next();
}
function requireAdmin(req, res, next) {
  if (req.auth?.role !== "admin") return res.status(403).json({ error: "Admin only" });
  next();
}
// Ensure the caller may act on :id (admin = any, friend = only their bot).
function scopeToBot(req, res, next) {
  const id = req.params.id;
  if (!BOT_IDS.has(id)) return res.status(404).json({ error: "Unknown bot" });
  if (req.auth.role === "admin" || req.auth.botId === id) return next();
  return res.status(403).json({ error: "Not your bot" });
}
const who = (req) => (req.auth.role === "admin" ? "admin" : `friend:${req.auth.botId}`);

// ── PM2 helpers (bot id is validated against BOT_IDS, so safe to interpolate) ──
async function pm2(action, id) {
  await execAsync(`pm2 ${action} ${id}`, { cwd: ROOT });
}
// Stop and CONFIRM via pm2 jlist — pm2 stop's exit code is unreliable
// (Windows writes "^C" and exits non-zero even on success).
async function pm2StopAndWait(id, timeoutMs = 10000) {
  try { await pm2("stop", id); } catch { /* verify below */ }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const map = await pm2StatusMap();
    if (!map[id] || map[id].status === "stopped") return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
async function pm2StatusMap() {
  try {
    const { stdout } = await execAsync("pm2 jlist", { cwd: ROOT });
    const list = JSON.parse(stdout);
    const map = {};
    for (const p of list) {
      map[p.name] = {
        status: p.pm2_env?.status || "unknown",
        uptime: p.pm2_env?.pm_uptime || null,
        restarts: p.pm2_env?.restart_time ?? null,
        cpu: p.monit?.cpu ?? null,
        memory: p.monit?.memory ?? null,
      };
    }
    return map;
  } catch {
    return {};
  }
}
function readRuntime(dir) {
  const f = join(dir, "runtime.json");
  try {
    if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  } catch { /* ignore */ }
  return { paused: false, disabledTargets: [] };
}
function writeRuntime(dir, state) {
  writeFileSync(join(dir, "runtime.json"), JSON.stringify(state, null, 2) + "\n", "utf8");
}

// ============================================================================
// ROUTES — status
// ============================================================================
app.get("/api/me", requireAuth, (req, res) => {
  res.json({ role: req.auth.role, botId: req.auth.botId || null });
});

app.get("/api/bots", requireAuth, async (req, res) => {
  const status = await pm2StatusMap();
  const visible = req.auth.role === "admin"
    ? BOTS
    : BOTS.filter((b) => b.id === req.auth.botId);
  res.json({
    role: req.auth.role,
    bots: visible.map((b) => ({
      id: b.id,
      statsPort: b.statsPort,
      pm2: status[b.id] || { status: "unknown" },
      runtime: readRuntime(b.dir),
    })),
  });
});

// ============================================================================
// ROUTES — per-bot control (scoped)
// ============================================================================
app.post("/api/bot/:id/restart", requireAuth, scopeToBot, async (req, res) => {
  try {
    await pm2("restart", req.params.id);
    audit(who(req), "restart", req.params.id);
    res.json({ ok: true, message: `${req.params.id} restarting` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stop the bot process (stays in the PM2 list, just not running). Use Restart
// to bring it back online — `pm2 restart` starts a stopped process.
app.post("/api/bot/:id/stop", requireAuth, scopeToBot, async (req, res) => {
  try {
    const stopped = await pm2StopAndWait(req.params.id);
    audit(who(req), "stop", req.params.id);
    res.json({ ok: true, message: stopped ? `${req.params.id} stopped`
                                          : `${req.params.id} stop requested (still shutting down)` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset auth — the safe corruption-recovery sequence a friend should follow:
//   1. pm2 stop <bot>          (kill the process so files aren't held open)
//   2. wait 1.5s               (let Windows/Linux release the file handles)
//   3. delete baileys_auth/    (the corrupted WhatsApp session)
//   4. delete fingerprints_*.json + .forwarded-messages.json (dedup cache)
//   5. pm2 start <bot>         (fresh boot → emits a new QR to scan)
// We deliberately STOP-then-clear-then-START rather than wiping a live process,
// so the bot never reads a half-deleted auth dir. runtime.json (pause/disabled
// prefs) is kept — a reset is about WhatsApp auth only, not the friend's settings.
app.post("/api/bot/:id/reset", requireAuth, scopeToBot, async (req, res) => {
  const bot = botById(req.params.id);
  try {
    const stopped = await pm2StopAndWait(bot.id);
    if (!stopped) throw new Error("Bot did not stop in time — try Reset again");
    await new Promise((r) => setTimeout(r, 800)); // let file handles release

    const authDir = join(bot.dir, "baileys_auth");
    for (let i = 0; existsSync(authDir) && i < 6; i++) {
      try { rmSync(authDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }); }
      catch { await new Promise((r) => setTimeout(r, 500)); }
    }
    if (existsSync(authDir)) throw new Error("Could not delete baileys_auth (file locked) — try Reset again");
    for (const f of readdirSync(bot.dir)) {
      if (f.startsWith("fingerprints_") || f === ".forwarded-messages.json") {
        rmSync(join(bot.dir, f), { force: true });
      }
    }

    await pm2("start", bot.id);
    audit(who(req), "reset-auth", bot.id);
    res.json({ ok: true, message: `${bot.id} auth wiped — scan the new QR to re-pair` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/bot/:id/pause", requireAuth, scopeToBot, (req, res) => {
  const bot = botById(req.params.id);
  const paused = req.body?.paused === true;
  const state = readRuntime(bot.dir);
  state.paused = paused;
  writeRuntime(bot.dir, state);
  audit(who(req), paused ? "pause" : "resume", bot.id);
  res.json({ ok: true, paused });
});

// Disable/enable a single target group (e.g. a friend's trial group)
app.post("/api/bot/:id/target", requireAuth, scopeToBot, (req, res) => {
  const bot = botById(req.params.id);
  const groupId = String(req.body?.groupId || "");
  const disabled = req.body?.disabled === true;
  if (!groupId.endsWith("@g.us")) {
    return res.status(400).json({ error: "groupId must end with @g.us" });
  }
  const state = readRuntime(bot.dir);
  const set = new Set(state.disabledTargets || []);
  if (disabled) set.add(groupId); else set.delete(groupId);
  state.disabledTargets = [...set];
  writeRuntime(bot.dir, state);
  audit(who(req), disabled ? "disable-target" : "enable-target", `${bot.id} ${groupId}`);
  res.json({ ok: true, disabledTargets: state.disabledTargets });
});

// ── Read-only proxies to the bot's own stats server (QR / groups / stats) ──
async function proxyBot(bot, path, res, asJson = true) {
  try {
    const r = await fetch(`http://127.0.0.1:${bot.statsPort}${path}`);
    if (asJson) {
      res.status(r.status).json(await r.json());
    } else {
      res.status(r.status).send(await r.text());
    }
  } catch (err) {
    res.status(503).json({ error: `Bot ${bot.id} unreachable: ${err.message}` });
  }
}
app.get("/api/bot/:id/qr", requireAuth, scopeToBot, (req, res) =>
  proxyBot(botById(req.params.id), "/qr/base64", res));
app.get("/api/bot/:id/groups", requireAuth, scopeToBot, (req, res) =>
  proxyBot(botById(req.params.id), "/groups", res));
app.get("/api/bot/:id/stats", requireAuth, scopeToBot, (req, res) =>
  proxyBot(botById(req.params.id), "/stats", res));

// ── Ride analytics — read the bot's append-only rides.jsonl, aggregate by city ──
const PERIOD_MS = { day: 86400000, week: 604800000, month: 2592000000, all: 0 };
function aggregateRides(dir, period) {
  const file = join(dir, "rides.jsonl");
  const out = { period, total: 0, byCity: {} };
  if (!existsSync(file)) return out;
  const since = PERIOD_MS[period] ? Date.now() - PERIOD_MS[period] : 0;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (r.t < since) continue;
    out.total++;
    out.byCity[r.city] = (out.byCity[r.city] || 0) + 1;
  }
  return out;
}
app.get("/api/bot/:id/analytics", requireAuth, scopeToBot, (req, res) => {
  const period = PERIOD_MS[req.query.period] !== undefined ? req.query.period : "day";
  try { res.json({ ok: true, ...aggregateRides(botById(req.params.id).dir, period) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.post("/api/bot/:id/analytics/reset", requireAuth, scopeToBot, (req, res) => {
  try {
    writeFileSync(join(botById(req.params.id).dir, "rides.jsonl"), "", "utf8");
    audit(who(req), "analytics-reset", req.params.id);
    res.json({ ok: true, message: "Ride counts cleared" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================================
// ROUTES — live group config (ADMIN only)
// ============================================================================
// Adding a group used to mean: edit config.json → commit → push → pull on the VM
// → pm2 restart. The bot now watches its own config.json (see watchConfigGroups
// in core/configLoader.js), so writing the file here is enough — routing picks
// the change up in ~1.3s with no restart and no QR re-scan.
function botConfigPath(dir) { return join(dir, "config.json"); }
function readBotConfig(dir)  { return JSON.parse(readFileSync(botConfigPath(dir), "utf8")); }
function writeBotConfig(dir, cfg) {
  writeFileSync(botConfigPath(dir), JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

// A group may hold exactly ONE role. Source+target on the same group is a
// forwarding loop, so adds are refused when the group is already configured.
function currentRole(cfg, groupId) {
  if (cfg.sourceGroupIds.includes(groupId)) return "source";
  if (cfg.paidCommonGroupId.includes(groupId)) return "paid";
  if (cfg.freeCommonGroupId === groupId) return "free common";
  const city = Object.keys(cfg.cityTargetGroups).find((c) => cfg.cityTargetGroups[c] === groupId);
  return city ? `city (${city})` : null;
}

app.get("/api/bot/:id/config", requireAuth, requireAdmin, scopeToBot, (req, res) => {
  try {
    const cfg = readBotConfig(botById(req.params.id).dir);
    res.json({
      ok: true,
      sourceGroupIds:    cfg.sourceGroupIds,
      paidCommonGroupId: cfg.paidCommonGroupId,
      freeCommonGroupId: cfg.freeCommonGroupId,
      cityTargetGroups:  cfg.cityTargetGroups,
      cities:            CANONICAL_CITIES,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// { action:"add"|"remove", role:"source"|"paid"|"city", groupId, city? }
app.post("/api/bot/:id/config/group", requireAuth, requireAdmin, scopeToBot, (req, res) => {
  const bot = botById(req.params.id);
  const action  = String(req.body?.action || "");
  const role    = String(req.body?.role || "");
  const groupId = String(req.body?.groupId || "").trim();
  const city    = String(req.body?.city || "").trim();

  if (!["add", "remove"].includes(action)) return res.status(400).json({ error: "action must be add or remove" });
  if (!["source", "paid", "city"].includes(role)) return res.status(400).json({ error: "role must be source, paid or city" });
  if (!groupId.endsWith("@g.us")) return res.status(400).json({ error: "groupId must end with @g.us" });

  try {
    const cfg = readBotConfig(bot.dir);
    let message;

    if (action === "add") {
      const held = currentRole(cfg, groupId);
      if (held) return res.status(400).json({ error: `Already configured as ${held} — remove it first` });

      if (role === "source") {
        cfg.sourceGroupIds.push(groupId);
        message = `Added as source (${cfg.sourceGroupIds.length} total)`;
      } else if (role === "paid") {
        cfg.paidCommonGroupId.push(groupId);
        message = `Added as paid group (${cfg.paidCommonGroupId.length} total)`;
      } else {
        if (!CANONICAL_CITIES.includes(city)) {
          return res.status(400).json({ error: `Unknown city "${city}" — pick one the router recognises` });
        }
        if (cfg.cityTargetGroups[city]) {
          return res.status(400).json({ error: `${city} already routes to another group — remove that one first` });
        }
        cfg.cityTargetGroups[city] = groupId;
        message = `Added as city group for ${city}`;
      }
    } else {
      if (role === "source") {
        const n = cfg.sourceGroupIds.length;
        cfg.sourceGroupIds = cfg.sourceGroupIds.filter((g) => g !== groupId);
        if (cfg.sourceGroupIds.length === n) return res.status(404).json({ error: "Not a source group" });
        message = `Removed from sources (${cfg.sourceGroupIds.length} left)`;
      } else if (role === "paid") {
        if (!cfg.paidCommonGroupId.includes(groupId)) return res.status(404).json({ error: "Not a paid group" });
        if (cfg.paidCommonGroupId.length === 1) {
          return res.status(400).json({ error: "Can't remove the last paid group — the bot needs at least one" });
        }
        cfg.paidCommonGroupId = cfg.paidCommonGroupId.filter((g) => g !== groupId);
        message = `Removed from paid groups (${cfg.paidCommonGroupId.length} left)`;
      } else {
        const key = Object.keys(cfg.cityTargetGroups).find((c) => cfg.cityTargetGroups[c] === groupId);
        if (!key) return res.status(404).json({ error: "Not a city group" });
        if (Object.keys(cfg.cityTargetGroups).length === 1) {
          return res.status(400).json({ error: "Can't remove the last city group — the bot needs at least one" });
        }
        delete cfg.cityTargetGroups[key];
        message = `Removed city group ${key}`;
      }
    }

    // Same validator the bot uses, so the panel can never write a config that
    // the running bot would reject (or that would kill it on the next restart).
    const errs = validateGroupFields(cfg);
    if (errs.length) return res.status(400).json({ error: errs.join("; ") });

    writeBotConfig(bot.dir, cfg);
    audit(who(req), `config-${action}-${role}`, `${bot.id} ${groupId}${city ? " " + city : ""}`);
    res.json({ ok: true, message: message + " — live in a couple of seconds" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// PEER MIRRORING — keep the block list identical across VPSs
// ============================================================================
// The two deployments live on different servers with their own blocked-data.json.
// Rather than syncing files, every block-list WRITE is replayed to each peer's
// panel through the same authenticated API this one exposes. Peers are listed in
// control-panel/peers.json (gitignored, read per request so edits need no
// restart):  [{ "name": "multibot", "url": "https://...", "token": "<their admin token>" }]
//
// The x-mirror header stops the replay from bouncing back. A peer that is down
// simply does not receive that entry — the response says so, and you re-submit.
// ponytail: fire-and-report, no retry queue. Add one only if peers are flaky.
const PEERS_PATH = join(__dirname, "peers.json");

function loadPeers() {
  try {
    return existsSync(PEERS_PATH) ? JSON.parse(readFileSync(PEERS_PATH, "utf8")) : [];
  } catch (err) {
    console.error(`peers.json unreadable — mirroring disabled: ${err.message}`);
    return [];
  }
}

// An auth proxy in front of a peer (Cloudflare Access, a login gate) answers with
// a 200 and an HTML page, so a 2xx alone proves nothing — the body has to be this
// API's JSON. Peers behind Access need a service token, which goes in their
// peers.json entry as "headers": { "CF-Access-Client-Id": "...", "CF-Access-Client-Secret": "..." }.
function peerHeaders(peer, extra) {
  return { "x-token": peer.token, ...(peer.headers || {}), ...extra };
}

async function peerJson(r) {
  try { return JSON.parse(await r.text()); } catch { return null; }
}

const NOT_THE_API = "not the panel API (got a web page — auth proxy in front?)";

async function mirror(req, path, body) {
  if (req.headers["x-mirror"]) return [];        // this write already IS a mirror
  const peers = loadPeers();
  if (!peers.length) return [];
  return Promise.all(peers.map(async (peer) => {
    try {
      const r = await fetch(`${String(peer.url).replace(/\/$/, "")}${path}`, {
        method: "POST",
        headers: peerHeaders(peer, { "Content-Type": "application/json", "x-mirror": "1" }),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      const reply = await peerJson(r);
      if (!r.ok) {
        return { peer: peer.name, ok: false, error: reply?.error || (r.status === 401 ? "token rejected" : `HTTP ${r.status}`) };
      }
      if (!reply) return { peer: peer.name, ok: false, error: NOT_THE_API };
      return { peer: peer.name, ok: reply.ok === true, status: r.status };
    } catch (err) {
      return { peer: peer.name, ok: false, error: err.message };
    }
  }));
}

// Setup check: can we actually reach each peer, and is its token an ADMIN one?
// A friend token is enough to ADD entries but not to remove them, so the answer
// matters — it is reported per peer instead of failing silently at 3am.
app.get("/api/peers", requireAuth, requireAdmin, async (req, res) => {
  const peers = loadPeers();
  const checked = await Promise.all(peers.map(async (peer) => {
    const base = String(peer.url || "").replace(/\/$/, "");
    try {
      const r = await fetch(`${base}/api/block/list`, {
        headers: peerHeaders(peer),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) {
        return { name: peer.name, ok: false, error: r.status === 401 ? "token rejected" : `HTTP ${r.status}` };
      }
      const body = await peerJson(r);
      if (!body) return { name: peer.name, ok: false, error: NOT_THE_API };
      if (!body.counts) return { name: peer.name, ok: false, error: "unexpected response from peer" };
      return { name: peer.name, ok: true, admin: !!body.data, counts: body.counts };
    } catch (err) {
      return { name: peer.name, ok: false, error: err.message };
    }
  }));
  const local = readData();
  res.json({
    ok: true,
    peers: checked,
    local: {
      blockedPhoneNumbers: local.blockedPhoneNumbers.length,
      blockedSenders: local.blockedSenders.length,
      ignoreIfContains: local.ignoreIfContains.length,
    },
  });
});

// ============================================================================
// ROUTES — shared block list (append-only for friends, full control for admin)
// ============================================================================
app.post("/api/block/number", requireAuth, async (req, res) => {
  try {
    const data = readData();
    const report = addNumbersToField(data, "blockedPhoneNumbers", req.body?.input || "");
    if (report.added.length) writeData(data);
    audit(who(req), "block-number", report.added.join(",") || "(none)");
    const peers = await mirror(req, "/api/block/number", { input: req.body?.input || "" });
    res.json({ ok: true, ...report, peers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/block/sender", requireAuth, async (req, res) => {
  try {
    const data = readData();
    const report = addNumbersToField(data, "blockedSenders", req.body?.input || "");
    if (report.added.length) writeData(data);
    audit(who(req), "block-sender", report.added.join(",") || "(none)");
    const peers = await mirror(req, "/api/block/sender", { input: req.body?.input || "" });
    res.json({ ok: true, ...report, peers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/block/ignore", requireAuth, async (req, res) => {
  try {
    const data = readData();
    const report = addIgnorePhrase(data, req.body?.phrase || "");
    if (report.added) writeData(data);
    audit(who(req), "block-ignore", report.phrase || "(none)");
    const peers = await mirror(req, "/api/block/ignore", { phrase: req.body?.phrase || "" });
    res.json({ ok: true, ...report, peers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/block/check", requireAuth, (req, res) => {
  try {
    const result = checkNumber(readData(), req.query.number || "");
    if (!result) return res.status(400).json({ error: "Provide exactly one valid number" });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/block/list", requireAuth, (req, res) => {
  try {
    const data = readData();
    const counts = {
      blockedPhoneNumbers: data.blockedPhoneNumbers.length,
      blockedSenders: data.blockedSenders.length,
      ignoreIfContains: data.ignoreIfContains.length,
    };
    // Friends get counts only; admin gets the full lists for management.
    if (req.auth.role !== "admin") return res.json({ counts });
    res.json({ counts, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// Remove an entry — ADMIN only (friends are append-only).
app.post("/api/block/remove", requireAuth, requireAdmin, async (req, res) => {
  try {
    const field = req.body?.field;
    const value = String(req.body?.value || "");
    if (!["blockedPhoneNumbers", "blockedSenders", "ignoreIfContains"].includes(field)) {
      return res.status(400).json({ error: "Invalid field" });
    }
    const data = readData();
    const before = data[field].length;
    data[field] = data[field].filter((v) => v !== value);
    const removed = before - data[field].length;
    if (removed) writeData(data);
    audit("admin", "block-remove", `${field}:${value}`);
    const peers = await mirror(req, "/api/block/remove", { field, value });
    res.json({ ok: true, removed, peers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// BOOT
// ============================================================================
app.listen(PORT, "0.0.0.0", () => {
  console.log("============================================================");
  console.log(`🎛️  Control panel listening on http://0.0.0.0:${PORT}`);
  console.log(`   Managed bots: ${BOTS.map((b) => b.id).join(", ")}`);
  console.log("------------------------------------------------------------");
  console.log(`   ADMIN  : /admin.html?token=${TOKENS.admin}`);
  for (const b of BOTS) {
    console.log(`   ${b.id.padEnd(12)} : /friend.html?token=${TOKENS.bots[b.id]}`);
  }
  console.log("   (tokens saved in control-panel/tokens.json — keep private)");
  console.log("============================================================");
});
