// =============================================================================
// ecosystem.config.cjs — PM2 process manifest (bot-admin + bot-taxi)
//
// KEY RULE:  "cwd" is set to each bot's own folder.
//            "script" is resolved RELATIVE TO "cwd".
//            So script is always just "./start.js".
//
// Adding a new bot = duplicate the nearest block, update:
//   name, cwd, log paths, STATS_PORT, start_delay
// =============================================================================

module.exports = {
  apps: [

    // =========================================================================
    // bot-admin  [starts immediately]
    // =========================================================================
    {
      name: "bot-admin",
      script: "./start.js",
      cwd: "/home/ubuntu/whatsapp-taxi-bot-v2/bots/bot-admin",

      interpreter: "/usr/bin/node",

      instances: 1,
      exec_mode: "fork",

      // ── Restart policy ──────────────────────────────────────────────────────
      autorestart: true,
      watch: false,
      restart_delay: 8000,          // 8s cooldown between PM2-triggered restarts
      exp_backoff_restart_delay: 100, // PM2 exponential backoff seed (ms)
      min_uptime: "20s",            // must stay up 20s or it counts as a crash
      max_restarts: 5,              // 5 crashes within min_uptime window → stop

      // ── Graceful shutdown ───────────────────────────────────────────────────
      kill_timeout: 15000,          // 15s for SIGTERM handler to finish
      kill_signal: "SIGTERM",
      shutdown_with_message: true,

      // ── Memory ─────────────────────────────────────────────────────────────
      max_memory_restart: "400M",

      // ── Staggered start ────────────────────────────────────────────────────
      start_delay: 0,               // first bot starts immediately

      // ── Logs ───────────────────────────────────────────────────────────────
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "../../logs/bot-admin-error.log",
      out_file: "../../logs/bot-admin-out.log",
      merge_logs: true,
      log_type: "raw",

      env: {
        NODE_ENV: "production",
        NODE_OPTIONS: "--max-old-space-size=384",
        TZ: "Asia/Kolkata",
        BOT_NAME: "bot-admin",
      },
    },

    // =========================================================================
    // bot-taxi  [starts at 20s to avoid simultaneous WA connections]
    // =========================================================================
    {
      name: "bot-taxi",
      script: "./start.js",
      cwd: "/home/ubuntu/whatsapp-taxi-bot-v2/bots/bot-taxi",

      interpreter: "/usr/bin/node",

      instances: 1,
      exec_mode: "fork",

      // ── Restart policy ──────────────────────────────────────────────────────
      autorestart: true,
      watch: false,
      restart_delay: 8000,
      exp_backoff_restart_delay: 100,
      min_uptime: "20s",
      max_restarts: 5,

      // ── Graceful shutdown ───────────────────────────────────────────────────
      kill_timeout: 15000,
      kill_signal: "SIGTERM",
      shutdown_with_message: true,

      // ── Memory ─────────────────────────────────────────────────────────────
      max_memory_restart: "400M",

      // ── Staggered start ────────────────────────────────────────────────────
      start_delay: 20000,           // 20s after bot-admin to avoid WA rate limits

      // ── Logs ───────────────────────────────────────────────────────────────
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "../../logs/bot-taxi-error.log",
      out_file: "../../logs/bot-taxi-out.log",
      merge_logs: true,
      log_type: "raw",

      env: {
        NODE_ENV: "production",
        NODE_OPTIONS: "--max-old-space-size=384",
        TZ: "Asia/Kolkata",
        BOT_NAME: "bot-taxi",
      },
    },

  ],
};
