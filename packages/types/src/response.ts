/**
 * Response Types
 * Shared across core, sdk, cli, and app packages
 */

// ============================================================================
// API Response Types
// ============================================================================

/**
 * Paginated response
 */
export interface PaginatedResponse<T> {
  data: T[];
  /**
   * Total number of records matching the query.
   * `null` when the count was intentionally skipped via `count: false`
   * (or the deployment default `COUNT_BY_DEFAULT=false`).
   */
  totalCount?: number | null;
  page?: number;
  limit?: number;
  totalPages?: number;
}

/**
 * Single item response
 */
export interface SingleResponse<T> {
  data: T;
}

/**
 * Create/Update response
 */
export interface MutationResponse<T = string> {
  data: T;
  message?: string;
}

/**
 * Delete response
 */
export interface DeleteResponse {
  data: { deleted: boolean; count?: number };
  message?: string;
}

/**
 * Bulk operation response
 */
export interface BulkResponse<T = string[]> {
  data: T;
  message?: string;
  errors?: Array<{ index: number; error: string }>;
}

/**
 * Read result (used internally in services)
 */
export interface ReadResult<T = any> {
  data: T[];
  /**
   * Total number of records matching the query.
   * `null` when the count was intentionally skipped (see `QueryParams.count`).
   */
  totalCount: number | null;
  page?: number;
  limit?: number;
}

/**
 * Error response
 */
export interface ErrorResponse {
  error: string;
  message: string;
  status: number;
  details?: unknown[];
}
