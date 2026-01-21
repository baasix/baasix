/**
 * PM2 Production Ecosystem Configuration for Baasix
 * 
 * Production configuration with cluster mode for high availability
 * 
 * Usage:
 *   pm2 start ecosystem.prod.config.js --env production
 *   pm2 save
 *   pm2 startup
 */

module.exports = {
  apps: [
    {
      // Application name
      name: 'baasix-prod',

      // Entry point
      script: '../../server.js',

      // Use tsx for ESM support on all platforms
      interpreter: 'npx',
      interpreter_args: 'tsx',

      // Working directory
      cwd: '../..',

      // Cluster mode settings
      instances: 'max',        // Use all available CPU cores
      exec_mode: 'cluster',    // Enable cluster mode

      // Don't watch in production
      watch: false,

      // Environment variables - Development
      env: {
        NODE_ENV: 'development',
        PORT: 8056,
      },

      // Environment variables - Production
      env_production: {
        NODE_ENV: 'production',
        PORT: 8056,
      },

      // Logging
      error_file: '/var/log/baasix/error.log',
      out_file: '/var/log/baasix/out.log',
      log_file: '/var/log/baasix/combined.log',
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,  // Merge logs from all cluster instances

      // Restart behavior
      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s',
      restart_delay: 4000,

      // Memory limit (restart if exceeded)
      max_memory_restart: '1G',

      // Graceful shutdown
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,

      // Source maps for error tracking
      source_map_support: true,

      // Node.js arguments
      node_args: [
        '--max-old-space-size=1024',  // Increase heap size
      ],

      // Exponential backoff restart delay
      exp_backoff_restart_delay: 100,
    },
  ],

  // Deployment configuration (optional)
  deploy: {
    production: {
      // SSH user
      user: 'deploy',

      // Target server(s)
      host: ['your-server.com'],

      // Git reference to deploy
      ref: 'origin/main',

      // Git repository
      repo: 'git@github.com:your-username/your-repo.git',

      // Deployment path on server
      path: '/var/www/baasix',

      // Commands to run before deployment
      'pre-deploy-local': '',

      // Commands to run after deployment
      'post-deploy': 'npm install && pm2 reload ecosystem.prod.config.js --env production',

      // Environment variables for deployment
      env: {
        NODE_ENV: 'production',
      },
    },
  },
};
