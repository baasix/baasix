import axios, { AxiosInstance } from "axios";
import type { SchemaInfo, FieldDefinition } from "@baasix/types";
import { BaasixConfig } from "./get-config.js";

// Re-export types for convenience
export type { SchemaInfo, FieldDefinition };

let client: AxiosInstance | null = null;
let authToken: string | null = null;

export async function createApiClient(config: BaasixConfig): Promise<AxiosInstance> {
  if (client) {
    return client;
  }

  client = axios.create({
    baseURL: config.url,
    timeout: 30000,
    headers: {
      "Content-Type": "application/json",
    },
  });

  // Authenticate if credentials provided
  if (config.token) {
    authToken = config.token;
    client.defaults.headers.common["Authorization"] = `Bearer ${authToken}`;
  } else if (config.email && config.password) {
    try {
      const response = await client.post("/auth/login", {
        email: config.email,
        password: config.password,
      });
      authToken = response.data.token;
      client.defaults.headers.common["Authorization"] = `Bearer ${authToken}`;
    } catch (error) {
      throw new Error(`Failed to authenticate: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  return client;
}

export function getAuthToken(): string | null {
  return authToken;
}

export interface MigrationInfo {
  id: string;
  version: string;
  name: string;
  status: string;
  type: string;
  executedAt?: string;
  batch?: number;
}

export async function fetchSchemas(config: BaasixConfig): Promise<SchemaInfo[]> {
  const client = await createApiClient(config);
  const response = await client.get("/schemas", {
    params: { limit: -1 },
  });
  return response.data.data || [];
}

export async function fetchMigrations(config: BaasixConfig): Promise<MigrationInfo[]> {
  const client = await createApiClient(config);
  const response = await client.get("/migrations");
  return response.data.data || [];
}

export async function runMigrations(config: BaasixConfig, options?: {
  dryRun?: boolean;
  step?: number;
}): Promise<{ success: boolean; message: string; migrations?: MigrationInfo[] }> {
  const client = await createApiClient(config);
  const response = await client.post("/migrations/run", options || {});
  return response.data;
}

export async function rollbackMigrations(config: BaasixConfig, options?: {
  step?: number;
  batch?: number;
}): Promise<{ success: boolean; message: string }> {
  const client = await createApiClient(config);
  const response = await client.post("/migrations/rollback", options || {});
  return response.data;
}
