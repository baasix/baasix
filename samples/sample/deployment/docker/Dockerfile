# Use Node.js 18 Alpine as base image
FROM node:18-alpine

# Install system dependencies
RUN apk add --no-cache \
    bash \
    curl \
    postgresql-client

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (tsx is a devDependency needed for running)
RUN npm ci

# Copy application files
COPY server.js ./
COPY .env* ./

# Copy extensions if they exist
COPY extensions/ ./extensions/ 2>/dev/null || true

# Create uploads directory
RUN mkdir -p uploads

# Create non-root user for security
RUN addgroup -g 1001 -S baasix && \
    adduser -S baasix -u 1001 -G baasix

# Change ownership of app directory
RUN chown -R baasix:baasix /app

# Switch to non-root user
USER baasix

# Expose the application port
EXPOSE 8056

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8056/ || exit 1

# Start the application
CMD ["npx", "tsx", "server.js"]
