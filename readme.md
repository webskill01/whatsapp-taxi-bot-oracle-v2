# WhatsApp Taxi Bot — Multi-Bot

Routes taxi-ride requests from 90+ source WhatsApp groups into paid, city, and free target groups. Each bot is an independent WhatsApp number with its own Baileys socket, all managed by a single PM2 instance.

---

## Quick Start

```bash
npm install
node bots/bot-admin/start.js     # dev — QR prints to terminal
# or production:
pm2 start ecosystem.config.cjs
```

Health checks (one port per bot):

```
curl localhost:3010/ping          # bot-admin alive?
curl localhost:3010/stats         # full runtime state (JSON)
curl localhost:3010/groups        # groups this number is a member of
```

---

## Directory Layout

```
whatsapp-taxi-bot-multibot/
│
├── core/                          shared engine — every bot runs the same code
│   ├── filter.js                    keyword / city / phone detection (DO NOT EDIT)
│   ├── router.js                    Path A & B target routing + send loop
│   ├── index.js                     Baileys socket + message handler + stats HTTP
│   ├── configLoader.js              loads + validates per-bot config & globalConfig
│   ├── logger.js                    pino wrapper with [botId] prefix on every line
│   ├── globalConfig.json            SHARED keywords, ignore list, blocked numbers
│   └── globalDefaults.js            ALL timing constants & cache sizes
│
├── bots/                          one folder per WhatsApp number
│   └── bot-admin/
│       ├── start.js                 PM2 entry point (path wiring only)
│       ├── config.json              per-bot: sourceGroups, targets, botPhone
│       ├── .env                     STATS_PORT (unique per bot)
│       └── baileys_auth/            QR auth state — created on first run
│
├── logs/                          PM2 log output (created at runtime)
├── ecosystem.config.cjs           PM2 process manifest
├── package.json
└── README.md
```

---

## How a Message Flows

```
WhatsApp group  →  Baileys messages.upsert (type: notify)
                        │
                        ▼
              index.js  handleMessage()
                ├── fromMe guard
                ├── B1  reconnect age-gate (10s strict for 30s after reconnect)
                ├── B2  replay-ID set (200 rolling)
                ├── text extraction
                ├── bot-self-send check (phone-level)
                ├── min-length gate
                ├── fingerprint dedup  ← ADD to set + markDirty here
                ├── A4  settling delay (5-15s, first msg only after connect)
                ├── circuit-breaker gate
                └── path dispatch
                        │
          ┌─────────────┴─────────────┐
          ▼                           ▼
     processPathA                processPathB
   (source → paid+city+free)  (free → paid+city)
     gate: blocked→taxi→phone→rate   (same gates)
     targets: paid → city → free     targets: paid → city
     shuffle (A3)                    shuffle (A3)
     sequential send loop            sequential send loop
       A1 typing delay (first)         (same delay logic)
       A5 weighted gaps (rest)
     C1 fingerprint cleanup           C1 cleanup
```

---

## Adding bot-taxi Later

1. Copy the bot folder and tweak:
   ```bash
   cp -r bots/bot-admin bots/bot-taxi
   rm -rf bots/bot-taxi/baileys_auth   # must re-scan QR for new number
   ```

2. `bots/bot-taxi/start.js` — change `BOT_ID` to `'bot-taxi'`.

3. `bots/bot-taxi/.env` — change `STATS_PORT` to `3011`.

4. `bots/bot-taxi/config.json` — set `botPhone`, `sourceGroupIds`, targets.

5. `ecosystem.config.cjs` — duplicate the bot-admin block (see template comment at the bottom of the file), change `name`, `cwd`, log file paths.

6. `pm2 restart ecosystem.config.cjs` — scan the new QR when it appears in the logs.

---

## Locked-In Design Decisions

| Code | What it does | Where |
|------|--------------|-------|
| A1 | Typing delay scales with text length (1.0–1.8 s), fires before first send only | router.js `getTypingDelay` |
| A3 | Target array is Fisher-Yates shuffled before every send loop | router.js `shuffleArray` |
| A4 | One-time 5–15 s settling pause on the very first message after connect/reconnect | index.js `needsSettlingDelay` |
| A5 | Between-group gaps are weighted 65 % toward the low end (0.8–1.5 s) | router.js `getWeightedDelay` |
| B1 | For 30 s after reconnect only messages < 10 s old are processed | index.js reconnect age-gate |
| B2 | Rolling 200-entry message-ID set catches Baileys reconnect replays | index.js `replayIdSet` |
| C1 | Fingerprint set trims to 80 % of cap in one batch on overflow | router.js `cleanupFingerprintSetIfNeeded` |
| C2 | Fingerprint disk writes are debounced at 30 s (dirty flag, not per-message) | index.js `markDirty` |
| E1 | Every log line is prefixed `[botId]` | logger.js `createLogger` |
| E2 | `/stats` JSON includes `bot.id` and `bot.phone` | index.js stats server |
| F1 | `extractAllCities` removed — confirmed dead across full codebase | filter.js |
| F2 | `"kharad"` alias lowercased — was silently never matching | filter.js alias map |

---

## What NOT to Edit

| File | Why |
|------|-----|
| `core/filter.js` | Every regex and alias is tuned from real traffic. Changes change what gets forwarded. |
| `core/globalConfig.json` | Shared by all bots. One restart applies changes everywhere. |
| `core/globalDefaults.js` | All timing constants are tuned to a 12–15 s delivery budget. Changing one without recalculating the budget will either exceed WhatsApp rate limits or break the timing window. |