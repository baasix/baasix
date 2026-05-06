# Extensions & Services Reference

## Table of Contents
1. [Extension Types](#extension-types)
2. [Hook Extensions](#hook-extensions)
3. [Endpoint Extensions](#endpoint-extensions)
4. [Schedule Extensions](#schedule-extensions)
5. [Services API](#services-api)
6. [Accessing Services in Extensions](#accessing-services-in-extensions)

---

## Extension Types

| Type | Folder Pattern | Purpose |
|------|----------------|---------|
| Hook | `baasix-hook-{name}/index.js` | Lifecycle hooks on data operations |
| Endpoint | `baasix-endpoint-{name}/index.js` | Custom API routes |
| Schedule | `baasix-schedule-{name}/index.js` | Cron jobs |
| Template | `baasix-templates/` | Email/custom templates (Liquid) |

All extensions live in the `extensions/` directory and use ES module exports.

---

## Hook Extensions

### Signature
```javascript
// extensions/baasix-hook-{name}/index.js
export default (hooksService, context) => {
  // context contains: db, permissionService, mailService, storageService, ItemsService, tasksService
  
  hooksService.registerHook("collection", "event", async (hookContext) => {
    // ... your logic
    return { data };  // MUST return for before hooks
  });
};
```

### Hook Events

| Event | Phase | Receives | Must Return |
|-------|-------|----------|-------------|
| items.create | Before | `{data, accountability, collection, schema, db, transaction}` | `{data}` |
| items.create.after | After | `{data, document, accountability, collection, db}` | nothing |
| items.read | Before (list) | `{query, accountability}` | `{query}` |
| items.read.after | After (list) | `{query, result, accountability}` | `{result}` |
| items.read.one | Before (single) | `{query, accountability}` | `{query}` |
| items.read.one.after | After (single) | `{query, result, accountability}` | `{result}` |
| items.update | Before | `{id, data, accountability}` | `{data}` |
| items.update.after | After | `{id, data, accountability}` | nothing |
| items.delete | Before | `{id, accountability}` | nothing (can throw) |
| items.delete.after | After | `{id, accountability}` | nothing |

### Wildcard Hooks
```javascript
// Applies to all collections
hooksService.registerHook("*", "items.create.after", async (ctx) => {
  console.log(`[${ctx.collection}] Created: ${ctx.document.id}`);
});
```

### Complete Hook Example
```javascript
export default (hooksService, context) => {
  const { ItemsService, mailService } = context;

  // BEFORE CREATE — validate & transform
  hooksService.registerHook("products", "items.create", async ({ data, accountability }) => {
    if (!data.sku) {
      const prefix = (data.name || "PRD").substring(0, 3).toUpperCase();
      data.sku = `${prefix}-${Date.now()}`;
    }
    data.sku = data.sku.toUpperCase();
    if (data.name) {
      data.slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    }
    if (accountability?.user) data.created_by = accountability.user.id;
    return { data };  // MUST RETURN
  });

  // AFTER CREATE — side effects
  hooksService.registerHook("products", "items.create.after", async ({ document, accountability }) => {
    if (document.price > 1000) {
      await mailService.sendMail({
        to: "admin@example.com",
        subject: "High-value product created",
        templateName: "high-value-product",
        context: { product: document }
      });
    }
  });

  // BEFORE READ — modify query
  hooksService.registerHook("products", "items.read", async ({ query, accountability }) => {
    if (accountability?.role?.name !== "administrator") {
      const existingFilter = query.filter ? JSON.parse(query.filter) : {};
      query.filter = JSON.stringify({
        AND: [existingFilter, { published: { eq: true } }]
      });
    }
    return { query };
  });

  // AFTER READ — transform results
  hooksService.registerHook("products", "items.read.after", async ({ result }) => {
    if (Array.isArray(result.data)) {
      result.data = result.data.map(item => ({
        ...item,
        displayPrice: `$${item.price.toFixed(2)}`
      }));
    }
    return { result };
  });

  // BEFORE DELETE — prevent or archive
  hooksService.registerHook("products", "items.delete", async ({ id, accountability }) => {
    const ordersService = new ItemsService("order_items", { accountability });
    const orders = await ordersService.readByQuery({
      filter: { product_Id: { eq: id } }, limit: 1
    });
    if (orders.totalCount > 0) {
      const productsService = new ItemsService("products", { accountability });
      await productsService.updateOne(id, { archived: true }, { bypassHooks: true });
      throw new Error("Product has orders and was archived instead of deleted");
    }
  });
};
```

---

## Endpoint Extensions

### Signature
```javascript
// extensions/baasix-endpoint-{name}/index.js
import { APIError, ItemsService } from "@baasix/baasix";

export default {
  id: "my-api",
  handler: (app, context) => {
    // app is Express app — register routes here
    
    // Protected endpoint
    app.get("/api/my-route", async (req, res, next) => {
      try {
        if (!req.accountability?.user) throw new APIError("Authentication required", 401);
        const service = new ItemsService("collection", { accountability: req.accountability });
        const result = await service.readByQuery({ limit: 10 });
        res.json({ data: result.data });
      } catch (error) { next(error); }
    });

    // Public endpoint (no auth check)
    app.post("/api/public-route", async (req, res, next) => {
      try {
        const service = new ItemsService("submissions", {});
        const id = await service.createOne(req.body);
        res.status(201).json({ data: { id } });
      } catch (error) { next(error); }
    });

    // Admin-only endpoint
    app.get("/api/admin/reports", async (req, res, next) => {
      try {
        if (!req.accountability?.user) throw new APIError("Authentication required", 401);
        if (req.accountability.role?.name !== "administrator") throw new APIError("Admin access required", 403);
        // ... admin logic
      } catch (error) { next(error); }
    });
  }
};
```

### File Upload Endpoint
```javascript
app.post("/api/products/:id/images", async (req, res, next) => {
  try {
    if (!req.accountability?.user) throw new APIError("Authentication required", 401);
    if (!req.files?.image) throw new APIError("No image provided", 400);
    
    const { FilesService } = await import("@baasix/baasix");
    const filesService = new FilesService({ accountability: req.accountability });
    const fileId = await filesService.createOne(
      { file: req.files.image },
      { title: `Product Image`, storage: "local", folder: `products/${req.params.id}` }
    );
    res.status(201).json({ data: { fileId } });
  } catch (error) { next(error); }
});
```

---

## Schedule Extensions

```javascript
// extensions/baasix-schedule-{name}/index.js
export default {
  id: "nightly-cleanup",
  schedule: "0 2 * * *",  // Cron syntax: 2 AM daily

  handler: async (context) => {
    const { ItemsService } = context;
    const logsService = new ItemsService("activity_logs", {});
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);
    
    const oldLogs = await logsService.readByQuery({
      filter: { createdAt: { lt: cutoffDate.toISOString() } },
      fields: ["id"], limit: -1
    });
    
    if (oldLogs.data.length > 0) {
      await logsService.deleteMany(oldLogs.data.map(l => l.id));
    }
  }
};
```

---

## Services API

### ItemsService
```javascript
import { ItemsService } from "@baasix/baasix";

const service = new ItemsService("collection_name", {
  accountability: req.accountability,  // User context
  tenant: tenantId                     // For multi-tenant
});

// Read
const { data, totalCount } = await service.readByQuery({
  filter: {...}, fields: [...], sort: {...},
  limit: 20, page: 1, search: "term",
  searchFields: ["field1"], relConditions: {...}
});
const item = await service.readOne(id, { fields: [...] });

// Write
const id = await service.createOne(data);
const ids = await service.createMany([data1, data2]);
await service.updateOne(id, data);
await service.updateMany([id1, id2], data);
await service.deleteOne(id);
await service.deleteMany([id1, id2]);

// Soft delete (paranoid schemas)
await service.deleteOne(id);                    // soft deletes
await service.deleteOne(id, { force: true });   // hard deletes
await service.restore(id);                       // restore

// Options
await service.createOne(data, { bypassPermissions: true, bypassHooks: true });
```

### FilesService
```javascript
import { FilesService } from "@baasix/baasix";
const filesService = new FilesService({ accountability });

const fileId = await filesService.createOne(
  { file: req.files.upload },
  { title: "Photo", storage: "local", isPublic: true }
);
const file = await filesService.readOne(fileId);
await filesService.deleteOne(fileId);
const fileId = await filesService.downloadFromUrl(url, metadata);
```

### MailService
```javascript
import { MailService } from "@baasix/baasix";
await MailService.sendMail({
  to: "user@example.com",
  subject: "Welcome!",
  templateName: "welcome",           // templates/mails/welcome.liquid
  context: { userName: "John" }
});
```

### NotificationService
```javascript
import { NotificationService } from "@baasix/baasix";
const ns = new NotificationService({ accountability });
await ns.send({
  type: "info", title: "New Comment", message: "Someone commented",
  data: { postId: "123" }, userIds: ["user-1", "user-2"]
});
await ns.markAsSeen(userId, notificationIds);
const count = await ns.getUnreadCount(userId);
```

### CacheService
```javascript
import { getCacheService, invalidateCollection, invalidateEntireCache } from "@baasix/baasix";
const cache = getCacheService();
await cache.set("key", value, ttlInSeconds);
const value = await cache.get("key");
await cache.delete("key");
await invalidateCollection("posts");
await invalidateEntireCache();
```

### StorageService
```javascript
import { StorageService } from "@baasix/baasix";
await StorageService.saveFile("local", "path/file.pdf", buffer);
const buffer = await StorageService.getFile("local", "path/file.pdf");
const url = await StorageService.getPublicUrl("s3", "path/file.pdf");
await StorageService.deleteFile("local", "path/file.pdf");
```

### ReportService
```javascript
import { ReportService } from "@baasix/baasix";
const reportService = new ReportService("orders", { accountability });
const report = await reportService.generateReport({
  fields: ["status", "category"],
  filter: { status: { eq: "completed" } },
  aggregate: { revenue: { function: "sum", field: "total" } },
  groupBy: ["status", "category"]
});
```

### StatsService
```javascript
import { StatsService } from "@baasix/baasix";
const statsService = new StatsService({ accountability });
const result = await statsService.generateStats([
  { name: "totalOrders", collection: "orders",
    query: { aggregate: { count: { function: "count", field: "id" } } } },
  { name: "totalRevenue", collection: "orders",
    query: { aggregate: { total: { function: "sum", field: "amount" } } } }
]);
// Returns: { data, totalStats, successfulStats }
```

### WorkflowService
```javascript
import { WorkflowService } from "@baasix/baasix";
const ws = new WorkflowService({ accountability });
const result = await ws.executeWorkflow(workflowId, triggerData);
```

### TasksService
```javascript
// Atomic task claiming
const claimed = await tasksService.claimTask(taskId);
if (!claimed) continue;

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

#### baasix_Tasks Table Columns

| Column | Description |
|--------|-------------|
| task_status | "Not started" / "Running" / "Completed" / "Error" |
| type | Task type string |
| scheduled_time | When to execute |
| started_at | Auto-set when task starts (used for stall detection) |
| max_retries | Max retry attempts (default: 0) |
| retry_count | Current retry count (system-managed) |
| task_data | JSON task payload |
| result_data | JSON result |
| error_data | JSON error info |

#### Stall Recovery

Automatic — runs during init and each cache refresh:
- Tasks "Running" beyond `TASK_STALL_TIMEOUT` are detected
- If `retry_count < max_retries`: reset to "Not started" for retry
- Otherwise: marked as "Error"

#### TasksService Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| TASK_SERVICE_ENABLED | false | Enable task service |
| TASK_CONCURRENCY | 1 | Max concurrent tasks per instance |
| TASK_STALL_TIMEOUT | 300 | Seconds before Running task is stalled |
| TASK_LIST_REFRESH_INTERVAL | 600 | Cache refresh interval (seconds) |
| TASK_SHUTDOWN_WAIT_TIME | 30 | Wait for running tasks on shutdown |
| TASK_REDIS_ENABLED | false | Enable Redis for distributed locking |
| TASK_REDIS_URL | - | Redis URL for distributed locking |

---

## Accessing Services in Extensions

Hook context provides: `db`, `permissionService`, `mailService`, `storageService`, `ItemsService`, `tasksService`.

For all other services, import them directly:
```javascript
import {
  ReportService, StatsService, FilesService,
  getCacheService, invalidateCollection, WorkflowService, NotificationService
} from "@baasix/baasix";
```
