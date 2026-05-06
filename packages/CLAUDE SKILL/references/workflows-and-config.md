# Workflows, Permissions & Configuration Reference

## Table of Contents
1. [Workflow System](#workflow-system)
2. [Permissions](#permissions)
3. [Plugin System](#plugin-system)
4. [Testing](#testing)
5. [CLI](#cli)
6. [Environment Variables](#environment-variables)
7. [Error Handling](#error-handling)
8. [Common Patterns](#common-patterns)
9. [Asset Transformations](#asset-transformations)
10. [Email Templates](#email-templates)

---

## Workflow System

### Trigger Types
| Type | Description |
|------|-------------|
| manual | Execute via `POST /workflows/:id/execute` |
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

### Structure
```javascript
POST /permissions
{
  "role_Id": "user-role-uuid",
  "collection": "products",
  "action": "read",              // read, create, update, delete
  "fields": ["*"],               // or specific fields
  "conditions": {                // Row-level filtering
    "published": {"eq": true}
  },
  "relConditions": {             // Filter array relations (O2M/M2M) in results
    "reviews": {"approved": {"eq": true}}
  }
}
```

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
  "fields": ["id", "name", "price", "description"],
  "conditions": {"published": {"eq": true}}
}

// Users can only edit their own posts
{
  "role_Id": "user-role-uuid",
  "collection": "posts",
  "action": "update",
  "fields": ["title", "content"],
  "conditions": {"author_Id": {"eq": "$CURRENT_USER"}}
}

// Admin full access
{
  "role_Id": "admin-role-uuid",
  "collection": "*",
  "action": "read",
  "fields": ["*"]
}

// Nested/relational field access in permissions
// Use dot notation to grant access to related fields
{
  "role_Id": "user-role-uuid",
  "collection": "orders",
  "action": "read",
  "fields": ["id", "status", "total", "items.*", "items.product.name", "items.product.price"],
  "conditions": {"customer_Id": {"eq": "$CURRENT_USER"}}
}

// Conditions with relational fields (filter by related data)
{
  "role_Id": "manager-role-uuid",
  "collection": "orders",
  "action": "read",
  "fields": ["*"],
  "conditions": {"customer.department": {"eq": "$CURRENT_USER.department"}}
}

// Tenant-scoped permissions
{
  "role_Id": "user-role-uuid",
  "collection": "products",
  "action": "read",
  "fields": ["*"],
  "conditions": {"tenant_Id": {"eq": "$CURRENT_TENANT"}}
}

// relConditions in permissions — filter which related items users can see
// Users reading orders only see their own order items that are not cancelled
{
  "role_Id": "user-role-uuid",
  "collection": "orders",
  "action": "read",
  "fields": ["*", "items.*", "items.product.*"],
  "conditions": {"customer_Id": {"eq": "$CURRENT_USER"}},
  "relConditions": {
    "items": {"status": {"ne": "cancelled"}}
  }
}

// Public users see products but only approved, visible reviews
{
  "role_Id": "public-role-uuid",
  "collection": "products",
  "action": "read",
  "fields": ["id", "name", "price", "reviews.*"],
  "conditions": {"published": {"eq": true}},
  "relConditions": {
    "reviews": {"approved": {"eq": true}, "visible": {"eq": true}}
  }
}
```

### Permission Fields — Nested Access
- Use `["*"]` for all direct fields on the collection
- Use `["*", "relation.*"]` to also grant access to a relation's fields
- Use `["id", "name", "relation.specificField"]` for fine-grained control
- Dot notation works at any depth: `"relation.subRelation.field"`
- If a relation field is not included in the permission's `fields`, that relation will be excluded from query results even if requested via `?fields=`

### Permission Conditions
- `conditions` use the same filter operator syntax as queries (`eq`, `ne`, `gt`, etc.)
- Dynamic variables work in conditions: `$CURRENT_USER`, `$CURRENT_ROLE`, `$CURRENT_TENANT`
- Relational field paths work: `{"author.department": {"eq": "$CURRENT_USER.department"}}`

### Permission relConditions
- `relConditions` in permissions works the same way as in queries — it filters which related items appear in array relations (O2M/M2M)
- This is enforced at the permission level, so users cannot bypass it by omitting `relConditions` in their query
- `conditions` controls which **parent records** the role can access; `relConditions` controls which **child/related items** appear within those records
- Uses the same filter operator syntax: `{"relation": {"field": {"operator": value}}}`
- Nested relConditions are supported: `{"items": {"product": {"inStock": {"eq": true}}}}`

---

## Plugin System

```javascript
import { definePlugin, createPluginMeta } from "@baasix/baasix";

const myPlugin = definePlugin({
  meta: createPluginMeta({
    name: "my-plugin",
    version: "1.0.0",
    description: "My custom plugin"
  }),

  hooks: (hooksService, context) => {
    hooksService.registerHook("*", "items.create", async ({ data }) => {
      // Plugin-wide hook logic
      return { data };
    });
  },

  endpoints: (app, context) => {
    app.get("/api/plugin/status", (req, res) => {
      res.json({ status: "active" });
    });
  },

  schedules: [
    {
      id: "plugin-cleanup",
      schedule: "0 3 * * *",
      handler: async (context) => { /* ... */ }
    }
  ]
});

export default myPlugin;
```

---

## Testing

```javascript
import request from "supertest";
import { app, startServerForTesting, destroyAllTablesInDB } from "@baasix/baasix";

describe("Products API", () => {
  let adminToken, userToken, productId;

  beforeAll(async () => {
    const adminRes = await request(app)
      .post("/auth/login")
      .send({ email: "admin@test.com", password: "admin123" });
    adminToken = adminRes.body.token;
  });

  test("Create product", async () => {
    const res = await request(app)
      .post("/items/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Test", price: 29.99, sku: "TEST-001" });
    expect(res.status).toBe(201);
    productId = res.body.data.id;
  });

  test("Filter products", async () => {
    const res = await request(app)
      .get("/items/products")
      .query({ filter: JSON.stringify({ inStock: { eq: true } }) })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
```

---

## CLI

### Installation
```bash
npm install -g baasix   # or: npx baasix <command>
```

### Configuration (.env)
```
BAASIX_URL=http://localhost:8056
BAASIX_EMAIL=admin@example.com
BAASIX_PASSWORD=your-password
# Or: BAASIX_TOKEN=your-jwt-token
```

### Commands
| Command | Description |
|---------|-------------|
| `baasix init [name]` | Initialize project (`-t api/nextjs`) |
| `baasix generate` | Generate TypeScript types (`-t types/sdk-types/schema-json`) |
| `baasix extension [name]` | Scaffold extension (`-t endpoint/hook`) |
| `baasix migrate [action]` | Migrations: status, list, run, create, rollback, reset |

```bash
baasix init my-api -t api
baasix generate -t types -o types/baasix.d.ts
baasix extension audit-log -t hook
baasix migrate create -n add_products_table
baasix migrate run
baasix migrate rollback --steps 1
```

### Migration File Structure
```javascript
// migrations/20240115120000_create_products_table.js
export async function up(baasix) {
  await baasix.schema.create("products", {
    name: "Products", timestamps: true,
    fields: {
      id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
      name: { type: "String", allowNull: false, values: { length: 255 } }
    }
  });
}
export async function down(baasix) {
  await baasix.schema.delete("products");
}
```

### Generated Types Usage
```typescript
import type { Products, Users } from "./types/baasix";
import { createBaasix } from "@baasix/sdk";
const baasix = createBaasix({ url: "http://localhost:8056" });
const products = await baasix.items<Products>("products").list();
```

---

## Environment Variables

### Required
| Variable | Description |
|----------|-------------|
| DATABASE_URL | PostgreSQL connection string |
| SECRET_KEY | JWT/encryption secret (32+ chars) |

### Server
| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 8056 | HTTP port |
| BODY_SIZE_LIMIT | 20mb | Max request body |
| LOG_LEVEL | info | fatal/error/warn/info/debug/trace |
| MULTI_TENANT | false | Multi-tenancy |
| SOCKET_ENABLED | false | Socket.IO |
| PUBLIC_REGISTRATION | true | Allow public registration |
| RATE_LIMIT | 100 | Requests per interval |
| RATE_LIMIT_INTERVAL | 5000 | Rate limit interval (ms) |

### System Cache
| Variable | Default | Description |
|----------|---------|-------------|
| SYSTEM_CACHE_ADAPTER | memory | memory/redis/upstash |
| SYSTEM_CACHE_REDIS_URL | - | Redis URL |
| SYSTEM_CACHE_SYNC_INTERVAL | 5 | L1↔L2 sync (seconds) |
| SYSTEM_CACHE_SIZE_GB | 1 | Max size (memory adapter) |
| SYSTEM_CACHE_TTL | 30 | Default TTL (seconds) |

### Data Cache
| Variable | Default | Description |
|----------|---------|-------------|
| DATA_CACHE_ENABLED | false | Enable query caching |
| DATA_CACHE_ADAPTER | memory | memory/redis/upstash |
| DATA_CACHE_REDIS_URL | - | Redis URL |
| DATA_CACHE_TTL | 3600 | TTL (seconds) |
| DATA_CACHE_STRATEGY | explicit | explicit/all |
| DATA_CACHE_SIZE_GB | 1 | Max size (memory adapter) |

### Storage
| Variable | Default | Description |
|----------|---------|-------------|
| STORAGE_SERVICES_ENABLED | LOCAL | Comma-separated: LOCAL,S3 |
| STORAGE_DEFAULT_SERVICE | LOCAL | Default storage |
| LOCAL_STORAGE_PATH | ./uploads | Local path |
| S3_STORAGE_BUCKET | - | S3 bucket |
| S3_STORAGE_REGION | - | S3 region |
| S3_STORAGE_ACCESS_KEY_ID | - | S3 key |
| S3_STORAGE_SECRET_ACCESS_KEY | - | S3 secret |
| S3_STORAGE_ENDPOINT | - | S3 endpoint (for DO Spaces, etc.) |

### Mail
| Variable | Default | Description |
|----------|---------|-------------|
| MAIL_HOST | - | SMTP host |
| MAIL_PORT | 587 | SMTP port |
| MAIL_USER | - | SMTP user |
| MAIL_PASSWORD | - | SMTP password |
| MAIL_FROM | - | Default sender |

### Cleanup
| Variable | Default | Description |
|----------|---------|-------------|
| AUDIT_LOG_CLEANUP_ENABLED | false | Auto-cleanup audit logs |
| AUDIT_LOG_RETENTION_DAYS | 90 | Retention period |
| EMAIL_LOG_CLEANUP_ENABLED | false | Auto-cleanup email logs |
| EMAIL_LOG_RETENTION_DAYS | 30 | Retention period |

---

## Error Handling

```javascript
import { APIError } from "@baasix/baasix";

// In endpoints/hooks
throw new APIError("Resource not found", 404);
throw new APIError("Invalid request data", 400);
throw new APIError("Authentication required", 401);
throw new APIError("Permission denied", 403);
throw new APIError("Resource already exists", 409);
throw new APIError("Rate limit exceeded", 429);

// Error response format
// { "error": { "message": "...", "code": "ERROR_CODE" } }
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

---

## Common Patterns

### Soft Delete with Paranoid
```javascript
// Schema: set "paranoid": true (adds deletedAt)
// Queries exclude deleted by default
// Include deleted: GET /items/products?paranoid=false
// Restore: await service.restore(id);
```

### Multi-Tenant Isolation
```javascript
// MULTI_TENANT=true in .env
// All queries auto-filter by tenant
// Use $CURRENT_TENANT in permissions/filters
```

### Geospatial Queries
```javascript
// Find within radius
GET /items/stores?filter={"location":{"dwithin":{"geometry":{"type":"Point","coordinates":[-73.9857,40.7484]},"distance":10000}}}

// Sort by distance
GET /items/stores?sort={"_distance":{"target":[-73.9857,40.7484],"column":"location","direction":"ASC"}}
```

### Nested Relations with Filtering
```javascript
// Combine filter (on parent) + relConditions (on children) + deep field selection
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

## Asset Transformations

`GET /assets/:id` with query parameters:

| Parameter | Description | Values |
|-----------|-------------|--------|
| width | Target width | number |
| height | Target height | number |
| fit | Resize mode | cover, contain, fill, inside, outside |
| quality | Output quality | 1-100 |
| format | Output format (default: jpeg) | jpeg, png, webp, avif |
| withoutEnlargement | Prevent upscaling | true |

```
GET /assets/file-uuid?width=200&height=200&fit=cover&quality=80&format=webp
```

Note: Default format is JPEG which flattens transparency to white. Use `format=webp` or `format=png` to preserve transparency.

---

## Email Templates

Templates use Liquid syntax and live in `templates/mails/`:
```
templates/mails/welcome.liquid
templates/mails/reset-password.liquid
```

Send via MailService:
```javascript
await MailService.sendMail({
  to: "user@example.com",
  subject: "Welcome!",
  templateName: "welcome",
  context: { userName: "John", link: "https://..." }
});
```

---

## Troubleshooting

### 401 Unauthorized
- Check `Authorization: Bearer <token>` header is present
- Verify token hasn't expired (re-login to get a fresh one)
- Ensure user exists and is active

### 403 Forbidden
- Check permissions exist for role/collection/action combination
- Verify permission `conditions` match the record being accessed
- Confirm `fields` in permission include the fields being requested

### Filters Not Working
- Ensure filter value is valid JSON in the query string
- Use operator syntax (`eq`, `gt`, etc.) — not `=` or `>`
- Check for typos in field names (case-sensitive)
- Wrap query string values in `JSON.stringify()` when building URLs

### Relations Not Loading
- Include relation in fields: `["*", "relation.*"]` — `["*"]` alone does not load relations
- Verify the relationship exists in the schema
- Check permissions for the related collection

### Extension Not Loading
- Verify folder name: `baasix-hook-{name}`, `baasix-endpoint-{name}`, `baasix-schedule-{name}`
- Check for syntax errors in `index.js`
- Ensure ES module syntax (`export default`) and `"type": "module"` in package.json

### Cache Issues
- Verify Redis connection if using Redis adapter
- Check `SYSTEM_CACHE_REDIS_URL` / `DATA_CACHE_REDIS_URL` in `.env`
- Manually invalidate: `invalidateCollection("collection")` or `invalidateEntireCache()`
