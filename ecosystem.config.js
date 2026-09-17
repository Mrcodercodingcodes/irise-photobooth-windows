/**
 * PM2 Ecosystem Config — iRISE Photobooth
 * 
 * Usage:
 *   pm2 start ecosystem.config.js          # start
 *   pm2 stop irise-photobooth              # stop
 *   pm2 restart irise-photobooth           # restart
 *   pm2 logs irise-photobooth              # view live logs
 *   pm2 monit                              # live dashboard
 *   pm2 save && pm2 startup               # persist across reboots
 */

module.exports = {
  apps: [
    {
      // ── Core identity ──────────────────────────────────────────
      name: 'irise-photobooth',
      script: './print-server.js',
      cwd: __dirname,

      // ── Restart policy ─────────────────────────────────────────
      watch: false,               // don't restart on file changes (use pm2 restart manually)
      autorestart: true,          // restart on crash
      max_restarts: 10,           // give up after 10 rapid crashes
      min_uptime: '10s',          // a restart counts as crash if it dies within 10s
      restart_delay: 2000,        // wait 2s between restart attempts

      // ── Logging ────────────────────────────────────────────────
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-err.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      max_size: '20M',            // rotate at 20 MB
      retain: 7,                  // keep 7 rotated files

      // ── Environment ────────────────────────────────────────────
      env: {
        NODE_ENV: 'production',
      },

      // ── Performance ────────────────────────────────────────────
      node_args: '--max-old-space-size=512',  // cap Node heap at 512 MB
      instances: 1,                           // single instance (FFmpeg is stateful)
      exec_mode: 'fork',                      // fork, not cluster
    }
  ]
};
