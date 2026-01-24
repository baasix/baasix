/**
 * Internal Core Types
 * Types used internally by core services
 */

import type { TransactionClient } from '../utils/db.js';

// ============================================================================
// Database Types
// ============================================================================

/**
 * Transaction wrapper that mimics Sequelize's transaction API
 * Allows commit/rollback control like Sequelize
 */
// @ts-ignore - Complex Drizzle transaction type compatibility
export interface Transaction extends TransactionClient {
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
  _committed: boolean;
  _rolledBack: boolean;
}

// ============================================================================
// Route & Cache Types
// ============================================================================

/**
 * Route context for Express routes
 */
export interface RouteContext {
  db: any;
  permissionService?: any;
  mailService?: any;
  storageService?: any;
}

/**
 * Cache interface (internal to cache utility)
 */
export interface CacheInterface {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttl?: number): Promise<void>;
  del(key: string): Promise<void>;
  clear(): Promise<void>;
}

// ============================================================================
// Asset Types
// ============================================================================

/**
 * Asset result interface (core-specific with file details)
 */
export interface AssetResult {
  buffer: Buffer | null;
  contentType: string;
  filePath?: string | null;
  file: any;
  isS3?: boolean;
}

// ============================================================================
// Field Types
// ============================================================================

/**
 * Flattened field interface (core-specific for field path traversal)
 * Used by fieldUtils.getFlattenedFields() for nested field resolution
 */
export interface FlattenedField {
  name: string;
  fullPath: string;
  type: string;
  collection?: string;
  isRelation: boolean;
  relationCollection?: string;
  relationType?: string;
}
