// PM2 ecosystem per deploy su VPS (Hostinger).
// Cluster mode: usa tutti i core disponibili. Log rotation nativa PM2.

module.exports = {
  apps: [
    {
      name: 'mfdepur-shop',
      script: 'server.js',
      instances: process.env.PM2_INSTANCES || 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3000,
      },
      // Restart policy
      max_restarts: 10,
      min_uptime: '30s',
      restart_delay: 3000,
      exp_backoff_restart_delay: 100,
      // Log rotation
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      max_memory_restart: '800M',
      // Kill timeout: lascia 30s a shutdown handler
      kill_timeout: 30000,
      // Graceful: PM2 manda SIGINT poi SIGKILL se non termina
      shutdown_with_message: false,
    },
  ],
};
