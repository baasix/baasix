# PM2 Deployment

This directory contains PM2 configuration files for deploying Baasix with process management.

## Files

- `ecosystem.config.js` - PM2 ecosystem configuration
- `ecosystem.prod.config.js` - Production PM2 configuration with clustering

## Prerequisites

```bash
# Install PM2 globally
npm install -g pm2
```

## Quick Start

### Development

```bash
# Start with development configuration
pm2 start ecosystem.config.js

# View logs
pm2 logs baasix

# Monitor processes
pm2 monit
```

### Production

```bash
# Start with production configuration (cluster mode)
pm2 start ecosystem.prod.config.js --env production

# Save process list for auto-restart
pm2 save

# Setup auto-start on system boot
pm2 startup
```

## Commands

```bash
# Start application
pm2 start ecosystem.config.js

# Stop application
pm2 stop baasix

# Restart application
pm2 restart baasix

# Reload with zero downtime
pm2 reload baasix

# Delete from PM2
pm2 delete baasix

# View all processes
pm2 list

# View logs
pm2 logs baasix

# View logs with timestamp
pm2 logs baasix --timestamp

# Monitor CPU/Memory
pm2 monit

# View detailed info
pm2 show baasix
```

## Cluster Mode

Production configuration uses cluster mode to spawn multiple instances:

```javascript
{
  instances: 'max',      // Use all CPU cores
  exec_mode: 'cluster',  // Enable cluster mode
}
```

You can also specify a fixed number:

```javascript
{
  instances: 4,  // Run 4 instances
}
```

## Log Rotation

Install PM2 log rotation module:

```bash
pm2 install pm2-logrotate

# Configure rotation
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

## Monitoring

### PM2 Plus (Optional)

For advanced monitoring, use PM2 Plus:

```bash
pm2 link <secret> <public>
```

### Health Checks

PM2 will automatically restart the application if it crashes. Configure additional health checks in the ecosystem file:

```javascript
{
  max_restarts: 10,
  min_uptime: '10s',
  restart_delay: 4000,
}
```

## Memory Management

Set memory limits to prevent memory leaks:

```javascript
{
  max_memory_restart: '500M',  // Restart if memory exceeds 500MB
}
```
