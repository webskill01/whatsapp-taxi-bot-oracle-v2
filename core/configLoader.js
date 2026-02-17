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

  if (!Array.isArray(config.sourceGroupIds)) {
    console.error(`❌ config.sourceGroupIds must be an array`);
    process.exit(1);
  }

  if (
    typeof config.freeCommonGroupId !== "string" ||
    !config.freeCommonGroupId.endsWith("@g.us")
  ) {
    console.error(`❌ config.freeCommonGroupId must be a valid @g.us group ID`);
    process.exit(1);
  }

  if (!Array.isArray(config.paidCommonGroupId) || config.paidCommonGroupId.length === 0) {
    console.error(`❌ config.paidCommonGroupId must be a non-empty array`);
    process.exit(1);
  }

  if (
    typeof config.cityTargetGroups !== "object" ||
    Array.isArray(config.cityTargetGroups) ||
    Object.keys(config.cityTargetGroups).length === 0
  ) {
    console.error(`❌ config.cityTargetGroups must be a non-empty object map`);
    process.exit(1);
  }

  // ==========================================================================
  // VALIDATE GROUP ID FORMATS
  // ==========================================================================

  function isValidGroupId(id) {
    return typeof id === "string" && id.endsWith("@g.us") && id.length > 10;
  }

  const invalidSourceGroups = config.sourceGroupIds.filter((id) => !isValidGroupId(id));
  if (invalidSourceGroups.length > 0) {
    console.error(`❌ Invalid source group IDs: ${invalidSourceGroups.join(", ")}`);
    process.exit(1);
  }

  const invalidPaidGroups = config.paidCommonGroupId.filter((id) => !isValidGroupId(id));
  if (invalidPaidGroups.length > 0) {
    console.error(`❌ Invalid paidCommonGroupId entries: ${invalidPaidGroups.join(", ")}`);
    process.exit(1);
  }

  for (const [city, groupId] of Object.entries(config.cityTargetGroups)) {
    if (!isValidGroupId(groupId)) {
      console.error(`❌ Invalid group ID for city "${city}": ${groupId}`);
      process.exit(1);
    }
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
  console.log(`✅ Rate Limits:    ${mergedConfig.rateLimits.hourly}/hour, ${mergedConfig.rateLimits.daily}/day`);
  console.log(`✅ Stats Port:     ${ENV.STATS_PORT}`);
  console.log(`✅ Anti-Ban:       10-layer protection enabled`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  return { config: mergedConfig, ENV };
}