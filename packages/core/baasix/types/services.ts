/**
 * Service Types
 * Centralized service-related type definitions
 */

import type { QueryParams, AggregateMapping, Accountability, PluginHookContext } from '@baasix/types';
import type { FilterObject } from './query.js';
import type { IncludeConfig } from './relations.js';
import type { Transaction } from './internal.js';

// Re-export shared types
export type { ReadResult } from '@baasix/types';

/**
 * Query options for read operations (extends shared QueryParams)
 * Core-specific with FilterObject and IncludeConfig support
 */
export interface QueryOptions extends Omit<QueryParams, 'filter' | 'relConditions' | 'sort' | 'aggregate'> {
  /** Filter conditions using core's FilterObject format */
  filter?: FilterObject;
  /** Sorting configuration - core uses simpler format */
  sort?: string[] | Record<string, 'asc' | 'desc'>;
  /** Aggregate configuration using core's AggregateMapping */
  aggregate?: AggregateMapping;
  /** Relations to include/load */
  include?: IncludeConfig[];
  /** Filter conditions for related items using core's FilterObject */
  relConditions?: Record<string, FilterObject>;
}

/**
 * Service options passed during construction
 */
export interface ServiceParams {
  accountability?: Accountability;
  tenant?: string | number;
}

/**
 * Operation options for write operations
 */
export interface OperationOptions {
  bypassPermissions?: boolean;
  transaction?: Transaction;
  force?: boolean; // Force hard delete even if paranoid mode is enabled
}


/**
 * Permission filter interface
 */
export interface PermissionFilter {
  conditions?: Record<string, any>;
  relConditions?: Record<string, any>;
}

/**
 * Hook context interface - alias for PluginHookContext from @baasix/types
 */
export type HookContext = PluginHookContext;

// Note: HookFunction is exported from plugin.ts (re-exported from @baasix/types)
