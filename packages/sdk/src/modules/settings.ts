import type { HttpClient } from "../client";
import type { Settings } from "../types";

export interface SettingsModuleConfig {
  client: HttpClient;
}

/**
 * Settings module for managing application settings.
 *
 * @example
 * ```typescript
 * // Get all settings
 * const settings = await baasix.settings.get();
 *
 * // Update settings
 * await baasix.settings.update({
 *   appName: 'My App',
 *   theme: 'dark'
 * });
 * ```
 */
export class SettingsModule {
  private client: HttpClient;

  constructor(config: SettingsModuleConfig) {
    this.client = config.client;
  }

  /**
   * Get all settings
   *
   * @example
   * ```typescript
   * const settings = await baasix.settings.get();
   * console.log(settings.appName);
   * ```
   */
  async get(): Promise<Settings> {
    const response = await this.client.get<{ data: Settings }>("/settings");
    return response.data;
  }

  /**
   * Get a specific setting by key
   *
   * @example
   * ```typescript
   * const appName = await baasix.settings.getKey('appName');
   * ```
   */
  async getKey<T = unknown>(key: string): Promise<T | null> {
    const settings = await this.get();
    return (settings[key] as T) ?? null;
  }

  /**
   * Update settings
   *
   * @example
   * ```typescript
   * await baasix.settings.update({
   *   appName: 'Updated App Name',
   *   logo: 'file-uuid',
   *   customConfig: {
   *     feature1: true,
   *     feature2: false
   *   }
   * });
   * ```
   */
  async update(settings: Partial<Settings>): Promise<Settings> {
    const response = await this.client.patch<{ data: Settings }>(
      "/settings",
      settings
    );
    return response.data;
  }

  /**
   * Set a specific setting
   *
   * @example
   * ```typescript
   * await baasix.settings.set('appName', 'My New App Name');
   * ```
   */
  async set<T>(key: string, value: T): Promise<Settings> {
    return this.update({ [key]: value });
  }
}

// Re-export types
export type { Settings };
