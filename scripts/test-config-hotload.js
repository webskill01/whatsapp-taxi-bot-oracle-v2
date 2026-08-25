/**
 * Self-check for live config group edits. Run on the VM (needs node_modules):
 *   node scripts/test-config-hotload.js
 * Exits non-zero if hot-reload or validation breaks.
 */
import assert from "assert";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { validateGroupFields, watchConfigGroups } from "../core/configLoader.js";

const G = (n) => `12036300000000000${n}@g.us`;
const base = {
  botPhone: "910000000000",
  sourceGroupIds: [G(1)],
  freeCommonGroupId: G(2),
  paidCommonGroupId: [G(3)],
  cityTargetGroups: { Delhi: G(4) },
};

// ── validator ──
assert.deepStrictEqual(validateGroupFields(base), []);
assert.ok(validateGroupFields({ ...base, paidCommonGroupId: [] }).length, "empty paid list must fail");
assert.ok(validateGroupFields({ ...base, sourceGroupIds: ["nope"] }).length, "bad group id must fail");
assert.ok(validateGroupFields({ ...base, cityTargetGroups: {} }).length, "empty city map must fail");

// ── hot reload ──
const dir = mkdtempSync(join(tmpdir(), "cfg-hotload-"));
const file = join(dir, "config.json");
const write = (o) => writeFileSync(file, JSON.stringify(o, null, 2), "utf8");
write(base);

const live = { ...base, botDir: dir, configuredCities: ["Delhi"] };
const log = { info: () => {}, warn: () => {} };
watchConfigGroups(live, log);

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  // add a source group + a city → picked up without restart
  write({ ...base, sourceGroupIds: [G(1), G(5)], cityTargetGroups: { Delhi: G(4), Noida: G(6) } });
  await settle(2500);
  assert.deepStrictEqual(live.sourceGroupIds, [G(1), G(5)], "source group not hot-loaded");
  assert.deepStrictEqual(live.configuredCities, ["Delhi", "Noida"], "city not hot-loaded");

  // a broken edit must be ignored, not applied and not thrown
  writeFileSync(file, "{ not json", "utf8");
  await settle(2500);
  assert.deepStrictEqual(live.sourceGroupIds, [G(1), G(5)], "broken config must keep previous groups");

  // an invalid-but-parsable edit must also be ignored
  write({ ...base, paidCommonGroupId: [] });
  await settle(2500);
  assert.deepStrictEqual(live.paidCommonGroupId, [G(3)], "invalid config must keep previous groups");

  console.log("✅ config hot-load self-check passed");
} finally {
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}
