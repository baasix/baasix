/**
 * PM2 Ecosystem Configuration for Baasix
 * 
 * Development configuration - single instance
 * 
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 logs baasix
 *   pm2 stop baasix
 */

module.exports = {
  apps: [
    {
      // Application name
      name: 'baasix',

      // Entry point
      script: '../../server.js',

      // Use tsx for ESM support on all platforms
      interpreter: 'npx',
      interpreter_args: 'tsx',

      // Working directory
      cwd: '../..',

      // Watch for file changes (development only)
      watch: false,

      // Restart on file change ignore patterns
      ignore_watch: ['node_modules', 'uploads', 'logs', '*.log'],

      // Environment variables
      env: {
        NODE_ENV: 'development',
        PORT: 8056,
      },

      // Logging
      error_file: './logs/baasix-error.log',
      out_file: './logs/baasix-out.log',
      log_file: './logs/baasix-combined.log',
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // Restart behavior
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 4000,

      // Memory limit (restart if exceeded)
      max_memory_restart: '500M',
    },
  ],
};
