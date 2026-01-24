/**
 * Baasix SDK Types
 *
 * This file re-exports shared types from @baasix/types and defines
 * SDK-specific types that are not shared with other packages.
 */

import type { StorageAdapter } from "./storage/types";

// ============================================================================
// Re-export shared types from @baasix/types
// ============================================================================

// Auth types
export type {
  User,
  UserWithPassword,
  UserWithRolesAndPermissions,
  Role,
  PermissionAction,
  Permission,
  PermissionData,
  CreatePermissionData,
  Tenant,
  Session,
  AuthTokens,
  JWTPayload,
  Accountability,
  LoginCredentials,
  RegisterData,
  AuthResponse,
  AuthStateEvent,
  AuthState,
  MagicLinkOptions,
  PasswordResetOptions,
  OAuth2Tokens,
  OAuth2UserInfo,
} from "@baasix/types";

// Schema types
export type {
  FieldType,
  DefaultValueType,
  FieldValidationRules,
  FieldValues,
  FieldDefinition,
  FlattenedField,
  FieldInfo,
  IndexDefinition,
  SchemaDefinition,
  SchemaInfo,
  SchemaValidation,
  FieldValidation,
  ValidationResult,
  RelationshipType,
  AssociationType,
  RelationshipDefinition,
  AssociationDefinition,
  IncludeConfig,
  ProcessedInclude,
} from "@baasix/types";

// Query types
export type {
  FilterOperator,
  FilterValue,
  FilterCondition,
  LogicalFilter,
  Filter,
  FilterObject,
  SortDirection,
  Sort,
  SortItem,
  SortObject,
  PaginationOptions,
  PaginationMetadata,
  AggregateFunction,
  AggregateConfig,
  Aggregate,
  DatePart,
  DateTruncPrecision,
  QueryParams,
  QueryOptions,
  QueryContext,
} from "@baasix/types";

// Response types
export type {
  PaginatedResponse,
  SingleResponse,
  MutationResponse,
  DeleteResponse,
  BulkResponse,
  ReadResult,
  ErrorResponse,
} from "@baasix/types";

// File types
export type {
  FileMetadata,
  FileData,
  UploadOptions,
  InternalUploadedFile,
  AssetTransformOptions,
  AssetQuery,
  ProcessedImage,
  StorageProvider,
} from "@baasix/types";

// Workflow types
export type {
  WorkflowTriggerType,
  WorkflowStatus,
  Workflow,
  WorkflowFlowData,
  WorkflowTrigger,
  WorkflowNode,
  WorkflowNodeData,
  WorkflowEdge,
  WorkflowExecutionStatus,
  WorkflowExecution,
  WorkflowExecutionLog,
} from "@baasix/types";

// Notification types
export type {
  NotificationType,
  Notification,
  NotificationOptions,
  SendNotificationData,
} from "@baasix/types";

// Common types
export type {
  BaseItem,
  TimestampedItem,
  SoftDeletableItem,
  DeepPartial,
  CollectionItem,
  WithRequired,
  WithOptional,
  KeysOfType,
  AnyRecord,
  Settings,
  TenantSettings,
  // Import/Export types
  UploadedFile,
  ImportOptions,
  ExportOptions,
  ImportResult,
  ExportResult,
  // Stats types
  StatsQuery,
  StatsResult,
  // Task types
  BackgroundTask,
  // Report types
  ReportConfig,
  ReportResult,
  // Spatial types
  GeoJSONPoint,
  GeoJSONLineString,
  GeoJSONPolygon,
  GeoJSONGeometry,
  // Hook types
  HookEvent,
  HookContext,
  HookHandler,
  Hook,
  // HTTP types
  HttpMethod,
  // Mail types
  MailOptions,
  SenderConfig,
  // Seed types
  SeedData,
  SeedResult,
  // Cache types
  CacheConfig,
  CacheStrategy,
} from "@baasix/types";

// Import types needed for SDK-specific interfaces
import type { User, AuthStateEvent } from "@baasix/types";

// Auth mode (re-exported from @baasix/types)
export type { AuthMode } from "@baasix/types";

// Import for internal use
import type { AuthMode } from "@baasix/types";

// ============================================================================
// SDK-Specific Types (not shared)
// ============================================================================

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
// Error Types (SDK-specific implementation)
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
