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
  name: 'bot-admin',
  script: './start.js',
  cwd: '/home/ubuntu/whatsapp-taxi-bot-v2/bots/bot-admin',

  interpreter: '/usr/bin/node',

  instances: 1,
  exec_mode: 'fork',

  autorestart: true,
  watch: false,
  restart_delay: 5000,
  exp_backoff_restart_delay: 2000,
  min_uptime: '15s',
  max_restarts: 10,

  max_memory_restart: '400M',
  env: {
    NODE_OPTIONS: '--max-old-space-size=384',
    TZ: "Asia/Kolkata",
  },

  kill_timeout: 10000,
  shutdown_with_message: true,

  log_date_format: 'YYYY-MM-DD HH:mm:ss',
  error_file: '../../logs/bot-admin-error.log',
  out_file: '../../logs/bot-admin-out.log',
  merge_logs: true,
},
    
    // =========================================================================
    // bot-taxi
    // =========================================================================
    {
  name: 'bot-taxi',
  script: './start.js',
  cwd: '/home/ubuntu/whatsapp-taxi-bot-v2/bots/bot-taxi',

  interpreter: '/usr/bin/node',

  instances: 1,
  exec_mode: 'fork',

  autorestart: true,
  watch: false,
  restart_delay: 5000,
  exp_backoff_restart_delay: 2000,
  min_uptime: '15s',
  max_restarts: 10,

  max_memory_restart: '400M',
  env: {
    NODE_OPTIONS: '--max-old-space-size=384',
    TZ: "Asia/Kolkata",
  },

  kill_timeout: 10000,
  shutdown_with_message: true,

  log_date_format: 'YYYY-MM-DD HH:mm:ss',
  error_file: '../../logs/bot-taxi-error.log',
  out_file: '../../logs/bot-taxi-out.log',
  merge_logs: true,
},   
  ]
};
