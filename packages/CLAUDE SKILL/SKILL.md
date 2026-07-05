---
name: baasix
description: >-
  Guide for building with Baasix (Backend as A Source), an open-source BaaS on Express.js,
  PostgreSQL, and Drizzle ORM. Use whenever the user mentions Baasix, @baasix/baasix, or
  works in a Baasix project. Covers schemas, CRUD queries, 50+ filter operators, extensions
  (hooks, endpoints, schedules), workflows, permissions, services (ItemsService, FilesService,
  etc.), env config, migrations, CLI, file uploads, asset transforms, PostGIS, pgvector, JSONB,
  multi-tenancy, caching, real-time, and plugins. Also trigger for Baasix patterns like
  relConditions, dynamic variables ($CURRENT_USER, $NOW), schema PATCH full-replacement behavior,
  or extension folder naming. Even if the user just says "add a table" or "create an endpoint" in
  a Baasix project, use this skill.
---

# Baasix — AI Coding Assistant Guide

Baasix is an open-source Backend-as-a-Service that generates REST APIs from data models.

**Key capabilities:** Dynamic schemas via API, PostgreSQL + PostGIS + pgvector, Drizzle ORM, 50+ filter operators (including vector similarity), visual workflows (17 node types), multi-tenancy, caching, real-time, plugin system.

**Package:** `@baasix/baasix` (v0.1.0-alpha.2) — Node.js 18+, PostgreSQL 14+, Redis 6+ (for caching).

## Quick Start

```javascript
// 1. npm install @baasix/baasix
// 2. Create server.js
import { startServer } from "@baasix/baasix";
startServer().catch(console.error);

// 3. Add to package.json: "type": "module"
// 4. Create .env with DATABASE_URL and SECRET_KEY
// 5. npm run dev
```

Default port is 8056. Minimum `.env`:
```
DATABASE_URL="postgresql://postgres:password@localhost:5432/baasix"
SECRET_KEY=your-32-character-secret-key-here
```

---

## Reference Files — Read Before Acting

This skill has detailed reference files. **Read the relevant file before writing code.**

| When the task involves... | Read this reference file |
|---------------------------|--------------------------|
| Creating/modifying schemas, field types, relationships, indexes | `references/schemas.md` |
| Querying data, filters, sorting, pagination, aggregation, relConditions, geospatial | `references/queries-and-filters.md` |
| Writing hooks, endpoints, schedules, or using services (ItemsService, etc.) | `references/extensions-and-services.md` |
| Workflows, permissions, plugins, testing, CLI, env vars, templates | `references/workflows-and-config.md` |

**Always read the relevant reference before generating code.** The references contain critical details (e.g., PATCH /schemas does FULL REPLACEMENT, extension folder naming conventions, filter operator syntax) that are easy to get wrong from memory.

---

## API Routes Overview

### Authentication
| Method | Endpoint | Auth |
|--------|----------|------|
| POST | /auth/register | No |
| POST | /auth/login | No |
| GET | /auth/me | Yes |
| GET | /auth/logout | Yes |
| POST | /auth/magiclink | No |
| POST | /auth/switch-tenant | Yes |
| POST | /auth/refresh | Yes |
| POST | /auth/forgot-password | No |
| POST | /auth/reset-password | No |
| GET | /auth/signin/:provider | No |
| GET | /auth/callback/:provider | No |
| POST | /auth/2fa/enable | Yes |
| POST | /auth/2fa/verify-setup | Yes |
| POST | /auth/2fa/disable | Yes |
| POST | /auth/2fa/verify | No |
| POST | /auth/passkey/register/options | Yes |
| POST | /auth/passkey/register/verify | Yes |
| POST | /auth/passkey/authenticate/options | No |
| POST | /auth/passkey/authenticate/verify | No |
| GET | /auth/passkey | Yes |
| DELETE | /auth/passkey/:id | Yes |
| GET | / | No |

Login returns `{ token, user }`, or `{ twoFactorRequired: true, twoFactorToken, code: "TWO_FACTOR_REQUIRED" }` when the account has 2FA enabled — complete the challenge via `POST /auth/2fa/verify`. Use `Authorization: Bearer <token>` for protected routes.

- `GET /auth/signin/:provider?redirect_url=<app-url>` — 302 to the OAuth provider (browser flow); provider is one of 35 social providers. `GET /auth/callback/:provider` completes the flow, redirecting back to `redirect_url` with `?token=` on success or `?error=` on failure.
- `POST /auth/2fa/enable` → `{ secret, otpauthUrl, backupCodes[10] }` (requires the account to have a password credential); `POST /auth/2fa/verify-setup { code }` confirms setup; `POST /auth/2fa/disable { password }` turns it off; `POST /auth/2fa/verify { twoFactorToken, code }` (public, rate-limited) completes a 2FA login challenge with a TOTP code or unused backup code.
- `POST /auth/passkey/register/options` / `register/verify` register a new passkey (authed). `POST /auth/passkey/authenticate/options` / `authenticate/verify` (public, rate-limited) log in with a passkey. `GET /auth/passkey` lists the current user's passkeys (no key material); `DELETE /auth/passkey/:id` removes one of your own.

Social, magic-link, and passkey logins bypass the 2FA challenge (2FA gates password login only).

`GET /` (project info) includes an `auth` discovery block so clients can build their login UI dynamically:
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
Only providers that are both enabled (`AUTH_SERVICES_ENABLED`) and credentialed appear in `socialProviders`. `magicLink` is true only when `LOCAL` is enabled and SMTP is configured. No secrets are ever exposed.

```javascript
// Register
POST /auth/register
{ "email": "user@example.com", "password": "securepassword", "firstName": "John", "lastName": "Doe" }

// Login — returns { token, user }
POST /auth/login
{ "email": "user@example.com", "password": "securepassword" }

// Use token
Authorization: Bearer <token>
```

### Items (CRUD)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /items/:collection | List with filtering, sorting, pagination |
| GET | /items/:collection/:id | Get single item |
| POST | /items/:collection | Create item |
| PATCH | /items/:collection/:id | Update item |
| DELETE | /items/:collection/:id | Delete item |
| POST | /items/:collection/bulk | Bulk create |
| PATCH | /items/:collection/bulk | Bulk update |
| DELETE | /items/:collection/bulk | Bulk delete |

### Schemas
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /schemas | List all schemas |
| GET | /schemas/:collection | Get schema (call BEFORE PATCH) |
| POST | /schemas | Create schema |
| PATCH | /schemas/:collection | Update schema (**FULL REPLACEMENT**) |
| DELETE | /schemas/:collection | Delete schema permanently |
| POST | /schemas/:collection/relationships | Create relationship |
| PATCH | /schemas/:collection/relationships/:name | Update relationship |
| DELETE | /schemas/:collection/relationships/:name | Delete relationship |
| POST | /schemas/:collection/indexes | Create index |

> **CRITICAL:** PATCH /schemas/:collection does a **FULL REPLACEMENT**. Always GET the current schema first, merge your changes, then PATCH with ALL fields included. Sending only new fields deletes everything else.

### Files & Assets
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /files | List all files |
| GET | /files/:id | Get file metadata |
| POST | /files | Upload (multipart/form-data) |
| PATCH | /files/:id | Update file metadata |
| DELETE | /files/:id | Delete file |
| GET | /assets/:id | Get with transformations (width, height, fit, quality, format) |

### Workflows
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

### Other: /permissions, /notifications, /reports/:collection, /settings

---

## Core Patterns (Quick Reference)

### Creating a Collection

```javascript
POST /schemas
{
  "collectionName": "products",
  "schema": {
    "name": "Product",
    "timestamps": true,
    "fields": {
      "id": { "type": "UUID", "primaryKey": true, "defaultValue": {"type": "UUIDV4"} },
      "name": { "type": "String", "allowNull": false, "values": {"length": 255} },
      "price": { "type": "Decimal", "values": {"precision": 10, "scale": 2}, "defaultValue": 0.00 }
    }
  }
}
```

For full field types, relationships, and indexes → read `references/schemas.md`.

### Querying with Filters

```javascript
// Filter, sort, paginate
GET /items/products?filter={"inStock":{"eq":true},"price":{"lt":50}}&sort={"price":"asc"}&limit=20&page=1

// Include relations
GET /items/products?fields=["*","category.*"]

// Aggregation
GET /items/orders?aggregate={"revenue":{"function":"sum","field":"total"}}&groupBy=["status"]
```

For all 50+ filter operators, relConditions, geospatial, JSONB, dynamic variables → read `references/queries-and-filters.md`.

### Writing Extensions

Extensions live in the `extensions/` folder with specific naming:
- **Hooks:** `baasix-hook-{name}/index.js`
- **Endpoints:** `baasix-endpoint-{name}/index.js`
- **Schedules:** `baasix-schedule-{name}/index.js`

```javascript
// Hook example
export default (hooksService, context) => {
  hooksService.registerHook("products", "items.create", async ({ data, accountability }) => {
    data.slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return { data };
  });
};

// Endpoint example
export default {
  id: "my-api",
  handler: (app, context) => {
    app.get("/api/custom", async (req, res, next) => {
      try {
        const service = new context.ItemsService("products", { accountability: req.accountability });
        const result = await service.readByQuery({ limit: 10 });
        res.json({ data: result.data });
      } catch (error) { next(error); }
    });
  }
};
```

For all hook events, service APIs, endpoint patterns, schedules → read `references/extensions-and-services.md`.

### Using ItemsService Programmatically

```javascript
import { ItemsService } from "@baasix/baasix";

const service = new ItemsService("collection", { accountability: req.accountability });
const { data, totalCount } = await service.readByQuery({ filter, fields, sort, limit, page });
const id = await service.createOne(data);
await service.updateOne(id, data);
await service.deleteOne(id);
```

---

## Common Gotchas

1. **Schema PATCH is full replacement** — always GET first, merge, then PATCH
2. **Extension folder naming** — must be `baasix-hook-{name}`, `baasix-endpoint-{name}`, `baasix-schedule-{name}`
3. **Before hooks must return `{ data }` or `{ query }`** — forgetting the return silently drops changes
4. **Fields selection for relations** — use `["*", "relation.*"]`, not just `["*"]`
5. **Aggregate results** — all numeric functions return JavaScript numbers; results are in `data[0].fieldName`
6. **Filter JSON in query strings** — must be valid JSON, use operator syntax (`eq`, not `=`)
7. **`relConditions`** — use this to filter array relations (O2M/M2M), not regular `filter`
8. **Always include an `id` field** with UUID or AUTOINCREMENT in schemas
9. **Use JSONB over JSON** — JSONB is queryable and indexable, JSON is not

---

## Exported Modules

```javascript
// Services
import { ItemsService, FilesService, MailService, NotificationService,
  PermissionService, SettingsService, StorageService, AssetsService,
  ReportService, StatsService, WorkflowService, TasksService,
  MigrationService, HooksManager, SocketService, RealtimeService
} from "@baasix/baasix";

// App & Server
import { app, startServer } from "@baasix/baasix";

// Cache
import { getCacheService, invalidateCollection, invalidateEntireCache } from "@baasix/baasix";

// Logger, Errors, Plugins, Auth
import { getLogger, APIError, definePlugin, getAuthInstance } from "@baasix/baasix";
```

---

## Best Practices

1. Use `timestamps: true` for automatic createdAt/updatedAt
2. Use field selection — don't fetch `*` when you only need specific fields
3. Paginate large datasets with limit/page
4. Set indexes on frequently filtered fields
5. Use `req.accountability` to access the current user in endpoints
6. Use transactions — hooks receive transaction context automatically
7. Cache expensive computations using CacheService
8. Validate input in custom endpoints before processing
9. Use `bypassPermissions: true` sparingly and only in system-context operations
10. For multi-tenancy, set `MULTI_TENANT=true` — queries auto-filter by tenant
