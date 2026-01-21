# Manual Deployment

This guide covers deploying Baasix manually on a server without containerization.

## Prerequisites

- Linux server (Ubuntu 20.04+ recommended)
- Node.js 18+
- PostgreSQL 14+ with PostGIS
- Redis 6+
- PM2 (for process management)
- Nginx (for reverse proxy)

## Step-by-Step Deployment

### 1. Prepare the Server

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version  # Should be 18.x
npm --version

# Install PM2 globally
sudo npm install -g pm2
```

### 2. Install PostgreSQL with PostGIS

```bash
# Install PostgreSQL
sudo apt install postgresql postgresql-contrib -y

# Install PostGIS
sudo apt install postgis postgresql-14-postgis-3 -y

# Start PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database and user
sudo -u postgres psql << EOF
CREATE USER baasix_user WITH PASSWORD 'your_secure_password';
CREATE DATABASE baasix_production OWNER baasix_user;
GRANT ALL PRIVILEGES ON DATABASE baasix_production TO baasix_user;
\c baasix_production
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
EOF
```

### 3. Install Redis

```bash
# Install Redis
sudo apt install redis-server -y

# Configure Redis (optional: set password)
sudo nano /etc/redis/redis.conf
# Uncomment and set: requirepass your_redis_password

# Start Redis
sudo systemctl start redis-server
sudo systemctl enable redis-server

# Test Redis
redis-cli ping  # Should return PONG
```

### 4. Deploy Application

```bash
# Create application directory
sudo mkdir -p /var/www/baasix
sudo chown $USER:$USER /var/www/baasix

# Navigate to directory
cd /var/www/baasix

# Create project files
cat > package.json << 'EOF'
{
  "name": "my-baasix-app",
  "version": "1.0.0",
  "type": "module",
  "main": "server.js",
  "scripts": {
    "start": "tsx server.js",
    "dev": "tsx watch server.js"
  },
  "dependencies": {
    "@baasix/baasix": "latest"
  },
  "devDependencies": {
    "tsx": "^4.16.0"
  }
}
EOF

cat > server.js << 'EOF'
import { startServer } from "@baasix/baasix";

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
EOF

# Install dependencies
npm install

# Create and configure .env file
cp .env.production .env
nano .env  # Edit with your configuration

# Create required directories
mkdir -p uploads logs extensions
```

### 5. Configure PM2

```bash
# Create PM2 ecosystem file
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'baasix',
    script: './server.js',
    instances: 'max',
    exec_mode: 'cluster',
    env_production: {
      NODE_ENV: 'production',
      PORT: 8056
    },
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    time: true,
    max_memory_restart: '500M'
  }]
};
EOF

# Start with PM2
pm2 start ecosystem.config.js --env production

# Save PM2 process list
pm2 save

# Setup PM2 to start on boot
pm2 startup
# Run the command it outputs
```

### 6. Configure Nginx

```bash
# Install Nginx
sudo apt install nginx -y

# Create Nginx configuration
sudo nano /etc/nginx/sites-available/baasix

# Add the following configuration (see nginx.conf in this directory)

# Enable the site
sudo ln -s /etc/nginx/sites-available/baasix /etc/nginx/sites-enabled/

# Remove default site
sudo rm /etc/nginx/sites-enabled/default

# Test configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
```

### 7. Setup SSL with Let's Encrypt

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx -y

# Obtain certificate
sudo certbot --nginx -d api.yourdomain.com

# Auto-renewal is configured automatically
# Test renewal
sudo certbot renew --dry-run
```

### 8. Configure Firewall

```bash
# Enable UFW
sudo ufw enable

# Allow SSH
sudo ufw allow ssh

# Allow HTTP and HTTPS
sudo ufw allow 'Nginx Full'

# Check status
sudo ufw status
```

## Maintenance

### View Logs

```bash
# PM2 logs
pm2 logs baasix

# Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### Update Application

```bash
cd /var/www/baasix

# Update package
npm update @baasix/baasix

# Restart with zero downtime
pm2 reload baasix
```

### Backup

```bash
# Database backup
pg_dump -h localhost -U baasix_user baasix_production | gzip > backup_$(date +%Y%m%d).sql.gz

# Files backup
tar -czf uploads_backup_$(date +%Y%m%d).tar.gz uploads/
```

## Troubleshooting

### Check Service Status

```bash
# Check PM2
pm2 status

# Check PostgreSQL
sudo systemctl status postgresql

# Check Redis
sudo systemctl status redis-server

# Check Nginx
sudo systemctl status nginx
```

### Common Issues

1. **Database connection failed**: Check PostgreSQL is running and credentials are correct
2. **Redis connection failed**: Check Redis is running and CACHE_REDIS_URL is correct
3. **Permission denied**: Check file ownership and permissions
4. **Port already in use**: Check if another process is using port 8056
