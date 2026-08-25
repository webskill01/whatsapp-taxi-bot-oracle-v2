/**
 * One-shot merge of a peer's block list into this server's blocked-data.json.
 * Use it once per VPS to converge two lists that have drifted apart; after that
 * the panels mirror every write to each other automatically.
 *
 *   node scripts/sync-blocked-data.js https://other-panel.example.com <their-admin-token>
 *
 * Union only — nothing is ever deleted. Run it on BOTH servers (each pointing at
 * the other) and the two files end up identical.
 */
import { readData, writeData } from "../core/blockData.js";

const [url, token] = process.argv.slice(2);
if (!url || !token) {
  console.error("usage: node scripts/sync-blocked-data.js <peer-url> <peer-admin-token>");
  process.exit(1);
}

const res = await fetch(`${url.replace(/\/$/, "")}/api/block/list`, {
  headers: { "x-token": token },
});
if (!res.ok) {
  console.error(`peer returned ${res.status} — is that the ADMIN token?`);
  process.exit(1);
}
const { data: peer } = await res.json();
if (!peer) {
  console.error("peer sent counts only — that token is not an admin token");
  process.exit(1);
}

const local = readData();
let added = 0;
for (const field of ["blockedPhoneNumbers", "blockedSenders", "ignoreIfContains"]) {
  const before = new Set(local[field]);
  for (const v of peer[field] || []) if (!before.has(v)) { local[field].push(v); added++; }
  console.log(`${field}: ${before.size} local + ${(peer[field] || []).length} peer -> ${local[field].length}`);
}
if (added) writeData(local);
console.log(added ? `✅ merged ${added} new entries` : "✅ already in sync");
process.exit(0);
