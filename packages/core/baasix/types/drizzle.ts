/**
 * Drizzle ORM Context Types
 * Core-specific types that depend on Drizzle ORM
 */

import type { PgTable, PgColumn } from 'drizzle-orm/pg-core';

// ============================================================================
// Sort Context
// ============================================================================

/**
 * Query context for sorting (core-specific with Drizzle types)
 */
export interface SortContext {
  table?: PgTable;
  tableName?: string;
  schema?: Record<string, PgColumn>;
}

// ============================================================================
// Aggregation Context
// ============================================================================

/**
 * Context for building aggregates (core-specific with Drizzle types)
 */
export interface AggregateContext {
  tableName?: string;
  schema?: Record<string, PgColumn>;
  pathToAliasMap?: Map<string, string>;
}
