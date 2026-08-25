/**
 * ============================================================================
 * CONFIG LOADER
 * ============================================================================
 * Bot-2 loading pattern (ES module, internal .env load, process.exit on error)
 * Bot-1 routing schema validated (botPhone, sourceGroupIds, freeCommonGroupId,
 * paidCommonGroupId, cityTargetGroups).
 * ============================================================================
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { GLOBAL_CONFIG } from "./globalConfig.js";

export function loadConfig(botDir) {
  // Load .env from bot directory FIRST (Bot-2 pattern)
  const envPath = path.join(botDir, ".env");
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }

  const configPath = path.join(botDir, "config.json");

  if (!fs.existsSync(configPath)) {
    console.error(`❌ Config file not found: ${configPath}`);
    process.exit(1);
  }

  let config;
  try {
    const configContent = fs.readFileSync(configPath, "utf8");
    config = JSON.parse(configContent);
  } catch (error) {
    console.error(`❌ Failed to parse config.json: ${error.message}`);
    process.exit(1);
  }

  // ==========================================================================
  // VALIDATE REQUIRED FIELDS (Bot-1 fixed routing schema)
  // ==========================================================================

  const requiredFields = [
    "botPhone",
    "sourceGroupIds",
    "freeCommonGroupId",
    "paidCommonGroupId",
    "cityTargetGroups",
  ];

  for (const field of requiredFields) {
    if (config[field] === undefined || config[field] === null) {
      console.error(`❌ Missing required config field: ${field}`);
      process.exit(1);
    }
  }

  // Type checks
  if (typeof config.botPhone !== "string" || config.botPhone.trim() === "") {
    console.error(`❌ config.botPhone must be a non-empty string`);
    process.exit(1);
  }

  const groupErrors = validateGroupFields(config);
  if (groupErrors.length > 0) {
    for (const e of groupErrors) console.error("❌ " + e);
    process.exit(1);
  }

  // ==========================================================================
  // DERIVE configuredCities list (keys of cityTargetGroups)
  // ==========================================================================

  const configuredCities = Object.keys(config.cityTargetGroups);

  // ==========================================================================
  // MERGE WITH GLOBAL CONFIG (Bot-2 pattern)
  // ==========================================================================

  const mergedConfig = {
    ...config,
    botDir,
    configuredCities,
    requestKeywords: GLOBAL_CONFIG.requestKeywords,
    ignoreIfContains: GLOBAL_CONFIG.ignoreIfContains,
    blockedPhoneNumbers: GLOBAL_CONFIG.blockedPhoneNumbers,
    blockedSenders: GLOBAL_CONFIG.blockedSenders,
    rateLimits: GLOBAL_CONFIG.rateLimits,
    validation: GLOBAL_CONFIG.validation,
    humanBehavior: GLOBAL_CONFIG.humanBehavior,
    circuitBreaker: GLOBAL_CONFIG.circuitBreaker,
    deduplication: GLOBAL_CONFIG.deduplication,
    reconnect: GLOBAL_CONFIG.reconnect,
  };

  // ==========================================================================
  // ENVIRONMENT VARIABLES
  // ==========================================================================

  const ENV = {
    BOT_NAME: process.env.BOT_NAME || path.basename(botDir),
    STATS_PORT: parseInt(
      process.env.STATS_PORT || process.env.QR_SERVER_PORT || "3001",
      10
    ),
    BOT_DIR: botDir,
    AUTH_DIR: path.join(botDir, "baileys_auth"),
  };

  if (isNaN(ENV.STATS_PORT) || ENV.STATS_PORT < 1 || ENV.STATS_PORT > 65535) {
    console.error(`❌ Invalid STATS_PORT: ${process.env.STATS_PORT}`);
    process.exit(1);
  }

  // Create auth directory if it doesn't exist (Bot-2 convenience)
  if (!fs.existsSync(ENV.AUTH_DIR)) {
    fs.mkdirSync(ENV.AUTH_DIR, { recursive: true });
  }

  // ==========================================================================
  // LOG CONFIGURATION SUMMARY
  // ==========================================================================

  const allTargetGroupIds = new Set([
    ...mergedConfig.paidCommonGroupId,
    mergedConfig.freeCommonGroupId,
    ...Object.values(mergedConfig.cityTargetGroups),
  ]);

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`📋 CONFIGURATION LOADED: ${ENV.BOT_NAME}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`✅ Bot Phone:      ${mergedConfig.botPhone}`);
  console.log(`✅ Source Groups:  ${mergedConfig.sourceGroupIds.length}`);
  console.log(`✅ Free Common:    ${mergedConfig.freeCommonGroupId}`);
  console.log(`✅ Paid Groups:    ${mergedConfig.paidCommonGroupId.length}`);
  console.log(`✅ City Groups:    ${configuredCities.length} (${configuredCities.join(", ")})`);
  console.log(`✅ Total Targets:  ${allTargetGroupIds.size} unique`);
  console.log(`✅ Keywords:       ${mergedConfig.requestKeywords.length}`);
  console.log(`✅ Ignore List:    ${mergedConfig.ignoreIfContains.length}`);
  console.log(`✅ Blocked Nums:   ${mergedConfig.blockedPhoneNumbers.length}`);
  console.log(`✅ Blocked Senders: ${mergedConfig.blockedSenders.length}`);
  console.log(`✅ Rate Limits:    ${mergedConfig.rateLimits.hourly}/hour, ${mergedConfig.rateLimits.daily}/day`);
  console.log(`✅ Stats Port:     ${ENV.STATS_PORT}`);
  console.log(`✅ Anti-Ban:       10-layer protection enabled`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  return { config: mergedConfig, ENV };
}

// ============================================================================
// GROUP-FIELD VALIDATION (shared by boot + hot-reload)
// ============================================================================
function isValidGroupId(id) {
  return typeof id === "string" && id.endsWith("@g.us") && id.length > 10;
}

/** Returns an array of human-readable errors; empty array = valid. */
export function validateGroupFields(cfg) {
  const errs = [];

  if (!Array.isArray(cfg.sourceGroupIds)) {
    errs.push("config.sourceGroupIds must be an array");
  } else {
    const bad = cfg.sourceGroupIds.filter((id) => !isValidGroupId(id));
    if (bad.length) errs.push(`Invalid source group IDs: ${bad.join(", ")}`);
  }

  if (!isValidGroupId(cfg.freeCommonGroupId)) {
    errs.push("config.freeCommonGroupId must be a valid @g.us group ID");
  }

  if (!Array.isArray(cfg.paidCommonGroupId) || cfg.paidCommonGroupId.length === 0) {
    errs.push("config.paidCommonGroupId must be a non-empty array");
  } else {
    const bad = cfg.paidCommonGroupId.filter((id) => !isValidGroupId(id));
    if (bad.length) errs.push(`Invalid paidCommonGroupId entries: ${bad.join(", ")}`);
  }

  if (
    typeof cfg.cityTargetGroups !== "object" ||
    cfg.cityTargetGroups === null ||
    Array.isArray(cfg.cityTargetGroups) ||
    Object.keys(cfg.cityTargetGroups).length === 0
  ) {
    errs.push("config.cityTargetGroups must be a non-empty object map");
  } else {
    for (const [city, gid] of Object.entries(cfg.cityTargetGroups)) {
      if (!isValidGroupId(gid)) errs.push(`Invalid group ID for city "${city}": ${gid}`);
    }
  }

  return errs;
}

// ============================================================================
// HOT-RELOAD — routing group lists only (control panel writes config.json)
// ============================================================================
/**
 * Watches the bot's config.json and re-applies the ROUTING GROUP fields onto the
 * live config object in place, so adding/removing a group in the control panel
 * takes effect with NO restart (same pattern as runtime.json / blocked-data.json).
 *
 * Only group fields are re-applied — botPhone, branding and env stay boot-time.
 * A malformed or invalid edit is IGNORED (previous groups stay live) rather than
 * crashing a running bot; boot-time validation still exits on bad config.
 */
export function watchConfigGroups(config, log) {
  const configPath = path.join(config.botDir, "config.json");
  let debounce = null;

  try {
    fs.watchFile(configPath, { interval: 1000 }, (curr, prev) => {
      if (curr.mtimeMs === prev.mtimeMs) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        let next;
        try {
          next = JSON.parse(fs.readFileSync(configPath, "utf8"));
        } catch (err) {
          log.warn(`⚠️  config.json reload failed to parse — keeping current groups: ${err.message}`);
          return;
        }
        const errs = validateGroupFields(next);
        if (errs.length) {
          log.warn(`⚠️  config.json reload rejected — keeping current groups: ${errs.join("; ")}`);
          return;
        }
        config.sourceGroupIds    = next.sourceGroupIds;
        config.paidCommonGroupId = next.paidCommonGroupId;
        config.freeCommonGroupId = next.freeCommonGroupId;
        config.cityTargetGroups  = next.cityTargetGroups;
        config.configuredCities  = Object.keys(next.cityTargetGroups);
        log.info(
          `🔄 config.json reloaded — ${config.sourceGroupIds.length} source, ` +
          `${config.paidCommonGroupId.length} paid, ${config.configuredCities.length} city groups`
        );
      }, 300);
    });
  } catch (err) {
    log.warn(`⚠️  could not watch config.json (live group edits disabled): ${err.message}`);
  }
}
