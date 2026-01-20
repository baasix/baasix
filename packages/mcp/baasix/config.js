/**
 * Configuration utility for Baasix MCP Server
 * Handles environment variable loading and validation
 */

import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Default configuration values
const DEFAULT_CONFIG = {
  BAASIX_URL: 'http://localhost:8056',
  BAASIX_EMAIL: 'admin@baasix.com',
  BAASIX_PASSWORD: 'admin@123'
};

// Load environment variables with priority
export function loadEnvironmentConfig(options = {}) {
  const {
    envPath = null,
    useDefaults = true,
    processEnv = true
  } = options;

  let config = {};

  // 1. Load defaults
  if (useDefaults) {
    config = { ...DEFAULT_CONFIG };
  }

  // 2. Load from .env file (look in mcp root directory)
  const mcpRootPath = join(__dirname, '..');
  if (envPath || fs.existsSync(join(mcpRootPath, '.env'))) {
    const dotenvPath = envPath || join(mcpRootPath, '.env');
    const result = dotenvConfig({ path: dotenvPath });
    if (result.parsed) {
      config = { ...config, ...result.parsed };
    }
  }

  // 3. Override with process environment variables
  if (processEnv) {
    const envVars = [
      'BAASIX_URL',
      'BAASIX_AUTH_TOKEN',
      'BAASIX_EMAIL',
      'BAASIX_PASSWORD'
    ];

    envVars.forEach(key => {
      if (process.env[key]) {
        config[key] = process.env[key];
      }
    });
  }

  return config;
}

// Validate configuration
export function validateConfig(config) {
  const errors = [];
  const warnings = [];

  // Required: BAASIX_URL
  if (!config.BAASIX_URL) {
    errors.push('BAASIX_URL is required');
  }

  // Authentication method validation
  const hasToken = config.BAASIX_AUTH_TOKEN;
  const hasCredentials = config.BAASIX_EMAIL && config.BAASIX_PASSWORD;

  if (!hasToken && !hasCredentials) {
    errors.push('Either BAASIX_AUTH_TOKEN or both BAASIX_EMAIL and BAASIX_PASSWORD must be provided');
  }

  if (hasToken && hasCredentials) {
    warnings.push('Both token and credentials provided - token will take priority');
  }

  // URL validation
  if (config.BAASIX_URL) {
    try {
      new URL(config.BAASIX_URL);
    } catch (error) {
      errors.push('BAASIX_URL must be a valid URL');
    }
  }

  return { errors, warnings, isValid: errors.length === 0 };
}

// Create configuration with validation
export function createConfig(options = {}) {
  const config = loadEnvironmentConfig(options);
  const validation = validateConfig(config);

  if (!validation.isValid) {
    throw new Error(`Configuration validation failed:\n${validation.errors.join('\n')}`);
  }

  if (validation.warnings.length > 0) {
    validation.warnings.forEach(warning => {
      console.warn(`Warning: ${warning}`);
    });
  }

  return config;
}

// Export default configuration loader
export default function getConfig(options = {}) {
  return createConfig(options);
}
