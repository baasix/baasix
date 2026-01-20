import type { StorageAdapter } from "./types";

/**
 * In-memory storage adapter.
 * Useful for server-side rendering (SSR), testing, or environments without persistent storage.
 * Data is lost when the application restarts.
 *
 * @example
 * ```typescript
 * import { createBaasix, MemoryStorageAdapter } from '@baasix/sdk';
 *
 * const client = createBaasix({
 *   url: 'https://api.example.com',
 *   storage: new MemoryStorageAdapter(),
 * });
 * ```
 */
export class MemoryStorageAdapter implements StorageAdapter {
  private store: Map<string, string>;

  constructor() {
    this.store = new Map();
  }

  get(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  set(key: string, value: string): void {
    this.store.set(key, value);
  }

  remove(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  /**
   * Get all stored keys (useful for debugging)
   */
  keys(): string[] {
    return Array.from(this.store.keys());
  }

  /**
   * Get the number of stored items
   */
  size(): number {
    return this.store.size;
  }
}
