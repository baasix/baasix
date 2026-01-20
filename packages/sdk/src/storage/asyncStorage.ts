import type { StorageAdapter } from "./types";

/**
 * Type definition for AsyncStorage-like interface (React Native)
 */
interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  multiRemove?(keys: string[]): Promise<void>;
  getAllKeys?(): Promise<readonly string[]>;
}

/**
 * AsyncStorage adapter for React Native.
 * Wraps @react-native-async-storage/async-storage or any compatible implementation.
 *
 * @example
 * ```typescript
 * import { createBaasix, AsyncStorageAdapter } from '@baasix/sdk';
 * import AsyncStorage from '@react-native-async-storage/async-storage';
 *
 * const client = createBaasix({
 *   url: 'https://api.example.com',
 *   storage: new AsyncStorageAdapter(AsyncStorage),
 * });
 * ```
 */
export class AsyncStorageAdapter implements StorageAdapter {
  private asyncStorage: AsyncStorageLike;
  private prefix: string;

  constructor(asyncStorage: AsyncStorageLike, prefix = "baasix_") {
    this.asyncStorage = asyncStorage;
    this.prefix = prefix;
  }

  private getKey(key: string): string {
    if (key.startsWith(this.prefix)) {
      return key;
    }
    return `${this.prefix}${key}`;
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.asyncStorage.getItem(this.getKey(key));
    } catch {
      console.warn(`[Baasix SDK] Failed to get item from AsyncStorage: ${key}`);
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      await this.asyncStorage.setItem(this.getKey(key), value);
    } catch {
      console.warn(`[Baasix SDK] Failed to set item in AsyncStorage: ${key}`);
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await this.asyncStorage.removeItem(this.getKey(key));
    } catch {
      console.warn(`[Baasix SDK] Failed to remove item from AsyncStorage: ${key}`);
    }
  }

  async clear(): Promise<void> {
    try {
      if (this.asyncStorage.getAllKeys && this.asyncStorage.multiRemove) {
        const allKeys = await this.asyncStorage.getAllKeys();
        const sdkKeys = allKeys.filter((key) => key.startsWith(this.prefix));
        if (sdkKeys.length > 0) {
          await this.asyncStorage.multiRemove(sdkKeys);
        }
      }
    } catch {
      console.warn("[Baasix SDK] Failed to clear AsyncStorage");
    }
  }
}
