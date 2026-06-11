import type { HttpClient } from "../client";

export interface ServerInfo {
  project?: {
    name?: string;
    multitenant?: boolean | string;
    [key: string]: unknown;
  };
  version?: string;
  [key: string]: unknown;
}

export interface ServerModuleConfig {
  client: HttpClient;
}

/**
 * Server module for retrieving server information.
 *
 * @example
 * ```typescript
 * const info = await baasix.server.info();
 * console.log(info.project?.name);
 * ```
 */
export class ServerModule {
  private client: HttpClient;

  constructor(config: ServerModuleConfig) {
    this.client = config.client;
  }

  /**
   * Get server information including project settings
   *
   * @param tenantId - Optional tenant ID to fetch tenant-merged project settings
   *
   * @example
   * ```typescript
   * const info = await baasix.server.info();
   * console.log('Project:', info.project?.name);
   * console.log('Version:', info.version);
   * ```
   */
  async info(tenantId?: string): Promise<ServerInfo> {
    return this.client.get<ServerInfo>(
      "/",
      tenantId ? { params: { tenant_id: tenantId } } : undefined
    );
  }

  /**
   * Check server health
   *
   * @example
   * ```typescript
   * const isHealthy = await baasix.server.health();
   * ```
   */
  async health(): Promise<boolean> {
    try {
      await this.client.get("/health");
      return true;
    } catch {
      return false;
    }
  }
}
