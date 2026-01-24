# @baasix/types

Shared TypeScript type definitions for Baasix packages.

## Installation

```bash
npm install @baasix/types
```

## Usage

```typescript
import type {
  // Auth types
  User,
  Role,
  Permission,
  Accountability,
  AuthResponse,
  AuthMode,

  // Schema types
  FieldType,
  FieldDefinition,
  SchemaDefinition,
  RelationshipType,

  // Query types
  Filter,
  FilterOperator,
  OperatorName,
  Sort,
  QueryParams,
  ReportQuery,
  StatsQuery,

  // Response types
  PaginatedResponse,
  SingleResponse,

  // File types
  FileMetadata,
  UploadOptions,
  ImportOptions,
  ExportOptions,

  // Spatial types
  GeoJSONPoint,
  GeoJSONGeometry,

  // Cache types
  CacheConfig,
  ICacheAdapter,

  // Workflow types
  Workflow,
  WorkflowExecution,

  // Common types
  BaseItem,
  DeepPartial,
} from '@baasix/types';
```

## Package Structure

```
src/
├── index.ts        # Main exports (aggregates all types)
├── auth.ts         # Authentication & authorization types
├── schema.ts       # Schema & field definition types
├── query.ts        # Query, filter, sort, aggregation, report & stats types
├── response.ts     # API response types
├── files.ts        # File, asset, import/export types
├── workflow.ts     # Workflow types
├── notification.ts # Notification types
├── spatial.ts      # GeoJSON/spatial types
├── cache.ts        # Cache configuration & adapter types
├── common.ts       # Base types, utilities, settings, hooks, mail, seed
└── plugin.ts       # Plugin system types (Express, services, hooks)
```

## Type Categories

### Auth Types (`auth.ts`)

User and authentication types:
- `User`, `UserWithPassword`, `UserWithRolesAndPermissions`
- `Role`, `Permission`, `PermissionAction`, `PermissionData`, `CreatePermissionData`
- `Tenant`, `Session`, `AuthTokens`, `JWTPayload`
- `Accountability` - User context for permission checking
- `LoginCredentials`, `RegisterData`, `AuthResponse`
- `AuthStateEvent`, `AuthState`, `MagicLinkOptions`, `PasswordResetOptions`
- `OAuth2Tokens`, `OAuth2UserInfo`
- `AuthMode` - Authentication mode (`"jwt"` | `"cookie"`)

### Schema Types (`schema.ts`)

Field and schema definition types:
- `FieldType`, `DefaultValueType`, `FieldValidationRules`, `FieldValues`
- `FieldDefinition`, `FlattenedField`, `FieldInfo`
- `IndexDefinition`, `SchemaDefinition`, `SchemaInfo`
- `SchemaValidation`, `FieldValidation`, `ValidationResult`
- `RelationshipType`, `AssociationType`, `RelationshipDefinition`
- `AssociationDefinition`, `IncludeConfig`, `ProcessedInclude`

### Query Types (`query.ts`)

Filter, sort, pagination, and aggregation types:
- `FilterOperator`, `OperatorName` - All supported filter operators
- `Filter`, `FilterValue`, `FilterCondition`, `LogicalFilter`, `FilterObject`
- `Sort`, `SortDirection`, `SortItem`, `SortObject`
- `PaginationOptions`, `PaginationMetadata`
- `AggregateFunction`, `AggregateConfig`, `Aggregate`, `AggregateMapping`
- `DatePart`, `DateTruncPrecision`
- `QueryParams`, `QueryOptions`, `QueryContext`

Report and stats query types:
- `ReportConfig`, `ReportResult`, `ReportQuery`
- `StatsQuery`, `StatsResult`

### Response Types (`response.ts`)

API response wrapper types:
- `PaginatedResponse<T>` - Paginated list response
- `SingleResponse<T>` - Single item response
- `MutationResponse<T>` - Create/update response
- `DeleteResponse` - Delete operation response
- `BulkResponse<T>` - Bulk operation response
- `ReadResult<T>` - Read operation result
- `ErrorResponse` - Error response

### File Types (`files.ts`)

File and asset handling types:
- `FileMetadata`, `FileData`, `UploadOptions`, `InternalUploadedFile`
- `AssetTransformOptions`, `AssetQuery`, `ProcessedImage`
- `StorageProvider`, `StorageAdapter`

Import/Export types:
- `UploadedFile` - Uploaded file from multipart form
- `ImportOptions`, `ImportResult`
- `ExportOptions`, `ExportResult`

### Workflow Types (`workflow.ts`)

Workflow automation types:
- `Workflow`, `WorkflowFlowData`, `WorkflowTrigger`
- `WorkflowNode`, `WorkflowNodeData`, `WorkflowEdge`
- `WorkflowExecution`, `WorkflowExecutionLog`
- `WorkflowTriggerType`, `WorkflowStatus`, `WorkflowExecutionStatus`

### Notification Types (`notification.ts`)

Notification system types:
- `Notification`, `NotificationType`
- `NotificationOptions`, `SendNotificationData`

### Spatial Types (`spatial.ts`)

GeoJSON/PostGIS compatible types:
- `GeoJSONPoint` - Point geometry `[longitude, latitude]`
- `GeoJSONLineString` - Line geometry
- `GeoJSONPolygon` - Polygon geometry
- `GeoJSONGeometry` - Union of all geometry types

### Cache Types (`cache.ts`)

Caching system types:
- `CacheConfig` - Cache configuration (enabled, ttl, prefix)
- `CacheSetOptions` - Options for cache.set operations
- `CacheStrategy` - Cache strategy (`"explicit"` | `"all"`)
- `CacheEntry` - Cache entry structure
- `ICacheAdapter` - Interface for custom cache adapters

### Common Types (`common.ts`)

Base and utility types:
- `BaseItem`, `TimestampedItem`, `SoftDeletableItem`
- `DeepPartial<T>`, `CollectionItem<T>`, `WithRequired<T, K>`, `WithOptional<T, K>`
- `KeysOfType<T, V>`, `AnyRecord`

Settings types:
- `Settings`, `TenantSettings`

Task types:
- `BackgroundTask`

Hook types:
- `HookEvent`, `HookContext`, `HookHandler`, `Hook`

Other types:
- `HttpMethod` - HTTP methods
- `MailOptions`, `SenderConfig` - Email types
- `SeedData`, `SeedResult` - Database seeding types

### Plugin Types (`plugin.ts`)

Express types (re-exported from `@types/express`):
- `Request`, `Response`, `NextFunction`, `Express`, `Router`
- Aliases: `ExpressRequest`, `PluginRequest`, etc.

Service interfaces:
- `IItemsService`, `IPermissionService`, `IMailService`
- `IStorageService`, `ISettingsService`, `ISocketService`
- `IRealtimeService`, `ITasksService`, `IWorkflowService`
- `IMigrationService`, `IHooksManager`, `ICacheService`
- `IFilesService`, `IAssetsService`, `INotificationService`
- `IReportService`, `IStatsService`

Plugin definition types:
- `PluginType`, `PluginMeta`, `PluginDefinition`, `BaasixPlugin`
- `PluginRoute`, `PluginHook`, `PluginMiddleware`, `PluginSchedule`
- `PluginContext`, `PluginRouteContext`, `PluginHookContext`
- `PluginServiceFactory`, `PluginService`, `PluginAuthProvider`
- `StartServerOptions`, `PluginManagerOptions`, `LoadedPlugin`

## Peer Dependencies

For Express types to work, you need `@types/express` installed:

```bash
npm install -D @types/express
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run dev
```

## License

MIT
