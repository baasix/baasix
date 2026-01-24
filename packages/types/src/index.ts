/**
 * @baasix/types
 * Shared TypeScript types for Baasix packages
 *
 * This package provides common type definitions used across:
 * - @baasix/core (backend)
 * - @baasix/sdk (client SDK)
 * - @baasix/cli (command-line interface)
 * - @baasix/app (admin panel)
 */

// ============================================================================
// Auth Types
// ============================================================================
export type {
  // User types
  User,
  UserWithPassword,
  UserWithRolesAndPermissions,
  // Role & Permission types
  Role,
  PermissionAction,
  Permission,
  PermissionData,
  CreatePermissionData,
  // Tenant types
  Tenant,
  // Session & Token types
  Session,
  AuthTokens,
  JWTPayload,
  // Accountability
  Accountability,
  // Auth request/response types
  LoginCredentials,
  RegisterData,
  AuthResponse,
  AuthStateEvent,
  AuthState,
  MagicLinkOptions,
  PasswordResetOptions,
  // OAuth types
  OAuth2Tokens,
  OAuth2UserInfo,
  // Auth mode
  AuthMode,
} from "./auth";

// ============================================================================
// Schema Types
// ============================================================================
export type {
  // Field types
  FieldType,
  DefaultValueType,
  FieldValidationRules,
  FieldValues,
  FieldDefinition,
  FlattenedField,
  FieldInfo,
  // Schema types
  IndexDefinition,
  SchemaDefinition,
  SchemaInfo,
  SchemaValidation,
  FieldValidation,
  ValidationResult,
  // Relationship types
  RelationshipType,
  AssociationType,
  RelationshipDefinition,
  AssociationDefinition,
  IncludeConfig,
  ProcessedInclude,
} from "./schema";

// ============================================================================
// Query Types (includes Report & Stats query types)
// ============================================================================
export type {
  // Filter types
  FilterOperator,
  OperatorName,
  FilterValue,
  FilterCondition,
  LogicalFilter,
  Filter,
  FilterObject,
  // Sort types
  SortDirection,
  Sort,
  SortItem,
  SortObject,
  // Pagination types
  PaginationOptions,
  PaginationMetadata,
  // Aggregation types
  AggregateFunction,
  AggregateConfig,
  Aggregate,
  AggregateMapping,
  DatePart,
  DateTruncPrecision,
  // Query parameters
  QueryParams,
  QueryOptions,
  QueryContext,
  // Report query types
  ReportConfig,
  ReportResult,
  ReportQuery,
  // Stats query types
  StatsQuery,
  StatsResult,
} from "./query";

// ============================================================================
// Response Types
// ============================================================================
export type {
  PaginatedResponse,
  SingleResponse,
  MutationResponse,
  DeleteResponse,
  BulkResponse,
  ReadResult,
  ErrorResponse,
} from "./response";

// ============================================================================
// File Types (includes Import/Export types)
// ============================================================================
export type {
  // File metadata
  FileMetadata,
  FileData,
  UploadOptions,
  InternalUploadedFile,
  // Asset types
  AssetTransformOptions,
  AssetQuery,
  ProcessedImage,
  // Storage types
  StorageProvider,
  StorageAdapter,
  // Import/Export types
  UploadedFile,
  ImportOptions,
  ExportOptions,
  ImportResult,
  ExportResult,
} from "./files";

// ============================================================================
// Workflow Types
// ============================================================================
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
} from "./workflow";

// ============================================================================
// Notification Types
// ============================================================================
export type {
  NotificationType,
  Notification,
  NotificationOptions,
  SendNotificationData,
} from "./notification";

// ============================================================================
// Spatial/GeoJSON Types
// ============================================================================
export type {
  GeoJSONPoint,
  GeoJSONLineString,
  GeoJSONPolygon,
  GeoJSONGeometry,
} from "./spatial";

// ============================================================================
// Cache Types
// ============================================================================
export type {
  CacheConfig,
  CacheSetOptions,
  CacheStrategy,
  CacheEntry,
  ICacheAdapter,
} from "./cache";

// ============================================================================
// Common Types
// ============================================================================
export type {
  // Base types
  BaseItem,
  TimestampedItem,
  SoftDeletableItem,
  // Utility types
  DeepPartial,
  CollectionItem,
  WithRequired,
  WithOptional,
  KeysOfType,
  AnyRecord,
  // Settings types
  Settings,
  TenantSettings,
  // Task types
  BackgroundTask,
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
} from "./common";

// ============================================================================
// Plugin Types
// ============================================================================
export type {
  // Express types (actual Express types from @types/express)
  Request,
  Response,
  NextFunction,
  Express,
  Router,
  // Express type aliases
  ExpressRequest,
  ExpressResponse,
  ExpressNextFunction,
  ExpressApp,
  ExpressRouter,
  // Express-compatible types (can be used without importing express)
  PluginRequest,
  PluginResponse,
  PluginNextFunction,
  PluginApp,
  PluginRouter,
  // Service interfaces
  ServiceOptions,
  IItemsService,
  IPermissionService,
  IMailService,
  IStorageService,
  ISettingsService,
  ISocketService,
  IRealtimeService,
  ITasksService,
  IWorkflowService,
  IMigrationService,
  IHooksManager,
  HookFunction,
  ICacheService,
  IFilesService,
  IAssetsService,
  INotificationService,
  IReportService,
  IStatsService,
  // Plugin types
  PluginType,
  PluginMeta,
  PluginSchemaDefinition,
  PluginRouteContext,
  PluginRouteHandler,
  PluginRoute,
  PluginHookEvent,
  PluginHookContext,
  PluginHookHandler,
  PluginHook,
  PluginContext,
  PluginServiceFactory,
  PluginService,
  AuthProviderType,
  OAuth2Config,
  PluginAuthProvider,
  PluginMiddleware,
  PluginSchedule,
  PluginDefinition,
  PluginFactory,
  BaasixPlugin,
  LoadedPlugin,
  PluginManagerOptions,
  StartServerOptions,
  // Express-typed plugin types (for core package)
  ExpressPluginRouteHandler,
  ExpressPluginRoute,
  ExpressPluginMiddleware,
  ExpressPluginContext,
} from "./plugin";
