import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "dotenv";

export interface BaasixConfig {
  url: string;
  email?: string;
  password?: string;
  token?: string;
}

/**
 * Load Baasix configuration from .env file or environment variables
 */
export async function getConfig(cwd: string): Promise<BaasixConfig | null> {
  // Check for .env file
  const envPath = path.join(cwd, ".env");
  let envVars: Record<string, string> = {};

  if (existsSync(envPath)) {
    const envContent = await fs.readFile(envPath, "utf-8");
    envVars = parse(envContent);
  }

  // Merge with process.env (process.env takes precedence)
  const mergedEnv = { ...envVars, ...process.env };

  const url = mergedEnv.BAASIX_URL || mergedEnv.API_URL || "http://localhost:8056";
  const email = mergedEnv.BAASIX_EMAIL || mergedEnv.ADMIN_EMAIL;
  const password = mergedEnv.BAASIX_PASSWORD || mergedEnv.ADMIN_PASSWORD;
  const token = mergedEnv.BAASIX_TOKEN || mergedEnv.BAASIX_AUTH_TOKEN;

  if (!url) {
    return null;
  }

  return {
    url,
    email,
    password,
    token,
  };
}

/**
 * Load configuration from baasix.config.js or baasix.config.ts if exists
 */
export async function loadConfigFile(cwd: string): Promise<Record<string, unknown> | null> {
  const possiblePaths = [
    "baasix.config.js",
    "baasix.config.mjs",
    "baasix.config.ts",
  ];

  for (const configPath of possiblePaths) {
    const fullPath = path.join(cwd, configPath);
    if (existsSync(fullPath)) {
      try {
        const config = await import(fullPath);
        return config.default || config;
      } catch {
        // Ignore import errors
      }
    }
  }

  return null;
}
