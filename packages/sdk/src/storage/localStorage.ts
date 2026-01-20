import type { StorageAdapter } from "./types";

/**
 * LocalStorage adapter for web browsers.
 * This is the default storage adapter used when running in a browser environment.
 *
 * @example
 * ```typescript
 * import { createBaasix, LocalStorageAdapter } from '@baasix/sdk';
 *
 * const client = createBaasix({
 *   url: 'https://api.example.com',
 *   storage: new LocalStorageAdapter(),
 * });
 * ```
 */
export class LocalStorageAdapter implements StorageAdapter {
  private prefix: string;

  constructor(prefix = "baasix_") {
    this.prefix = prefix;
  }

  private getKey(key: string): string {
    // If key already starts with prefix, don't add it again
    if (key.startsWith(this.prefix)) {
      return key;
    }
    return `${this.prefix}${key}`;
  }

  get(key: string): string | null {
    if (typeof window === "undefined" || !window.localStorage) {
      return null;
    }
    try {
      return localStorage.getItem(this.getKey(key));
    } catch {
      console.warn(`[Baasix SDK] Failed to get item from localStorage: ${key}`);
      return null;
    }
  }

  set(key: string, value: string): void {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    try {
      localStorage.setItem(this.getKey(key), value);
    } catch {
      console.warn(`[Baasix SDK] Failed to set item in localStorage: ${key}`);
    }
  }

  remove(key: string): void {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    try {
      localStorage.removeItem(this.getKey(key));
    } catch {
      console.warn(`[Baasix SDK] Failed to remove item from localStorage: ${key}`);
    }
  }

  clear(): void {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(this.prefix)) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));
    } catch {
      console.warn("[Baasix SDK] Failed to clear localStorage");
    }
  }
}
