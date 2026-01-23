#!/usr/bin/env node

/**
 * Baasix MCP Server CLI
 *
 * This is the entry point for running the MCP server via npx.
 * Usage: npx @baasix/mcp
 *
 * Environment variables:
 *   BAASIX_URL - URL of your Baasix server (default: http://localhost:8056)
 *   BAASIX_AUTH_TOKEN - Static auth token (optional)
 *   BAASIX_EMAIL - Email for auto-login (optional)
 *   BAASIX_PASSWORD - Password for auto-login (optional)
 */

import { startMCPServer } from "../baasix/index.js";

startMCPServer().catch((error) => {
  console.error("Failed to start MCP server:", error);
  process.exit(1);
});
