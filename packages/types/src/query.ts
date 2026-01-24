/**
 * Query & Filter Types
 * Shared across core, sdk, cli, and app packages
 */

// ============================================================================
// Filter Types
// ============================================================================

/**
 * Filter operators supported by Baasix
 * Also known as OperatorName in core (alias provided for backward compatibility)
 */
export type FilterOperator =
  // Comparison
  | "eq"
  | "ne"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "is"
  | "not"
  // Collection
  | "in"
  | "notIn"
  | "nin"
  // String patterns
  | "like"
  | "notLike"
  | "iLike"
  | "notILike"
  | "ilike"
  | "contains"
  | "icontains"
  | "ncontains"
  | "startsWith"
  | "startsWiths"
  | "endsWith"
  | "endsWiths"
  | "nstartsWith"
  | "nstartsWiths"
  | "nendsWith"
  | "nendsWiths"
  | "regex"
  // Range
  | "between"
  | "notBetween"
  | "nbetween"
  // Null/Empty
  | "isNull"
  | "isNotNull"
  | "empty"
  // Array (PostgreSQL)
  | "arraycontains"
  | "arraycontainsany"
  | "arraycontained"
  | "arrayoverlap"
  | "arraylength"
  | "arrayempty"
  // JSONB
  | "jsoncontains"
  | "jsonbContains"
  | "jsonbContainedBy"
  | "jsonbNotContains"
  | "jsonhaskey"
  | "jsonbHasKey"
  | "jsonhasanykeys"
  | "jsonbHasAnyKeys"
  | "jsonhasallkeys"
  | "jsonbHasAllKeys"
  | "jsonpath"
  | "jsonbKeyEquals"
  | "jsonbKeyNotEquals"
  | "jsonbKeyGt"
  | "jsonbKeyGte"
  | "jsonbKeyLt"
  | "jsonbKeyLte"
  | "jsonbKeyIn"
  | "jsonbKeyNotIn"
  | "jsonbKeyLike"
  | "jsonbKeyIsNull"
  | "jsonbKeyIsNotNull"
  | "jsonbPathExists"
  | "jsonbPathMatch"
  | "jsonbDeepValue"
  | "jsonbArrayLength"
  | "jsonbTypeOf"
  // Geospatial (PostGIS)
  | "within"
  | "containsGEO"
  | "contains"
  | "intersects"
  | "nIntersects"
  | "dwithin"
  | "overlaps";

/**
 * Operator name type (alias for FilterOperator)
 * Used internally in core for the OPERATOR_MAP keys
 * @see FilterOperator
 */
export type OperatorName = FilterOperator;

/**
 * Filter value with operator
 */
export type FilterValue<T = unknown> =
  | T
  | { [K in FilterOperator]?: T | T[] }
  | { cast?: string };

/**
 * Filter condition for a field
 */
export type FilterCondition = {
  [field: string]: FilterValue | FilterCondition;
};

/**
 * Logical filter operators
 */
export interface LogicalFilter {
  AND?: (FilterCondition | LogicalFilter)[];
  OR?: (FilterCondition | LogicalFilter)[];
  NOT?: FilterCondition | LogicalFilter;
}

/**
 * Complete filter type
 */
export type Filter = FilterCondition | LogicalFilter;

/**
 * Filter object (used internally in core)
 */
export interface FilterObject {
  field: string;
  operator: FilterOperator;
  value: unknown;
  cast?: string;
}

// ============================================================================
// Sort Types
// ============================================================================

/**
 * Sort direction
 */
export type SortDirection = "asc" | "desc" | "ASC" | "DESC";

/**
 * Sort configuration - supports multiple formats
 */
export type Sort =
  | string
  | string[]
  | Record<string, SortDirection>
  | { column: string; order: SortDirection }[]
  | { field: string; order: SortDirection }[];

/**
 * Sort item (normalized)
 */
export interface SortItem {
  field: string;
  direction: SortDirection;
}

/**
 * Sort object structure (Sequelize-style)
 * Example: { name: 'ASC', createdAt: 'DESC' }
 */
export interface SortObject {
  [field: string]: SortDirection;
}

// ============================================================================
// Pagination Types
// ============================================================================

/**
 * Pagination options
 */
export interface PaginationOptions {
  page?: number;
  limit?: number;
  offset?: number;
  pageSize?: number;
}

/**
 * Pagination metadata in response
 */
export interface PaginationMetadata {
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  /** @deprecated Use total instead */
  totalCount?: number;
  /** @deprecated Use pageCount instead */
  totalPages?: number;
  /** @deprecated Use pageSize instead */
  limit?: number;
}

// ============================================================================
// Aggregation Types
// ============================================================================

/**
 * Aggregation function
 */
export type AggregateFunction =
  | "count"
  | "sum"
  | "avg"
  | "min"
  | "max"
  | "distinct"
  | "array_agg";

/**
 * Aggregation configuration
 */
export interface AggregateConfig {
  function: AggregateFunction;
  field: string;
  alias?: string;
}

/**
 * Aggregate mapping (general form)
 */
export type Aggregate = Record<string, AggregateConfig | AggregateFunction>;

/**
 * Aggregate result mapping (strict form - always uses AggregateConfig)
 * Example: { totalUsers: { function: 'count', field: 'id' } }
 */
export interface AggregateMapping {
  [alias: string]: AggregateConfig;
}

/**
 * Date part for date extraction
 */
export type DatePart =
  | "year"
  | "month"
  | "week"
  | "day"
  | "hour"
  | "minute"
  | "second"
  | "dow"
  | "isodow"
  | "quarter";

/**
 * Date truncation precision
 */
export type DateTruncPrecision =
  | "day"
  | "week"
  | "month"
  | "year"
  | "hour"
  | "minute"
  | "second";

// ============================================================================
// Query Parameters
// ============================================================================

/**
 * Query parameters for listing items
 * Used by SDK, app, and can be extended by core for internal use
 */
export interface QueryParams<T = unknown> {
  /**
   * Fields to return
   * @example ['*'], ['id', 'name'], ['*', 'author.*']
   */
  fields?: string[];

  /**
   * Filter conditions
   */
  filter?: Filter;

  /**
   * Sorting configuration
   */
  sort?: Sort;

  /**
   * Number of items per page (-1 for all)
   * @default 10
   */
  limit?: number;

  /**
   * Page number (1-indexed)
   * @default 1
   */
  page?: number;

  /**
   * Number of items to skip
   */
  offset?: number;

  /**
   * Full-text search query
   */
  search?: string;

  /**
   * Fields to search in
   */
  searchFields?: string[];

  /**
   * Sort results by search relevance
   * @default false
   */
  sortByRelevance?: boolean;

  /**
   * Aggregation configuration
   */
  aggregate?: Aggregate;

  /**
   * Fields to group by (used with aggregate)
   */
  groupBy?: string[];

  /**
   * Include soft-deleted items
   * @default false
   */
  paranoid?: boolean;

  /**
   * Filter conditions for related items (O2M/M2M)
   */
  relConditions?: Record<string, Filter>;

  /**
   * Additional metadata
   */
  meta?: T;
}

/**
 * Query options for read operations (alias for QueryParams)
 * Core-compatible naming
 */
export type QueryOptions = QueryParams;

/**
 * Query context (used internally in core)
 */
export interface QueryContext {
  collection: string;
  filter?: Filter;
  sort?: Sort;
  fields?: string[];
  limit?: number;
  page?: number;
  offset?: number;
  aggregate?: Aggregate;
  groupBy?: string[];
}

// ============================================================================
// Report Query Types
// ============================================================================

/**
 * Report configuration
 */
export interface ReportConfig {
  collection: string;
  filter?: Record<string, unknown>;
  groupBy?: string;
  aggregate?: Record<string, unknown>;
  dateRange?: {
    start: string;
    end: string;
    field?: string;
  };
}

/**
 * Report result
 */
export interface ReportResult {
  data: Record<string, unknown>[];
  summary?: Record<string, unknown>;
}

/**
 * Report query parameters
 */
export interface ReportQuery {
  fields?: string[];
  filter?: Record<string, any>;
  sort?: string[];
  limit?: number;
  page?: number;
  aggregate?: Record<string, any>;
  groupBy?: string[];
}

// ============================================================================
// Stats Query Types
// ============================================================================

/**
 * Stats query
 */
export interface StatsQuery {
  name: string;
  query: Record<string, unknown>;
  collection: string;
}

/**
 * Stats result
 */
export interface StatsResult {
  data: Record<string, unknown>;
  totalStats: number;
  successfulStats: number;
}
