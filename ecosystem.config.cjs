module.exports = {
  apps: [
    {
      name:   "bot-admin",
      script: "./bots/bot-admin/start.js",
      cwd:    "./",
      instances: 1,
      exec_mode: "fork",

      // 🔒 Stability
      autorestart: true,
      watch:       false,
      restart_delay: 8000,    // 8s cooldown between restarts
      min_uptime:   20000,    // must stay alive 20s or counts as crash
      max_restarts: 5,        // 5 crashes in window → stop

      // 🧹 Graceful shutdown
      kill_timeout:          15000,
      kill_signal:           "SIGTERM",
      shutdown_with_message: true,

      // 🧠 Memory
      max_memory_restart: "500M",

      start_delay: 0,         // starts immediately

      // 📜 Logs
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file:  "./logs/bot-admin-error.log",
      out_file:    "./logs/bot-admin-out.log",
      merge_logs:  true,
      log_type:    "raw",

      env: {
        NODE_ENV:    "production",
        TZ:          "Asia/Kolkata",
        NODE_OPTIONS: "--max-old-space-size=480",
        BOT_NAME:    "bot-admin",
        STATS_PORT:  "3001",
      },
    },

    {
      name:   "bot-taxi",
      script: "./bots/bot-taxi/start.js",
      cwd:    "./",
      instances: 1,
      exec_mode: "fork",

      autorestart: true,
      watch:       false,
      restart_delay: 8000,
      min_uptime:   20000,
      max_restarts: 5,

      kill_timeout:          15000,
      kill_signal:           "SIGTERM",
      shutdown_with_message: true,

      max_memory_restart: "500M",
      start_delay: 20000,     // 20s stagger after bot-admin

      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file:  "./logs/bot-taxi-error.log",
      out_file:    "./logs/bot-taxi-out.log",
      merge_logs:  true,
      log_type:    "raw",

      env: {
        NODE_ENV:    "production",
        TZ:          "Asia/Kolkata",
        NODE_OPTIONS: "--max-old-space-size=480",
        BOT_NAME:    "bot-taxi",
        STATS_PORT:  "3002",
      },
    },
  ],
};
