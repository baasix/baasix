import type { StorageAdapter } from "./storage/types";

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Authentication mode for the SDK
 * - 'jwt': Use JWT tokens stored in the configured storage adapter (default)
 * - 'cookie': Use HTTP-only cookies (server handles token storage)
 */
export type AuthMode = "jwt" | "cookie";

/**
 * SDK Configuration options
 */
export interface BaasixConfig {
  /**
   * The base URL of your Baasix instance
   * @example 'https://api.example.com' or 'http://localhost:8056'
   */
  url: string;

  /**
   * Authentication mode
   * @default 'jwt'
   */
  authMode?: AuthMode;

  /**
   * Storage adapter for persisting tokens and user data
   * @default LocalStorageAdapter (web) or MemoryStorageAdapter (SSR)
   */
  storage?: StorageAdapter;

  /**
   * Static access token (useful for server-side or service accounts)
   * When provided, this token is used instead of stored tokens
   */
  token?: string;

  /**
   * Custom headers to include in all requests
   */
  headers?: Record<string, string>;

  /**
   * Request timeout in milliseconds
   * @default 30000 (30 seconds)
   */
  timeout?: number;

  /**
   * Whether to automatically refresh tokens before expiry
   * @default true
   */
  autoRefresh?: boolean;

  /**
   * Credentials mode for fetch requests (important for cookies)
   * @default 'include' for cookie mode, 'same-origin' for jwt mode
   */
  credentials?: RequestCredentials;

  /**
   * Tenant ID for multi-tenant mode
   */
  tenantId?: string;

  /**
   * Global error handler
   */
  onError?: (error: BaasixError) => void;

  /**
   * Called when authentication state changes
   */
  onAuthStateChange?: (event: AuthStateEvent, user: User | null) => void;

  /**
   * WebSocket server URL for realtime features
   * @default Same as url
   */
  socketUrl?: string;

  /**
   * WebSocket path
   * @default '/socket'
   */
  socketPath?: string;
}

// ============================================================================
// Authentication Types
// ============================================================================

export interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  avatar?: string;
  role?: Role;
  role_Id?: string;
  tenant_Id?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface Role {
  id: string;
  name: string;
  description?: string;
  [key: string]: unknown;
}

export interface Tenant {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  expiresIn?: number;
}

export interface LoginCredentials {
  email: string;
  password: string;
  tenantId?: string;
}

export interface RegisterData {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  [key: string]: unknown;
}

export interface AuthResponse {
  token: string;
  refreshToken?: string;
  user: User;
  expiresIn?: number;
}

export type AuthStateEvent =
  | "SIGNED_IN"
  | "SIGNED_OUT"
  | "TOKEN_REFRESHED"
  | "USER_UPDATED"
  | "TENANT_SWITCHED";

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: BaasixError | null;
}

export interface MagicLinkOptions {
  email: string;
  redirectUrl?: string;
  mode?: "link" | "code";
}

export interface PasswordResetOptions {
  email: string;
  redirectUrl?: string;
}

// ============================================================================
// Query Types
// ============================================================================

/**
 * Filter operators supported by Baasix
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
  // Range
  | "between"
  | "notBetween"
  | "nbetween"
  // Null
  | "isNull"
  | "isNotNull"
  // Array (PostgreSQL)
  | "arraycontains"
  | "arraycontained"
  | "arrayoverlap"
  | "arraylength"
  // JSONB
  | "jsonbContains"
  | "jsonbContainedBy"
  | "jsonbNotContains"
  | "jsonbHasKey"
  | "jsonbHasAnyKeys"
  | "jsonbHasAllKeys"
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
  | "intersects"
  | "nIntersects"
  | "dwithin";

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
 * Sort direction
 */
export type SortDirection = "asc" | "desc" | "ASC" | "DESC";

/**
 * Sort configuration
 */
export type Sort =
  | string
  | string[]
  | Record<string, SortDirection>
  | { column: string; order: SortDirection }[];

/**
 * Aggregation function
 */
export type AggregateFunction = "count" | "sum" | "avg" | "min" | "max";

/**
 * Aggregation configuration
 */
export interface AggregateConfig {
  function: AggregateFunction;
  field: string;
}

export type Aggregate = Record<string, AggregateConfig>;

/**
 * Query parameters for listing items
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
   * @example { createdAt: 'desc' } or ['-createdAt', 'name']
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

// ============================================================================
// Response Types
// ============================================================================

/**
 * Paginated response
 */
export interface PaginatedResponse<T> {
  data: T[];
  totalCount?: number;
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

// ============================================================================
// Schema Types
// ============================================================================

export type FieldType =
  | "String"
  | "Text"
  | "HTML"
  | "Integer"
  | "BigInt"
  | "Float"
  | "Real"
  | "Double"
  | "Decimal"
  | "Boolean"
  | "Date"
  | "DateTime"
  | "Time"
  | "UUID"
  | "SUID"
  | "JSON"
  | "JSONB"
  | "Array"
  | "Geometry"
  | "Point"
  | "LineString"
  | "Polygon"
  | "Enum";

/**
 * Default value types supported by Baasix
 */
export type DefaultValueType =
  | { type: "UUIDV4" }
  | { type: "SUID" }
  | { type: "NOW" }
  | { type: "AUTOINCREMENT" }
  | { type: "SQL"; value: string }
  | { type: "CURRENT_USER" }
  | { type: "CURRENT_TENANT" };

export interface FieldDefinition {
  type: FieldType;
  primaryKey?: boolean;
  allowNull?: boolean;
  unique?: boolean;
  /**
   * Default value for the field
   * Can be a static value or a dynamic type
   * @example
   * // Static values
   * defaultValue: "active"
   * defaultValue: 0
   * defaultValue: false
   * defaultValue: []
   * 
   * // Dynamic types
   * defaultValue: { type: "UUIDV4" }
   * defaultValue: { type: "SUID" }
   * defaultValue: { type: "NOW" }
   * defaultValue: { type: "AUTOINCREMENT" }
   * defaultValue: { type: "SQL", value: "CURRENT_DATE" }
   */
  defaultValue?: DefaultValueType | string | number | boolean | null | unknown[] | Record<string, unknown>;
  values?: {
    length?: number;
    precision?: number;
    scale?: number;
    type?: string;
    values?: string[]; // For Enum
  };
  validate?: {
    /** Minimum value for numeric fields */
    min?: number;
    /** Maximum value for numeric fields */
    max?: number;
    /** Validate as integer */
    isInt?: boolean;
    /** String must not be empty */
    notEmpty?: boolean;
    /** Validate email format */
    isEmail?: boolean;
    /** Validate URL format */
    isUrl?: boolean;
    /** String length range [min, max] */
    len?: [number, number];
    /** Pattern matching with regex (alias: matches) */
    is?: string;
    /** Pattern matching with regex (alias: is) */
    matches?: string;
    /** @deprecated Use 'is' or 'matches' instead */
    regex?: string;
  };
  comment?: string;
}

export interface SchemaDefinition {
  name: string;
  timestamps?: boolean;
  paranoid?: boolean;
  /** 
   * True for M2M/M2A junction tables (system-generated)
   * Junction tables are auto-created when defining M2M or M2A relationships
   */
  isJunction?: boolean;
  fields: Record<string, FieldDefinition>;
  indexes?: IndexDefinition[];
}

export interface IndexDefinition {
  name: string;
  fields: string[];
  unique?: boolean;
  /** When true, NULL values are considered equal for unique indexes (PostgreSQL 15+) */
  nullsNotDistinct?: boolean;
}

export type RelationshipType = "M2O" | "O2M" | "M2M" | "M2A" | "O2O";

export interface RelationshipDefinition {
  type: RelationshipType;
  target: string;
  name: string;
  alias?: string;
  /** 
   * Custom junction table name for M2M/M2A relationships (max 63 chars for PostgreSQL)
   * If not provided, auto-generated as: {source}_{target}_{name}_junction
   * @example "product_tags" or "comment_refs"
   */
  through?: string;
  onDelete?: "CASCADE" | "RESTRICT" | "SET NULL";
  onUpdate?: "CASCADE" | "RESTRICT" | "SET NULL";
  /** Target tables for M2A (polymorphic) relationships */
  tables?: string[];
}

export interface SchemaInfo {
  collectionName: string;
  schema: SchemaDefinition;
  relationships?: RelationshipDefinition[];
}

// ============================================================================
// File Types
// ============================================================================

export interface FileMetadata {
  id: string;
  title?: string;
  description?: string;
  filename: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  storage: string;
  path: string;
  isPublic?: boolean;
  uploadedBy?: string;
  createdAt: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface UploadOptions {
  title?: string;
  description?: string;
  folder?: string;
  storage?: "local" | "s3";
  isPublic?: boolean;
  metadata?: Record<string, unknown>;
  onProgress?: (progress: number) => void;
  /** Request timeout in milliseconds (default: 30000). Set to 0 for no timeout. */
  timeout?: number;
}

export interface AssetTransformOptions {
  width?: number;
  height?: number;
  fit?: "cover" | "contain" | "fill" | "inside" | "outside";
  quality?: number;
  format?: "jpeg" | "png" | "webp" | "avif";
}

// ============================================================================
// Permission Types
// ============================================================================

export type PermissionAction = "create" | "read" | "update" | "delete";

export interface Permission {
  id: string;
  role_Id: string;
  collection: string;
  action: PermissionAction;
  fields?: string[];
  conditions?: Filter;
  defaultValues?: Record<string, unknown>;
  relConditions?: Record<string, Filter>;
}

export interface CreatePermissionData {
  role_Id: string;
  collection: string;
  action: PermissionAction;
  fields?: string[];
  conditions?: Filter;
  defaultValues?: Record<string, unknown>;
  relConditions?: Record<string, Filter>;
}

// ============================================================================
// Notification Types
// ============================================================================

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  seen: boolean;
  user_Id: string;
  createdAt: string;
}

export interface SendNotificationData {
  type?: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  userIds: string[];
}

// ============================================================================
// Workflow Types
// ============================================================================

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  trigger: WorkflowTrigger;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface WorkflowTrigger {
  type: "manual" | "webhook" | "schedule" | "hook";
  config?: Record<string, unknown>;
}

export interface WorkflowNode {
  id: string;
  type: string;
  config: Record<string, unknown>;
  position?: { x: number; y: number };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  condition?: string;
}

export interface WorkflowExecution {
  id: string;
  workflow_Id: string;
  status: "pending" | "running" | "completed" | "failed";
  triggerData?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  startedAt: string;
  completedAt?: string;
}

// ============================================================================
// Report Types
// ============================================================================

export interface ReportConfig {
  collection: string;
  filter?: Filter;
  groupBy?: string;
  aggregate?: Aggregate;
  dateRange?: {
    start: string;
    end: string;
    field?: string;
  };
}

export interface ReportResult {
  data: Record<string, unknown>[];
  summary?: Record<string, unknown>;
}

// ============================================================================
// Error Types
// ============================================================================

export interface BaasixErrorDetails {
  code?: string;
  field?: string;
  message?: string;
  [key: string]: unknown;
}

export class BaasixError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly details?: BaasixErrorDetails[];
  public readonly isRetryable: boolean;

  constructor(
    message: string,
    status = 500,
    code?: string,
    details?: BaasixErrorDetails[]
  ) {
    super(message);
    this.name = "BaasixError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.isRetryable = status >= 500 || status === 429;

    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, BaasixError);
    }
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      code: this.code,
      details: this.details,
    };
  }
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Make all properties of T optional recursively
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * Extract the item type from a collection
 */
export type CollectionItem<T> = T extends Array<infer U> ? U : T;

/**
 * Generic record type with ID
 */
export interface BaseItem {
  id: string;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string;
  [key: string]: unknown;
}

/**
 * Settings configuration
 */
export interface Settings {
  [key: string]: unknown;
}
