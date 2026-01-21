/**
 * Baasix Server Entry Point
 * 
 * This is the main entry point for your Baasix-powered application.
 * It imports and starts the server from the @baasix/baasix package.
 */

import { startServer } from "@baasix/baasix";

// Start the server with proper error handling
// Basic usage - uses defaults (pretty printing in development, JSON in production)
startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

/**
 * LOGGER CONFIGURATION EXAMPLES
 * =============================
 * 
 * The startServer function now accepts logger configuration options powered by Pino.
 * By default, it uses stdio output with pretty printing in development.
 * 
 * Example 1: Basic configuration with port and log level
 * -------------------------------------------------------
 * startServer({
 *   port: 3000,
 *   logger: {
 *     level: "debug"  // Options: 'fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'
 *   }
 * });
 * 
 * Example 2: Pretty printing (default in development)
 * ---------------------------------------------------
 * startServer({
 *   logger: {
 *     pretty: true,  // Use pino-pretty for human-readable output
 *     level: "info"
 *   }
 * });
 * 
 * Example 3: JSON output for production (default in production)
 * -------------------------------------------------------------
 * startServer({
 *   logger: {
 *     pretty: false,  // Disable pretty printing, output raw JSON
 *     level: "warn"
 *   }
 * });
 * 
 * Example 4: Custom transport (e.g., file logging)
 * ------------------------------------------------
 * startServer({
 *   logger: {
 *     transport: {
 *       target: "pino/file",
 *       options: { destination: "./logs/app.log" }
 *     },
 *     level: "info"
 *   }
 * });
 * 
 * Example 5: Multiple transports
 * ------------------------------
 * startServer({
 *   logger: {
 *     transport: {
 *       targets: [
 *         { target: "pino-pretty", options: { colorize: true }, level: "info" },
 *         { target: "pino/file", options: { destination: "./logs/app.log" }, level: "error" }
 *       ]
 *     }
 *   }
 * });
 * 
 * Example 6: Custom pino options
 * ------------------------------
 * startServer({
 *   logger: {
 *     level: "info",
 *     options: {
 *       name: "my-baasix-app",
 *       base: { pid: process.pid },
 *       timestamp: () => `,"time":"${new Date().toISOString()}"`
 *     }
 *   }
 * });
 * 
 * Example 7: Datadog integration (requires pino-datadog-transport)
 * ----------------------------------------------------------------
 * // First install: npm install pino-datadog-transport
 * startServer({
 *   logger: {
 *     level: "info",
 *     transport: {
 *       target: "pino-datadog-transport",
 *       options: {
 *         apiKey: process.env.DD_API_KEY,
 *         service: "baasix-api",
 *         env: process.env.NODE_ENV || "development",
 *         hostname: process.env.HOSTNAME,
 *         // Optional: add custom tags
 *         ddtags: "team:backend,version:1.0.0"
 *       }
 *     }
 *   }
 * });
 * 
 * Example 8: Datadog with local console output (multiple transports)
 * ------------------------------------------------------------------
 * startServer({
 *   logger: {
 *     transport: {
 *       targets: [
 *         // Console output for local development
 *         { target: "pino-pretty", options: { colorize: true }, level: "debug" },
 *         // Datadog for production monitoring
 *         { 
 *           target: "pino-datadog-transport", 
 *           options: {
 *             apiKey: process.env.DD_API_KEY,
 *             service: "baasix-api",
 *             env: process.env.NODE_ENV,
 *             ddsource: "nodejs"
 *           },
 *           level: "info"
 *         }
 *       ]
 *     }
 *   }
 * });
 * 
 * Example 9: Loki (Grafana) integration (requires pino-loki)
 * ----------------------------------------------------------
 * // First install: npm install pino-loki
 * startServer({
 *   logger: {
 *     transport: {
 *       target: "pino-loki",
 *       options: {
 *         host: "http://localhost:3100",
 *         labels: { application: "baasix-api", environment: "production" }
 *       }
 *     }
 *   }
 * });
 * 
 * Example 10: Elasticsearch integration (requires pino-elasticsearch)
 * -------------------------------------------------------------------
 * // First install: npm install pino-elasticsearch
 * startServer({
 *   logger: {
 *     transport: {
 *       target: "pino-elasticsearch",
 *       options: {
 *         node: "http://localhost:9200",
 *         index: "baasix-logs",
 *         esVersion: 8
 *       }
 *     }
 *   }
 * });
 * 
 * Environment Variables:
 * ----------------------
 * - LOG_LEVEL: Set the log level (e.g., LOG_LEVEL=debug)
 * - DEBUGGING: Set to "true" to enable debug logging
 * - NODE_ENV: When "development", pretty printing is enabled by default
 * 
 * Popular Pino Transports:
 * ------------------------
 * - pino-pretty: Human-readable console output
 * - pino/file: File logging
 * - pino-datadog-transport: Datadog integration
 * - pino-loki: Grafana Loki integration
 * - pino-elasticsearch: Elasticsearch integration
 * - pino-sentry-transport: Sentry error tracking
 * - pino-cloudwatch: AWS CloudWatch Logs
 * - @logtail/pino: Logtail/Better Stack integration
 */
