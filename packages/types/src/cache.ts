/**
 * Cache Types
 * Types for caching functionality
 */

// ============================================================================
// Cache Configuration Types
// ============================================================================

/**
 * Cache configuration (SDK/app level)
 */
export interface CacheConfig {
  enabled?: boolean;
  ttl?: number;
  prefix?: string;
}

/**
 * Cache set options (Redis-style options for cache.set operations)
 */
export interface CacheSetOptions {
  /** Expiration in seconds */
  ex?: number;
  [key: string]: unknown;
}

/**
 * Cache strategy
 */
export type CacheStrategy = "explicit" | "all";

// ============================================================================
// Cache Entry Types
// ============================================================================

/**
 * Cache entry structure
 */
export interface CacheEntry {
  value: any;
  expiry: number;
  tables: string[];
  tags: string[];
  tenant?: string | null;
}

// ============================================================================
// Cache Adapter Interface
// ============================================================================

/**
 * Base interface for all cache adapters
 * Implement this interface to create custom cache adapters
 */
export interface ICacheAdapter {
  get(key: string): Promise<any | null>;
  set(key: string, value: any, ttl?: number, metadata?: { tables: string[]; tags: string[]; tenant?: string | null }): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  invalidateByPattern(pattern: string): Promise<void>;
  invalidateByTables(tables: string[], tenant?: string | null): Promise<void>;
  invalidateByTags(tags: string[], tenant?: string | null): Promise<void>;
  getStats(): Promise<{ keys: number; size?: number }>;
  close(): Promise<void>;
}
