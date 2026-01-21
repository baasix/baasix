#!/bin/bash
# =============================================================================
# Baasix Deployment Script
# =============================================================================
# This script automates the deployment process for Baasix
# Usage: ./deploy.sh
# =============================================================================

set -e  # Exit on error

APP_DIR="/var/www/baasix"
BACKUP_DIR="/var/backups/baasix"
LOG_FILE="/var/log/baasix-deploy.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE"
    exit 1
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1" | tee -a "$LOG_FILE"
}

# Create backup
create_backup() {
    log "Creating backup..."
    mkdir -p "$BACKUP_DIR"
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    
    # Backup database
    if command -v pg_dump &> /dev/null; then
        pg_dump -h localhost -U baasix_user baasix_production | gzip > "$BACKUP_DIR/db_$TIMESTAMP.sql.gz"
        log "Database backup created: db_$TIMESTAMP.sql.gz"
    fi
    
    # Backup uploads
    if [ -d "$APP_DIR/uploads" ]; then
        tar -czf "$BACKUP_DIR/uploads_$TIMESTAMP.tar.gz" -C "$APP_DIR" uploads
        log "Uploads backup created: uploads_$TIMESTAMP.tar.gz"
    fi
    
    # Clean old backups (keep last 7 days)
    find "$BACKUP_DIR" -name "*.gz" -mtime +7 -delete
    log "Old backups cleaned"
}

# Update application
update_app() {
    log "Updating application..."
    cd "$APP_DIR"
    
    # Update package
    npm update @baasix/baasix
    
    log "Application updated"
}

# Restart services
restart_services() {
    log "Restarting services..."
    
    # Reload PM2 with zero downtime
    pm2 reload baasix
    
    log "Services restarted"
}

# Health check
health_check() {
    log "Running health check..."
    
    sleep 5  # Wait for app to start
    
    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8056/)
    
    if [ "$RESPONSE" == "200" ]; then
        log "Health check passed"
    else
        error "Health check failed with status $RESPONSE"
    fi
}

# Main
main() {
    log "Starting deployment..."
    
    create_backup
    update_app
    restart_services
    health_check
    
    log "Deployment completed successfully!"
}

main "$@"
