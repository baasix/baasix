# Baasix Core Type Definitions

This directory contains TypeScript type definitions specific to the Baasix core package. Many types are shared via `@baasix/types` and re-exported here for convenience.

## Architecture

Types are split between two locations:

1. **`@baasix/types`** - Shared types used across all packages (core, sdk, cli, app)
2. **`core/baasix/types/`** - Core-specific types that depend on Drizzle ORM or internal implementations

## Directory Structure

```
types/
├── index.ts          # Main export file - aggregates all types
├── drizzle.ts        # Drizzle ORM context types (SortContext, AggregateContext)
├── internal.ts       # Internal core types (Transaction, RouteContext, etc.)
├── external.ts       # External library types (StorageProvider, SocketWithAuth, etc.)
├── query.ts          # Query and filter types with Drizzle dependencies
├── relations.ts      # Relation and association types
├── services.ts       # Service layer types
├── files.ts          # File handling types
├── hooks.ts          # Hook system types
├── plugin.ts         # Plugin types (re-exports from @baasix/types)
├── express.d.ts      # Express Request augmentation
└── README.md         # This file
```

## Usage

### Importing Types

Import from the central index:

```typescript
import type {
  QueryOptions,
  FilterObject,
  Transaction,
  OperatorName,
} from '../types';
```

Or from specific modules:

```typescript
import type { QueryOptions, ServiceParams } from '../types/services';
import type { FilterObject, QueryContext } from '../types/query';
import type { Transaction, RouteContext } from '../types/internal';
```

## Type Categories

### Shared Types (from `@baasix/types`)

These types are re-exported from `@baasix/types` for convenience:

- **Auth**: `JWTPayload`, `Accountability`, `PermissionData`, `AuthMode`
- **Query**: `PaginationOptions`, `PaginationMetadata`, `FilterOperator`, `OperatorName`
- **Aggregation**: `AggregateFunction`, `AggregateConfig`, `AggregateMapping`, `DatePart`
- **Cache**: `CacheStrategy`, `CacheEntry`, `ICacheAdapter`, `CacheSetOptions`
- **Schema**: `ValidationResult`, `FieldValidation`, `SchemaValidation`, `FieldDefinition`
- **Files**: `AssetQuery`, `ProcessedImage`, `UploadedFile`, `ImportOptions`, `ExportOptions`
- **Workflow**: `Workflow`, `WorkflowTriggerType`, `WorkflowStatus`
- **Reports/Stats**: `ReportConfig`, `ReportResult`, `ReportQuery`, `StatsQuery`, `StatsResult`
- **Spatial**: `GeoJSONPoint`, `GeoJSONLineString`, `GeoJSONPolygon`, `GeoJSONGeometry`
- **Common**: `Settings`, `TenantSettings`, `SeedData`, `SeedResult`, `BackgroundTask`

### Drizzle ORM Types (`drizzle.ts`)

Types that depend on Drizzle ORM's `PgTable` and `PgColumn`:

- `SortContext` - Context for building sort queries
- `AggregateContext` - Context for building aggregate queries

### Internal Types (`internal.ts`)

Core-internal types:

- `Transaction` - Transaction wrapper with commit/rollback methods
- `RouteContext` - Route handler context
- `CacheInterface` - Internal cache interface
- `AssetResult` - Asset processing result
- `FlattenedField` - Flattened field representation

### External Library Types (`external.ts`)

Types for external library integrations:

- `StorageProvider` - S3/storage provider configuration
- `SocketWithAuth` - Socket.io socket with authentication
- `MailOptions` - Email sending options (extends shared type)
- `SenderConfig` - Email sender configuration
- `TenantTransporter` - Multi-tenant mail transporter

### Query Types (`query.ts`)

Query-building types with Drizzle dependencies:

- `FilterObject` - Core-specific filter object (Sequelize-style)
- `QueryContext` - Query building context with Drizzle types
- `OperatorContext` - Operator context with column reference
- `ColumnReference` - Column reference format
- `FilterValue` - Filter value types

### Relation Types (`relations.ts`)

Relation and association handling:

- `AssociationType` - Association types (HasMany, BelongsTo, etc.)
- `RelationType` - Relation types
- `AssociationDefinition` - Association definition
- `IncludeConfig` - Include configuration for loading relations
- `ProcessedInclude` - Processed include with join information
- `JoinDefinition` - Join definition for queries
- `ResolvedPath` - Resolved relation path
- `RelationalResult` - Relational data processing result

### Service Types (`services.ts`)

Service layer types:

- `QueryOptions` - Query options extending shared `QueryParams`
- `ServiceParams` - Service construction parameters
- `OperationOptions` - Write operation options
- `PermissionFilter` - Permission filter structure
- `HookContext` - Hook context (alias for `PluginHookContext`)

### File Types (`files.ts`)

File handling types:

- `FileData` - File data structure
- `FileMetadata` - File metadata
- `InternalUploadedFile` - Internal uploaded file representation

### Hook Types (`hooks.ts`)

Hook system types:

- `Hook` - Hook definition
- `HookHandler` - Hook handler function
- `InternalHook` - Internal hook with handler reference

### Plugin Types (`plugin.ts`)

Re-exports all plugin types from `@baasix/types`:

- Express types: `Request`, `Response`, `NextFunction`, `Express`, `Router`
- Plugin interfaces: `PluginDefinition`, `PluginContext`, `PluginRoute`, etc.
- Service interfaces: `IItemsService`, `IPermissionService`, `IMailService`, etc.

### Express Augmentation (`express.d.ts`)

Augments Express Request with `accountability` property for auth middleware.

## Best Practices

1. **Use type imports**: Always use `import type { ... }` for type-only imports
2. **Prefer shared types**: Use types from `@baasix/types` when possible
3. **Import from index**: Import from `types/` for better organization
4. **Avoid circular dependencies**: Core types use `any` where needed to prevent cycles
5. **Document complex types**: Add JSDoc comments for non-obvious definitions

## Why Types Are Split

Some types cannot be moved to `@baasix/types` because they depend on:

1. **Drizzle ORM** - `PgTable`, `PgColumn`, `SQL` types
2. **External libraries** - `@aws-sdk/client-s3`, `socket.io`, `nodemailer`
3. **Internal implementations** - Transaction handling, cache internals

This split keeps `@baasix/types` dependency-free for SDK/CLI consumers while allowing core to have rich type definitions for its ORM and library integrations.
