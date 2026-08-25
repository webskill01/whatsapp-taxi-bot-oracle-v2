/**
 * Guards the regression that made real forwards fail: a burst of groupMetadata
 * calls from /groups exhausting the rate budget shared with message sending.
 *   node scripts/test-name-throttle.js
 */
import assert from "assert";
import { metadataThrottled } from "../core/index.js";

const log = { info: () => {}, warn: () => {} };
let calls = 0;

// A socket that always reports the rate limit WhatsApp sends under pressure.
const angrySock = {
  groupMetadata: async () => { calls++; throw new Error("rate-overlimit"); },
};

const first = await metadataThrottled(angrySock, "1@g.us", log);
assert.strictEqual(first, null, "a rate-limited lookup must return null, not throw");
assert.strictEqual(calls, 1);

// After the first rate-overlimit the whole process must stop asking for a while.
for (let i = 0; i < 5; i++) {
  assert.strictEqual(await metadataThrottled(angrySock, `${i}@g.us`, log), null);
}
assert.strictEqual(calls, 1, `backoff broken — sock was called ${calls} times after a rate limit`);

console.log("✅ name-lookup throttle self-check passed");
process.exit(0);
