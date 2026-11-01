/**
 * ============================================================================
 * runtimeState.js — per-bot live control flags (pause / disabled targets)
 * ============================================================================
 * Each bot owns a `runtime.json` in its own directory:
 *
 *   { "paused": false, "disabledTargets": ["<id>@g.us", ...] }
 *
 * The control dashboard (or a scoped friend link) writes this file; the bot
 * watches it and applies changes LIVE — same hot-reload pattern as
 * blocked-data.json, so toggling forwarding on/off needs NO restart, no
 * reconnect, no QR re-scan.
 *
 *   • paused=true            → bot stays connected but forwards nothing
 *   • disabledTargets=[...]  → those target groups are skipped on every send
 *                              (e.g. pause sharing to a friend's trial group)
 *
 * SAFETY: a missing/malformed file defaults to ACTIVE (paused=false, no disabled
 * targets) and never crashes the bot. The returned object is mutated in place so
 * the reference attached to `config.runtime` always reflects current state.
 * ============================================================================
 */

import { readFileSync, writeFileSync, existsSync, watchFile } from "fs";
import { join } from "path";

const DEFAULT_STATE = { paused: false, disabledTargets: [] };

export function initRuntimeState(botDir, log) {
  const filePath = join(botDir, "runtime.json");

  // Live state object. `disabledTargets` is a Set for O(1) lookups in the send loop.
  const state = { paused: false, disabledTargets: new Set(), alwaysOn: new Set() };

  function apply(data) {
    state.paused = data.paused === true;
    state.disabledTargets = new Set(
      Array.isArray(data.disabledTargets) ? data.disabledTargets : []
    );
    // Targets that keep receiving rides even while the whole bot is paused.
    state.alwaysOn = new Set(Array.isArray(data.alwaysOn) ? data.alwaysOn : []);
  }

  // Initial load — create the file with defaults if it doesn't exist yet.
  try {
    if (existsSync(filePath)) {
      apply(JSON.parse(readFileSync(filePath, "utf8")));
      log.info(
        `🎛️  runtime.json loaded — paused=${state.paused}, disabledTargets=${state.disabledTargets.size}`
      );
    } else {
      writeFileSync(filePath, JSON.stringify(DEFAULT_STATE, null, 2) + "\n", "utf8");
      log.info("🎛️  Created runtime.json (active, nothing disabled)");
    }
  } catch (err) {
    log.warn(`⚠️  runtime.json load failed — defaulting to ACTIVE: ${err.message}`);
  }

  // Live watcher (1s mtime poll, debounced) — mirrors the blocked-data hot-reload.
  let debounce = null;
  try {
    watchFile(filePath, { interval: 1000 }, (curr, prev) => {
      if (curr.mtimeMs === prev.mtimeMs) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        try {
          apply(JSON.parse(readFileSync(filePath, "utf8")));
          log.info(
            `🔄 runtime.json reloaded — paused=${state.paused}, disabledTargets=${state.disabledTargets.size}`
          );
        } catch (err) {
          log.warn(`⚠️  runtime.json reload failed — keeping previous state: ${err.message}`);
        }
      }, 300);
    });
  } catch (err) {
    log.warn(`⚠️  could not watch runtime.json (live toggle disabled): ${err.message}`);
  }

  return state;
}
