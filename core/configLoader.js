// =============================================================================
// configLoader.js — Loads and validates per-bot config + shared globalConfig.
// Called once at startup by start.js. Fails fast on any invalid config.
// =============================================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// -----------------------------------------------------------------------------
// VALIDATION HELPERS (preserved from original src/config.js)
// -----------------------------------------------------------------------------

function isValidGroupId(id) {
  if (typeof id !== 'string') return false;
  return id.endsWith('@g.us') && id.length > 10;
}

function normalizeBlockedNumbers(raw) {
  if (!raw) return [];
  if (!Array.isArray(raw)) {
    throw new Error('blockedPhoneNumbers must be an array');
  }
  return raw
    .map(num => {
      if (typeof num !== 'string') {
        console.warn(`⚠️  Invalid blocked number (not a string): ${num}`);
        return '';
      }
      return num.replace(/\s+/g, '');
    })
    .filter(num => num.length > 0);
}

// -----------------------------------------------------------------------------
// LOAD SHARED GLOBAL CONFIG (keywords, ignore list, blocked numbers)
// -----------------------------------------------------------------------------

function loadGlobalConfig(log) {
  const globalPath = path.join(__dirname, 'globalConfig.json');

  if (!fs.existsSync(globalPath)) {
    throw new Error(`Global config not found: ${globalPath}`);
  }

  let global;
  try {
    global = JSON.parse(fs.readFileSync(globalPath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse globalConfig.json: ${err.message}`);
  }

  // Validate required global fields
  const requiredGlobalFields = ['requestKeywords', 'ignoreIfContains', 'blockedPhoneNumbers'];
  for (const field of requiredGlobalFields) {
    if (!global[field]) {
      throw new Error(`Missing required field in globalConfig.json: ${field}`);
    }
  }

  if (!Array.isArray(global.requestKeywords)) {
    throw new Error('requestKeywords in globalConfig.json must be an array');
  }
  if (!Array.isArray(global.ignoreIfContains)) {
    throw new Error('ignoreIfContains in globalConfig.json must be an array');
  }

  // Normalize blocked numbers (strip spaces, filter empties)
  global.blockedPhoneNumbers = normalizeBlockedNumbers(global.blockedPhoneNumbers);

  return global;
}

// -----------------------------------------------------------------------------
// LOAD PER-BOT CONFIG (sourceGroupIds, targets, botPhone)
// -----------------------------------------------------------------------------

function loadBotConfig(botConfigPath, log) {
  if (!fs.existsSync(botConfigPath)) {
    throw new Error(`Bot config not found: ${botConfigPath}`);
  }

  let bot;
  try {
    bot = JSON.parse(fs.readFileSync(botConfigPath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse bot config.json: ${err.message}`);
  }

  // Validate required per-bot fields
  const requiredBotFields = [
    'botPhone',
    'sourceGroupIds',
    'freeCommonGroupId',
    'paidCommonGroupId',
    'cityTargetGroups'
  ];

  for (const field of requiredBotFields) {
    if (!bot[field]) {
      throw new Error(`Missing required field in bot config.json: ${field}`);
    }
  }

  // Type checks
  if (!Array.isArray(bot.sourceGroupIds)) {
    throw new Error('sourceGroupIds must be an array');
  }
  if (typeof bot.botPhone !== 'string') {
    throw new Error('botPhone must be a string');
  }
  if (!Array.isArray(bot.paidCommonGroupId) && typeof bot.paidCommonGroupId !== 'string') {
    throw new Error('paidCommonGroupId must be an array or string');
  }
  if (typeof bot.cityTargetGroups !== 'object' || Array.isArray(bot.cityTargetGroups)) {
    throw new Error('cityTargetGroups must be an object');
  }

  // Validate source group IDs format
  const invalidSourceGroups = bot.sourceGroupIds.filter(id => !isValidGroupId(id));
  if (invalidSourceGroups.length > 0) {
    throw new Error(`Invalid source group IDs: ${invalidSourceGroups.join(', ')}`);
  }

  // Validate freeCommonGroupId
  if (!isValidGroupId(bot.freeCommonGroupId)) {
    throw new Error(`Invalid freeCommonGroupId: ${bot.freeCommonGroupId}`);
  }

  // Validate paid group IDs
  const paidGroups = Array.isArray(bot.paidCommonGroupId)
    ? bot.paidCommonGroupId
    : [bot.paidCommonGroupId];

  const invalidPaidGroups = paidGroups.filter(id => !isValidGroupId(id));
  if (invalidPaidGroups.length > 0) {
    throw new Error(`Invalid paid group IDs: ${invalidPaidGroups.join(', ')}`);
  }

  // Validate city target group IDs
  const invalidCityGroups = [];
  for (const [city, groupId] of Object.entries(bot.cityTargetGroups)) {
    if (groupId && groupId.trim() !== '' && !isValidGroupId(groupId)) {
      invalidCityGroups.push(`${city}: ${groupId}`);
    }
  }
  if (invalidCityGroups.length > 0) {
    throw new Error(`Invalid city group IDs: ${invalidCityGroups.join(', ')}`);
  }

  return bot;
}

// -----------------------------------------------------------------------------
// MAIN EXPORT — called once by start.js
// -----------------------------------------------------------------------------

/**
 * Loads and validates both configs. Returns a single merged object.
 *
 * @param {string} botConfigPath   - absolute path to this bot's config.json
 * @param {string} botId           - e.g. "bot-1" (for log prefixing)
 * @param {{ info: Function }}  log - the bot logger instance
 * @returns {object}               - merged config
 */
export function loadConfig(botConfigPath, botId, log) {
  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log.info('📋 LOADING CONFIGURATION');
  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Load both files — any error here is fatal
  const globalCfg = loadGlobalConfig(log);
  const botCfg    = loadBotConfig(botConfigPath, log);

  // Merge into one flat config object
  const config = {
    // Per-bot
    botPhone:           botCfg.botPhone,
    botId:              botId,
    sourceGroupIds:     botCfg.sourceGroupIds,
    freeCommonGroupId:  botCfg.freeCommonGroupId,
    paidCommonGroupId:  botCfg.paidCommonGroupId,
    cityTargetGroups:   botCfg.cityTargetGroups,

    // Global (shared)
    requestKeywords:    globalCfg.requestKeywords,
    ignoreIfContains:   globalCfg.ignoreIfContains,
    blockedPhoneNumbers: globalCfg.blockedPhoneNumbers,

    // Derived
    configuredCities:   Object.keys(botCfg.cityTargetGroups),
  };

  // Log summary (preserved from original startup logging)
  log.info(`✅ Source Groups:    ${config.sourceGroupIds.length}`);
  log.info(`✅ Free Common:     1`);
  log.info(`✅ Paid Groups:     ${Array.isArray(config.paidCommonGroupId) ? config.paidCommonGroupId.length : 1}`);
  log.info(`✅ City Groups:     ${config.configuredCities.length}`);
  log.info(`✅ Keywords:        ${config.requestKeywords.length}`);
  log.info(`✅ Ignore Keywords: ${config.ignoreIfContains.length}`);
  log.info(`✅ Blocked Numbers: ${config.blockedPhoneNumbers.length}`);
  log.info(`✅ Bot Phone:       ${config.botPhone}`);
  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  config.configuredCities.forEach(city => {
    const gid = config.cityTargetGroups[city];
    log.info(`   🏙️  ${city} → ${gid ? gid.substring(0, 18) + '...' : 'NO GROUP CONFIGURED'}`);
  });

  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return config;
}