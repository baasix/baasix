/**
 * Storage adapter interface for persisting authentication state.
 * Implement this interface to create custom storage solutions (e.g., AsyncStorage for React Native).
 */
export interface StorageAdapter {
  /**
   * Get a value from storage
   * @param key - The storage key
   * @returns The stored value or null if not found
   */
  get(key: string): Promise<string | null> | string | null;

  /**
   * Set a value in storage
   * @param key - The storage key
   * @param value - The value to store
   */
  set(key: string, value: string): Promise<void> | void;

  /**
   * Remove a value from storage
   * @param key - The storage key
   */
  remove(key: string): Promise<void> | void;

  /**
   * Clear all SDK-related values from storage
   */
  clear?(): Promise<void> | void;
}

/**
 * Storage keys used by the SDK
 */
export const STORAGE_KEYS = {
  ACCESS_TOKEN: "baasix_access_token",
  REFRESH_TOKEN: "baasix_refresh_token",
  TOKEN_EXPIRY: "baasix_token_expiry",
  USER: "baasix_user",
  TENANT: "baasix_tenant",
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
