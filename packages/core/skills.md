# BAASIX.md - AI Coding Assistant Guide

> Comprehensive guide for AI assistants helping developers build with Baasix.
> Use this file alongside llms.txt for complete context.

## Overview

Baasix is an open-source Backend-as-a-Service (BaaS) that generates REST APIs from data models. Key differentiators:

- **Dynamic Schemas**: Create/modify tables via API at runtime
- **PostgreSQL + PostGIS + pgvector**: Full SQL power with geospatial and vector embedding support
- **Drizzle ORM**: Modern TypeScript ORM under the hood
- **50+ Filter Operators**: Most comprehensive query system
- **Visual Workflows**: 17 node types for automation
- **Enterprise Ready**: Multi-tenancy, caching, real-time
- **Plugin System**: Extensible architecture with hooks, endpoints, schedules

---

## Quick Start Template

```javascript
// 1. Install
npm install @baasix/baasix

// 2. Create server.js
import { startServer } from "@baasix/baasix";
startServer().catch(console.error);

// 3. Add to package.json: "type": "module"

// 4. Create .env
DATABASE_URL="postgresql://postgres:password@localhost:5432/baasix"
SECRET_KEY=your-32-character-secret-key-here

// 5. Run
npm run dev
```

---

## API Routes Reference

### Authentication Routes

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | /auth/register | Register new user (403 `REGISTRATION_DISABLED` if `PUBLIC_REGISTRATION=false` and no invite token) | No |
| POST | /auth/login | Login, returns JWT token (or `{ twoFactorRequired: true, twoFactorToken }` if 2FA is enabled) | No |
| GET | /auth/me | Get current authenticated user | Yes |
| GET | /auth/logout | Logout and invalidate session | Yes |
| POST | /auth/magiclink | Request magic link login | No |
| POST | /auth/switch-tenant | Switch to different tenant | Yes |
| POST | /auth/refresh | Refresh JWT token | Yes |
| POST | /auth/password/reset | Request password reset | No |
| POST | /auth/password/reset/:token | Reset password with token | No |
| GET | /auth/signin/:provider | Start browser OAuth flow; 302 to one of 35 social providers | No |
| GET | /auth/callback/:provider | OAuth provider callback; 302 back to the app with `?token=` or `?error=` | No |
| POST | /auth/2fa/enable | Enable 2FA; returns `{ secret, otpauthUrl, backupCodes[10] }` (requires a password credential) | Yes |
| POST | /auth/2fa/verify-setup | Confirm TOTP code to turn 2FA on | Yes |
| POST | /auth/2fa/disable | Disable 2FA (requires current password) | Yes |
| POST | /auth/2fa/verify | Complete a 2FA login challenge (TOTP or backup code); rate-limited | No |
| POST | /auth/passkey/register/options | Get WebAuthn registration options | Yes |
| POST | /auth/passkey/register/verify | Verify and save a new passkey | Yes |
| POST | /auth/passkey/authenticate/options | Get WebAuthn login options; rate-limited | No |
| POST | /auth/passkey/authenticate/verify | Complete passkey login; rate-limited | No |
| GET | /auth/passkey | List the current user's passkeys | Yes |
| DELETE | /auth/passkey/:id | Remove one of your own passkeys | Yes |
| GET | / | Project info, including an `auth` discovery block (enabled login methods) | No |

Social, magic-link, and passkey logins bypass the 2FA challenge — 2FA gates password login only. `GET /` returns:

```json
{
  "project": {
    "auth": {
      "registration": true,
      "emailPassword": true,
      "magicLink": false,
      "passkey": true,
      "twoFactor": true,
      "socialProviders": ["google", "github", "discord"]
    }
  }
}
```

`socialProviders` only lists providers that are both enabled (`AUTH_SERVICES_ENABLED`) and credentialed; `magicLink` is true only when `LOCAL` is enabled and SMTP is configured; no secrets are exposed.

### Authentication Examples

```javascript
// Register
POST /auth/register
{
  "email": "user@example.com",
  "password": "securepassword",
  "firstName": "John",
  "lastName": "Doe"
}

// Login - returns { token, user }
POST /auth/login
{
  "email": "user@example.com",
  "password": "securepassword"
}

// Use token in subsequent requests
Authorization: Bearer <token>
```

### Items Routes (CRUD)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /items/:collection | List items with filtering, sorting, pagination |
| GET | /items/:collection/:id | Get single item by ID |
| POST | /items/:collection | Create single item |
| PATCH | /items/:collection/:id | Update single item |
| DELETE | /items/:collection/:id | Delete single item |
| POST | /items/:collection/bulk | Bulk create multiple items |
| PATCH | /items/:collection/bulk | Bulk update multiple items |
| DELETE | /items/:collection/bulk | Bulk delete multiple items |

### Schema Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /schemas | List all schemas |
| GET | /schemas/:collection | Get schema for collection (call this BEFORE PATCH to get all existing fields) |
| POST | /schemas | Create new schema/collection |
| PATCH | /schemas/:collection | Update schema (⚠️ FULL REPLACEMENT — must include ALL fields, not just changes) |
| DELETE | /schemas/:collection | Delete schema and table permanently |
| POST | /schemas/:collection/relationships | Create relationship |
| PATCH | /schemas/:collection/relationships/:name | Update relationship |
| DELETE | /schemas/:collection/relationships/:name | Delete relationship |
| POST | /schemas/:collection/indexes | Create index |
| DELETE | /schemas/:collection/indexes/:name | Delete index |

#### ⚠️ IMPORTANT: PATCH /schemas/:collection behavior

The PATCH endpoint performs a **FULL REPLACEMENT** of the schema definition.
When adding, modifying, or removing columns, you MUST:
1. First GET /schemas/:collection to retrieve the current full schema
2. Include ALL existing fields in your PATCH request body (not just new/changed ones)
3. Add/modify/remove only the specific fields you need

Sending only new fields will DELETE all other field definitions from the schema.

### Files Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /files | List all files |
| GET | /files/:id | Get file metadata |
| POST | /files | Upload file (multipart/form-data) |
| PATCH | /files/:id | Update file metadata |
| DELETE | /files/:id | Delete file |
| GET | /assets/:id | Get file with transformations |

#### Asset Transformations (GET /assets/:id)

| Parameter | Description | Values |
|-----------|-------------|--------|
| width | Target width | number |
| height | Target height | number |
| fit | Resize mode | cover, contain, fill, inside, outside |
| quality | Output quality (1-100) | 1-100 |
| format | Output format; defaults to jpeg. webp/png preserve transparency | jpeg, png, webp, avif |
| withoutEnlargement | Prevent upscaling | true |

```
# Resize to WebP
GET /assets/file-uuid?width=200&height=200&fit=cover&quality=80&format=webp

# Default (JPEG, transparency flattened to white)
GET /assets/file-uuid?width=200&height=200&fit=cover&quality=80
```

### Workflow Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /workflows | List workflows |
| GET | /workflows/:id | Get workflow |
| POST | /workflows | Create workflow |
| PATCH | /workflows/:id | Update workflow |
| DELETE | /workflows/:id | Delete workflow |
| POST | /workflows/:id/execute | Execute workflow |
| GET | /workflows/:id/executions | List executions |
| POST | /workflows/:id/test | Test workflow |

### Other Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /permissions | List permissions |
| POST | /permissions | Create permission |
| GET | /notifications | Get user notifications |
| POST | /reports/:collection | Generate report |
| GET | /settings | Get app settings |
| PATCH | /settings | Update settings |

---

## Task: Create a New Collection/Table

### Step 1: Design the Schema

```javascript
// POST /schemas
{
  "collectionName": "products",  // Table name (lowercase, snake_case)
  "schema": {
    "name": "Product",           // Model name (PascalCase)
    "timestamps": true,          // Adds createdAt, updatedAt
    "paranoid": false,           // Set true for soft deletes (adds deletedAt)
    "tenantScoped": true,        // Set false for global/shared collections
    "fields": {
      "id": {
        "type": "UUID",
        "primaryKey": true,
        "defaultValue": {"type": "UUIDV4"}
      },
      "name": {
        "type": "String",
        "allowNull": false,
        "values": {"length": 255}  // VARCHAR(255)
      },
      "description": {
        "type": "Text",           // Unlimited length
        "allowNull": true
      },
      "price": {
        "type": "Decimal",
        "values": {"precision": 10, "scale": 2},
        "allowNull": false,
        "defaultValue": 0.00
      },
      "sku": {
        "type": "String",
        "allowNull": false,
        "unique": true
      },
      "inStock": {
        "type": "Boolean",
        "allowNull": false,
        "defaultValue": true
      },
      "quantity": {
        "type": "Integer",
        "allowNull": false,
        "defaultValue": 0,
        "validate": {"min": 0}
      },
      "tags": {
        "type": "Array_String",
        "defaultValue": []
      },
      "metadata": {
        "type": "JSONB",
        "allowNull": true,
        "defaultValue": {}
      }
    }
  }
}
```

### Step 2: Add Relationships

```javascript
// POST /schemas/products/relationships
// BelongsTo Category
{
  "type": "M2O",
  "target": "categories",
  "name": "category",      // products.category_Id → categories.id
  "alias": "products"      // categories.products (reverse)
}

// POST /schemas/products/relationships
// Many-to-Many with Tags
{
  "type": "M2M",
  "target": "tags",
  "name": "tags",
  "alias": "products"
}
```

### Step 3: Add Indexes

```javascript
// POST /schemas/products/indexes
{
  "name": "idx_products_sku",
  "fields": ["sku"],
  "unique": true
}

// Composite index for common queries
{
  "name": "idx_products_category_instock",
  "fields": ["category_Id", "inStock"]
}
```

---

## Task: Build Complex Queries

### Basic CRUD

```javascript
// Create
POST /items/products
{ "name": "Widget", "price": 29.99, "sku": "WDG-001" }

// Read one
GET /items/products/{id}

// Update
PATCH /items/products/{id}
{ "price": 24.99 }

// Delete
DELETE /items/products/{id}

// Bulk operations
POST /items/products/bulk
[{ "name": "A", "sku": "A" }, { "name": "B", "sku": "B" }]
```

### Query Parameters

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| fields | string[] | Fields to return | `["id","name","author.*"]` |
| filter | object | Filter conditions | `{"status":{"eq":"active"}}` |
| sort | object/string[] | Sort order | `{"createdAt":"desc"}` or `["-createdAt"]` |
| limit | number | Items per page (-1 for all) | 20 |
| page | number | Page number (1-indexed) | 1 |
| offset | number | Skip N records | 0 |
| search | string | Full-text search | "keyword" |
| searchFields | string[] | Fields to search | `["title","content"]` |
| aggregate | object | Aggregation ops | `{"total":{"function":"count","field":"id"}}` |
| groupBy | string[] | Group by fields | `["status","category"]` |
| paranoid | boolean | Include soft-deleted | false |
| relConditions | object | Filter array relations | `{"comments":{"approved":true}}` |
| count | boolean | Compute `totalCount` (omit for server default) | false |

**Total count:** List responses include `totalCount` by default. Pass `count=false` to skip the COUNT query for faster reads — the response returns `"totalCount": null`. The deployment default is controlled by the `COUNT_BY_DEFAULT` env var (default `true`); a per-request `count` always overrides it. When `limit=-1` with no offset, `totalCount` is taken from the result length (no extra query).

### Field Selection Patterns

```javascript
// All direct fields
fields: ["*"]

// Specific fields
fields: ["id", "name", "email"]

// Include relation (all fields)
fields: ["*", "author.*"]

// Specific relation fields
fields: ["*", "author.firstName", "author.email"]

// Deep nesting
fields: ["*", "posts.*", "posts.comments.*"]

// Depth via repeated wildcards (each "*" segment = one level; no "**" syntax)
fields: ["*.*"]      // direct columns + first-level relations
fields: ["*.*.*"]    // + second-level (relations of relations)

// Exclude fields
fields: ["*", "-password", "-secretKey"]
```

> The same wildcard rule applies to permission `fields`: `"*"` = own columns only, `"rel.*"` = that relation one level deep, `"rel.*.*"` = one level deeper. See [Permissions](#permissions).

### Query with Filters

```javascript
// Active products under $50 in electronics category
GET /items/products?filter={
  "AND": [
    {"inStock": {"eq": true}},
    {"price": {"lt": 50}},
    {"category.slug": {"eq": "electronics"}}
  ]
}

// Products created in last 7 days
GET /items/products?filter={
  "createdAt": {"gte": "$NOW-DAYS_7"}
}

// Products with specific tags
GET /items/products?filter={
  "tags": {"arraycontains": ["featured", "sale"]}
}

// Search products
GET /items/products?search=wireless&searchFields=["name","description"]
```

### Query with Relations

```javascript
// Include category and reviews
GET /items/products?fields=["*","category.*","reviews.*"]

// Filter by relation
GET /items/products?filter={
  "category.name": {"eq": "Electronics"},
  "reviews.rating": {"gte": 4}
}

// Deep nesting
GET /items/products?fields=["*","category.parent.*","reviews.author.*"]
```

### relConditions (Filter Array Relations)

```javascript
// Only show approved reviews in products.reviews array
GET /items/products?fields=["*","reviews.*"]&relConditions={
  "reviews": {"approved": {"eq": true}, "rating": {"gte": 3}}
}

// Nested relConditions
GET /items/orders?fields=["*","items.*","items.product.*"]&relConditions={
  "items": {
    "quantity": {"gt": 0},
    "product": {"inStock": {"eq": true}}
  }
}
```

### Aggregation

```javascript
// Total revenue by category
GET /items/orders?aggregate={
  "revenue": {"function": "sum", "field": "total"},
  "count": {"function": "count", "field": "id"}
}&groupBy=["category_Id"]

// Average product price
GET /items/products?aggregate={
  "avgPrice": {"function": "avg", "field": "price"},
  "minPrice": {"function": "min", "field": "price"},
  "maxPrice": {"function": "max", "field": "price"}
}
```

### Aggregation Functions

| Function | Description | Example |
|----------|-------------|---------|
| count | Count records | `{"total": {"function": "count", "field": "id"}}` |
| sum | Sum values | `{"revenue": {"function": "sum", "field": "amount"}}` |
| avg | Average | `{"avgPrice": {"function": "avg", "field": "price"}}` |
| min | Minimum | `{"minAge": {"function": "min", "field": "age"}}` |
| max | Maximum | `{"maxScore": {"function": "max", "field": "score"}}` |

All numeric aggregate functions (`sum`, `avg`, `min`, `max`) return JavaScript numbers, including when applied to Decimal columns. `count` and `distinct` also return numbers. `array_agg` returns an array.

### Sorting and Pagination

```javascript
// Sort by multiple fields
GET /items/products?sort={"category_Id":"asc","price":"desc"}

// Or array syntax
GET /items/products?sort=["-createdAt","name"]

// Pagination
GET /items/products?limit=20&page=1

// Get all (use carefully!)
GET /items/products?limit=-1
```

---

## Complete Filter Operators

### Basic Comparison Operators

| Operator | Description | Example |
|----------|-------------|---------|
| eq | Equal | `{"status": {"eq": "active"}}` |
| ne | Not equal | `{"status": {"ne": "deleted"}}` |
| gt | Greater than | `{"age": {"gt": 18}}` |
| gte | Greater than or equal | `{"price": {"gte": 100}}` |
| lt | Less than | `{"stock": {"lt": 10}}` |
| lte | Less than or equal | `{"rating": {"lte": 5}}` |
| is | IS (for null) | `{"deletedAt": {"is": null}}` |
| not | NOT (alternative to ne) | `{"status": {"not": "spam"}}` |

### Collection Operators

| Operator | Description | Example |
|----------|-------------|---------|
| in | Value in array | `{"status": {"in": ["active", "pending"]}}` |
| notIn | Value not in array | `{"category": {"notIn": ["spam", "deleted"]}}` |

### String Pattern Operators (Auto-wrap with %)

| Operator | Description | Pattern | Example |
|----------|-------------|---------|---------|
| like | Case-sensitive | %value% | `{"name": {"like": "john"}}` |
| notLike | NOT LIKE | %value% | `{"name": {"notLike": "spam"}}` |
| iLike | Case-insensitive | %value% | `{"email": {"iLike": "GMAIL"}}` |
| notILike | NOT ILIKE | %value% | `{"email": {"notILike": "test"}}` |

### Prefix/Suffix Operators

| Operator | Description | Pattern | Case |
|----------|-------------|---------|------|
| startsWith | Starts with | value% | Insensitive |
| startsWiths | Starts with | value% | Sensitive |
| endsWith | Ends with | %value | Insensitive |
| endsWiths | Ends with | %value | Sensitive |
| nstartsWith | NOT starts with | value% | Insensitive |
| nstartsWiths | NOT starts with | value% | Sensitive |
| nendsWith | NOT ends with | %value | Insensitive |
| nendsWiths | NOT ends with | %value | Sensitive |

```javascript
// Examples
{"name": {"startsWith": "John"}}     // John%, case-insensitive
{"email": {"endsWith": ".edu"}}      // %.edu, case-insensitive
{"code": {"startsWiths": "PRD"}}     // PRD%, case-sensitive
```

### Range Operators

| Operator | Description | Example |
|----------|-------------|---------|
| between | BETWEEN min AND max | `{"price": {"between": [10, 100]}}` |
| notBetween | NOT BETWEEN | `{"age": {"notBetween": [0, 17]}}` |

### Null Check Operators

| Operator | Value | Result |
|----------|-------|--------|
| isNull | true | IS NULL |
| isNull | false | IS NOT NULL |
| isNotNull | true | IS NOT NULL |
| isNotNull | false | IS NULL |

```javascript
{"deletedAt": {"isNull": true}}      // Not deleted
{"avatar": {"isNotNull": true}}      // Has avatar
```

### PostgreSQL Array Operators

| Operator | PostgreSQL | Description | Example |
|----------|------------|-------------|---------|
| arraycontains | @> | Array contains all | `{"tags": {"arraycontains": ["js", "api"]}}` |
| arraycontained | <@ | Array contained by | `{"perms": {"arraycontained": ["read", "write", "admin"]}}` |

### JSONB Operators

#### Containment
| Operator | PostgreSQL | Description |
|----------|------------|-------------|
| jsonbContains | @> | JSONB contains object |
| jsonbContainedBy | <@ | JSONB is contained by |
| jsonbNotContains | NOT @> | JSONB does not contain |

```javascript
{"metadata": {"jsonbContains": {"status": "active", "type": "premium"}}}
```

#### Key Existence
| Operator | PostgreSQL | Description |
|----------|------------|-------------|
| jsonbHasKey | ? | Has key |
| jsonbHasAnyKeys | ?| | Has any of keys |
| jsonbHasAllKeys | ?& | Has all keys |

```javascript
{"metadata": {"jsonbHasKey": "discount"}}
{"metadata": {"jsonbHasAnyKeys": ["promo", "coupon"]}}
{"metadata": {"jsonbHasAllKeys": ["price", "stock", "sku"]}}
```

#### Key Value Comparisons
| Operator | Description | Example |
|----------|-------------|---------|
| jsonbKeyEquals | Key equals value | `{"metadata": {"jsonbKeyEquals": {"key": "status", "value": "active"}}}` |
| jsonbKeyNotEquals | Key not equals | `{"metadata": {"jsonbKeyNotEquals": {"key": "status", "value": "deleted"}}}` |
| jsonbKeyGt | Key > value | `{"metadata": {"jsonbKeyGt": {"key": "price", "value": 100}}}` |
| jsonbKeyGte | Key >= value | `{"metadata": {"jsonbKeyGte": {"key": "stock", "value": 10}}}` |
| jsonbKeyLt | Key < value | `{"metadata": {"jsonbKeyLt": {"key": "discount", "value": 50}}}` |
| jsonbKeyLte | Key <= value | `{"metadata": {"jsonbKeyLte": {"key": "rating", "value": 5}}}` |
| jsonbKeyIn | Key in list | `{"metadata": {"jsonbKeyIn": {"key": "type", "values": ["A", "B"]}}}` |
| jsonbKeyNotIn | Key not in list | `{"metadata": {"jsonbKeyNotIn": {"key": "category", "values": ["spam"]}}}` |
| jsonbKeyLike | Key ILIKE pattern | `{"metadata": {"jsonbKeyLike": {"key": "name", "pattern": "%test%"}}}` |
| jsonbKeyIsNull | Key is null | `{"metadata": {"jsonbKeyIsNull": "deletedAt"}}` |
| jsonbKeyIsNotNull | Key is not null | `{"metadata": {"jsonbKeyIsNotNull": "publishedAt"}}` |

#### JSON Path Operators
| Operator | PostgreSQL | Description |
|----------|------------|-------------|
| jsonbPathExists | @? | Path returns items |
| jsonbPathMatch | @@ | Path predicate matches |

```javascript
{"profile": {"jsonbPathExists": "$.user.preferences"}}
{"metadata": {"jsonbPathMatch": "$.price > 100"}}
```

#### Deep Nested Value Access
```javascript
// Access deeply nested value
{"profile": {"jsonbDeepValue": {
  "path": ["user", "preferences", "theme"],
  "value": "dark"
}}}

// With comparison operator
{"profile": {"jsonbDeepValue": {
  "path": ["stats", "loginCount"],
  "value": 10,
  "op": "gte"  // eq, ne, gt, gte, lt, lte, like, ilike
}}}
```

#### JSONB Array/Type Operators
```javascript
// Check array length
{"tags": {"jsonbArrayLength": {"op": "gte", "value": 3}}}

// Check type
{"metadata": {"jsonbTypeOf": {"type": "object"}}}
// Types: object, array, string, number, boolean, null
```

### Geospatial Operators (PostGIS)

| Operator | PostGIS | Description |
|----------|---------|-------------|
| within | ST_Within | Geometry within another |
| containsGEO | ST_Contains | Geometry contains another |
| intersects | ST_Intersects | Geometries intersect |
| nIntersects | NOT ST_Intersects | Don't intersect |
| dwithin | ST_DWithin | Within distance |

```javascript
// Point within polygon
{"location": {"within": {
  "type": "Polygon",
  "coordinates": [[[lng1,lat1], [lng2,lat2], [lng3,lat3], [lng1,lat1]]]
}}}

// Within radius (distance in meters)
{"location": {"dwithin": {
  "geometry": {"type": "Point", "coordinates": [-74.006, 40.7128]},
  "distance": 5000
}}}

// Sort by distance
{"sort": {"_distance": {
  "target": [-74.006, 40.7128],
  "column": "location",
  "direction": "ASC"
}}}
```

### Vector Similarity Operators (pgvector)

Requires `DATABASE_VECTOR=true` and a field of type `Vector`, `HalfVec`, or `SparseVec`.

| Operator | SQL Operator | Description |
|----------|-------------|-------------|
| vectorL2 | `<->` | L2 (Euclidean) distance |
| vectorCosine | `<=>` | Cosine distance |
| vectorInnerProduct | `<#>` | Inner product (negated, max inner product search) |
| vectorL1 | `<+>` | L1 (Manhattan) distance (pgvector >= 0.7) |

```javascript
// Nearest by L2 (Euclidean) distance
{"embedding": {"vectorL2": {"vector": [0.1, 0.2, 0.3], "threshold": 0.5}}}

// Cosine similarity search
{"embedding": {"vectorCosine": {"vector": [0.1, 0.2, 0.3], "threshold": 0.2}}}

// Maximum inner product
{"embedding": {"vectorInnerProduct": {"vector": [0.1, 0.2, 0.3], "threshold": 0.8}}}

// L1 (Manhattan) distance
{"embedding": {"vectorL1": {"vector": [0.1, 0.2, 0.3], "threshold": 1.0}}}
```

#### Sort by Vector Distance (top-K retrieval)

Use `_vectorDistance` in sort to rank results by distance without a fixed threshold.
Supported operators: `cosine` (default), `l2`, `innerProduct`, `l1`.

```javascript
// Top-K nearest neighbors ordered by cosine distance
{"sort": {"_vectorDistance": {
  "vector": [0.1, 0.2, 0.3],
  "column": "embedding",
  "operator": "cosine",
  "direction": "ASC"
}}, "limit": 10}

// ANN: filter candidate set + sort by distance
{
  "filter": {"embedding": {"vectorCosine": {"vector": [0.1, 0.2, 0.3], "threshold": 0.5}}},
  "sort": {"_vectorDistance": {"vector": [0.1, 0.2, 0.3], "column": "embedding", "operator": "cosine", "direction": "ASC"}},
  "limit": 10
}
```

### Logical Operators

```javascript
// AND (explicit)
{"AND": [
  {"status": {"eq": "published"}},
  {"views": {"gt": 100}}
]}

// OR
{"OR": [
  {"status": {"eq": "featured"}},
  {"views": {"gt": 1000}}
]}

// Nested
{"AND": [
  {"OR": [
    {"status": {"eq": "published"}},
    {"status": {"eq": "featured"}}
  ]},
  {"createdAt": {"gt": "2025-01-01"}}
]}

// Implicit AND (multiple keys)
{"status": {"eq": "active"}, "price": {"lt": 100}}
```

### Column-to-Column Comparisons

Use `$COL(columnName)` to compare against another column:

```javascript
// Compare two fields
{"actualCost": {"gt": "$COL(estimatedCost)"}}

// With type casting
{"startTime": {"gt": "$COL(endTime)", "cast": "time"}}

// PostgreSQL cast in reference
{"startTime": {"gt": "$COL(endTime::time)"}}

// Relational comparison
{"salary": {"gt": "$COL(manager.salary)"}}
```

### Type Casting

Add `"cast": "type"` to any filter condition:

| Cast Type | Description |
|-----------|-------------|
| text, varchar | Convert to string |
| integer, bigint | Convert to integer |
| decimal, numeric | Convert to decimal |
| boolean | Convert to boolean |
| date | Extract date from datetime |
| time | Extract time from datetime |
| timestamp | Convert to timestamp |
| uuid | Convert to UUID |
| json, jsonb | Convert to JSON |

```javascript
// Date extraction
{"createdAt": {"eq": "2025-01-15", "cast": "date"}}

// Time extraction
{"workStart": {"between": ["08:00:00", "18:00:00"], "cast": "time"}}

// Number to text for pattern matching
{"price": {"startsWith": "199", "cast": "text"}}
```

### Dynamic Variables

| Variable | Description |
|----------|-------------|
| $CURRENT_USER | Current user's ID |
| $CURRENT_USER.field | User's field (e.g., $CURRENT_USER.department) |
| $CURRENT_ROLE | Current role's ID |
| $CURRENT_ROLE.field | Role's field |
| $CURRENT_TENANT | Current tenant ID |
| $CURRENT_TENANT.field | Tenant's field (e.g., $CURRENT_TENANT.name) |
| $CURRENT_SETTINGS.field | Settings field, tenant-aware (e.g., $CURRENT_SETTINGS.currency) |
| $NOW | Current timestamp |

```javascript
{"authorId": {"eq": "$CURRENT_USER"}}
{"tenant_Id": {"eq": "$CURRENT_TENANT"}}
{"publishedAt": {"lte": "$NOW"}}
```

### Relative Date Variables

Pattern: `$NOW[+|-][UNIT]_[NUMBER]`

| Unit | Example |
|------|---------|
| SECONDS | $NOW-SECONDS_30 |
| MINUTES | $NOW+MINUTES_15 |
| HOURS | $NOW-HOURS_2 |
| DAYS | $NOW+DAYS_7 |
| WEEKS | $NOW-WEEKS_3 |
| MONTHS | $NOW+MONTHS_6 |
| YEARS | $NOW-YEARS_1 |

```javascript
// Last 30 days
{"createdAt": {"gte": "$NOW-DAYS_30"}}

// Next week
{"scheduledAt": {"between": ["$NOW", "$NOW+DAYS_7"]}}

// Last 2 hours
{"lastModified": {"gte": "$NOW-HOURS_2"}}
```

### Relational Field Filtering

```javascript
// BelongsTo
{"author.name": {"like": "John"}}

// Deep nesting (3+ levels)
{"comments.user.profile.verified": {"eq": true}}

// Arrays in relations
{"author.skills": {"arraycontains": ["javascript"]}}
```

---

## Schema Definition Reference

### Complete Schema Structure

```javascript
POST /schemas
{
  "collectionName": "products",
  "schema": {
    "name": "Product",
    "timestamps": true,        // createdAt, updatedAt
    "paranoid": false,         // deletedAt for soft deletes
    "tenantScoped": true,      // false = global/shared in multi-tenant deployments
    "indexes": [],
    "fields": {
      "id": {
        "type": "UUID",
        "primaryKey": true,
        "defaultValue": {"type": "UUIDV4"}
      }
      // ... more fields
    }
  }
}
```

### Field Types Reference

| Type | PostgreSQL | Description |
|------|------------|-------------|
| **String types** | | |
| String | VARCHAR(255) | Short text (use values.length for custom) |
| Text | TEXT | Unlimited text |
| CiText | CITEXT | Case-insensitive text |
| HTML | TEXT | HTML content |
| **Numeric types** | | |
| Integer | INTEGER | 32-bit integer |
| BigInt | BIGINT | 64-bit integer |
| Real | REAL | Single-precision floating point |
| Double | DOUBLE PRECISION | Double-precision floating point |
| Decimal | DECIMAL(p,s) | Exact decimal (values: precision, scale) |
| **Boolean** | | |
| Boolean | BOOLEAN | true/false |
| **Date/Time types** | | |
| Date | DATE | Date only |
| DateTime | TIMESTAMP WITH TZ | Date and time (with timezone) |
| DateTime_NO_TZ | TIMESTAMP | Date and time (without timezone) |
| Time | TIME WITH TZ | Time only (with timezone) |
| Time_NO_TZ | TIME | Time only (without timezone) |
| **Identifiers** | | |
| UUID | UUID | UUID v4 |
| TOKEN | VARCHAR(9) | 9-character token |
| **JSON types** | | |
| JSON | JSON | JSON (not queryable) |
| JSONB | JSONB | Binary JSON (queryable, indexed) |
| **Enum** | | |
| ENUM | VARCHAR(255) | Stored as varchar |
| **Virtual** | | |
| VIRTUAL | (computed) | Computed column (requires `calculated` expression) |
| **Array types** | | |
| Array_String | TEXT[] | Array of strings |
| Array_Integer | INTEGER[] | Array of integers |
| Array_Double | DOUBLE PRECISION[] | Array of doubles |
| Array_Decimal | NUMERIC[] | Array of decimals |
| Array_DateTime | TIMESTAMP WITH TZ[] | Array of datetimes |
| Array_DateTime_NO_TZ | TIMESTAMP[] | Array of datetimes (no TZ) |
| Array_Date | DATE[] | Array of dates |
| Array_Time | TIME WITH TZ[] | Array of times |
| Array_Time_NO_TZ | TIME[] | Array of times (no TZ) |
| Array_UUID | UUID[] | Array of UUIDs |
| Array_Boolean | BOOLEAN[] | Array of booleans |
| **Range types** | | |
| Range_Integer | INT4RANGE | Integer range |
| Range_Double | NUMRANGE | Double range |
| Range_Decimal | NUMRANGE | Decimal range |
| Range_DateTime | TSTZRANGE | DateTime range (with TZ) |
| Range_DateTime_NO_TZ | TSRANGE | DateTime range (no TZ) |
| Range_Date | DATERANGE | Date range |
| Range_Time | (time range) | Time range (with TZ) |
| Range_Time_NO_TZ | (time range) | Time range (no TZ) |
| **PostGIS Geometry** | | |
| Point | POINT | PostGIS point |
| LineString | LINESTRING | PostGIS linestring |
| Polygon | POLYGON | PostGIS polygon |
| MultiPoint | MULTIPOINT | Multiple points |
| MultiLineString | MULTILINESTRING | Multiple linestrings |
| MultiPolygon | MULTIPOLYGON | Multiple polygons |
| GeometryCollection | GEOMETRYCOLLECTION | Collection of geometries |
| Geography | GEOGRAPHY | Geographic coordinates |
| **pgvector (Vector Embeddings)** | | |
| Vector | vector(n) | float32 vector (requires DATABASE_VECTOR=true) |
| HalfVec | halfvec(n) | float16 vector (pgvector >= 0.7) |
| SparseVec | sparsevec(n) | sparse vector (pgvector >= 0.7) |

### Field Properties

| Property | Type | Description |
|----------|------|-------------|
| type | string | Field type (required) |
| primaryKey | boolean | Is primary key |
| allowNull | boolean | Allow NULL values |
| unique | boolean | Unique constraint |
| defaultValue | any | Default value or type object |
| values | object | Type-specific options |
| validate | object | Validation rules |
| comment | string | Column comment |

### Default Value Types

```javascript
{"type": "UUIDV4"}         // Generate UUID v4
{"type": "SUID"}           // Generate short unique ID (compact, URL-safe)
{"type": "NOW"}            // Current timestamp
{"type": "AUTOINCREMENT"}  // Auto-incrementing integer
{"type": "SQL", "value": "(SELECT ...)"} // Custom SQL expression
"static value"             // Literal value
0                          // Numeric default
false                      // Boolean default
[]                         // Empty array
{}                         // Empty object
```

#### SQL Default Value Examples

```javascript
// Next sort order
{
  "sortOrder": {
    "type": "Integer",
    "defaultValue": {"type": "SQL", "value": "(SELECT COALESCE(MAX(sort_order), 0) + 1 FROM products)"}
  }
}

// Random code
{
  "code": {
    "type": "String",
    "defaultValue": {"type": "SQL", "value": "md5(random()::text)"}
  }
}

// Current fiscal year
{
  "fiscalYear": {
    "type": "Integer",
    "defaultValue": {"type": "SQL", "value": "EXTRACT(YEAR FROM CURRENT_DATE)"}
  }
}
```

### Field Validation Rules

Baasix enforces validation rules at runtime during create and update operations.

#### Numeric Validation (Integer, BigInt, Decimal, Double, Real)

```javascript
{
  "age": {
    "type": "Integer",
    "validate": {
      "min": 0,          // Minimum allowed value
      "max": 150,        // Maximum allowed value
      "isInt": true      // Must be integer (for Double/Decimal)
    }
  },
  "price": {
    "type": "Decimal",
    "values": {"precision": 10, "scale": 2},
    "validate": {
      "min": 0.01,
      "max": 99999.99
    }
  }
}
```

#### String Validation

```javascript
{
  "email": {
    "type": "String",
    "validate": {
      "isEmail": true,      // Must be valid email format
      "notEmpty": true,     // Cannot be empty string
      "len": [5, 255]       // Length between 5-255 characters
    }
  },
  "website": {
    "type": "String",
    "validate": {
      "isUrl": true         // Must be valid URL format
    }
  },
  "zipCode": {
    "type": "String",
    "validate": {
      "is": "^\\d{5}(-\\d{4})?$"  // Regex pattern matching
    }
  }
}
```

#### Array Validation

Validation rules apply to each element in the array:

```javascript
{
  "scores": {
    "type": "Array_Integer",
    "validate": {
      "min": 0,    // Each element must be >= 0
      "max": 100   // Each element must be <= 100
    }
  }
}
```

#### Range Validation

Validation rules apply to both lower and upper bounds. Also ensures lower bound <= upper bound.

```javascript
{
  "age_range": {
    "type": "Range_Integer",
    "validate": {
      "min": 0,    // Lower/upper bounds must be >= 0
      "max": 200   // Lower/upper bounds must be <= 200
    }
  }
}
```

### Field Definition Examples

```javascript
{
  // Primary key
  "id": {
    "type": "UUID",
    "primaryKey": true,
    "defaultValue": {"type": "UUIDV4"}
  },

  // String with length
  "title": {
    "type": "String",
    "allowNull": false,
    "values": {"length": 500}
  },

  // Text (unlimited)
  "content": {
    "type": "Text",
    "allowNull": true
  },

  // Decimal with precision
  "price": {
    "type": "Decimal",
    "values": {"precision": 10, "scale": 2},
    "allowNull": false,
    "defaultValue": 0.00
  },

  // Integer with validation
  "age": {
    "type": "Integer",
    "validate": {"min": 0, "max": 150}
  },

  // Boolean with default
  "isPublished": {
    "type": "Boolean",
    "allowNull": false,
    "defaultValue": false
  },

  // DateTime
  "publishedAt": {
    "type": "DateTime",
    "allowNull": true
  },

  // Array of strings
  "tags": {
    "type": "Array_String",
    "defaultValue": []
  },

  // JSONB
  "metadata": {
    "type": "JSONB",
    "allowNull": true,
    "defaultValue": {}
  },

  // Geometry (PostGIS)
  "location": {
    "type": "Point",
    "allowNull": true
  },

  // Vector embedding (pgvector — requires DATABASE_VECTOR=true)
  "embedding": {
    "type": "Vector",
    "allowNull": true,
    "values": { "dimensions": 1536 }
  }
}

#### M2O (Many-to-One / BelongsTo)
```javascript
POST /schemas/posts/relationships
{
  "type": "M2O",
  "target": "baasix_User",
  "name": "author",         // Field on posts
  "alias": "posts"          // Reverse relation name on users (optional)
}
// Creates: posts.author_Id → baasix_User.id
// Auto-creates index on author_Id for better query performance
```

#### O2M (One-to-Many / HasMany)
```javascript
// Automatically created as reverse of M2O
// Access: user.posts
```

#### M2M (Many-to-Many)
```javascript
POST /schemas/posts/relationships
{
  "type": "M2M",
  "target": "tags",
  "name": "tags",
  "alias": "posts"
}
// Creates junction table: posts_tags_tags_junction (auto-generated)
// Junction table has isJunction: true in schema

// With custom junction table name (useful for long collection names)
POST /schemas/posts/relationships
{
  "type": "M2M",
  "target": "tags",
  "name": "tags",
  "alias": "posts",
  "through": "post_tags"    // Custom name (max 63 chars for PostgreSQL)
}
```

#### M2A (Many-to-Any / Polymorphic)
```javascript
POST /schemas/comments/relationships
{
  "type": "M2A",
  "name": "commentable",
  "tables": ["posts", "products"],  // Can relate to multiple collections
  "alias": "comments",
  "through": "comment_refs"          // Optional custom junction table name
}
// Creates polymorphic junction table with collection column
```

#### Junction Tables (M2M/M2A)
- **Auto-generated name**: `{source}_{target}_{name}_junction`
- **Custom name**: Use `through` property (max 63 characters for PostgreSQL)
- **Schema property**: `isJunction: true` marks junction tables
- **Auto-indexed**: All FK columns are automatically indexed

### Indexes

```javascript
POST /schemas/:collection/indexes
{
  "name": "idx_email_unique",
  "fields": ["email"],
  "unique": true
}

// Composite index
{
  "name": "idx_status_created",
  "fields": ["status", "createdAt"]
}
```

---

## Services API

### ItemsService

```javascript
import { ItemsService } from "@baasix/baasix";

const service = new ItemsService("collection_name", {
  accountability: req.accountability,  // User context
  tenant: tenantId                      // For multi-tenant
});

// Read methods
const result = await service.readByQuery({
  filter: {...},
  fields: [...],
  sort: {...},
  limit: 20,
  page: 1,
  search: "term",
  searchFields: ["field1", "field2"],
  relConditions: {...}
});
// Returns: { data: [...], totalCount: number }

// Read with transaction support
const result = await service.readByQuery(query, false, transaction);

const item = await service.readOne(id, { fields: [...] });

// ReadOne with transaction support
const item = await service.readOne(id, query, false, transaction);

// Write methods
const id = await service.createOne(data);
const ids = await service.createMany([data1, data2]);
const id = await service.updateOne(id, data);
const ids = await service.updateMany([id1, id2], data);
await service.deleteOne(id);
await service.deleteMany([id1, id2]);

// Soft delete (if paranoid enabled on schema)
// deleteOne automatically soft-deletes for paranoid schemas
await service.deleteOne(id); // soft deletes
await service.deleteOne(id, { force: true }); // hard deletes
await service.restore(id); // restores soft-deleted item

// Options
await service.createOne(data, { 
  bypassPermissions: true,
  bypassHooks: true 
});
```

### FilesService

```javascript
import { FilesService } from "@baasix/baasix";

const filesService = new FilesService({ accountability });

// Upload file
const fileId = await filesService.createOne(
  { file: req.files.upload },
  { title: "Photo", storage: "local", isPublic: true }
);

// Get file
const file = await filesService.readOne(fileId);

// Delete file
await filesService.deleteOne(fileId);

// Download from URL
const fileId = await filesService.downloadFromUrl(url, metadata);
```

### MailService

```javascript
import { MailService } from "@baasix/baasix";

await MailService.sendMail({
  to: "user@example.com",
  subject: "Welcome!",
  templateName: "welcome",  // templates/mails/welcome.liquid
  context: { userName: "John", link: "https://..." }
});
```

### NotificationService

```javascript
import { NotificationService } from "@baasix/baasix";

const notificationService = new NotificationService({ accountability });

await notificationService.send({
  type: "info",
  title: "New Comment",
  message: "Someone commented",
  data: { postId: "123" },
  userIds: ["user-1", "user-2"]
});

await notificationService.markAsSeen(userId, notificationIds);
const count = await notificationService.getUnreadCount(userId);
```

### CacheService

```javascript
import { getCacheService, invalidateCollection, invalidateEntireCache } from "@baasix/baasix";

const cache = getCacheService();

await cache.set("key", value, ttlInSeconds);
const value = await cache.get("key");
await cache.delete("key");

// Invalidate collection cache
await invalidateCollection("posts");

// Clear all cache
await invalidateEntireCache();
```

### StorageService

```javascript
import { StorageService } from "@baasix/baasix";

// Save file
const path = await StorageService.saveFile("local", "path/file.pdf", buffer);

// Get file
const buffer = await StorageService.getFile("local", "path/file.pdf");

// Get URL (signed for S3)
const url = await StorageService.getPublicUrl("s3", "path/file.pdf");

// Delete
await StorageService.deleteFile("local", "path/file.pdf");
```

### ReportService

```javascript
import { ReportService } from "@baasix/baasix";

const reportService = new ReportService("orders", { accountability });

// Generate a report with fields, filter, sort, aggregate, groupBy
const report = await reportService.generateReport({
  fields: ["status", "category"],
  filter: { status: { eq: "completed" } },
  sort: { createdAt: "desc" },
  limit: 100,
  page: 1,
  aggregate: {
    revenue: { function: "sum", field: "total" },
    count: { function: "count", field: "id" }
  },
  groupBy: ["status", "category"]
});
// Uses ItemsService internally, supports grouped reports with relational fields
```

### StatsService

```javascript
import { StatsService } from "@baasix/baasix";

const statsService = new StatsService({ accountability });

// Generate stats across multiple collections
const result = await statsService.generateStats([
  {
    name: "totalOrders",
    collection: "orders",
    query: {
      aggregate: { count: { function: "count", field: "id" } },
      filter: { status: { eq: "completed" } }
    }
  },
  {
    name: "totalRevenue",
    collection: "orders",
    query: {
      aggregate: { total: { function: "sum", field: "amount" } }
    }
  },
  {
    name: "activeUsers",
    collection: "baasix_User",
    query: {
      aggregate: { count: { function: "count", field: "id" } },
      filter: { status: { eq: "active" } }
    }
  }
]);
// Returns: { data, totalStats, successfulStats }
// Creates a ReportService per collection internally
```

### WorkflowService

```javascript
import { WorkflowService } from "@baasix/baasix";

const workflowService = new WorkflowService({ accountability });

// Execute workflow
const result = await workflowService.executeWorkflow(
  workflowId,
  triggerData
);
```

### TasksService

Background task management with distributed locking, atomic claiming, stall recovery, and concurrency control.

```javascript
// Atomic task claiming — prevents duplicate processing
const claimed = await tasksService.claimTask(taskId);
if (!claimed) continue; // Already taken by another worker

// Get cached "Not started" tasks (within 4hr window)
const tasks = await tasksService.getNotStartedTasks();

// Distributed job locking — for cron jobs that must run on one instance
const locked = await tasksService.acquireJobLock('job-name', ttlSeconds);
try { /* process */ } finally { await tasksService.releaseJobLock('job-name'); }

// Instance-level concurrency lock (respects TASK_CONCURRENCY)
const acquired = await tasksService.tryAcquireLock(60);
try { /* process */ } finally { await tasksService.releaseLock(); }

// Force cache refresh
await tasksService.forceRefresh();

// Cache stats
const stats = await tasksService.getCacheStats();
```

#### TasksService Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| TASK_SERVICE_ENABLED | false | Enable task service |
| TASK_CONCURRENCY | 1 | Max concurrent tasks per instance |
| TASK_STALL_TIMEOUT | 300 | Seconds before Running task is stalled |
| TASK_LIST_REFRESH_INTERVAL | 600 | Cache refresh interval in seconds |
| TASK_SHUTDOWN_WAIT_TIME | 30 | Wait for running tasks on shutdown |
| TASK_REDIS_ENABLED | false | Enable Redis for distributed locking |
| TASK_REDIS_URL | - | Redis URL for distributed locking |

#### baasix_Tasks Table Columns

- `task_status`: "Not started" | "Running" | "Completed" | "Error"
- `type`: Task type string
- `scheduled_time`: When to execute
- `started_at`: Auto-set when task starts (used for stall detection)
- `max_retries`: Max retry attempts (default: 0)
- `retry_count`: Current retry count (system-managed)
- `task_data`: JSON task payload
- `result_data`: JSON result
- `error_data`: JSON error info

#### Stall Recovery

Automatic — runs during init and each cache refresh:
- Tasks in "Running" beyond `TASK_STALL_TIMEOUT` are detected
- If `retry_count < max_retries`: reset to "Not started" for retry
- Otherwise: marked as "Error"

---

## Extensions

### Extension Types

| Type | Folder Pattern | Purpose |
|------|----------------|---------|
| Hook | baasix-hook-{name} | Lifecycle hooks |
| Endpoint | baasix-endpoint-{name} | Custom API routes |
| Schedule | baasix-schedule-{name} | Cron jobs |
| Template | baasix-templates | Email/custom templates |

### Hook Extension Context

Hook extensions receive `(hooksService, context)` where context contains:

```javascript
{
  db,                  // Drizzle database instance
  permissionService,   // PermissionService instance
  mailService,         // MailService (static methods)
  storageService,      // StorageService instance
  ItemsService,        // ItemsService class (constructor)
  tasksService         // TasksService instance
}
```

> **Note**: For other services like ReportService, StatsService, FilesService, getCacheService, etc., import them directly from `@baasix/baasix` in your extension.

### Hook Events Reference

| Event | Phase | Can Modify |
|-------|-------|------------|
| items.create | Before | data |
| items.create.after | After | - |
| items.read | Before (list) | query, transaction |
| items.read.after | After (list) | result, transaction |
| items.read.one | Before (single) | query, transaction |
| items.read.one.after | After (single) | result, transaction |
| items.update | Before | data |
| items.update.after | After | - |
| items.delete | Before | - (can throw) |
| items.delete.after | After | - |

### Complete Hook Example

```javascript
// extensions/baasix-hook-products/index.js
export default (hooksService, context) => {
  const { ItemsService, mailService } = context;

  // ==========================================
  // BEFORE CREATE - Validate & Transform
  // ==========================================
  hooksService.registerHook("products", "items.create", async ({
    data,
    accountability,
    collection,
    schema,
    db,
    transaction
  }) => {
    // Auto-generate SKU if not provided
    if (!data.sku) {
      const prefix = (data.name || "PRD").substring(0, 3).toUpperCase();
      data.sku = `${prefix}-${Date.now()}`;
    }

    // Ensure SKU is uppercase
    data.sku = data.sku.toUpperCase();

    // Add audit fields
    if (accountability?.user) {
      data.created_by = accountability.user.id;
    }

    // Generate slug from name
    if (data.name) {
      data.slug = data.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
    }

    // MUST return modified data
    return { data };
  });

  // ==========================================
  // AFTER CREATE - Side Effects
  // ==========================================
  hooksService.registerHook("products", "items.create.after", async ({
    data,
    document,  // The created record with ID
    accountability,
    collection,
    db
  }) => {
    // Send notification to admin for high-value products
    if (document.price > 1000) {
      await mailService.sendMail({
        to: "admin@example.com",
        subject: "High-value product created",
        templateName: "high-value-product",
        context: { product: document }
      });
    }

    // Log activity (no return needed for after hooks)
    console.log(`Product created: ${document.id} by ${accountability?.user?.email}`);
  });

  // ==========================================
  // BEFORE READ - Filter/Modify Query
  // ==========================================
  hooksService.registerHook("products", "items.read", async ({
    query,
    accountability,
    transaction
  }) => {
    // Non-admins can only see published products
    if (accountability?.role?.name !== "administrator") {
      const existingFilter = query.filter ? JSON.parse(query.filter) : {};
      query.filter = JSON.stringify({
        AND: [
          existingFilter,
          { published: { eq: true } },
          { deletedAt: { isNull: true } }
        ]
      });
    }

    return { query };
  });

  // ==========================================
  // AFTER READ - Transform Results
  // ==========================================
  hooksService.registerHook("products", "items.read.after", async ({
    query,
    result,
    accountability,
    transaction
  }) => {
    // Add computed fields
    if (Array.isArray(result.data)) {
      result.data = result.data.map(item => ({
        ...item,
        displayPrice: `$${item.price.toFixed(2)}`,
        isOnSale: item.salePrice && item.salePrice < item.price
      }));
    }

    return { result };
  });

  // ==========================================
  // BEFORE UPDATE - Validation
  // ==========================================
  hooksService.registerHook("products", "items.update", async ({
    id,
    data,
    accountability
  }) => {
    // Prevent changing SKU after creation
    if (data.sku) {
      delete data.sku;
    }

    // Add audit fields
    if (accountability?.user) {
      data.updated_by = accountability.user.id;
    }

    // Update slug if name changed
    if (data.name) {
      data.slug = data.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
    }

    return { data };
  });

  // ==========================================
  // BEFORE DELETE - Prevent or Archive
  // ==========================================
  hooksService.registerHook("products", "items.delete", async ({
    id,
    accountability
  }) => {
    const productsService = new ItemsService("products", { accountability });
    const product = await productsService.readOne(id);

    // Check if product has orders
    const ordersService = new ItemsService("order_items", { accountability });
    const orders = await ordersService.readByQuery({
      filter: { product_Id: { eq: id } },
      limit: 1
    });

    if (orders.totalCount > 0) {
      // Archive instead of delete
      await productsService.updateOne(id, {
        archived: true,
        archivedAt: new Date()
      }, { bypassHooks: true });

      throw new Error("Product has orders and was archived instead of deleted");
    }
  });

  // ==========================================
  // WILDCARD HOOK - All Collections
  // ==========================================
  hooksService.registerHook("*", "items.create.after", async (ctx) => {
    // Log all creates
    console.log(`[${ctx.collection}] Created: ${ctx.document.id}`);
  });
};
```

### Endpoint Extension

```javascript
// extensions/baasix-endpoint-dashboard/index.js
import { APIError, ItemsService } from "@baasix/baasix";

export default {
  id: "dashboard-api",
  handler: (app, context) => {

    // ==========================================
    // PROTECTED ENDPOINT - Requires Auth
    // ==========================================
    app.get("/api/dashboard/stats", async (req, res, next) => {
      try {
        // Check authentication
        if (!req.accountability?.user) {
          throw new APIError("Authentication required", 401);
        }

        const { accountability } = req;

        // Initialize services
        const ordersService = new ItemsService("orders", { accountability });
        const productsService = new ItemsService("products", { accountability });
        const usersService = new ItemsService("baasix_User", { accountability });

        // Fetch stats in parallel
        const [orderStats, productStats, userStats] = await Promise.all([
          ordersService.readByQuery({
            filter: { status: { eq: "completed" } },
            aggregate: {
              revenue: { function: "sum", field: "total" },
              count: { function: "count", field: "id" }
            }
          }),
          productsService.readByQuery({
            filter: { inStock: { eq: true } },
            aggregate: { count: { function: "count", field: "id" } }
          }),
          usersService.readByQuery({
            filter: { status: { eq: "active" } },
            aggregate: { count: { function: "count", field: "id" } }
          })
        ]);

        res.json({
          data: {
            totalRevenue: orderStats.data[0]?.revenue || 0,
            totalOrders: orderStats.data[0]?.count || 0,
            activeProducts: productStats.data[0]?.count || 0,
            activeUsers: userStats.data[0]?.count || 0
          }
        });
      } catch (error) {
        next(error);
      }
    });

    // ==========================================
    // ROLE-BASED ENDPOINT - Admin Only
    // ==========================================
    app.get("/api/admin/reports/sales", async (req, res, next) => {
      try {
        if (!req.accountability?.user) {
          throw new APIError("Authentication required", 401);
        }

        if (req.accountability.role?.name !== "administrator") {
          throw new APIError("Admin access required", 403);
        }

        const { startDate, endDate, groupBy = "day" } = req.query;
        const { accountability } = req;

        const ordersService = new ItemsService("orders", { accountability });

        const filter = {
          AND: [
            { status: { eq: "completed" } },
            { createdAt: { gte: startDate || "$NOW-DAYS_30" } },
            { createdAt: { lte: endDate || "$NOW" } }
          ]
        };

        const result = await ordersService.readByQuery({
          filter,
          aggregate: {
            revenue: { function: "sum", field: "total" },
            count: { function: "count", field: "id" },
            avgOrder: { function: "avg", field: "total" }
          },
          groupBy: ["status"]
        });

        res.json({ data: result.data });
      } catch (error) {
        next(error);
      }
    });

    // ==========================================
    // PUBLIC ENDPOINT - No Auth
    // ==========================================
    app.post("/api/contact", async (req, res, next) => {
      try {
        const { name, email, message, subject } = req.body;

        // Validation
        if (!name || !email || !message) {
          throw new APIError("Name, email, and message are required", 400);
        }

        // Email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          throw new APIError("Invalid email format", 400);
        }

        // Save to database (no accountability = system context)
        const contactService = new ItemsService("contact_submissions", {});

        const id = await contactService.createOne({
          name,
          email,
          message,
          subject: subject || "General Inquiry",
          submittedAt: new Date(),
          status: "pending"
        });

        // Send notification email
        const { mailService } = context;
        await mailService.sendMail({
          to: "support@example.com",
          subject: `New Contact: ${subject || "General Inquiry"}`,
          templateName: "contact-notification",
          context: { name, email, message }
        });

        res.status(201).json({
          data: { id },
          message: "Thank you for your message"
        });
      } catch (error) {
        next(error);
      }
    });

    // ==========================================
    // PARAMETERIZED ENDPOINT
    // ==========================================
    app.get("/api/products/:slug", async (req, res, next) => {
      try {
        const { slug } = req.params;
        const { accountability } = req;

        const productsService = new ItemsService("products", { accountability });

        const result = await productsService.readByQuery({
          filter: { slug: { eq: slug } },
          fields: ["*", "category.*", "reviews.*", "reviews.author.firstName"],
          limit: 1
        });

        if (result.data.length === 0) {
          throw new APIError("Product not found", 404);
        }

        res.json({ data: result.data[0] });
      } catch (error) {
        next(error);
      }
    });

    // ==========================================
    // FILE UPLOAD ENDPOINT
    // ==========================================
    app.post("/api/products/:id/images", async (req, res, next) => {
      try {
        if (!req.accountability?.user) {
          throw new APIError("Authentication required", 401);
        }

        if (!req.files?.image) {
          throw new APIError("No image provided", 400);
        }

        const { id } = req.params;
        const { accountability } = req;

        // Import FilesService directly (not in hook context)
        const { FilesService } = await import("@baasix/baasix");

        // Upload file
        const filesService = new FilesService({ accountability });
        const fileId = await filesService.createOne(
          { file: req.files.image },
          {
            title: `Product ${id} Image`,
            storage: "local",
            folder: `products/${id}`
          }
        );

        // Link to product
        const productsService = new ItemsService("products", { accountability });
        await productsService.updateOne(id, {
          images: { push: fileId }  // Assuming images is an array
        });

        res.status(201).json({ data: { fileId } });
      } catch (error) {
        next(error);
      }
    });
  }
};
```

### Schedule Extension

```javascript
// extensions/baasix-schedule-cleanup/index.js
export default {
  id: "nightly-cleanup",
  schedule: "0 2 * * *",  // 2 AM daily (cron syntax)

  handler: async (context) => {
    const { ItemsService } = context;

    // Clean old logs (30 days)
    const logsService = new ItemsService("activity_logs", {});
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);

    const oldLogs = await logsService.readByQuery({
      filter: { createdAt: { lt: cutoffDate.toISOString() } },
      fields: ["id"],
      limit: -1
    });

    if (oldLogs.data.length > 0) {
      await logsService.deleteMany(oldLogs.data.map(l => l.id));
      console.log(`Deleted ${oldLogs.data.length} old logs`);
    }

    // Clean expired sessions (7 days)
    const sessionsService = new ItemsService("baasix_Session", {});
    const sessionCutoff = new Date();
    sessionCutoff.setDate(sessionCutoff.getDate() - 7);

    const expiredSessions = await sessionsService.readByQuery({
      filter: { lastActivity: { lt: sessionCutoff.toISOString() } },
      fields: ["id"],
      limit: -1
    });

    if (expiredSessions.data.length > 0) {
      await sessionsService.deleteMany(expiredSessions.data.map(s => s.id));
      console.log(`Deleted ${expiredSessions.data.length} expired sessions`);
    }

    console.log("Cleanup completed");
  }
};
```

### Accessing Additional Services in Extensions

```javascript
// Hook or endpoint extension — import additional services directly
import {
  ReportService,
  StatsService,
  FilesService,
  getCacheService,
  invalidateCollection,
  invalidateEntireCache,
  WorkflowService,
  NotificationService
} from "@baasix/baasix";

export default (hooksService, context) => {
  // context has: db, permissionService, mailService, storageService, ItemsService, tasksService

  hooksService.registerHook("orders", "items.create.after", async ({ document, accountability }) => {
    // Use imported services
    const cache = getCacheService();
    await cache.delete("dashboard:stats");
    await invalidateCollection("orders");

    const reportService = new ReportService("orders", { accountability });
    const report = await reportService.generateReport({
      aggregate: { total: { function: "sum", field: "amount" } }
    });

    const notificationService = new NotificationService({ accountability });
    await notificationService.send({
      type: "info",
      title: "New Order",
      message: `Order total: ${document.total}`,
      userIds: ["admin-user-id"]
    });
  });
};
```

---

## Workflow System

### Trigger Types

| Type | Description |
|------|-------------|
| manual | Execute via API |
| webhook | Execute via webhook URL |
| schedule | Cron-based execution |
| hook | Trigger on data changes |

### Node Types (17 total)

| Node | Purpose |
|------|---------|
| HTTP | Make HTTP requests |
| Transform | Transform data |
| Condition | Conditional branching |
| Service | Call ItemsService methods |
| Loop | Iterate over arrays |
| Filter | Filter array items |
| Aggregate | Aggregate calculations |
| Delay | Add delay |
| Notification | Send notifications |
| Email | Send emails |
| Workflow | Execute sub-workflow |
| Stats | Collect statistics |
| File | File operations |
| Variable | Set/get variables |
| Script | Execute custom JavaScript |
| Try | Error handling (try-catch branching) |
| Trigger | Workflow entry point |

### Template Variables

```javascript
{{trigger.data.fieldName}}     // Trigger data
{{outputs.nodeId.data}}        // Node output
{{variables.name}}             // Workflow variables
{{accountability.user.id}}     // Current user
```

---

## Permissions

### Permission Structure

```javascript
// POST /permissions
{
  "role_Id": "user-role-uuid",
  "collection": "products",
  "action": "read",              // read, create, update, delete
  "fields": ["*", "reviews.*"],  // see "fields" rules below
  "conditions": {                // ROW filter on THIS collection (which records)
    "published": {"eq": true}
  },
  "relConditions": {             // filter on RELATED rows in the response
    "reviews": {"approved": {"eq": true}}
  }
}
```

#### `fields` — which COLUMNS the role may access

> **Critical:** `"*"` grants only the collection's OWN/DIRECT columns. It does **not** include any related/nested data. A relation that is not named in `fields` is stripped from the response entirely (even if `relConditions` targets it).

Each `*` segment is **one level** deep — add another `.*` to go one level deeper. There is **no** `**` syntax.

| Pattern | Grants |
|---------|--------|
| `["*"]` | Own/direct columns only — **no relations** |
| `["name", "price"]` | Only those two own columns |
| `["*", "author.*"]` | Own columns + author's direct fields (one level) |
| `["*", "author.*.*"]` | Own columns + author + author's relations one level deeper |
| `["*.*"]` | Own columns + all first-level relations |

#### `conditions` vs `relConditions` — they are different

- **`conditions`** = a **row filter on THIS collection**. Decides **which records** of the permissioned collection the role can see/act on (merged into the main query's WHERE). Keys are this collection's columns.
  - `{"author_Id": {"eq": "$CURRENT_USER"}}` → only the user's own records
- **`relConditions`** = a filter on **related rows returned alongside** (HasMany / M2M arrays). Decides **which related rows** appear in the response. Keyed by **relation name**. Does **not** restrict the main records, and only takes effect if that relation is also granted in `fields`.
  - `{"reviews": {"approved": {"eq": true}}}` → only approved reviews in each product's `reviews` array

> Rule of thumb: *"which rows of THIS collection?"* → `conditions`. *"which related rows inside the response?"* → `relConditions`.

### Built-in Roles

| Role | Description |
|------|-------------|
| administrator | Full system access (not tenant-specific) |
| public | Unauthenticated users (not tenant-specific) |
| user | Standard user access (tenant-specific) |

### Common Permission Patterns

```javascript
// Public can read published products
{
  "role_Id": "public-role-uuid",
  "collection": "products",
  "action": "read",
  "fields": ["id", "name", "price", "description", "images"],
  "conditions": {"published": {"eq": true}}
}

// Users can only edit their own posts
{
  "role_Id": "user-role-uuid",
  "collection": "posts",
  "action": "update",
  "fields": ["title", "content"],
  "conditions": {"author_Id": {"eq": "$CURRENT_USER"}}  // which posts (row filter)
}

// Read products with their author + only approved reviews
{
  "role_Id": "user-role-uuid",
  "collection": "products",
  "action": "read",
  // "*" alone would EXCLUDE author/reviews — name them explicitly:
  "fields": ["*", "author.firstName", "reviews.*"],
  "conditions": {"published": {"eq": true}},            // which products (row filter)
  "relConditions": {"reviews": {"approved": {"eq": true}}}  // which reviews appear
}

// Admin full access (no conditions)
{
  "role_Id": "admin-role-uuid",
  "collection": "*",     // All collections
  "action": "read",
  "fields": ["*"]        // "*" = own columns only; add "rel.*" per relation as needed
}
```

---

## Error Handling

### Error Response Format

```json
{
  "error": {
    "message": "Error description",
    "code": "ERROR_CODE"
  }
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad request / Validation error |
| 401 | Unauthorized (not logged in) |
| 403 | Forbidden (no permission) |
| 404 | Not found |
| 409 | Conflict (duplicate) |
| 422 | Unprocessable entity |
| 429 | Rate limited |
| 500 | Internal server error |

### APIError Class

```javascript
import { APIError } from "@baasix/baasix";

// In endpoints/hooks
try {
  // Your code
} catch (error) {
  if (error instanceof APIError) {
    throw error;  // Re-throw APIError as-is
  }
  console.error("Unexpected error:", error);
  throw new APIError("An unexpected error occurred", 500);
}

// Common error codes
throw new APIError("Resource not found", 404);
throw new APIError("Invalid request data", 400);
throw new APIError("Authentication required", 401);
throw new APIError("Permission denied", 403);
throw new APIError("Resource already exists", 409);
throw new APIError("Rate limit exceeded", 429);
```

---

## Common Patterns & Solutions

### Pattern: Soft Delete with Paranoid

```javascript
// Schema
{
  "schema": {
    "paranoid": true,  // Adds deletedAt field
    "fields": {...}
  }
}

// Query excludes deleted by default
GET /items/products

// Include deleted records
GET /items/products?paranoid=false

// Restore deleted
await service.restore(id);
```

### Pattern: Multi-Tenant Isolation

```javascript
// Enable in .env
MULTI_TENANT=true

// All queries automatically filter by tenant
// Hooks receive tenant context
hooksService.registerHook("orders", "items.create", async ({ data, accountability }) => {
  data.tenant_Id = accountability.tenant;
  return { data };
});
```

### Pattern: Full-Text Search

```javascript
// Search across multiple fields
GET /items/products?search=wireless headphones&searchFields=["name","description","tags"]

// Combine with filters
GET /items/products?search=laptop&filter={"category.slug":"electronics","inStock":true}
```

### Pattern: Geospatial Queries

```javascript
// Find stores within 10km
GET /items/stores?filter={
  "location": {
    "dwithin": {
      "geometry": {"type": "Point", "coordinates": [-73.9857, 40.7484]},
      "distance": 10000
    }
  }
}

// Sort by distance
GET /items/stores?sort={
  "_distance": {
    "target": [-73.9857, 40.7484],
    "column": "location",
    "direction": "ASC"
  }
}
```

### Pattern: Vector Similarity Queries (pgvector)

Requires `DATABASE_VECTOR=true` and a `Vector`/`HalfVec`/`SparseVec` field.

```javascript
// Semantic search (cosine similarity)
GET /items/documents?filter={
  "embedding": {
    "vectorCosine": {
      "vector": [0.021, -0.012, 0.034, ...],
      "threshold": 0.2
    }
  }
}

// Nearest neighbors (L2 / Euclidean)
GET /items/products?filter={
  "embedding": {
    "vectorL2": {
      "vector": [0.021, -0.012, 0.034, ...],
      "threshold": 0.5
    }
  }
}

// True top-K: sort by distance, no hard threshold
GET /items/documents?sort={"_vectorDistance":{"vector":[...]},"column":"embedding","operator":"cosine","direction":"ASC"}}&limit=10

// ANN hybrid: pre-filter by distance bound, then sort for ranked results
GET /items/documents?filter={"embedding":{"vectorCosine":{"vector":[...]},"threshold":0.5}}}&sort={"_vectorDistance":{"vector":[...]},"column":"embedding","operator":"cosine","direction":"ASC"}}&limit=10
```

### Pattern: Nested Relations with Filtering

```javascript
// Get orders with filtered items
GET /items/orders?fields=["*","items.*","items.product.*"]&filter={
  "status": {"eq": "completed"}
}&relConditions={
  "items": {
    "quantity": {"gt": 0},
    "product": {
      "inStock": {"eq": true}
    }
  }
}
```

---

## Testing Guide

```javascript
import request from "supertest";
import { app } from "./setup"; // Your test setup

describe("Products API", () => {
  let adminToken, userToken, productId;

  beforeAll(async () => {
    // Login as admin
    const adminRes = await request(app)
      .post("/auth/login")
      .send({ email: "admin@test.com", password: "admin123" });
    adminToken = adminRes.body.token;

    // Login as regular user
    const userRes = await request(app)
      .post("/auth/login")
      .send({ email: "user@test.com", password: "user123" });
    userToken = userRes.body.token;
  });

  describe("CRUD Operations", () => {
    test("Admin can create product", async () => {
      const res = await request(app)
        .post("/items/products")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Test Product",
          price: 29.99,
          sku: "TEST-001",
          inStock: true
        });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBeDefined();
      productId = res.body.data.id;
    });

    test("Read product with relations", async () => {
      const res = await request(app)
        .get(`/items/products/${productId}`)
        .query({ fields: JSON.stringify(["*", "category.*"]) })
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe("Test Product");
    });

    test("Filter products", async () => {
      const filter = JSON.stringify({ inStock: { eq: true } });
      const res = await request(app)
        .get("/items/products")
        .query({ filter })
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    test("Update product", async () => {
      const res = await request(app)
        .patch(`/items/products/${productId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ price: 24.99 });

      expect(res.status).toBe(200);
    });

    test("Delete product", async () => {
      const res = await request(app)
        .delete(`/items/products/${productId}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });
  });

  describe("Permissions", () => {
    test("Unauthorized user cannot create", async () => {
      const res = await request(app)
        .post("/items/products")
        .send({ name: "Unauthorized" });

      expect(res.status).toBe(401);
    });

    test("Regular user cannot delete", async () => {
      const res = await request(app)
        .delete(`/items/products/${productId}`)
        .set("Authorization", `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });
  });
});
```

---

## CLI (Command Line Interface)

Baasix provides a CLI tool (`baasix`) for project scaffolding, type generation, and migrations.

### Installation

```bash
# Global installation
npm install -g baasix

# Or use npx
npx baasix <command>
```

### Configuration

Create a `.env` file with:

```env
BAASIX_URL=http://localhost:8056
BAASIX_EMAIL=admin@example.com
BAASIX_PASSWORD=your-password
# Or: BAASIX_TOKEN=your-jwt-token
```

### Commands

| Command | Description |
|---------|-------------|
| `baasix init [name]` | Initialize new project (-t api/nextjs) |
| `baasix generate` | Generate TypeScript types (-t types/sdk-types/schema-json) |
| `baasix extension [name]` | Scaffold extension (-t endpoint/hook) |
| `baasix migrate [action]` | Migration management (status/list/run/create/rollback/reset) |

### Quick Examples

```bash
# Create new API project
baasix init my-api -t api

# Generate TypeScript types
baasix generate -t types -o types/baasix.d.ts

# Create hook extension
baasix extension audit-log -t hook

# Create and run migrations
baasix migrate create -n add_products_table
baasix migrate run
baasix migrate rollback --steps 1
```

### Generated Types Usage

```typescript
import type { Products, Users } from "./types/baasix";
import { createBaasix } from "@baasix/sdk";

const baasix = createBaasix({ url: "http://localhost:8056" });

// Type-safe queries
const products = await baasix.items<Products>("products").list();
const user = await baasix.items<Users>("users").get("user-id");
```

### Migration File Structure

```javascript
// migrations/20240115120000_create_products_table.js
export async function up(baasix) {
  await baasix.schema.create("products", {
    name: "Products",
    timestamps: true,
    fields: {
      id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
      name: { type: "String", allowNull: false, values: { length: 255 } },
      price: { type: "Decimal", values: { precision: 10, scale: 2 } },
    },
  });
}

export async function down(baasix) {
  await baasix.schema.delete("products");
}
```

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| DATABASE_URL | Yes | - | PostgreSQL connection string |
| SECRET_KEY | Yes | - | JWT/encryption secret (32+ chars) |
| PORT | No | 8056 | HTTP port |
| BODY_SIZE_LIMIT | No | 20mb | Max JSON request body size |
| LOG_LEVEL | No | info | Log level (fatal/error/warn/info/debug/trace) |
| MULTI_TENANT | No | false | Enable multi-tenancy |
| WORKFLOWS_ENABLED | No | true | Master switch for the workflow subsystem; false disables hooks (no per-request overhead), schedules, /workflows/* routes, and code execution |
| SOCKET_ENABLED | No | false | Enable Socket.IO |
| REALTIME_ROW_LEVEL_SCOPING | No | false | Per-recipient row-level scoping for realtime broadcasts (A12); default off = fast room broadcast (may show other rows in tenant) |
| PUBLIC_REGISTRATION | No | true | Allow public registration; `false` makes `POST /auth/register` return 403 `REGISTRATION_DISABLED` unless the request carries a valid invite token |
| RATE_LIMIT | No | 100 | Requests per interval |
| RATE_LIMIT_INTERVAL | No | 5000 | Rate limit interval (ms) |
| AUTH_RATE_LIMIT | No | 10 | Brute-force limit for login/magic-link/password-reset, per (IP+email) pair (each account has its own budget per IP; does not cap total attempts across accounts) |
| AUTH_RATE_LIMIT_INTERVAL | No | 900000 | Window (ms) for the auth limiter (15 min) |
| AUTH_RATE_LIMIT_DISABLED | No | (off) | Disable the auth limiter (auto-disabled in TEST_MODE) |
| SYSTEM_CACHE_ADAPTER | No | memory | System cache adapter (memory/redis/upstash) |
| SYSTEM_CACHE_REDIS_URL | No | - | Redis URL for system cache |
| SYSTEM_CACHE_SYNC_INTERVAL | No | 5 | L1↔L2 sync interval in seconds |
| SYSTEM_CACHE_SIZE_GB | No | 1 | Max system cache size in GB (memory adapter) |
| SYSTEM_CACHE_TTL | No | 30 | System cache default TTL in seconds |
| DATA_CACHE_ENABLED | No | false | Enable data/query caching |
| DATA_CACHE_ADAPTER | No | memory | Data cache adapter (memory/redis/upstash) |
| DATA_CACHE_REDIS_URL | No | - | Redis URL for data cache |
| DATA_CACHE_TTL | No | 3600 | Data cache TTL (seconds) |
| DATA_CACHE_STRATEGY | No | explicit | Data cache strategy (explicit/all) |
| DATA_CACHE_SIZE_GB | No | 1 | Max data cache size in GB (memory adapter) |
| STORAGE_SERVICES_ENABLED | No | LOCAL | Comma-separated list (LOCAL,S3) |
| STORAGE_DEFAULT_SERVICE | No | LOCAL | Default storage service |
| LOCAL_STORAGE_DRIVER | No | LOCAL | Storage driver (LOCAL or S3) |
| LOCAL_STORAGE_PATH | No | ./uploads | Local storage path |
| S3_STORAGE_DRIVER | No | S3 | S3 driver |
| S3_STORAGE_BUCKET | No | - | S3 bucket name |
| S3_STORAGE_REGION | No | - | S3 region |
| S3_STORAGE_ACCESS_KEY_ID | No | - | S3 access key |
| S3_STORAGE_SECRET_ACCESS_KEY | No | - | S3 secret key |
| S3_STORAGE_ENDPOINT | No | - | S3 endpoint URL |
| MAIL_HOST | No | - | SMTP host |
| MAIL_PORT | No | 587 | SMTP port |
| MAIL_USER | No | - | SMTP user |
| MAIL_PASSWORD | No | - | SMTP password |
| MAIL_FROM | No | - | Default sender |
| AUDIT_LOG_CLEANUP_ENABLED | No | false | Enable automatic audit log cleanup |
| AUDIT_LOG_RETENTION_DAYS | No | 90 | Audit log retention in days |
| EMAIL_LOG_CLEANUP_ENABLED | No | false | Enable automatic email log cleanup |
| EMAIL_LOG_RETENTION_DAYS | No | 30 | Email log retention in days |
| COUNT_BY_DEFAULT | No | true | Compute `totalCount` on list reads (per-request `?count=` overrides) |
| PROTECT_PRIVILEGE_FIELDS | No | true | Privilege fields (role_Id, tenant_Id, emailVerified, hidden fields) excluded from `fields:["*"]` — must be named explicitly (admins exempt). Tri-state: `true` (password denied to non-admins even if explicitly granted), `allow-password` (non-admin may set password when explicitly granted — delegated reset; still hashed), `false` (off) |
| PROTECT_IS_PUBLIC_FIELD | No | false | Make baasix_File isPublic opt-in (not settable via broad `*` grant); default off = backward compatible |
| EXPOSE_ERROR_DETAILS | No | (prod: false) | Include raw DB error text in responses; off in production (leaks schema / injection oracle) |
| STORAGE_PATH_CONFINEMENT | No | true | Confine local-disk file ops within storage root (blocks path traversal) |
| STORAGE_FOLDER_STRUCTURE | No | false | Organize files into tenants/{t}/users/{u}|system folders (default off; existing files unaffected; migrate via POST /files/migrate-storage-structure) |
| ASSET_XSS_PROTECTION | No | true | Force executable upload types (html/svg/js/xml) to download, not render inline |
| ASSET_NOSNIFF | No | true | Send `X-Content-Type-Options: nosniff` on asset responses |
| STRICT_TENANT_ISOLATION | No | true | (Multi-tenant) restrict isTenantSpecific:false bypass to administrator; non-admin global roles stay tenant-scoped |
| AUTH_SERVICES_ENABLED | No | LOCAL | Comma list (uppercase): `LOCAL`, any of the 35 social provider ids (e.g. `GOOGLE,GITHUB,DISCORD`), `PASSKEY`, `TWOFACTOR` |
| BASE_URL | For OAuth | - | Required for OAuth; builds the provider callback `redirect_uri`: `{BASE_URL}/auth/callback/{provider}` |
| `<PROVIDERID>_CLIENT_ID` / `<PROVIDERID>_CLIENT_SECRET` | No | - | Per-provider credentials (e.g. `DISCORD_CLIENT_ID`); a provider activates only when enabled AND credentialed, else skipped with a startup warning |
| APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY | No | - | Apple Sign In extra keys |
| MICROSOFT_TENANT_ID | No | common | Microsoft (Entra ID) tenant |
| TIKTOK_CLIENT_KEY | No | - | TikTok; also currently requires `TIKTOK_CLIENT_ID` to be set as the registration gate |
| COGNITO_DOMAIN / COGNITO_REGION | No | - | AWS Cognito |
| WECHAT_CLIENT_ID / WECHAT_CLIENT_SECRET | No | - | WeChat appid / secret |
| PASSKEY_RP_ID | For passkeys | - | WebAuthn Relying Party ID (e.g. `example.com`); required with RP_NAME and ORIGIN to activate passkeys |
| PASSKEY_RP_NAME | For passkeys | - | WebAuthn Relying Party display name |
| PASSKEY_ORIGIN | For passkeys | - | Comma list of allowed web origins for WebAuthn |
| OAUTH_ALLOW_UNVERIFIED_LINK | No | false | Auto-link OAuth to existing account on UNVERIFIED email (default off = secure; only link verified) |
| OAUTH_ALLOW_DIRECT_IDTOKEN | No | false | Enable client-supplied direct idToken sign-in (default off; requires JWKS verification) |
| OAUTH_STATE_COOKIE_BINDING | No | false | Bind OAuth state to browser via httpOnly cookie (CSRF; default off — may break cross-site callbacks) |
| SSRF_ALLOW_PRIVATE_URL_FETCH | No | false | Allow server-side URL fetches to private/loopback/metadata addresses (default off = blocked) |
| URL_FETCH_TIMEOUT_MS | No | 15000 | Response timeout per hop for upload-from-URL (time-to-first-response, not total download; size capped by MAX_UPLOAD_FILE_SIZE) |
| ASSET_MAX_DIMENSION | No | 5000 | Max output width/height (px) for image transforms; larger requests clamped (DoS guard) |
| ASSET_MAX_INPUT_PIXELS | No | 100000000 | Max input pixels the decoder accepts (sharp limitInputPixels; decompression-bomb defense) |

> Security note: identifier allowlisting on filter/sort/aggregate fields and JSONB numeric-operand validation (SQL-injection protection) is always on and not configurable.

---

## Best Practices

1. **Always include an `id` field** with UUID or AUTOINCREMENT
2. **Use `timestamps: true`** for automatic createdAt/updatedAt
3. **Use JSONB over JSON** for queryable flexible data
4. **Use relConditions** to filter array relations (O2M/M2M)
5. **Use field selection** for performance (don't fetch `*` when not needed)
6. **Paginate large datasets** with limit/page
7. **Set proper indexes** for frequently filtered fields
8. **Handle errors** in extensions with try-catch
9. **Use req.accountability** to access current user in endpoints
10. **Test with real data patterns** that match production
11. **Use transactions** (hooks receive transaction context automatically)
12. **Cache expensive computations** using CacheService
13. **Validate input** in custom endpoints before processing

---

## Troubleshooting

### Common Issues

1. **401 Unauthorized**
   - Check `Authorization: Bearer <token>` header
   - Verify token hasn't expired
   - Ensure user exists and is active

2. **403 Forbidden**
   - Check permissions for role/collection/action
   - Verify permission conditions match the data

3. **Filters not working**
   - Ensure filter is valid JSON in query string
   - Use correct operator syntax (eq, not =)
   - Check for typos in field names

4. **Relations not loading**
   - Include relation in fields: `["*", "relation.*"]`
   - Verify relationship exists in schema
   - Check permissions for related collection

5. **Extension not loading**
   - Verify folder name: `baasix-hook-{name}`, `baasix-endpoint-{name}`
   - Check for syntax errors in index.js
   - Ensure proper ES module export

6. **Cache issues**
   - Verify Redis connection
   - Check SYSTEM_CACHE_REDIS_URL / DATA_CACHE_REDIS_URL in .env
   - Manually invalidate: `invalidateCollection("collection")`

---

## Exported Modules Reference

Everything importable from `@baasix/baasix`:

```javascript
// Services
import {
  ItemsService,       // CRUD for any collection
  FilesService,       // File upload/management
  MailService,        // Email sending
  NotificationService,// User notifications
  PermissionService,  // Permission management
  SettingsService,    // App settings
  StorageService,     // File storage (local/S3)
  AssetsService,      // Asset transformations
  ReportService,      // Report generation with aggregation
  StatsService,       // Multi-collection statistics
  WorkflowService,    // Workflow execution
  TasksService,       // Background task management
  MigrationService,   // Database migrations
  HooksManager,       // Hook registration/management
  SocketService,      // WebSocket management
  RealtimeService,    // Real-time subscriptions
} from "@baasix/baasix";

// App & Server
import { app, startServer, startServerForTesting, destroyAllTablesInDB } from "@baasix/baasix";

// Cache
import { getCacheService, invalidateCollection, invalidateEntireCache } from "@baasix/baasix";

// Logger
import { getLogger, initializeLogger } from "@baasix/baasix";

// Errors
import { APIError } from "@baasix/baasix";

// Plugin system
import { definePlugin, createPluginMeta, PluginManager } from "@baasix/baasix";

// Auth
import { getAuthInstance } from "@baasix/baasix";
```

---

## Version

- Package: @baasix/baasix@0.1.0-alpha.2
- Node.js: 18+
- PostgreSQL: 14+ (with PostGIS for geospatial)
- Redis: 6+ (for caching)
