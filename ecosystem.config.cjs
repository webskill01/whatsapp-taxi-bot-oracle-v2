// =============================================================================
// ecosystem.config.cjs — PM2 process manifest.
//
// KEY RULE:  "cwd" is set to each bot's own folder.
//            "script" is resolved RELATIVE TO "cwd".
//            So script is always just "./start.js".
//
// Adding bot-taxi later = duplicate the block, change name / cwd / log paths.
// =============================================================================

module.exports = {
  apps: [

    // =========================================================================
    // bot-admin
    // =========================================================================
    {
      name:   'bot-admin',
      script: './start.js',                        // relative to cwd below
      cwd:    './bots/bot-admin',                  // PM2 resolves this from where you run "pm2 start"

      instances:  1,
      exec_mode:  'fork',                          // one process per bot, no cluster

      // ── restart policy ──
      autorestart:   true,
      watch:         false,
      restart_delay: 5000,                         // 5s cooldown between restarts
      min_uptime:    '15s',                        // must stay up 15s or it counts as a crash
      max_restarts:  10,

      // ── memory ──
      max_memory_restart: '400M',
      env: {
        NODE_OPTIONS: '--max-old-space-size=384',
      },

      // ── graceful shutdown ──
      kill_timeout:            10000,              // 10s for SIGTERM handler to flush + close socket
      shutdown_with_message:   true,

      // ── logging ──
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '../../logs/bot-admin-error.log',   // relative to cwd
      out_file:   '../../logs/bot-admin-out.log',
      merge_logs: true,
    },
    
    // =========================================================================
    // bot-taxi
    // =========================================================================
    {
      name:   'bot-taxi',
      script: './start.js',                        // relative to cwd below
      cwd:    './bots/bot-taxi',                  // PM2 resolves this from where you run "pm2 start"

      instances:  1,
      exec_mode:  'fork',                          // one process per bot, no cluster

      // ── restart policy ──
      autorestart:   true,
      watch:         false,
      restart_delay: 5000,                         // 5s cooldown between restarts
      min_uptime:    '15s',                        // must stay up 15s or it counts as a crash
      max_restarts:  10,

      // ── memory ──
      max_memory_restart: '400M',
      env: {
        NODE_OPTIONS: '--max-old-space-size=384',
      },

      // ── graceful shutdown ──
      kill_timeout:            10000,              // 10s for SIGTERM handler to flush + close socket
      shutdown_with_message:   true,

      // ── logging ──
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '../../logs/bot-taxi-error.log',   // relative to cwd
      out_file:   '../../logs/bot-taxi-out.log',
      merge_logs: true,
    },
   
  ]
};
