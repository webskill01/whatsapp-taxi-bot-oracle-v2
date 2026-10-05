// Self-check for the unknown-cities report. Run: node scripts/unknown-cities.test.mjs
import assert from "assert";
import { candidates, nearest } from "./unknown-cities.js";

// Misspelled pickup beside a route word is picked up; vehicle/time noise is not.
const c = candidates("Need innova chandighar to nalagarh drop 4 pm 98765 43210");
assert.ok(c.includes("chandighar"), c);
assert.ok(c.includes("nalagarh"), c);
assert.ok(!c.includes("innova") && !c.includes("need"), c);

// Known aliases are not reported.
assert.ok(!candidates("delhi to mohali").length);

// Words far from any route word are ignored (signatures, chatter).
assert.ok(!candidates("thanks for choosing rajputana travels").length);

// Misspelling maps to its city; an unrelated word maps to nothing.
assert.match(nearest("chandighar"), /Chandigarh/i);
assert.equal(nearest("zzzzzz"), null);

console.log("ok");
process.exit(0); // globalConfig keeps a file watcher alive
