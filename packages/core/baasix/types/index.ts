/**
 * Centralized Type Exports
 * Single source for all type definitions across the application
 *
 * Note: Core has its own internal type definitions that differ from @baasix/types
 * due to implementation-specific requirements. The @baasix/types package provides
 * simplified types for SDK/CLI consumers.
 */

// ============================================================================
// Direct re-exports from @baasix/types (shared types)
// ============================================================================

// Import/Export types
export type {
  UploadedFile,
  ImportOptions,
  ExportOptions,
  ImportResult,
  ExportResult,
} from '@baasix/types';

// Notification types
export type {
  NotificationOptions,
  Notification,
  NotificationType,
} from '@baasix/types';

// Schema validation types
export type {
  ValidationResult,
  FieldValidation,
  SchemaValidation,
} from '@baasix/types';

// Settings types
export type {
  TenantSettings,
  Settings,
} from '@baasix/types';

// Spatial/GIS types
export type {
  GeoJSONPoint,
  GeoJSONLineString,
  GeoJSONPolygon,
  GeoJSONGeometry,
} from '@baasix/types';

// Stats types
export type {
  StatsQuery,
  StatsResult,
} from '@baasix/types';

// Workflow types
export type {
  Workflow,
  WorkflowTriggerType,
  WorkflowStatus,
  WorkflowFlowData,
  WorkflowNode,
  WorkflowEdge,
} from '@baasix/types';

// Seed types
export type {
  SeedData,
  SeedResult,
} from '@baasix/types';

// Report types
export type {
  ReportConfig,
  ReportResult,
  ReportQuery,
} from '@baasix/types';

// Task types
export type {
  BackgroundTask,
} from '@baasix/types';

// Aggregation types
export type {
  AggregateFunction,
  AggregateConfig,
  AggregateMapping,
  DatePart,
  DateTruncPrecision,
} from '@baasix/types';

// Auth types
export type {
  JWTPayload,
  UserWithRolesAndPermissions,
  PermissionData,
  Accountability,
  AuthMode,
} from '@baasix/types';

// Cache types
export type {
  CacheStrategy,
  CacheEntry,
  ICacheAdapter,
  CacheSetOptions,
} from '@baasix/types';

// Backward compatibility alias
export type { CacheSetOptions as CacheConfig } from '@baasix/types';

// Field types
export type {
  FieldValidationRules,
  FieldDefinition,
} from '@baasix/types';

// Query types
export type {
  PaginationOptions,
  PaginationMetadata,
  FilterOperator,
  OperatorName,
} from '@baasix/types';

// Sort types
export type {
  SortDirection,
  SortObject,
} from '@baasix/types';

// Asset types
export type {
  AssetQuery,
  ProcessedImage,
} from '@baasix/types';

// ============================================================================
// Core-specific types
// ============================================================================

// Drizzle ORM context types (SortContext, AggregateContext)
export * from './drizzle.js';

// Internal core types (Transaction, RouteContext, CacheInterface, AssetResult, FlattenedField)
export * from './internal.js';

// External library types (StorageProvider, SocketWithAuth, MailOptions, SenderConfig, TenantTransporter)
export * from './external.js';

// Query and filter types (FilterObject, QueryContext, OperatorContext, etc.)
export * from './query.js';

// Relation types (AssociationDefinition, IncludeConfig, ProcessedInclude, etc.)
export * from './relations.js';

// Service types (QueryOptions, ServiceParams, OperationOptions, etc.)
export * from './services.js';

// File types (FileData, FileMetadata, InternalUploadedFile)
export * from './files.js';

// Hook types (Hook, HookHandler, InternalHook)
export * from './hooks.js';

// Plugin types (includes Express types from @baasix/types)
export * from './plugin.js';
