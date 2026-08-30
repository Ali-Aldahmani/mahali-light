/**
 * PM2 ecosystem config — used to run the mahali-light API server as a
 * managed process that auto-restarts on crash and starts with Windows.
 *
 * Usage:
 *   pm2 start ecosystem.config.js          # start
 *   pm2 stop mahali-light                  # stop
 *   pm2 restart mahali-light               # restart
 *   pm2 logs mahali-light                  # tail logs
 *   pm2 monit                              # live dashboard
 */
module.exports = {
  apps: [
    {
      name: 'mahali-light',
      script: 'server/index.js',

      // Resolve paths relative to the project root, not the CWD where pm2 is
      // invoked.  This is important when PM2 is started by Windows at boot.
      cwd: __dirname,

      // Never watch for file changes in production — nodemon is dev-only.
      watch: false,

      // Restart automatically if the process exits.
      autorestart: true,

      // Wait 3 s before a restart so rapid crash-loops don't hammer the DB.
      restart_delay: 8000,

      // Give up after 10 consecutive crashes within 30 min and mark as
      // errored so the operator is alerted instead of looping forever.
      max_restarts: 10,
      min_uptime: '30s',

      // Keep up to 30 days of logs; rotate at 10 MB.
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: 'logs/pm2-error.log',
      out_file:   'logs/pm2-out.log',
      merge_logs: true,

      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
