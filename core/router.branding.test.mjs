// Self-check for idempotent branding. Run: node core/router.branding.test.mjs
import assert from "assert";
import { applyBranding } from "./router.js";

const config = {
  brandingSuffixes: [
    "- 🚨 Forwarded Duty 🚨",
    "- 📢 Forward Duty 📢",
    "- 🚨 Forwarded ਡਿਊਟੀ 🚨",
  ],
};

const ride = "Delhi to Noida\nSedan needed\n9876543210";

const countSuffixes = (t) =>
  config.brandingSuffixes.reduce(
    (n, v) => n + t.split(v).length - 1,
    0
  );

// 1. Fresh message → exactly one suffix.
let msg = applyBranding(ride, config);
assert.strictEqual(countSuffixes(msg), 1, "fresh should have 1 suffix");

// 2. Re-branding 10x (message loops back through the pipeline) → still exactly one.
for (let i = 0; i < 10; i++) msg = applyBranding(msg, config);
assert.strictEqual(countSuffixes(msg), 1, "re-brand loop must stay at 1 suffix");
assert.ok(msg.startsWith(ride), "original ride text preserved");

// 3. Already-stacked garbage (5 suffixes) collapses to one.
const stacked =
  ride +
  "\n\n" + config.brandingSuffixes[0] +
  "\n\n" + config.brandingSuffixes[1] +
  "\n\n" + config.brandingSuffixes[0] +
  "\n\n" + config.brandingSuffixes[2] +
  "\n\n" + config.brandingSuffixes[1];
assert.strictEqual(countSuffixes(stacked), 5, "sanity: input has 5");
assert.strictEqual(countSuffixes(applyBranding(stacked, config)), 1, "stacked collapses to 1");

// 4. No branding configured → text untouched.
assert.strictEqual(applyBranding(ride, { brandingSuffixes: [] }), ride);

console.log("✅ branding idempotency: all checks passed");
