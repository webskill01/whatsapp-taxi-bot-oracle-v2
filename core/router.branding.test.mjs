// Self-check for fleet branding. Run: node core/router.branding.test.mjs
//
// multibot forwards this bot's output back into groups it watches, so the stamp
// must be swapped for ours, never stacked on top.
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { applyBranding, stripBranding } from "./router.js";
import { getMessageFingerprint } from "./filter.js";
import { GLOBAL_CONFIG } from "./globalConfig.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(
  fs.readFileSync(path.join(here, "..", "bots", "bot-taxi", "config.json"), "utf8")
);
const KNOWN = GLOBAL_CONFIG.knownBrandings;
const own = cfg.brandingSuffixes;
const ride = "Delhi to Noida\nSedan needed\n9876543210";
const count = (t, vs) => vs.reduce((n, v) => n + t.split(v).length - 1, 0);

// 1. Drift guard: our stamps must be registered, or multibot cannot strip them.
for (const v of own) {
  assert.ok(KNOWN.includes(v), `"${v}" missing from GLOBAL_CONFIG.knownBrandings`);
}

// 2. No variant may be a suffix of another, or peeling leaves debris.
for (const a of KNOWN) {
  for (const b of KNOWN) {
    assert.ok(a === b || !a.endsWith(b), `"${a}" ends with "${b}"`);
  }
}

// 3. A ride wearing ANY fleet stamp comes out wearing exactly one - ours.
for (const incoming of KNOWN) {
  const out = applyBranding(`${ride}\n\n${incoming}`, cfg);
  assert.strictEqual(count(out, KNOWN), 1, "exactly one stamp");
  assert.ok(own.some((v) => out.endsWith(v)), "must be our own stamp");
  assert.ok(out.startsWith(ride), "ride text preserved");
}

// 4. Re-branding in a loop never stacks.
let msg = ride;
for (let i = 0; i < 10; i++) msg = applyBranding(msg, cfg);
assert.strictEqual(count(msg, KNOWN), 1, "re-brand loop must stay at 1 stamp");

// 5. The dedup bug this prevents: the same ride wearing different stamps must
//    fingerprint identically once stripped, or it forwards once per variant.
const fps = new Set(
  KNOWN.map((v) => getMessageFingerprint(stripBranding(`${ride}\n\n${v}`, KNOWN), null, 1))
);
assert.strictEqual(fps.size, 1, "stripped variants must share one fingerprint");

const raw = new Set(KNOWN.map((v) => getMessageFingerprint(`${ride}\n\n${v}`, null, 1)));
assert.ok(raw.size > 1, "unstripped variants should differ (else test is vacuous)");

// 6. No branding configured -> strip only, never append.
assert.strictEqual(applyBranding(`${ride}\n\n${KNOWN[0]}`, { brandingSuffixes: [] }), ride);

console.log(
  `✅ fleet branding: ${own.length} own stamps, ${KNOWN.length} registered, all checks passed`
);

// globalConfig watchFile()s its data file, which holds the event loop open.
process.exit(0);
