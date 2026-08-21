# @baasix/sdk

Official JavaScript/TypeScript SDK for [Baasix](https://www.baasix.com) Backend-as-a-Service.

[![npm version](https://img.shields.io/npm/v/@baasix/sdk.svg)](https://www.npmjs.com/package/@baasix/sdk)
[![npm downloads](https://img.shields.io/npm/dm/@baasix/sdk.svg)](https://www.npmjs.com/package/@baasix/sdk)
[![license](https://img.shields.io/npm/l/@baasix/sdk.svg)](https://github.com/baasix/baasix/blob/main/LICENSE)

## Features

- 🌐 **Universal** - Works in browsers, Node.js, and React Native
- 🔐 **Flexible Auth** - JWT tokens, HTTP-only cookies, 35+ OAuth providers (Google, GitHub, Discord, Microsoft, Slack, and more), passkeys (WebAuthn), and 2FA (TOTP + backup codes)
- 💾 **Customizable Storage** - LocalStorage, AsyncStorage, or custom adapters
- 📝 **Type-Safe** - Full TypeScript support with generics
- 🔄 **Auto Token Refresh** - Seamless token management
- 🏢 **Multi-Tenant** - Built-in tenant switching and invitation support
- ⚡ **Query Builder** - Fluent API for complex queries with 50+ filter operators
- 📡 **Realtime** - WebSocket subscriptions for live data updates
- 📁 **File Management** - Upload, download, and transform assets
- 🔀 **Workflows** - Execute and monitor workflow executions
- 👥 **User & Role Management** - Admin operations for users and roles
- 📊 **Reports** - Generate reports with aggregations
- 🔔 **Notifications** - User notification system with realtime delivery
- 🗃️ **Migrations** - Database schema migration management
- 🔃 **Sort/Reorder** - Drag-and-drop style item reordering
- 🧩 **App Builder** - Create and manage pages & blocks via the items API

## Installation

```bash
npm install @baasix/sdk
# or
yarn add @baasix/sdk
# or
pnpm add @baasix/sdk
```

## Quick Start

```typescript
import { createBaasix } from '@baasix/sdk';

// Create client
const baasix = createBaasix({
  url: 'https://your-baasix-instance.com',
});

// Login
const { user, token } = await baasix.auth.login({
  email: 'user@example.com',
  password: 'password123',
});

// Query items
const { data: products } = await baasix.items('products').find({
  filter: { status: { eq: 'active' } },
  sort: { createdAt: 'desc' },
  limit: 10,
});

// Create item
const productId = await baasix.items('products').create({
  name: 'New Product',
  price: 29.99,
});
```

## Configuration

### Basic Configuration

```typescript
import { createBaasix } from '@baasix/sdk';

const baasix = createBaasix({
  url: 'https://api.example.com',        // Required: Your Baasix URL
  authMode: 'jwt',                        // 'jwt' (default) or 'cookie'
  timeout: 30000,                         // Request timeout in ms (default: 30000)
  autoRefresh: true,                      // Auto-refresh tokens (default: true)
  onAuthStateChange: (event, user) => {   // Auth state callback
    console.log('Auth changed:', event, user);
  },
});
```

### React Native Setup

```typescript
import { createBaasix, AsyncStorageAdapter } from '@baasix/sdk';
import AsyncStorage from '@react-native-async-storage/async-storage';

const baasix = createBaasix({
  url: 'https://api.example.com',
  storage: new AsyncStorageAdapter(AsyncStorage),
});
```

### Cookie Mode (Web with HTTP-only cookies)

```typescript
const baasix = createBaasix({
  url: 'https://api.example.com',
  authMode: 'cookie',
  credentials: 'include', // Required for cookies
});
```

### Server-Side / Service Account

```typescript
const baasix = createBaasix({
  url: 'https://api.example.com',
  token: 'your-service-account-token', // Static token
});
```

## Authentication

### Register

```typescript
const { user, token } = await baasix.auth.register({
  email: 'newuser@example.com',
  password: 'securepassword',
  firstName: 'John',
  lastName: 'Doe',
});
```

### Login

```typescript
const { user, token } = await baasix.auth.login({
  email: 'user@example.com',
  password: 'password123',
});

// With tenant (multi-tenant mode)
const result = await baasix.auth.login({
  email: 'user@example.com',
  password: 'password123',
  tenantId: 'tenant-uuid',
});

// With authMode and authType for session management
const result = await baasix.auth.login({
  email: 'user@example.com',
  password: 'password123',
  authMode: 'cookie', // 'jwt' (default) or 'cookie'
  authType: 'mobile', // 'web', 'mobile', 'default', etc.
});
```

**Login Options:**

| Option | Type | Description |
|--------|------|-------------|
| `email` | string | User's email address (required) |
| `password` | string | User's password (required) |
| `tenantId` | string | Tenant ID for multi-tenant mode |
| `authMode` | `'jwt'` \| `'cookie'` | Authentication mode. Use `'jwt'` for token-based auth (default), `'cookie'` for cookie-based auth |
| `authType` | string | Session type identifier (e.g., `'web'`, `'mobile'`, `'default'`). Used for session limits and management |

### Get Current User

```typescript
// From server (makes API call to /auth/me)
const user = await baasix.auth.getUser();

// Alias for getUser()
const user = await baasix.auth.me();

// From cache (no API call)
const cachedUser = await baasix.auth.getCachedUser();
```

### Logout

```typescript
await baasix.auth.logout();
```

### Check Authentication

```typescript
if (await baasix.auth.isAuthenticated()) {
  // User is logged in
}
```

### Magic Link Login

```typescript
// Send magic link
await baasix.auth.sendMagicLink({
  email: 'user@example.com',
  redirectUrl: 'https://myapp.com/auth/callback',
});

// Verify (after user clicks link)
const { user, token } = await baasix.auth.verifyMagicLink('verification-token');
```

### Password Reset

```typescript
// Request reset (link mode: emails a clickable reset URL)
await baasix.auth.forgotPassword({
  email: 'user@example.com',
  redirectUrl: 'https://myapp.com/reset-password',
});

// Request reset (code mode: emails a short one-time code, no redirectUrl needed)
await baasix.auth.forgotPassword({
  email: 'user@example.com',
  mode: 'code',
});

// Reset password with the token or emailed code
await baasix.auth.resetPassword('reset-token-or-code', 'newpassword123');
```

### Change Password

```typescript
// Change current user's password (requires current password)
await baasix.auth.changePassword('currentPassword', 'newPassword');
```

### Token Management

```typescript
// Get current access token
const token = await baasix.auth.getToken();

// Set a static token (for server-side/service accounts)
await baasix.auth.setToken('your-api-token');

// Refresh the current token
const { token, expiresIn } = await baasix.auth.refreshToken();
```

### Session & State Management

```typescript
// Initialize auth state from storage (call on app startup)
const state = await baasix.auth.initialize();

// Get current auth state
const { user, isAuthenticated } = await baasix.auth.getState();

// Check if session is valid with server
const isValid = await baasix.auth.checkSession();
```

### Email Verification

```typescript
// Request email verification
await baasix.auth.requestEmailVerification('https://myapp.com/verify-email');

// Verify email with token
await baasix.auth.verifyEmail('verification-token');
```

### Multi-Tenant

```typescript
// Get available tenants
const tenants = await baasix.auth.getTenants();

// Switch tenant
const { user, token } = await baasix.auth.switchTenant('tenant-uuid');

// Send invitation
await baasix.auth.sendInvite({
  email: 'newuser@example.com',
  roleId: 'editor-role-uuid',
  tenantId: 'tenant-uuid',
  redirectUrl: 'https://myapp.com/accept-invite',
});

// Verify invitation
const inviteInfo = await baasix.auth.verifyInvite('invite-token');

// Accept invitation (for existing users)
const { user, token } = await baasix.auth.acceptInvite('invite-token');

// Register with invitation (for new users)
const { user, token } = await baasix.auth.registerWithInvite({
  email: 'newuser@example.com',
  password: 'password123',
  firstName: 'John',
  lastName: 'Doe',
  inviteToken: 'invite-token',
});
```

## Items (CRUD Operations)

### Query Items

```typescript
const items = baasix.items('products');

// Basic find
const { data, totalCount } = await items.find();

// With parameters
const { data: activeProducts } = await items.find({
  filter: { status: { eq: 'active' } },
  sort: { createdAt: 'desc' },
  limit: 20,
  page: 1,
  fields: ['id', 'name', 'price', 'category.*'],
});

// Find one by ID
const product = await items.findOne('product-uuid');

// With related data
const product = await items.findOne('product-uuid', {
  fields: ['*', 'category.*', 'reviews.*'],
});
```

### Query Builder

```typescript
const results = await baasix.items('posts')
  .query()
  .select('*', 'author.*', 'comments.*')
  .filter({
    AND: [
      { status: { eq: 'published' } },
      { createdAt: { gte: '$NOW-DAYS_30' } },
    ],
  })
  .sort({ createdAt: 'desc' })
  .limit(10)
  .page(1)
  .get();

// First result only
const post = await baasix.items('posts')
  .query()
  .filter({ slug: { eq: 'my-post' } })
  .first();

// Count
const count = await baasix.items('products')
  .query()
  .filter({ inStock: { eq: true } })
  .count();
```

### Create Items

```typescript
// Single item
const id = await baasix.items('products').create({
  name: 'New Product',
  price: 29.99,
  status: 'draft',
});

// Multiple items
const ids = await baasix.items('products').createMany([
  { name: 'Product 1', price: 10 },
  { name: 'Product 2', price: 20 },
]);
```

### Update Items

```typescript
// Single item
await baasix.items('products').update('product-uuid', {
  price: 24.99,
  status: 'published',
});

// Multiple items
await baasix.items('products').updateMany(
  ['id1', 'id2', 'id3'],
  { status: 'archived' }
);

// Upsert (create or update)
const id = await baasix.items('products').upsert(
  { sku: { eq: 'SKU-001' } },
  { name: 'Widget', price: 29.99, sku: 'SKU-001' }
);
```

### Delete Items

```typescript
// Single item
await baasix.items('products').delete('product-uuid');

// Multiple items
await baasix.items('products').deleteMany(['id1', 'id2', 'id3']);

// Soft delete (if paranoid mode enabled)
await baasix.items('products').softDelete('product-uuid');

// Restore soft-deleted
await baasix.items('products').restore('product-uuid');
```

### Aggregation

```typescript
const results = await baasix.items('orders').aggregate({
  aggregate: {
    totalRevenue: { function: 'sum', field: 'total' },
    orderCount: { function: 'count', field: 'id' },
    avgOrderValue: { function: 'avg', field: 'total' },
  },
  groupBy: ['status', 'category'],
  filter: { createdAt: { gte: '$NOW-DAYS_30' } },
});
```

## App Builder (Pages & Blocks)

The Baasix [App Builder](https://baasix.dev/docs/guides/app-builder) lets admins compose internal
tools from 27 data-bound block types (tables, wizard forms, kanban, charts, tabs, modals, reports,
and more) with cross-block reactivity on a 12-column grid. Pages and blocks are stored in the
`baasix_Page` and `baasix_Block` system collections, so you manage them with the **same `items()`
API** — no special client. Block `config` is validated server-side on every create and update.

```typescript
// Create a page
const page = await baasix.items('baasix_Page').create({
  name: 'Operations',
  slug: 'operations', // unique per tenant; used in /pages/?slug=operations
  icon: 'gauge',
});

// Add a table block bound to the orders collection
await baasix.items('baasix_Block').create({
  page_Id: page.id,
  type: 'table',
  collection: 'orders',
  position: { row: 0, col: 0, span: 8 }, // 12-column grid: row, col, span
  config: {
    columns: [{ field: 'id' }, { field: 'customer' }, { field: 'total' }],
    filter: { status: { eq: 'open' } },
    sort: 'createdAt:desc',
    actions: { create: true, edit: true, view: true },
  },
});

// Add a status chart beside it
await baasix.items('baasix_Block').create({
  page_Id: page.id,
  type: 'chart',
  collection: 'orders',
  position: { row: 0, col: 8, span: 4 },
  config: {
    chartType: 'doughnut',
    aggregate: { count: { function: 'count', field: 'id' } },
    groupBy: ['status'],
  },
});

// List all blocks on a page
const blocks = await baasix.items('baasix_Block')
  .filter({ page_Id: { eq: page.id } })
  .get();
```

> **Block types (27):** data — `table`, `form`, `details`, `kanban`, `calendar`, `chart`, `cardlist`,
> `map` (Leaflet or Google Maps), `geochart`, `media`, `feed`, `timeline`, `progress`, `repeater`,
> `report`, `filter`; layout — `tabs`, `container`, `modal`, `divider` (children carry
> `parentBlock_Id` + `slot`); content & input — `markdown`, `richtext`, `buttons`, `input`,
> `iframe`, `upload`, `code`.
> Filters in any block config use the same filter DSL as the items API, plus the runtime
> placeholders `"$param.<name>"`, `"$selection.<blockId>.<field>"` and `"$input.<name>"` for
> master-detail wiring. See the
> [App Builder guide](https://baasix.dev/docs/guides/app-builder) for the full config reference.

## Filter Operators

Baasix supports 50+ filter operators:

```typescript
// Comparison
{ field: { eq: value } }        // Equal
{ field: { ne: value } }        // Not equal
{ field: { gt: value } }        // Greater than
{ field: { gte: value } }       // Greater than or equal
{ field: { lt: value } }        // Less than
{ field: { lte: value } }       // Less than or equal

// Collection
{ field: { in: [1, 2, 3] } }    // In list
{ field: { notIn: [1, 2, 3] } } // Not in list

// String
{ field: { like: 'pattern' } }        // LIKE (case-sensitive)
{ field: { iLike: 'pattern' } }       // ILIKE (case-insensitive)
{ field: { startsWith: 'prefix' } }   // Starts with
{ field: { endsWith: 'suffix' } }     // Ends with
{ field: { contains: 'substring' } }  // Contains

// Range
{ field: { between: [10, 100] } }     // Between

// Null
{ field: { isNull: true } }           // Is null
{ field: { isNotNull: true } }        // Is not null

// Array (PostgreSQL)
{ tags: { arraycontains: ['js', 'api'] } }

// JSONB
{ metadata: { jsonbHasKey: 'discount' } }
{ metadata: { jsonbKeyEquals: { key: 'status', value: 'active' } } }

// Logical
{ AND: [{ status: { eq: 'active' } }, { price: { gt: 0 } }] }
{ OR: [{ status: { eq: 'featured' } }, { views: { gt: 1000 } }] }

// Relation filtering
{ 'author.name': { like: 'John' } }

// Dynamic variables
{ author_Id: { eq: '$CURRENT_USER' } }
{ tenant_Id: { eq: '$CURRENT_TENANT' } }
{ currency: { eq: '$CURRENT_SETTINGS.currency' } }
{ createdAt: { gte: '$NOW-DAYS_30' } }
```

## Files

### Upload Files

```typescript
// Browser
const fileMetadata = await baasix.files.upload(fileInput.files[0], {
  title: 'Product Image',
  folder: 'products',
  isPublic: true,
  onProgress: (progress) => console.log(`${progress}% uploaded`),
});

// React Native with expo-image-picker
const metadata = await baasix.files.upload({
  uri: result.uri,
  name: 'photo.jpg',
  type: 'image/jpeg',
});
```

### Get Asset URLs

```typescript
// Original file
const url = baasix.files.getAssetUrl('file-uuid');

// Resize to thumbnail
const thumbnailUrl = baasix.files.getAssetUrl('file-uuid', {
  width: 200,
  height: 200,
  fit: 'cover',
  quality: 80,
  format: 'webp',
});

// Convert to WebP without resizing (preserves transparency)
const webpUrl = baasix.files.getAssetUrl('file-uuid', {
  format: 'webp',
  quality: 85,
});

// Resize without upscaling
const safeUrl = baasix.files.getAssetUrl('file-uuid', {
  width: 800,
  format: 'webp',
  withoutEnlargement: true,
});
```

**`AssetTransformOptions`:**

| Option               | Type                              | Default   | Description                                                                 |
| -------------------- | --------------------------------- | --------- | --------------------------------------------------------------------------- |
| `width`              | `number`                          | —         | Target width in pixels                                                      |
| `height`             | `number`                          | —         | Target height in pixels                                                     |
| `fit`                | `'cover'\|'contain'\|'fill'\|'inside'\|'outside'` | `'cover'` | Resize fit mode |
| `quality`            | `number` (1–100)                  | `80`      | Output quality                                                              |
| `format`             | `'jpeg'\|'png'\|'webp'\|'avif'`   | `'jpeg'`  | Output format. `webp` and `png` preserve alpha transparency; `jpeg` flattens transparency to white |
| `withoutEnlargement` | `boolean`                         | `false`   | Prevent upscaling images smaller than the target dimensions                 |

### File Operations

```typescript
// List files
const { data: files } = await baasix.files.find({
  filter: { mimeType: { startsWith: 'image/' } },
});

// Get file info
const file = await baasix.files.findOne('file-uuid');

// Download file
const blob = await baasix.files.download('file-uuid');

// Delete file
await baasix.files.delete('file-uuid');
```

## Schemas

### Create Collection

```typescript
await baasix.schemas.create({
  collectionName: 'products',
  schema: {
    name: 'Product',
    timestamps: true,
    paranoid: true, // Soft deletes
    tenantScoped: true, // Tenant-scoped by default; set false for global/shared collections
    fields: {
      id: {
        type: 'UUID',
        primaryKey: true,
        defaultValue: { type: 'UUIDV4' },
      },
      sku: {
        type: 'SUID',
        unique: true,
        defaultValue: { type: 'SUID' },
      },
      name: {
        type: 'String',
        allowNull: false,
        values: { length: 255 },
        validate: {
          notEmpty: true,
          len: [3, 255],
        },
      },
      price: {
        type: 'Decimal',
        values: { precision: 10, scale: 2 },
        defaultValue: 0,
        validate: {
          min: 0,
          max: 999999.99,
        },
      },
      quantity: {
        type: 'Integer',
        defaultValue: 0,
        validate: {
          isInt: true,
          min: 0,
        },
      },
      email: {
        type: 'String',
        validate: {
          isEmail: true,
        },
      },
      website: {
        type: 'String',
        validate: {
          isUrl: true,
        },
      },
      slug: {
        type: 'String',
        validate: {
          matches: '^[a-z0-9-]+$',
        },
      },
      tags: {
        type: 'Array',
        values: { type: 'String' },
        defaultValue: [],
      },
      metadata: {
        type: 'JSONB',
        defaultValue: {},
      },
      status: {
        type: 'String',
        defaultValue: 'draft',
      },
      isActive: {
        type: 'Boolean',
        defaultValue: true,
      },
      sortOrder: {
        type: 'Integer',
        defaultValue: { type: 'AUTOINCREMENT' },
      },
      publishedAt: {
        type: 'DateTime',
        defaultValue: { type: 'NOW' },
      },
    },
  },
});
```

### Validation Rules

| Rule | Type | Description |
|------|------|-------------|
| `min` | number | Minimum value for numeric fields |
| `max` | number | Maximum value for numeric fields |
| `isInt` | boolean | Validate as integer |
| `notEmpty` | boolean | String must not be empty |
| `isEmail` | boolean | Validate email format |
| `isUrl` | boolean | Validate URL format |
| `len` | [min, max] | String length range |
| `is` / `matches` | string | Pattern matching with regex |

### Default Value Types

| Type | Description |
|------|-------------|
| `UUIDV4` | Random UUID v4 |
| `SUID` | Short unique ID (compact, URL-safe) |
| `NOW` | Current timestamp |
| `AUTOINCREMENT` | Auto-incrementing integer |
| `SQL` | Custom SQL expression |
| Static | Any constant value (`"active"`, `false`, `0`) |

### Relationships

```typescript
// Many-to-One (BelongsTo)
// Auto-creates index on foreign key column
await baasix.schemas.createRelationship('products', {
  type: 'M2O',
  target: 'categories',
  name: 'category',
  alias: 'products',
});

// Many-to-Many
// Auto-generates junction table: products_tags_tags_junction
await baasix.schemas.createRelationship('products', {
  type: 'M2M',
  target: 'tags',
  name: 'tags',
  alias: 'products',
});

// Many-to-Many with custom junction table name
// Useful when auto-generated name exceeds PostgreSQL's 63 char limit
await baasix.schemas.createRelationship('products', {
  type: 'M2M',
  target: 'tags',
  name: 'tags',
  alias: 'products',
  through: 'product_tags', // Custom junction table name (max 63 chars)
});

// Many-to-Any (Polymorphic)
await baasix.schemas.createRelationship('comments', {
  type: 'M2A',
  name: 'commentable',
  tables: ['posts', 'products'],
  alias: 'comments',
  through: 'comment_refs', // Optional custom junction table name
});
```

#### Junction Tables (M2M/M2A)
- **Auto-generated name**: `{source}_{target}_{name}_junction`
- **Custom name**: Use `through` property (max 63 characters for PostgreSQL)
- **Schema property**: Junction tables have `isJunction: true` in their schema
- **Auto-indexed**: Foreign key columns are automatically indexed

### Indexes

```typescript
await baasix.schemas.createIndex('products', {
  name: 'idx_products_sku',
  fields: ['sku'],
  unique: true,
});
```

## Reports & Analytics

### Generate Report (POST)

Use `generate()` to create a report with a POST request, sending the query in the request body:

```typescript
const report = await baasix.reports.generate('orders', {
  aggregate: {
    revenue: { function: 'sum', field: 'total' },
    orders: { function: 'count', field: 'id' },
  },
  groupBy: ['category'],
  filter: { status: { eq: 'completed' } },
  sort: ['-revenue'],       // Sort by aggregate alias descending
  limit: 10,                // Paginate grouped results
  page: 1,
  dateRange: {
    start: '2025-01-01',
    end: '2025-12-31',
  },
});
// Returns: { data: [...], totalCount: 15 }
```

### Query Report (GET)

Use `query()` to fetch a report with query parameters:

```typescript
const report = await baasix.reports.query('orders', {
  aggregate: {
    total: { function: 'sum', field: 'amount' },
  },
  groupBy: ['status'],
  filter: { createdAt: { gte: '$NOW-DAYS_30' } },
  sort: ['-total'],         // Sort by aggregate result
  limit: 50,
  page: 1,
});
// Returns: { data: [...], totalCount: 5 }
```

### Multi-Collection Stats

Get statistics for multiple collections in a single request:

```typescript
const stats = await baasix.reports.getStats([
  {
    name: 'total_products',
    collection: 'products',
    query: {
      aggregate: { count: { function: 'count', field: '*' } },
    },
  },
  {
    name: 'total_orders',
    collection: 'orders',
    query: {
      aggregate: {
        count: { function: 'count', field: '*' },
        total_amount: { function: 'sum', field: 'amount' },
      },
    },
  },
  {
    name: 'products_by_category',
    collection: 'products',
    query: {
      groupBy: ['categoryId'],
      aggregate: {
        count: { function: 'count', field: 'id' },
        avg_price: { function: 'avg', field: 'price' },
      },
      fields: ['categoryId', 'category.name'],
    },
  },
]);
// Returns: [{ name: 'total_products', collection: 'products', data: [...] }, ...]
```

### Aggregation Query

Run aggregation queries directly on a collection (uses items endpoint):

```typescript
const results = await baasix.reports.aggregate('orders', {
  aggregate: {
    total: { function: 'sum', field: 'amount' },
    count: { function: 'count', field: 'id' },
    min: { function: 'min', field: 'amount' },
    max: { function: 'max', field: 'amount' },
    avg: { function: 'avg', field: 'amount' },
  },
  groupBy: ['status', 'paymentMethod'],
  filter: { createdAt: { gte: '$NOW-DAYS_30' } },
  sort: ['-total'],       // Sort by aggregate alias
  limit: 20,              // Paginate results
  page: 1,
});
```

### Quick Count

```typescript
const activeUsers = await baasix.reports.count('users', {
  status: { eq: 'active' },
});
```

### Distinct Values

```typescript
const categories = await baasix.reports.distinct('products', 'category');
// Returns: ['Electronics', 'Clothing', 'Books', ...]
```

## Workflows

### Basic Operations

```typescript
// List workflows
const { data: workflows } = await baasix.workflows.find();

// Get workflow by ID
const workflow = await baasix.workflows.findOne('workflow-uuid');

// Create workflow
const newWorkflow = await baasix.workflows.create({
  name: 'Order Processing',
  trigger: { type: 'hook', config: { collection: 'orders', event: 'items.create.after' } },
  nodes: [...],
  edges: [...],
  isActive: true
});

// Update workflow
await baasix.workflows.update('workflow-uuid', { name: 'Updated Name' });

// Delete workflow
await baasix.workflows.delete('workflow-uuid');

// Enable/Disable workflow
await baasix.workflows.enable('workflow-uuid');
await baasix.workflows.disable('workflow-uuid');

// Duplicate workflow
const copy = await baasix.workflows.duplicate('workflow-uuid', { name: 'Copy' });
```

### Execution

```typescript
// Execute workflow
const result = await baasix.workflows.execute('workflow-uuid', {
  orderId: 'order-123',
});

// Execute a specific node
const nodeResult = await baasix.workflows.executeNode('workflow-uuid', 'node-id', {
  inputData: 'value'
});

// Test workflow (without persisting)
const testResult = await baasix.workflows.test('workflow-uuid', { testData: {} });

// Get execution history
const { data: executions } = await baasix.workflows.getExecutions('workflow-uuid', {
  limit: 50,
  status: 'completed'
});

// Get specific execution
const execution = await baasix.workflows.getExecution('workflow-uuid', 'execution-uuid');

// Get execution logs
const logs = await baasix.workflows.getExecutionLogs('workflow-uuid', 'execution-uuid');

// Cancel running execution
await baasix.workflows.cancelExecution('workflow-uuid', 'execution-uuid');

// Subscribe to execution updates (requires realtime)
const unsubscribe = baasix.realtime.subscribeToExecution(executionId, (update) => {
  console.log('Progress:', update.progress, '%');
  if (update.status === 'complete') {
    console.log('Workflow finished!', update.result);
  }
});
```

### Statistics & Validation

```typescript
// Get workflow statistics
const stats = await baasix.workflows.getStats('workflow-uuid');
console.log(`Total: ${stats.totalExecutions}, Success Rate: ${stats.successRate}%`);

// Validate workflow definition
const validation = await baasix.workflows.validate({
  name: 'My Workflow',
  nodes: [...],
  edges: [...]
});
if (!validation.valid) {
  console.log('Errors:', validation.errors);
}
```

### Export/Import

```typescript
// Export single workflow
const exported = await baasix.workflows.export('workflow-uuid');

// Export all workflows
const allExported = await baasix.workflows.exportAll({
  ids: ['wf-1', 'wf-2'], // Optional: specific workflows
  includeInactive: true
});

// Preview import
const preview = await baasix.workflows.importPreview(file);
console.log('Will import:', preview.workflows.length);
console.log('Conflicts:', preview.conflicts);

// Import workflows
const result = await baasix.workflows.import(file, { overwrite: true });
console.log(`Imported: ${result.imported}, Skipped: ${result.skipped}`);
```

## Settings

```typescript
// Get all settings
const settings = await baasix.settings.get();

// Get a specific setting
const appName = await baasix.settings.getKey('appName');

// Update settings
await baasix.settings.update({
  appName: 'My Application',
  theme: 'dark'
});

// Set a specific setting
await baasix.settings.set('appName', 'New App Name');

// Get settings by app URL (multi-tenant)
const tenantSettings = await baasix.settings.getByAppUrl('https://myapp.example.com');

// Get email branding
const branding = await baasix.settings.getBranding();

// Test email configuration (admin only)
await baasix.settings.testEmail('admin@example.com');

// Reload settings cache (admin only)
await baasix.settings.reload();

// Delete tenant settings (admin only)
await baasix.settings.deleteTenant();
```

## Permissions

```typescript
// List all permissions
const { data: permissions } = await baasix.permissions.find();

// Get permissions for a role
const { data: rolePerms } = await baasix.permissions.findByRole('role-uuid');

// Get permissions for a collection
const { data: collectionPerms } = await baasix.permissions.findByCollection('products');

// Create permission
const permission = await baasix.permissions.create({
  role_Id: 'editor-role-uuid',
  collection: 'posts',
  action: 'update',
  fields: ['title', 'content'],
  conditions: { author_Id: { eq: '$CURRENT_USER' } }
});

// Create CRUD permissions for a collection
await baasix.permissions.createCrudPermissions('role-uuid', 'products', {
  create: { fields: ['name', 'price'] },
  read: { fields: ['*'] },
  update: { fields: ['name', 'price'] },
  delete: false
});

// Update permission
await baasix.permissions.update('permission-uuid', { fields: ['*'] });

// Delete permission
await baasix.permissions.delete('permission-uuid');

// Reload permissions cache (admin only)
await baasix.permissions.reloadCache();

// Export all permissions
const exported = await baasix.permissions.export();

// Import permissions
const result = await baasix.permissions.import(exportedData, { overwrite: true });
console.log(`Imported: ${result.imported}`);
```

## Realtime Subscriptions

The SDK supports real-time data updates via WebSocket connections.

### Setup

```typescript
// Install socket.io-client separately
npm install socket.io-client

// Initialize realtime
import { io } from 'socket.io-client';

// Set the socket client
baasix.realtime.setSocketClient(io);

// Connect to realtime server
await baasix.realtime.connect();
```

### Subscribe to Collections

```typescript
// Subscribe to all changes on a collection
const unsubscribe = baasix.realtime.subscribe('products', (payload) => {
  console.log(`Product ${payload.action}:`, payload.data);
  // payload.action: 'create' | 'update' | 'delete'
  // payload.data: the created/updated/deleted item
  // payload.timestamp: ISO timestamp
});

// Subscribe to specific events only
const unsubscribe = baasix.realtime.on('orders', 'create', (data) => {
  console.log('New order received:', data);
});

// Unsubscribe when done
unsubscribe();
```

### Supabase-style Channel API

```typescript
const channel = baasix.realtime
  .channel('products')
  .on('INSERT', (payload) => console.log('New:', payload))
  .on('UPDATE', (payload) => console.log('Updated:', payload))
  .on('DELETE', (payload) => console.log('Deleted:', payload))
  .subscribe();

// Later
channel.unsubscribe();
```

### Custom Rooms

Custom rooms enable real-time communication between users for chat, games, or collaborative features. The **first user to join** a room becomes its creator. If the creator leaves temporarily, ownership transfers to the next member — but the **original creator automatically reclaims ownership** when they rejoin. If the room empties and is recreated, the next joiner becomes the new owner.

```typescript
// Join a room — pass optional metadata stored alongside your membership.
// Returns { history } — the room's last 200 messages, replayed for late joiners.
const { history } = await baasix.realtime.joinRoom('game:lobby', {
  username: 'Alice',
  avatar: 'https://example.com/alice.png',
  team: 'blue',
});

// Replay buffered messages so the user sees missed events immediately
// Each entry: { event, payload, sender: { userId, socketId }, timestamp }
history.forEach((msg) => {
  addMessageToUI(msg.sender.userId, msg.payload.text);
});

// Get current members (you must be in the room)
// Each entry includes userId, socketId, isCreator, and metadata
const members = await baasix.realtime.getRoomMembers('game:lobby');
// [{ socketId: string, userId: string|number, isCreator: boolean, metadata: Record<string,any> }, ...]

// List all active rooms — no membership required
const rooms = await baasix.realtime.listRooms();
// [{ name: 'game:lobby', memberCount: 4 }, { name: 'chat:general', memberCount: 12 }]

// Filter by name prefix — e.g. show only 'game:' rooms
const gameRooms = await baasix.realtime.listRooms('game:');
// [{ name: 'game:lobby', memberCount: 4 }, { name: 'game:arena', memberCount: 8 }]

// Send a persisted message — stored in the history buffer (default)
await baasix.realtime.sendToRoom('game:lobby', 'chat', { text: 'Hello!' });

// Send an ephemeral message — broadcast only, NOT stored in history
// Ideal for high-frequency events: cursors, typing indicators, presence pings
await baasix.realtime.sendToRoom('game:lobby', 'typing', { userId }, { history: false });
await baasix.realtime.sendToRoom('game:lobby', 'cursor', { x: 120, y: 340 }, { history: false });

// Listen for room messages
const unsubscribe = baasix.realtime.onRoomMessage('game:lobby', 'chat', (data) => {
  console.log(`${data.sender.userId}: ${data.payload.text}`);
});

// Listen for users joining / leaving (joined event includes their metadata)
baasix.realtime.onRoomUserJoined('game:lobby', (data) => {
  console.log(`${data.metadata.username} joined`);
});
baasix.realtime.onRoomUserLeft('game:lobby', (data) => {
  console.log(`${data.userId} left`);
});

// Kick a user — only the room creator can do this
await baasix.realtime.kickFromRoom('game:lobby', 'target-user-id');

// Listen for being kicked out (fires only on the kicked user's socket)
baasix.realtime.onKicked('game:lobby', ({ kickedBy }) => {
  console.log(`You were kicked by user ${kickedBy}`);
  // Room listeners are automatically cleaned up after a kick
});

// Listen for ownership changes (fires for all members when creator changes)
baasix.realtime.onRoomCreatorChanged('game:lobby', ({ newCreatorUserId }) => {
  console.log(`New room owner: ${newCreatorUserId}`);
});

// Leave the room
await baasix.realtime.leaveRoom('game:lobby');
```

### Connection Management

```typescript
// Check connection status
if (baasix.realtime.isConnected) {
  console.log('Connected to realtime server');
}

// Listen for connection changes
baasix.realtime.onConnectionChange((connected) => {
  console.log('Realtime:', connected ? 'online' : 'offline');
});

// Disconnect
baasix.realtime.disconnect();
```

## OAuth / Social Login

35 social providers are supported via the `SOCIAL_PROVIDERS` constant — `google`, `github`, `discord`, `microsoft`, `slack`, `apple`, `facebook`, `gitlab`, `linkedin`, `twitter`, … 35 total. `getOAuthUrl`'s `provider` option is typed as `OAuthProvider`, the union of all 35 ids — import `SOCIAL_PROVIDERS` if you need the list at runtime (e.g. to render login buttons).

End-to-end browser flow: `getOAuthUrl()` builds the provider redirect URL → the browser navigates there and completes the provider's login → the provider redirects back to your app's callback page with a `token` (or `error`) query param → your callback page calls `handleOAuthCallback(token)` to finish signing in.

```typescript
import { SOCIAL_PROVIDERS, type OAuthProvider } from '@baasix/sdk';

// SOCIAL_PROVIDERS: readonly array of all 35 provider ids, e.g. for rendering buttons
SOCIAL_PROVIDERS.forEach((provider) => renderSocialButton(provider));

// 1. Redirect to the OAuth provider
const url = baasix.auth.getOAuthUrl({
  provider: 'github', // OAuthProvider — one of SOCIAL_PROVIDERS (35 total)
  redirectUrl: 'https://myapp.com/auth/callback',
});
window.location.href = url;

// 2. Provider redirects back to your callback page with ?token=... (or ?error=...)
// In your callback page:
const params = new URLSearchParams(window.location.search);
const token = params.get('token');
const error = params.get('error');

if (token) {
  const { user } = await baasix.auth.handleOAuthCallback(token);
  console.log('Logged in as:', user.email);
} else if (error) {
  console.error('OAuth sign-in failed:', error);
}
```

## Auth Method Discovery

Ask the server which login methods are actually enabled (registration, email/password, magic link, passkey, 2FA, and the list of configured social providers) so your login UI only shows what's available. The result is cached per client instance — pass `force: true` to bypass the cache.

```typescript
const methods = await baasix.auth.getAuthMethods();
// {
//   registration: true,
//   emailPassword: true,
//   magicLink: false,
//   passkey: true,
//   twoFactor: true,
//   socialProviders: ['google', 'github', 'discord'],
// }

if (methods.socialProviders.includes('google')) {
  // show "Sign in with Google"
}
if (methods.passkey) {
  // show "Sign in with a passkey"
}
```

## Two-Factor Authentication

TOTP-based 2FA (SHA1, 6-digit codes, 30s window) with 10 single-use backup codes. 2FA gates **password login only** — social, magic-link, and passkey sign-ins bypass the 2FA challenge (they're already a possession/federated factor). Enabling 2FA requires the account to already have a password credential.

```typescript
// Enable 2FA (while logged in) — returns a secret, otpauth:// URL (render as a QR code), and backup codes
const setup = await baasix.auth.twoFactor.enable();
// { secret, otpauthUrl, backupCodes: [10 codes] }

// Confirm setup with a code from the authenticator app
await baasix.auth.twoFactor.verifySetup('123456');
// { enabled: true }

// Disable 2FA (requires the account password)
await baasix.auth.twoFactor.disable('currentPassword');
// { disabled: true }

// Login flow with 2FA enabled
const result = await baasix.auth.login({ email, password });

if ('twoFactorRequired' in result && result.twoFactorRequired) {
  // Prompt for a TOTP code or an unused backup code
  const { user, token } = await baasix.auth.twoFactor.verify(result.twoFactorToken, '123456');
} else {
  // Logged in directly — 2FA not enabled for this account
  const { user, token } = result;
}
```

## Passkeys

WebAuthn-based, usernameless passkey sign-in with per-user credential management. **Browser-only** — `baasix.auth.passkey.*` methods dynamically import `@simplewebauthn/browser` and throw a `BaasixError` when called outside a browser (e.g. Node.js or React Native).

```typescript
// Register a passkey for the currently logged-in user
await baasix.auth.passkey.register('MacBook Touch ID'); // name is optional

// Authenticate with a passkey (no prior login required)
const { user, token } = await baasix.auth.passkey.authenticate();

// List the current user's registered passkeys (no key material returned)
const passkeys = await baasix.auth.passkey.list();

// Remove one of your own passkeys
await baasix.auth.passkey.remove(passkeys[0].id);
```

## Invitation System (Multi-tenant)

```typescript
// Send invitation
await baasix.auth.sendInvite({
  email: 'newuser@example.com',
  roleId: 'editor-role-uuid',
  tenantId: 'tenant-uuid',
  redirectUrl: 'https://myapp.com/accept-invite',
});

// Verify invitation token (in callback page)
const result = await baasix.auth.verifyInvite(token);
if (result.valid) {
  // Show registration form with pre-filled email
  console.log('Invite for:', result.email);
}

// Register with invitation
const { user } = await baasix.auth.registerWithInvite({
  email: 'newuser@example.com',
  password: 'password123',
  firstName: 'John',
  lastName: 'Doe',
  inviteToken: token,
});
```

## Users Management (Admin)

```typescript
// List users
const { data: users } = await baasix.users.find({
  filter: { status: { eq: 'active' } },
  limit: 20,
});

// Create user
const userId = await baasix.users.create({
  email: 'user@example.com',
  password: 'password123',
  firstName: 'John',
  role_Id: 'role-uuid',
});

// Update user
await baasix.users.update(userId, { firstName: 'Jane' });

// Admin password change
await baasix.users.changePassword(userId, 'newPassword123');

// Suspend/Activate user
await baasix.users.suspend(userId);
await baasix.users.activate(userId);
```

## Roles Management

```typescript
// List roles
const { data: roles } = await baasix.roles.find();

// Find by name
const adminRole = await baasix.roles.findByName('Administrator');

// Create role
const roleId = await baasix.roles.create({
  name: 'Editor',
  description: 'Content editors',
  appAccess: true,
});

// Update role
await baasix.roles.update(roleId, { description: 'Updated description' });
```

## Bulk Operations

```typescript
// Bulk create
const ids = await baasix.items('products').createMany([
  { name: 'Product 1', price: 29.99 },
  { name: 'Product 2', price: 39.99 },
]);

// Bulk update - apply same data to multiple items
await baasix.items('products').updateMany(
  ['uuid-1', 'uuid-2', 'uuid-3'],
  { status: 'archived' }
);

// Bulk delete
await baasix.items('products').deleteMany(['uuid-1', 'uuid-2']);
```

## CSV/JSON Import

```typescript
// Import from CSV file
const result = await baasix.items('products').importCSV(csvFile);
console.log(`Imported: ${result.imported}, Failed: ${result.failed}`);

// Import from JSON file
const result = await baasix.items('products').importJSON(jsonFile);
```

## Sort / Reorder Items

```typescript
// Move item1 before item2
await baasix.items('products').sortItem('item1-uuid', 'item2-uuid');

// Move item1 after item2
await baasix.items('products').sortItem('item1-uuid', 'item2-uuid', 'after');

// Reorder multiple items (set explicit order)
await baasix.items('products').reorder([
  'item3-uuid',
  'item1-uuid',
  'item2-uuid'
]);
```

## Migrations (Admin)

```typescript
// Check migration status
const status = await baasix.migrations.status();
console.log(`Pending: ${status.pendingCount}`);

// Get pending migrations
const pending = await baasix.migrations.pending();

// Run pending migrations
const result = await baasix.migrations.run();
console.log(`Completed: ${result.summary.completed}`);

// Run with options
const result = await baasix.migrations.run({
  step: 1,      // Run only 1 migration
  dryRun: true, // Preview without executing
});

// Rollback a specific migration
await baasix.migrations.rollback('20231201000000');

// Rollback last batch
await baasix.migrations.rollbackBatch();

// Create new migration file
const { filepath } = await baasix.migrations.create('add_status_column', {
  type: 'schema',
  description: 'Add status column to orders',
});

// Mark migrations as completed (without running)
await baasix.migrations.markCompleted('20231201000000');
await baasix.migrations.markAllCompleted();
```

## Notifications

```typescript
// Get user notifications
const { data } = await baasix.notifications.find({
  limit: 20,
  filter: { seen: { eq: false } },
});

// Get unread count
const count = await baasix.notifications.getUnreadCount();

// Mark notifications as seen
await baasix.notifications.markAsSeen(['id1', 'id2']);
// Or mark all as seen
await baasix.notifications.markAsSeen();

// Delete notifications
await baasix.notifications.delete(['id1', 'id2']);

// Send notification (admin only)
await baasix.notifications.send({
  type: 'alert',
  title: 'System Update',
  message: 'Maintenance scheduled for tonight',
  userIds: ['user1-uuid', 'user2-uuid'],
});

// Cleanup old notifications (admin only)
await baasix.notifications.cleanup(30); // older than 30 days
```

## Custom Storage Adapter

Create a custom storage adapter for any environment:

```typescript
import { StorageAdapter } from '@baasix/sdk';

class MyCustomStorage implements StorageAdapter {
  async get(key: string): Promise<string | null> {
    // Your implementation
  }

  async set(key: string, value: string): Promise<void> {
    // Your implementation
  }

  async remove(key: string): Promise<void> {
    // Your implementation
  }

  async clear(): Promise<void> {
    // Your implementation
  }
}

const baasix = createBaasix({
  url: 'https://api.example.com',
  storage: new MyCustomStorage(),
});
```

## Error Handling

```typescript
import { BaasixError } from '@baasix/sdk';

try {
  await baasix.items('products').create({ name: 'Product' });
} catch (error) {
  if (error instanceof BaasixError) {
    console.error('Status:', error.status);
    console.error('Code:', error.code);
    console.error('Message:', error.message);
    console.error('Details:', error.details);

    if (error.status === 401) {
      // Handle unauthorized
    }
    if (error.status === 403) {
      // Handle forbidden
    }
    if (error.isRetryable) {
      // Can retry request
    }
  }
}
```

## TypeScript Support

### Shared Types from @baasix/types

The SDK uses shared types from `@baasix/types`. Import common types directly:

```typescript
import type {
  // Auth types
  User,
  Role,
  Permission,
  AuthMode,

  // Query types
  Filter,
  FilterOperator,
  Sort,
  QueryParams,
  PaginationMetadata,

  // Response types
  PaginatedResponse,

  // File types
  FileMetadata,
  UploadOptions,

  // Schema types
  SchemaDefinition,
  FieldDefinition,

  // Spatial types
  GeoJSONPoint,
  GeoJSONGeometry,
} from '@baasix/types';
```

### Using Generics

Use generics for type-safe operations:

```typescript
interface Product {
  id: string;
  name: string;
  price: number;
  category_Id: string;
  createdAt: string;
}

// Typed items module
const products = baasix.items<Product>('products');

// Type inference
const { data } = await products.find();
// data is Product[]

const product = await products.findOne('uuid');
// product is Product

await products.create({
  name: 'Widget',
  price: 29.99,
  category_Id: 'cat-uuid',
}); // Type-checked
```

## React Example

```tsx
import { createBaasix } from '@baasix/sdk';
import { useEffect, useState } from 'react';

const baasix = createBaasix({
  url: process.env.REACT_APP_BAASIX_URL!,
  onAuthStateChange: (event, user) => {
    console.log('Auth:', event, user);
  },
});

function App() {
  const [user, setUser] = useState(null);
  const [products, setProducts] = useState([]);

  useEffect(() => {
    // Initialize auth on mount
    baasix.auth.initialize().then((state) => {
      setUser(state.user);
    });
  }, []);

  useEffect(() => {
    // Fetch products
    baasix.items('products')
      .find({ filter: { status: { eq: 'active' } } })
      .then(({ data }) => setProducts(data));
  }, []);

  const handleLogin = async (email, password) => {
    const { user } = await baasix.auth.login({ email, password });
    setUser(user);
  };

  const handleLogout = async () => {
    await baasix.auth.logout();
    setUser(null);
  };

  return (
    <div>
      {user ? (
        <>
          <p>Welcome, {user.email}</p>
          <button onClick={handleLogout}>Logout</button>
        </>
      ) : (
        <LoginForm onSubmit={handleLogin} />
      )}
      <ProductList products={products} />
    </div>
  );
}
```

## API Reference

### `createBaasix(config)`

Creates a new Baasix SDK instance.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | `string` | Required | Your Baasix server URL |
| `authMode` | `'jwt' \| 'cookie'` | `'jwt'` | Authentication mode |
| `storage` | `StorageAdapter` | Auto-detected | Token storage adapter |
| `token` | `string` | - | Static auth token |
| `timeout` | `number` | `30000` | Request timeout (ms) |
| `autoRefresh` | `boolean` | `true` | Auto-refresh tokens |
| `headers` | `object` | `{}` | Custom headers |
| `tenantId` | `string` | - | Multi-tenant ID |
| `credentials` | `RequestCredentials` | Based on authMode | Fetch credentials |
| `onAuthStateChange` | `function` | - | Auth state callback |
| `onError` | `function` | - | Global error handler |

### Storage Adapters

- `LocalStorageAdapter` - Browser localStorage (default for web)
- `MemoryStorageAdapter` - In-memory (default for SSR/Node.js)
- `AsyncStorageAdapter` - React Native AsyncStorage

## License

MIT © [Vivek Palanisamy](https://www.baasix.com)
