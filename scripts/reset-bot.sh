#!/usr/bin/env bash
# =============================================================================
# reset-bot.sh — Full session reset for ONE bot
# =============================================================================
# Stops the bot, wipes its WhatsApp session + dedup caches, restarts it, then
# tails its logs so you can scan the new QR.
#
#   ⚠️  This LOGS THE BOT OUT — it forces QR re-pairing on next start.
#       For a normal code deploy use `pm2 restart all` instead.
#
# USAGE:  ./scripts/reset-bot.sh <bot-name>
#         e.g. ./scripts/reset-bot.sh bot-admin
#
# NOTE: intentionally does NOT use `set -e`. A `pm2 stop` on an
#       already-stopped bot returns non-zero, and that must NOT abort the wipe.
# =============================================================================

# Resolve repo root from THIS script's own location (works from any cwd) --------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BOTS_DIR="$REPO_ROOT/bots"

# Discover valid bot names from the bots/ directory ----------------------------
VALID_BOTS=()
for d in "$BOTS_DIR"/*/; do
  [ -d "$d" ] && VALID_BOTS+=("$(basename "$d")")
done

BOT="$1"

usage_and_exit() {
  echo "❌ Usage: $0 <bot-name>"
  echo "   Valid bots: ${VALID_BOTS[*]}"
  exit 1
}

# Validate argument -----------------------------------------------------------
if [ -z "$BOT" ]; then
  echo "❌ No bot name given."
  usage_and_exit
fi

is_valid=0
for v in "${VALID_BOTS[@]}"; do
  [ "$v" = "$BOT" ] && is_valid=1
done
if [ "$is_valid" -ne 1 ]; then
  echo "❌ Unknown bot: '$BOT'"
  usage_and_exit
fi

BOT_DIR="$BOTS_DIR/$BOT"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔄 RESETTING $BOT"
echo "   Repo:    $REPO_ROOT"
echo "   Bot dir: $BOT_DIR"
echo "   ⚠️  This forces a NEW QR scan on next start."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

cd "$REPO_ROOT" || { echo "❌ Cannot cd to repo root"; exit 1; }

# 1) Stop (benign failure if already stopped — do NOT abort) -------------------
echo "⏹️  pm2 stop $BOT"
pm2 stop "$BOT"

# 2) Wipe session + dedup caches ----------------------------------------------
echo "🧹 Wiping baileys_auth/"
rm -rf "$BOT_DIR/baileys_auth"

echo "🧹 Wiping fingerprints_*.json"
rm -f "$BOT_DIR"/fingerprints_*.json

echo "🧹 Wiping legacy .forwarded-messages.json"
rm -f "$BOT_DIR/.forwarded-messages.json"
rm -f "$REPO_ROOT/.forwarded-messages.json"

# 3) Start fresh --------------------------------------------------------------
echo "▶️  pm2 start (ecosystem, only $BOT)"
pm2 start ecosystem.config.cjs --only "$BOT"

# 4) Tail logs so the QR appears ----------------------------------------------
echo "📜 pm2 logs $BOT  (Ctrl-C to stop tailing — bot keeps running)"
pm2 logs "$BOT"
