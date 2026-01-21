# Docker Deployment

This directory contains Docker configuration files for deploying Baasix.

## Files

- `Dockerfile` - Application container image
- `docker-compose.yml` - Full stack deployment (app + PostgreSQL + Redis)
- `docker-compose.prod.yml` - Production deployment with Nginx
- `.dockerignore` - Files to exclude from Docker build

## Quick Start

### Development

```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f app

# Stop all services
docker-compose down
```

### Production

```bash
# Copy and configure environment
cp ../../.env.production .env

# Build and start with production configuration
docker-compose -f docker-compose.prod.yml up -d

# Scale application instances
docker-compose -f docker-compose.prod.yml up -d --scale app=3
```

## Building the Image

```bash
# Build the image
docker build -t my-baasix-app .

# Run the container
docker run -p 8056:8056 --env-file .env my-baasix-app
```

## Environment Variables

All environment variables from `.env` are passed to the container. See `.env.example` in the project root for all available options.

## Volumes

- `postgres_data` - PostgreSQL data persistence
- `redis_data` - Redis data persistence
- `./uploads` - File uploads directory

## Health Check

The container includes a health check that queries the root `/` endpoint.

## Nginx Configuration

For production, the `docker-compose.prod.yml` includes Nginx as a reverse proxy with:
- SSL termination
- Gzip compression
- WebSocket support for Socket.IO
- Static file caching
