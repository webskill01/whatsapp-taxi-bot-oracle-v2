// Self-check for always-on targets. Run: node core/router.alwayson.test.mjs
import assert from "assert";
import { filterDisabledTargets } from "./router.js";

const log = { info() {} };
const t = ["paid@g.us", "easecab@g.us", "free@g.us"];
const rt = (o) => ({ paused: false, disabledTargets: new Set(), alwaysOn: new Set(), ...o });

assert.deepStrictEqual(filterDisabledTargets(t, rt({}), log, "x"), t);
assert.deepStrictEqual(
  filterDisabledTargets(t, rt({ paused: true, alwaysOn: new Set(["easecab@g.us"]) }), log, "x"),
  ["easecab@g.us"]
);
assert.deepStrictEqual(filterDisabledTargets(t, rt({ paused: true }), log, "x"), []);
// A per-group pause still wins over the pin.
assert.deepStrictEqual(
  filterDisabledTargets(t, rt({ paused: true, alwaysOn: new Set(["easecab@g.us"]),
    disabledTargets: new Set(["easecab@g.us"]) }), log, "x"),
  []
);
console.log("always-on: ok");
process.exit(0); // router.js starts a cleanup interval
