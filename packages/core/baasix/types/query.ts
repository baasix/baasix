/**
 * Query, Filter, and Pagination Types
 * Core-specific query-building type definitions
 * Note: PaginationOptions, PaginationMetadata, FilterOperator, OperatorName are exported from index.ts via @baasix/types
 */

import type { PgTable, PgColumn } from 'drizzle-orm/pg-core';
import type { JoinDefinition } from './relations.js';

// Note: OperatorName is exported from index.ts via @baasix/types

/**
 * Filter object structure (Sequelize-style) - core-specific with Drizzle support
 */
export interface FilterObject {
  [key: string]: any;
  AND?: FilterObject[];
  OR?: FilterObject[];
  cast?: string;
}

/**
 * Query context for building where conditions (core-specific with Drizzle types)
 */
export interface QueryContext {
  table?: PgTable;
  tableName?: string;
  schema?: Record<string, PgColumn>;
  schemaDefinition?: any; // From SchemaManager
  joins?: JoinDefinition[]; // Array to accumulate joins for relation paths
  forPermissionCheck?: boolean; // If true, use INNER JOINs for relation filters to enforce existence
}

/**
 * Column reference format for filter values
 * Format: $COL(columnName) or $COL(tableName.columnName)
 */
export type ColumnReference = string;

/**
 * Type for filter operator values
 */
export type FilterValue = string | number | boolean | null | Date | any[] | Record<string, any> | ColumnReference;

/**
 * Interface for operator context (core-specific with Drizzle types)
 */
export interface OperatorContext {
  column: PgColumn;
  schemaTable?: any; // Drizzle table schema
  fieldName: string;
  tableName?: string;
}

// OperatorName is now imported from @baasix/types (see re-export at top of file)
