# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A multi-bot WhatsApp automation system that routes taxi ride requests from 100+ source WhatsApp groups into categorized target groups (paid, city-specific, free). Built with Baileys (WhatsApp API), Express, and Pino. Managed via PM2 for production.

## Commands

```bash
# Development - run a single bot (QR code prints to terminal)
node bots/bot-admin/start.js
node bots/bot-taxi/start.js

# Production - manage all bots via PM2
npm run pm2:start      # Start all bots
npm run pm2:stop       # Stop all bots
npm run pm2:restart    # Restart all bots
npm run pm2:reload     # Graceful reload (zero-downtime)
npm run pm2:logs       # Stream live logs
npm run pm2:status     # Check bot health

# Health checks (replace port for bot-taxi: 3002)
curl localhost:3001/ping    # bot-admin liveness
curl localhost:3001/stats   # Full runtime state (JSON)
curl localhost:3001/groups  # Monitored group membership
```

## Architecture

### Shared Core + Per-Bot Config Pattern
All bots run identical code from `core/`. Each bot in `bots/[botId]/` only provides:
- `start.js` — PM2 entry point that resolves paths and hands off to `core/index.js`
- `config.json` — Bot-specific group IDs, phone number, city targets
- `.env` — `STATS_PORT` for the HTTP stats server
- `baileys_auth/` — WhatsApp session state (auto-created on first run)

### Message Flow Pipeline (`core/index.js`)
Messages enter via Baileys `messages.upsert` (type: `notify`) and pass through a sequential validation chain before routing:

1. **Reconnect age-gate** (B1) — Rejects messages >10s old for 30s after reconnect
2. **Replay-ID dedup** (B2) — Rolling 200-entry set catches Baileys replays
3. **Text extraction + normalization** — Emoji removal, whitespace normalization
4. **Self-send check** — Drops bot's own messages
5. **Min-length gate** — 10 chars minimum
6. **Fingerprint dedup** — SHA256(normalizedText + senderId), 2000-entry cache with 2h TTL
7. **Settling delay** (A4) — 5–15s pause on first message after connect only
8. **Circuit breaker check** — Halts if 10+ consecutive failures (60s cooldown)
9. **Message age gate** — Drops messages older than 5 minutes
10. **Path dispatch** → `processPathA` or `processPathB`

### Routing Logic (`core/router.js`)
- **Path A**: Source group → paid groups + city group + free common group
- **Path B**: Free common group → paid groups + city group (no echo back to free)

Anti-ban protections applied during send:
- **A1**: Typing simulation delay (1.0–1.8s, scaled by message length)
- **A3**: Fisher-Yates shuffle of target group order per send
- **A5**: Weighted inter-group gap (0.8–1.5s, 65% bias toward lower end)

### Message Filtering (`core/filter.js`)
A message is forwarded only if it passes all of:
1. `isTaxiRequest()` — Contains taxi keywords AND route patterns
2. `hasPhoneNumber()` — Has 8+ digit phone number in any of 12 formats
3. `containsBlockedNumber()` — Not from a globally blocked number
4. `extractPickupCity()` — Returns a recognized city (or null → no city target)
5. Not containing any ignored keywords (spam filters)

### Global Configuration (`core/globalConfig.js`)
Single source of truth for all bots:
- `requestKeywords` — 49 taxi-related terms that trigger routing
- `ignoreIfContains` — 95+ terms for spam/fraud filtering
- `blockedPhoneNumbers` — 166+ globally blocked numbers
- Timing constants for all anti-ban delays
- Rate limits: 100/hour, 1500/day per bot

**Edit this file to add/remove blocked numbers, keywords, or adjust timing.**

### City Matching (`core/cityAliases.js`)
Maps 500+ aliases per city to canonical names for 11 cities (Delhi, Gurgaon, Noida, Ambala, Patiala, Chandigarh, Zirakpur, Mohali, Amritsar, Ludhiana, Jalandhar). Includes typos, airport codes, and railway station names.

## Adding a New Bot
1. `cp -r bots/bot-admin bots/bot-X`
2. Update `BOT_NAME` in `bots/bot-X/start.js`
3. Set unique `STATS_PORT` in `bots/bot-X/.env`
4. Configure group IDs and phone in `bots/bot-X/config.json`
5. Add a new app block in `ecosystem.config.cjs`
6. Run `npm run pm2:restart`

## Key Implementation Notes
- **No tests** — This codebase has no test suite
- **ES Modules** — All files use `import`/`export` syntax, `"type": "module"` in package.json
- **Node >=18** required
- **First run requires QR scan** — Baileys auth state is saved to `baileys_auth/` and reused on restart
- **Fingerprint cache** is persisted to `baileys_auth/fingerprints_[botId].json` with 30s debounced writes
- **PM2 ecosystem** staggers bot-taxi startup by 20s to avoid simultaneous WhatsApp connections
- **Stats are in-memory only** — Counters reset on restart
