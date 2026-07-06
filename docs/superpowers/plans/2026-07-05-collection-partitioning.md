# Collection Partitioning (Tenant / Time) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-collection Postgres declarative partitioning (`tenant` LIST, `time` RANGE, `tenant+time` composite) configured via a `partitioning` key in the collection schema JSON, with tenant-lifecycle partition management, startup reconciliation, and inline copy-and-swap conversion of populated tables.

**Architecture:** All DDL stays inside `SchemaManager` (raw SQL via `sql.unsafe`, matching existing style). A new pure-function module `partitionUtils.ts` owns config normalization/validation, partition naming, and period math. Tenant lifecycle is intercepted with `HooksManager` hooks on `baasix_Tenant`. The query layer (`ItemsService`, Drizzle objects, caches) is untouched.

**Tech Stack:** TypeScript (strict: false), postgres (porsager) client, Drizzle (models only), Jest + ts-jest ESM + supertest, PostgreSQL ≥ 12.

**Spec:** `docs/superpowers/specs/2026-07-05-collection-partitioning-design.md`

## Global Constraints

- Working directory for all commands: `packages/core`. Run a single test file with: `NODE_OPTIONS='--experimental-vm-modules' npx jest test/<file> --runInBand` (tests hit a real Postgres at `DATABASE_URL` from `.env.test`).
- The collection setting is **top-level** `schema.partitioning` (same level as `tenantScoped`), NOT `options.partitioning`: `{ "strategy": "tenant"|"time"|"tenant+time", "timeField"?: string (default "createdAt"), "interval"?: "month"|"quarter"|"year" (default "year"), "premake"?: number (default 1) }`.
- Partition naming: default partition `<table>__default`; tenant partition `<table>__t_<first 8 hex of tenant uuid>`; time partition `<table>__y2026` / `<table>__2026q3` / `<table>__202607`; composite `<table>__t_<hex8>__y2026`. All identifiers go through a 63-char truncate-with-hash guard.
- Composite PK per strategy: `(id, tenant_Id)` / `(id, <timeField>)` / `(id, tenant_Id, <timeField>)`. Partition-key columns are forced NOT NULL. Unique indexes get missing partition-key columns appended.
- `tenant`/`tenant+time` require `MULTI_TENANT=true` and are forbidden on `baasix_` collections and `tenantScoped: false` collections. PG floor: 12 (via existing `isPgVersionAtLeast`; every partitioning feature used is PG12+).
- Tenant delete drops that tenant's partitions (before the row delete). No automated time-partition retention — old partitions are kept until manually dropped.
- DDL identifier interpolation uses `sql.unsafe` with double-quoted identifiers (existing convention). Tenant UUIDs MUST be regex-validated before interpolation into DDL.
- Errors: validation throws `APIError` (from `baasix/utils/errorHandler.ts`); background/DDL-sync failures are logged with `console.warn/error` and do not crash startup (existing convention).
- Commit after every task. All existing tests must keep passing (`npm test -- test/multitenant.test.js` is the canary for tenant behavior).

---

### Task 1: Types + `partitionUtils.ts` (pure helpers)

**Files:**
- Modify: `packages/types/src/schema.ts` (SchemaDefinition, ~line 205)
- Create: `packages/core/baasix/utils/partitionUtils.ts`
- Test: `packages/core/test/partitionUtils.test.js`

**Interfaces:**
- Consumes: `APIError` from `../utils/errorHandler.js`.
- Produces (used by Tasks 2–7):
  - `interface PartitioningConfig { strategy: 'tenant'|'time'|'tenant+time'; timeField: string; interval: 'month'|'quarter'|'year'; premake: number }`
  - `normalizePartitioning(raw: any): PartitioningConfig | null` (null when absent; applies defaults; throws APIError(400) on bad values)
  - `validatePartitioning(collectionName: string, schema: any, ctx: { isMultiTenant: boolean; pgOk: boolean }): PartitioningConfig | null`
  - `getPartitionKeyColumns(config: PartitioningConfig): string[]`
  - `partitionName(base: string, parts: string[]): string` (joins with `__`, 63-char truncate+hash guard)
  - `tenantPartitionName(table: string, tenantId: string): string` (validates UUID, throws APIError otherwise)
  - `periodsToEnsure(now: Date, interval: string, premake: number): Array<{ suffix: string; start: string; end: string }>` (UTC bounds as `YYYY-MM-DD 00:00:00+00` strings)

- [ ] **Step 1: Write the failing unit test**

`packages/core/test/partitionUtils.test.js`:

```js
import { describe, test, expect } from "@jest/globals";
import {
  normalizePartitioning, validatePartitioning, getPartitionKeyColumns,
  partitionName, tenantPartitionName, periodsToEnsure,
} from "../baasix/utils/partitionUtils.js";

describe("partitionUtils", () => {
  test("normalize applies defaults", () => {
    expect(normalizePartitioning({ strategy: "time" })).toEqual({
      strategy: "time", timeField: "createdAt", interval: "year", premake: 1,
    });
    expect(normalizePartitioning(undefined)).toBeNull();
    expect(normalizePartitioning(null)).toBeNull();
  });

  test("normalize rejects bad values", () => {
    expect(() => normalizePartitioning({ strategy: "hash" })).toThrow(/strategy/i);
    expect(() => normalizePartitioning({ strategy: "time", interval: "week" })).toThrow(/interval/i);
    expect(() => normalizePartitioning({ strategy: "time", premake: 99 })).toThrow(/premake/i);
  });

  test("partition key columns per strategy", () => {
    expect(getPartitionKeyColumns(normalizePartitioning({ strategy: "tenant" }))).toEqual(["tenant_Id"]);
    expect(getPartitionKeyColumns(normalizePartitioning({ strategy: "time" }))).toEqual(["createdAt"]);
    expect(getPartitionKeyColumns(normalizePartitioning({ strategy: "tenant+time", timeField: "loggedAt" })))
      .toEqual(["tenant_Id", "loggedAt"]);
  });

  test("tenant partition name uses first 8 hex of uuid", () => {
    expect(tenantPartitionName("orders", "a1b2c3d4-e5f6-4a7b-8c9d-000011112222")).toBe("orders__t_a1b2c3d4");
    expect(() => tenantPartitionName("orders", "not-a-uuid; DROP TABLE x")).toThrow(/tenant id/i);
  });

  test("partitionName truncates >63 chars deterministically", () => {
    const long = "x".repeat(70);
    const name = partitionName(long, ["default"]);
    expect(name.length).toBeLessThanOrEqual(63);
    expect(name).toBe(partitionName(long, ["default"])); // deterministic
  });

  test("year periods with premake", () => {
    const periods = periodsToEnsure(new Date("2026-07-05T10:00:00Z"), "year", 1);
    expect(periods).toEqual([
      { suffix: "y2026", start: "2026-01-01 00:00:00+00", end: "2027-01-01 00:00:00+00" },
      { suffix: "y2027", start: "2027-01-01 00:00:00+00", end: "2028-01-01 00:00:00+00" },
    ]);
  });

  test("quarter and month periods", () => {
    expect(periodsToEnsure(new Date("2026-07-05T00:00:00Z"), "quarter", 0)).toEqual([
      { suffix: "2026q3", start: "2026-07-01 00:00:00+00", end: "2026-10-01 00:00:00+00" },
    ]);
    expect(periodsToEnsure(new Date("2026-12-15T00:00:00Z"), "month", 1)).toEqual([
      { suffix: "202612", start: "2026-12-01 00:00:00+00", end: "2027-01-01 00:00:00+00" },
      { suffix: "202701", start: "2027-01-01 00:00:00+00", end: "2027-02-01 00:00:00+00" },
    ]);
  });

  test("validatePartitioning gates env/system/timeField", () => {
    const base = { fields: { id: { type: "UUID", primaryKey: true } }, timestamps: true };
    const ctx = { isMultiTenant: true, pgOk: true };
    expect(validatePartitioning("orders", { ...base, partitioning: { strategy: "tenant" } }, ctx))
      .toMatchObject({ strategy: "tenant" });
    expect(() => validatePartitioning("orders", { ...base, partitioning: { strategy: "tenant" } },
      { isMultiTenant: false, pgOk: true })).toThrow(/MULTI_TENANT/);
    expect(() => validatePartitioning("baasix_File", { ...base, partitioning: { strategy: "tenant" } }, ctx))
      .toThrow(/system/i);
    expect(() => validatePartitioning("orders",
      { ...base, tenantScoped: false, partitioning: { strategy: "tenant" } }, ctx)).toThrow(/tenantScoped/);
    expect(() => validatePartitioning("orders",
      { ...base, timestamps: false, partitioning: { strategy: "time" } }, ctx)).toThrow(/timeField/i);
    expect(() => validatePartitioning("orders", { ...base, partitioning: { strategy: "time" } },
      { isMultiTenant: false, pgOk: false })).toThrow(/PostgreSQL 12/);
    expect(validatePartitioning("orders", base, ctx)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS='--experimental-vm-modules' npx jest test/partitionUtils.test.js --runInBand`
Expected: FAIL — cannot find module `../baasix/utils/partitionUtils.js`.

- [ ] **Step 3: Add the type to `packages/types/src/schema.ts`**

Immediately before `export interface SchemaDefinition` (~line 205) add:

```ts
export interface PartitioningOptions {
  /** Partitioning strategy: LIST by tenant, RANGE by time, or composite */
  strategy: "tenant" | "time" | "tenant+time";
  /** DateTime field used for RANGE partitioning (default "createdAt") */
  timeField?: string;
  /** Time partition width (default "year") */
  interval?: "month" | "quarter" | "year";
  /** Future periods to pre-create (default 1) */
  premake?: number;
}
```

and inside `SchemaDefinition` after `tenantScoped?: boolean;` add:

```ts
  partitioning?: PartitioningOptions;
```

- [ ] **Step 4: Write `packages/core/baasix/utils/partitionUtils.ts`**

```ts
import crypto from "crypto";
import { APIError } from "./errorHandler.js";

export interface PartitioningConfig {
  strategy: "tenant" | "time" | "tenant+time";
  timeField: string;
  interval: "month" | "quarter" | "year";
  premake: number;
}

const STRATEGIES = ["tenant", "time", "tenant+time"];
const INTERVALS = ["month", "quarter", "year"];
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const PG_MAX_IDENTIFIER = 63;

export function normalizePartitioning(raw: any): PartitioningConfig | null {
  if (raw === undefined || raw === null || raw === false) return null;
  if (typeof raw !== "object" || !raw.strategy) {
    throw new APIError("Invalid partitioning config", 400, "partitioning must be an object with a strategy");
  }
  if (!STRATEGIES.includes(raw.strategy)) {
    throw new APIError("Invalid partitioning strategy", 400,
      `strategy must be one of ${STRATEGIES.join(", ")}; got "${raw.strategy}"`);
  }
  const interval = raw.interval ?? "year";
  if (!INTERVALS.includes(interval)) {
    throw new APIError("Invalid partitioning interval", 400,
      `interval must be one of ${INTERVALS.join(", ")}; got "${raw.interval}"`);
  }
  const premake = raw.premake ?? 1;
  if (!Number.isInteger(premake) || premake < 0 || premake > 12) {
    throw new APIError("Invalid partitioning premake", 400, "premake must be an integer between 0 and 12");
  }
  return { strategy: raw.strategy, timeField: raw.timeField ?? "createdAt", interval, premake };
}

export function validatePartitioning(
  collectionName: string,
  schema: any,
  ctx: { isMultiTenant: boolean; pgOk: boolean }
): PartitioningConfig | null {
  const config = normalizePartitioning(schema?.partitioning);
  if (!config) return null;
  if (!ctx.pgOk) {
    throw new APIError("Partitioning unavailable", 400, "Partitioning requires PostgreSQL 12 or newer");
  }
  if (collectionName.startsWith("baasix_")) {
    throw new APIError("Partitioning not supported", 400, "Partitioning is not supported on system collections");
  }
  if (config.strategy === "tenant" || config.strategy === "tenant+time") {
    if (!ctx.isMultiTenant) {
      throw new APIError("Partitioning unavailable", 400,
        `Strategy "${config.strategy}" requires MULTI_TENANT=true`);
    }
    if (schema?.tenantScoped === false) {
      throw new APIError("Partitioning unavailable", 400,
        `Strategy "${config.strategy}" cannot be used with tenantScoped: false`);
    }
  }
  if (config.strategy === "time" || config.strategy === "tenant+time") {
    const field = schema?.fields?.[config.timeField];
    const isDefaultTimestamp = config.timeField === "createdAt" && schema?.timestamps !== false;
    const fieldOk = field && (field.type === "DateTime" || field.type === "DateTime_NO_TZ") &&
      (field.allowNull === false || field.defaultValue?.type === "NOW");
    if (!isDefaultTimestamp && !fieldOk) {
      throw new APIError("Invalid partitioning timeField", 400,
        `timeField "${config.timeField}" must be a DateTime field that is NOT NULL or has a NOW default`);
    }
  }
  return config;
}

export function getPartitionKeyColumns(config: PartitioningConfig): string[] {
  if (config.strategy === "tenant") return ["tenant_Id"];
  if (config.strategy === "time") return [config.timeField];
  return ["tenant_Id", config.timeField];
}

export function partitionName(base: string, parts: string[]): string {
  const full = [base, ...parts].join("__");
  if (full.length <= PG_MAX_IDENTIFIER) return full;
  const hash = crypto.createHash("sha1").update(full).digest("hex").slice(0, 8);
  return `${full.slice(0, PG_MAX_IDENTIFIER - 10)}_h${hash}`;
}

export function tenantPartitionName(table: string, tenantId: string): string {
  if (!UUID_RE.test(tenantId)) {
    throw new APIError("Invalid tenant id", 400, `"${tenantId}" is not a valid tenant id (UUID expected)`);
  }
  return partitionName(table, [`t_${tenantId.replace(/-/g, "").slice(0, 8).toLowerCase()}`]);
}

function boundsFor(interval: string, year: number, monthIdx: number): { suffix: string; start: Date; end: Date } {
  if (interval === "year") {
    return { suffix: `y${year}`, start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year + 1, 0, 1)) };
  }
  if (interval === "quarter") {
    const q = Math.floor(monthIdx / 3);
    return {
      suffix: `${year}q${q + 1}`,
      start: new Date(Date.UTC(year, q * 3, 1)),
      end: new Date(Date.UTC(year, q * 3 + 3, 1)),
    };
  }
  return {
    suffix: `${year}${String(monthIdx + 1).padStart(2, "0")}`,
    start: new Date(Date.UTC(year, monthIdx, 1)),
    end: new Date(Date.UTC(year, monthIdx + 1, 1)),
  };
}

function fmt(d: Date): string {
  return `${d.toISOString().slice(0, 10)} 00:00:00+00`;
}

export function periodsToEnsure(
  now: Date, interval: "month" | "quarter" | "year", premake: number
): Array<{ suffix: string; start: string; end: string }> {
  const out: Array<{ suffix: string; start: string; end: string }> = [];
  let cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let i = 0; i <= premake; i++) {
    const b = boundsFor(interval, cursor.getUTCFullYear(), cursor.getUTCMonth());
    out.push({ suffix: b.suffix, start: fmt(b.start), end: fmt(b.end) });
    cursor = b.end; // next period starts where this one ends
  }
  return out;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `NODE_OPTIONS='--experimental-vm-modules' npx jest test/partitionUtils.test.js --runInBand`
Expected: PASS (all 8 tests). If the import of `partitionUtils.js` fails to resolve, check `jest.config.js` `moduleNameMapper` — other core code imports sibling modules with the `.js` suffix, so ts-jest ESM resolution should already map it.

- [ ] **Step 6: Commit**

```bash
git add packages/types/src/schema.ts packages/core/baasix/utils/partitionUtils.ts packages/core/test/partitionUtils.test.js
git commit -m "feat(core): partitioning config types and pure helpers"
```

---

### Task 2: Validation wiring in `updateModel` + APIError passthrough in schema routes

**Files:**
- Modify: `packages/core/baasix/utils/schemaManager.ts` (imports ~line 4-9; `updateModel` ~line 2113)
- Modify: `packages/core/baasix/routes/schema.route.ts` (POST catch ~line 400; PATCH catch ~line 450)
- Test: `packages/core/test/partitioning.test.js` (new file, first describe block)

**Interfaces:**
- Consumes: `validatePartitioning`, `normalizePartitioning` (Task 1); existing `isPgVersionAtLeast` (already imported in schemaManager at line 4).
- Produces: `updateModel` throws `APIError(400)` for invalid partitioning configs before persisting anything. Schema routes return the APIError status instead of always 500.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/partitioning.test.js`:

```js
import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, test, expect, describe } from "@jest/globals";

let app;
let adminToken;

const authed = (req) => req.set("Authorization", `Bearer ${adminToken}`);

beforeAll(async () => {
  await destroyAllTablesInDB();
  app = await startServerForTesting({ envOverrides: { MULTI_TENANT: "true" } });
  const login = await request(app).post("/auth/login")
    .send({ email: "admin@baasix.com", password: "admin@123" });
  adminToken = login.body.data.token ?? login.body.token;
});

describe("partitioning validation", () => {
  test("rejects tenant strategy on system collections", async () => {
    const res = await authed(request(app).patch("/schemas/baasix_File"))
      .send({ schema: { name: "File", fields: {}, partitioning: { strategy: "tenant" } } });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/system/i);
  });

  test("rejects unknown strategy", async () => {
    const res = await authed(request(app).post("/schemas")).send({
      collectionName: "bad_part",
      schema: {
        name: "BadPart",
        fields: { id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } } },
        partitioning: { strategy: "hash" },
      },
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/strategy/i);
  });

  test("rejects bad timeField", async () => {
    const res = await authed(request(app).post("/schemas")).send({
      collectionName: "bad_time_part",
      schema: {
        name: "BadTimePart",
        timestamps: false,
        fields: { id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } } },
        partitioning: { strategy: "time" },
      },
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/timeField/i);
  });
});
```

Note: the exact login response shape — copy the token extraction from `test/multitenant.test.js` (~lines 40-53) if `login.body.data.token` is wrong.

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS='--experimental-vm-modules' npx jest test/partitioning.test.js --runInBand`
Expected: FAIL — statuses are 500 (route wraps everything) and/or the invalid schemas are accepted (200).

- [ ] **Step 3: Wire validation into `updateModel`**

In `schemaManager.ts` add to the imports:

```ts
import { validatePartitioning, normalizePartitioning, getPartitionKeyColumns, partitionName, tenantPartitionName, periodsToEnsure, PartitioningConfig } from './partitionUtils.js';
import { APIError } from './errorHandler.js';
```

In `updateModel` (line ~2113), right after `const isMultiTenant = envValue === 'true';`, add:

```ts
    // Validate partitioning config before persisting anything (throws APIError on bad config)
    const partitionConfig = validatePartitioning(collectionName, schema, {
      isMultiTenant,
      pgOk: await isPgVersionAtLeast(12),
    });
    if (partitionConfig) {
      appendPartitionKeysToUniqueIndexes(schema, getPartitionKeyColumns(partitionConfig));
    }
```

Add the helper at module level (near the bottom, before the module-level re-exports at ~line 2744):

```ts
/** Unique constraints on a partitioned table must contain all partition key columns. */
function appendPartitionKeysToUniqueIndexes(schema: any, keys: string[]): void {
  for (const holder of [schema, schema.options]) {
    if (!holder?.indexes || !Array.isArray(holder.indexes)) continue;
    holder.indexes = holder.indexes.map((index: any) => {
      if (!index.unique) return index;
      const missing = keys.filter((k) => !index.fields.includes(k));
      return missing.length ? { ...index, fields: [...index.fields, ...missing] } : index;
    });
  }
}
```

- [ ] **Step 4: Pass APIError through in schema routes**

In `schema.route.ts`, POST `/schemas` catch block (~line 400) and PATCH `/schemas/:collectionName` catch block (~line 450), change:

```ts
        } catch (error) {
            console.error("Error creating schema:", error);
            if (error instanceof APIError) return next(error);
            next(new APIError("Error creating schema", 500, error.message));
        }
```

(`APIError` is already imported in this file; keep the existing message string in the PATCH handler: "Error updating schema".)

- [ ] **Step 5: Run test to verify it passes**

Run: `NODE_OPTIONS='--experimental-vm-modules' npx jest test/partitioning.test.js --runInBand`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/baasix/utils/schemaManager.ts packages/core/baasix/routes/schema.route.ts packages/core/test/partitioning.test.js
git commit -m "feat(core): validate partitioning config in updateModel, pass APIError through schema routes"
```

---

### Task 3: Partitioned CREATE TABLE + `ensurePartitions` (tenant, time, tenant+time)

**Files:**
- Modify: `packages/core/baasix/utils/schemaManager.ts` — refactor `createTableFromSchema` (line 837) to use a new `buildCreateTableSQL`; add `ensurePartitions`, `ensureTenantPartition`, `isTablePartitioned`.
- Test: `packages/core/test/partitioning.test.js` (append describe block)

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces (used by Tasks 4–7):
  - `private buildCreateTableSQL(tableName: string, schema: any): string` — full CREATE TABLE statement, partition-aware via `schema.partitioning`.
  - `async ensurePartitions(collectionName: string, schema: any, opts?: { tableName?: string; sqlClient?: any }): Promise<void>` — idempotent (`CREATE TABLE IF NOT EXISTS`), creates default + tenant + time partitions.
  - `private async ensureTenantPartition(parentTable: string, config: PartitioningConfig, tenantId: string, sqlClient?: any): Promise<void>`
  - `async isTablePartitioned(tableName: string): Promise<boolean | null>` — null if the table doesn't exist, else relkind === 'p'.

- [ ] **Step 1: Write the failing test**

Append to `test/partitioning.test.js` (top-level, after existing imports, add `import { getSqlClient } from "../baasix/utils/db.js";` and two module vars `let tenantA; let tenantB;`):

```js
describe("tenant-partitioned collection", () => {
  beforeAll(async () => {
    const t1 = await authed(request(app).post("/items/baasix_Tenant")).send({ name: "PartTenant A" });
    const t2 = await authed(request(app).post("/items/baasix_Tenant")).send({ name: "PartTenant B" });
    tenantA = t1.body.data?.id ?? t1.body.id;
    tenantB = t2.body.data?.id ?? t2.body.id;

    const res = await authed(request(app).post("/schemas")).send({
      collectionName: "part_orders",
      schema: {
        name: "PartOrder",
        fields: {
          id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
          sku: { type: "String", allowNull: false },
          amount: { type: "Integer" },
        },
        indexes: [{ fields: ["sku"], unique: true, name: "part_orders_sku_unique" }],
        partitioning: { strategy: "tenant" },
      },
    });
    expect(res.status).toBeLessThan(300);
  });

  test("parent is partitioned with default + per-tenant partitions", async () => {
    const sql = getSqlClient();
    const [parent] = await sql`SELECT relkind FROM pg_class WHERE relname = 'part_orders'`;
    expect(parent.relkind).toBe("p");
    const parts = await sql`
      SELECT relid::regclass::text AS name FROM pg_partition_tree('"part_orders"'::regclass) WHERE isleaf`;
    const names = parts.map((p) => p.name.replace(/"/g, ""));
    expect(names).toContain("part_orders__default");
    expect(names).toContain(`part_orders__t_${tenantA.replace(/-/g, "").slice(0, 8)}`);
    expect(names).toContain(`part_orders__t_${tenantB.replace(/-/g, "").slice(0, 8)}`);
  });

  test("composite PK includes tenant_Id and tenant_Id is NOT NULL", async () => {
    const sql = getSqlClient();
    const pk = await sql`
      SELECT a.attname FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = '"part_orders"'::regclass AND i.indisprimary`;
    expect(pk.map((r) => r.attname).sort()).toEqual(["id", "tenant_Id"]);
    const [col] = await sql`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'part_orders' AND column_name = 'tenant_Id'`;
    expect(col.is_nullable).toBe("NO");
  });

  test("rows land in their tenant's partition", async () => {
    const created = await authed(request(app).post("/items/part_orders"))
      .send({ sku: "SKU-1", amount: 5, tenant_Id: tenantA });
    expect(created.status).toBeLessThan(300);
    const sql = getSqlClient();
    const [row] = await sql`
      SELECT tableoid::regclass::text AS part FROM "part_orders" WHERE sku = 'SKU-1'`;
    expect(row.part.replace(/"/g, "")).toBe(`part_orders__t_${tenantA.replace(/-/g, "").slice(0, 8)}`);
  });

  test("uniqueness is per-tenant", async () => {
    const dupSameTenant = await authed(request(app).post("/items/part_orders"))
      .send({ sku: "SKU-1", amount: 1, tenant_Id: tenantA });
    expect(dupSameTenant.status).toBeGreaterThanOrEqual(400);
    const sameSkuOtherTenant = await authed(request(app).post("/items/part_orders"))
      .send({ sku: "SKU-1", amount: 1, tenant_Id: tenantB });
    expect(sameSkuOtherTenant.status).toBeLessThan(300);
  });
});

describe("tenant+time composite partitioning", () => {
  test("creates per-tenant subtrees with time sub-partitions", async () => {
    const res = await authed(request(app).post("/schemas")).send({
      collectionName: "part_events",
      schema: {
        name: "PartEvent",
        fields: {
          id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
          kind: { type: "String", allowNull: false },
        },
        partitioning: { strategy: "tenant+time", interval: "year", premake: 1 },
      },
    });
    expect(res.status).toBeLessThan(300);

    const sql = getSqlClient();
    const year = new Date().getUTCFullYear();
    const parts = await sql`
      SELECT relid::regclass::text AS name FROM pg_partition_tree('"part_events"'::regclass)`;
    const names = parts.map((p) => p.name.replace(/"/g, ""));
    const tA = `part_events__t_${tenantA.replace(/-/g, "").slice(0, 8)}`;
    expect(names).toContain(tA); // tenant partition (itself RANGE-partitioned)
    expect(names).toContain(`${tA}__y${year}`);
    expect(names).toContain(`${tA}__y${year + 1}`);
    expect(names).toContain(`${tA}__default`);
    expect(names).toContain("part_events__default");

    // composite PK includes both partition keys
    const pk = await sql`
      SELECT a.attname FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = '"part_events"'::regclass AND i.indisprimary`;
    expect(pk.map((r) => r.attname).sort()).toEqual(["createdAt", "id", "tenant_Id"]);
  });

  test("deleting a tenant drops its whole subtree", async () => {
    const created = await authed(request(app).post("/items/baasix_Tenant")).send({ name: "PartTenant D" });
    const tenantD = created.body.data?.id ?? created.body.id;
    const sql = getSqlClient();
    const tD = `part_events__t_${tenantD.replace(/-/g, "").slice(0, 8)}`;
    let rows = await sql`SELECT 1 FROM pg_class WHERE relname = ${tD}`;
    expect(rows.length).toBe(1);

    await authed(request(app).delete(`/items/baasix_Tenant/${tenantD}`));
    rows = await sql`SELECT relname FROM pg_class WHERE relname LIKE ${tD + "%"}`;
    expect(rows.length).toBe(0); // parent AND its time sub-partitions gone (DROP ... CASCADE)
  });
});
```

Note: admin has a global (non-tenant) role, so it can pass `tenant_Id` explicitly. If tenant stamping rejects this, switch to per-tenant users following the pattern in `test/multitenant.test.js` (~lines 57-140).

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS='--experimental-vm-modules' npx jest test/partitioning.test.js --runInBand`
Expected: FAIL — `relkind` is `'r'` (plain table), no partitions exist.

- [ ] **Step 3: Refactor `createTableFromSchema` and add partition DDL**

In `schemaManager.ts`, replace the column-building section of `createTableFromSchema` (lines 867-940, from `// Build CREATE TABLE statement` through the `createTableSQL` assignment) with:

```ts
    const createTableSQL = this.buildCreateTableSQL(collectionName, schema);
    if (!createTableSQL) {
      console.warn(`No columns to create for table ${collectionName}`);
      return;
    }
    const foreignKeyAssociations: Array<{fieldName: string, assoc: any}> = [];
    for (const [fieldName, fieldSchema] of Object.entries(schema.fields)) {
      const fs = fieldSchema as any;
      if (fs.relType === 'BelongsTo') foreignKeyAssociations.push({fieldName, assoc: fs});
    }
```

and add the new method (place it directly above `createTableFromSchema`). It is the old loop body plus partition handling — the `PARTITION-AWARE` comments mark every behavioral addition:

```ts
  private buildCreateTableSQL(tableName: string, schema: any): string | null {
    const partitionConfig = normalizePartitioning(schema.partitioning);
    const partitionKeys = partitionConfig ? getPartitionKeyColumns(partitionConfig) : [];
    const columns: string[] = [];
    let pkField: string | null = null;
    const inlineUniqueFields: string[] = [];

    for (const [fieldName, fieldSchema] of Object.entries(schema.fields)) {
      let fs = fieldSchema as any;

      if (fs.relType === 'BelongsTo') {
        const foreignKey = fs.foreignKey || `${fieldName}_Id`;
        const foreignKeyExists = foreignKey !== fieldName && Object.keys(schema.fields).includes(foreignKey);
        if (!foreignKeyExists && foreignKey !== fieldName) {
          const RELATION_TYPES_CT = ["M2O", "O2O", "O2M", "M2M"];
          const fkType = (fs.type && !RELATION_TYPES_CT.includes(fs.type)) ? fs.type : 'UUID';
          // PARTITION-AWARE: partition key columns must be NOT NULL; inline UNIQUE moves to composite
          const fkAllowNull = partitionKeys.includes(foreignKey) ? false : fs.allowNull;
          const fkUnique = partitionConfig ? false : fs.unique;
          if (partitionConfig && fs.unique) inlineUniqueFields.push(foreignKey);
          const columnDef = this.buildColumnDefinition(foreignKey, {
            type: fkType, allowNull: fkAllowNull, unique: fkUnique
          });
          if (columnDef) columns.push(columnDef);
        }
        const RELATION_INDICATORS_CT = ["M2O", "O2O", "O2M", "M2M"];
        if (!(foreignKey === fieldName && fs.type && !RELATION_INDICATORS_CT.includes(fs.type))) {
          continue;
        }
      }

      const RELATION_TYPE_IND = ["M2O", "O2O", "O2M", "M2M"];
      if (fs.relType && (!fs.type || RELATION_TYPE_IND.includes(fs.type))) continue;

      // PARTITION-AWARE: strip inline PRIMARY KEY / UNIQUE, force NOT NULL on partition keys
      if (partitionConfig) {
        if (fs.primaryKey) { pkField = fieldName; fs = { ...fs, primaryKey: false }; }
        if (fs.unique) { inlineUniqueFields.push(fieldName); fs = { ...fs, unique: false }; }
        if (partitionKeys.includes(fieldName) && fs.allowNull !== false) {
          fs = { ...fs, allowNull: false };
        }
      }

      const columnDef = this.buildColumnDefinition(fieldName, fs);
      if (columnDef) columns.push(columnDef);
    }

    if (schema.timestamps !== false) {
      if (!schema.fields.createdAt) {
        // PARTITION-AWARE: createdAt must be NOT NULL when it is the partition key
        columns.push(partitionKeys.includes('createdAt')
          ? '"createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()'
          : '"createdAt" TIMESTAMPTZ DEFAULT NOW()');
      }
      if (!schema.fields.updatedAt) {
        columns.push('"updatedAt" TIMESTAMPTZ DEFAULT NOW()');
      }
    }
    if (schema.paranoid && !schema.fields.deletedAt) {
      columns.push('"deletedAt" TIMESTAMPTZ');
    }
    if (columns.length === 0) return null;

    // PARTITION-AWARE: composite PK / UNIQUE constraints and PARTITION BY clause
    let partitionByClause = '';
    if (partitionConfig) {
      const quotedKeys = partitionKeys.map((k) => `"${k}"`).join(', ');
      if (pkField) columns.push(`PRIMARY KEY ("${pkField}", ${quotedKeys})`.replace(`, "${pkField}"`, ''));
      for (const uf of inlineUniqueFields) {
        columns.push(`UNIQUE ("${uf}", ${quotedKeys})`);
      }
      partitionByClause = partitionConfig.strategy === 'time'
        ? ` PARTITION BY RANGE ("${partitionConfig.timeField}")`
        : ` PARTITION BY LIST ("tenant_Id")`;
    }
    return `CREATE TABLE "${tableName}" (${columns.join(', ')})${partitionByClause}`;
  }
```

Note on the PK line: if `pkField` is itself a partition key (unusual), the `.replace` removes the duplicate; normally it is a no-op because `quotedKeys` never contains the pk field. If this reads too clever, dedupe explicitly:

```ts
      if (pkField) {
        const pkCols = [pkField, ...partitionKeys.filter((k) => k !== pkField)].map((k) => `"${k}"`);
        columns.push(`PRIMARY KEY (${pkCols.join(', ')})`);
      }
```

(use the explicit version — delete the `.replace` one-liner).

- [ ] **Step 4: Add `ensurePartitions` / `ensureTenantPartition` / `isTablePartitioned`**

Add to `SchemaManager` (below `createTableFromSchema`):

```ts
  /** Idempotently create default/tenant/time partitions for a partitioned collection. */
  async ensurePartitions(
    collectionName: string,
    schema: any,
    opts: { tableName?: string; sqlClient?: any } = {}
  ): Promise<void> {
    const config = normalizePartitioning(schema.partitioning);
    if (!config) return;
    const sql = opts.sqlClient || getSqlClient();
    const table = opts.tableName || collectionName;

    await sql.unsafe(
      `CREATE TABLE IF NOT EXISTS "${partitionName(table, ['default'])}" PARTITION OF "${table}" DEFAULT`);

    if (config.strategy === 'time') {
      for (const p of periodsToEnsure(new Date(), config.interval, config.premake)) {
        await sql.unsafe(
          `CREATE TABLE IF NOT EXISTS "${partitionName(table, [p.suffix])}" PARTITION OF "${table}" ` +
          `FOR VALUES FROM ('${p.start}') TO ('${p.end}')`);
      }
      return;
    }

    const tenants = await sql`SELECT id FROM "baasix_Tenant"`;
    for (const t of tenants) {
      await this.ensureTenantPartition(table, config, String(t.id), sql);
    }
  }

  private async ensureTenantPartition(
    parentTable: string, config: PartitioningConfig, tenantId: string, sqlClient?: any
  ): Promise<void> {
    const sql = sqlClient || getSqlClient();
    const tName = tenantPartitionName(parentTable, tenantId); // validates UUID (DDL injection guard)
    if (config.strategy === 'tenant') {
      await sql.unsafe(
        `CREATE TABLE IF NOT EXISTS "${tName}" PARTITION OF "${parentTable}" FOR VALUES IN ('${tenantId}')`);
      return;
    }
    // tenant+time: the tenant partition is itself RANGE-partitioned by the time field
    await sql.unsafe(
      `CREATE TABLE IF NOT EXISTS "${tName}" PARTITION OF "${parentTable}" FOR VALUES IN ('${tenantId}') ` +
      `PARTITION BY RANGE ("${config.timeField}")`);
    await sql.unsafe(
      `CREATE TABLE IF NOT EXISTS "${partitionName(tName, ['default'])}" PARTITION OF "${tName}" DEFAULT`);
    for (const p of periodsToEnsure(new Date(), config.interval, config.premake)) {
      await sql.unsafe(
        `CREATE TABLE IF NOT EXISTS "${partitionName(tName, [p.suffix])}" PARTITION OF "${tName}" ` +
        `FOR VALUES FROM ('${p.start}') TO ('${p.end}')`);
    }
  }

  /** relkind check: null = table missing, true = partitioned parent, false = plain table. */
  async isTablePartitioned(tableName: string): Promise<boolean | null> {
    const sql = getSqlClient();
    const rows = await sql`
      SELECT relkind FROM pg_class
      WHERE relname = ${tableName} AND relnamespace = 'public'::regnamespace`;
    if (rows.length === 0) return null;
    return rows[0].relkind === 'p';
  }
```

Wire `ensurePartitions` into `createTableFromSchema` in BOTH branches:
- In the existing-table branch (after the `createIndex` loop, before `return` at line ~864): `await this.ensurePartitions(collectionName, schema);`
- In the create branch (after `sql.unsafe(createTableSQL)` succeeds, before the FK/index calls): `await this.ensurePartitions(collectionName, schema);`

- [ ] **Step 5: Run tests**

Run: `NODE_OPTIONS='--experimental-vm-modules' npx jest test/partitioning.test.js --runInBand`
Expected: PASS. Debug notes: if `CREATE INDEX` on the parent fails with "unique index must include all partition key columns", the Task 2 `appendPartitionKeysToUniqueIndexes` isn't being hit for `schema.indexes` — verify both holders are processed.

Also run the canary: `NODE_OPTIONS='--experimental-vm-modules' npx jest test/multitenant.test.js --runInBand` — Expected: PASS (unpartitioned behavior unchanged).

- [ ] **Step 6: Commit**

```bash
git add packages/core/baasix/utils/schemaManager.ts packages/core/test/partitioning.test.js
git commit -m "feat(core): partitioned CREATE TABLE and partition provisioning (tenant/time/tenant+time)"
```

---

### Task 4: Foreign keys targeting partitioned collections

**Files:**
- Modify: `packages/core/baasix/utils/schemaManager.ts` — `ensureForeignKeyConstraints` (lines 973-1114)
- Test: `packages/core/test/partitioning.test.js` (append describe block)

**Interfaces:**
- Consumes: `this.schemaDefinitions` map, `normalizePartitioning`.
- Produces: inbound FKs to `tenant`-partitioned targets are composite `(fk, tenant_Id) → (id, tenant_Id)`; FKs to time-partitioned targets (or from children without `tenant_Id`) are skipped with a `console.warn`.

- [ ] **Step 1: Write the failing test**

Append to `test/partitioning.test.js`:

```js
describe("FKs to partitioned collections", () => {
  beforeAll(async () => {
    const res = await authed(request(app).post("/schemas")).send({
      collectionName: "part_order_lines",
      schema: {
        name: "PartOrderLine",
        fields: {
          id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
          qty: { type: "Integer" },
          order: { relType: "BelongsTo", target: "part_orders", foreignKey: "order_Id", as: "order" },
        },
      },
    });
    expect(res.status).toBeLessThan(300);
  });

  test("FK is composite on (order_Id, tenant_Id)", async () => {
    const sql = getSqlClient();
    const [fk] = await sql`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conname = 'fk_part_order_lines_order_Id'`;
    expect(fk).toBeDefined();
    expect(fk.def).toContain('"order_Id"');
    expect(fk.def).toContain('"tenant_Id"');
    expect(fk.def).toContain('REFERENCES "part_orders"("id", "tenant_Id")');
  });

  test("cross-tenant reference is rejected by the FK", async () => {
    const orders = await authed(request(app).get("/items/part_orders")).query({ limit: 50 });
    const anOrder = (orders.body.data ?? orders.body).find((o) => o.tenant_Id === tenantA);
    const res = await authed(request(app).post("/items/part_order_lines"))
      .send({ qty: 1, order_Id: anOrder.id, tenant_Id: tenantB });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS='--experimental-vm-modules' npx jest test/partitioning.test.js --runInBand`
Expected: FAIL — either the FK creation errored in logs ("there is no unique constraint matching given keys") and the constraint is missing, or a plain single-column FK exists.

- [ ] **Step 3: Make `ensureForeignKeyConstraints` partition-aware**

In `ensureForeignKeyConstraints`, locate where `createForeignKeySQL(...)` is called (~line 1071). Before that call, resolve the target's partitioning and branch:

```ts
        // Partitioned targets need the partition key in the FK (or no FK at all)
        const targetDefEntry: any = this.schemaDefinitions.get(assoc.target);
        const targetSchema = targetDefEntry?.schema ?? targetDefEntry;
        let targetPartitioning: PartitioningConfig | null = null;
        try { targetPartitioning = normalizePartitioning(targetSchema?.partitioning); } catch { targetPartitioning = null; }

        let fkSQL: string;
        if (targetPartitioning) {
          if (targetPartitioning.strategy !== 'tenant') {
            console.warn(`[partitioning] Skipping FK ${constraintName}: target "${assoc.target}" is time-partitioned (children cannot reference (id, ${targetPartitioning.timeField}))`);
            continue;
          }
          if (!schema.fields?.tenant_Id) {
            console.warn(`[partitioning] Skipping FK ${constraintName}: "${collectionName}" has no tenant_Id column to reference partitioned "${assoc.target}"`);
            continue;
          }
          fkSQL = `ALTER TABLE "${collectionName}" ADD CONSTRAINT "${constraintName}" ` +
            `FOREIGN KEY ("${foreignKey}", "tenant_Id") REFERENCES "${assoc.target}"("id", "tenant_Id") ` +
            `ON DELETE ${onDelete} ON UPDATE ${onUpdate}`;
        } else {
          fkSQL = createForeignKeySQL(collectionName, foreignKey, assoc.target, 'id', onDelete, onUpdate);
        }
```

(Adapt variable names to the surrounding code — `constraintName`, `foreignKey`, `onDelete`, `onUpdate` all already exist in that scope. Keep the existing existing-constraint check and `sql.unsafe(fkSQL)` execution path unchanged.)

Note: `schema.fields?.tenant_Id` is reliable because `updateModel`/`createOrUpdateModel` inject `tenant_Id` into every non-system schema in MT mode before DDL runs.

- [ ] **Step 4: Run tests**

Run: `NODE_OPTIONS='--experimental-vm-modules' npx jest test/partitioning.test.js --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/baasix/utils/schemaManager.ts packages/core/test/partitioning.test.js
git commit -m "feat(core): composite FKs to tenant-partitioned collections, skip+warn otherwise"
```

---

### Task 5: Tenant lifecycle hooks (create partitions / drop partitions)

**Files:**
- Modify: `packages/core/baasix/utils/schemaManager.ts` — add `createPartitionsForTenant`, `dropPartitionsForTenant`.
- Modify: `packages/core/baasix/services/HooksManager.ts` — register internal hooks (after the `baasix_Sessions` hook, ~line 257, inside the `__baasix_hooksManagerInitialized` guard).
- Test: `packages/core/test/partitioning.test.js` (append describe block)

**Interfaces:**
- Consumes: `ensureTenantPartition` (Task 3), `hooksManager.registerHook(collection, event, fn)`; hook context: `context.document` (row, in `.after` events), `context.id` (in delete events).
- Produces:
  - `async createPartitionsForTenant(tenantId: string): Promise<void>` — for every tenant-partitioned collection in `this.schemaDefinitions`.
  - `async dropPartitionsForTenant(tenantId: string): Promise<void>` — `DROP TABLE IF EXISTS ... CASCADE` of each tenant partition (CASCADE removes tenant+time sub-partitions).

- [ ] **Step 1: Write the failing test**

Append to `test/partitioning.test.js`:

```js
describe("tenant lifecycle partitions", () => {
  test("creating a tenant creates its partitions; deleting drops them", async () => {
    const sql = getSqlClient();
    const created = await authed(request(app).post("/items/baasix_Tenant")).send({ name: "PartTenant C" });
    const tenantC = created.body.data?.id ?? created.body.id;
    const partName = `part_orders__t_${tenantC.replace(/-/g, "").slice(0, 8)}`;

    let rows = await sql`SELECT 1 FROM pg_class WHERE relname = ${partName}`;
    expect(rows.length).toBe(1);

    // rows for other tenants survive tenant C's deletion
    const before = await sql`SELECT COUNT(*)::int AS c FROM "part_orders"`;
    const del = await authed(request(app).delete(`/items/baasix_Tenant/${tenantC}`));
    expect(del.status).toBeLessThan(300);

    rows = await sql`SELECT 1 FROM pg_class WHERE relname = ${partName}`;
    expect(rows.length).toBe(0);
    const after = await sql`SELECT COUNT(*)::int AS c FROM "part_orders"`;
    expect(after[0].c).toBe(before[0].c);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS='--experimental-vm-modules' npx jest test/partitioning.test.js --runInBand`
Expected: FAIL — partition for tenant C does not exist (`rows.length` is 0 at the first assertion).

- [ ] **Step 3: Add lifecycle methods to `SchemaManager`**

```ts
  /** Create partitions for a new tenant across all tenant-partitioned collections. */
  async createPartitionsForTenant(tenantId: string): Promise<void> {
    for (const [name, defEntry] of this.schemaDefinitions) {
      const schema = (defEntry as any)?.schema ?? defEntry;
      let config: PartitioningConfig | null = null;
      try { config = normalizePartitioning(schema?.partitioning); } catch { continue; }
      if (!config || config.strategy === 'time') continue;
      try {
        await this.ensureTenantPartition(name, config, tenantId);
      } catch (error) {
        console.error(`[partitioning] Failed to create partition of "${name}" for tenant ${tenantId}:`, error);
        throw error; // fail the tenant creation — partitions must exist
      }
    }
  }

  /** Drop a deleted tenant's partitions (irreversible bulk erase, per design). */
  async dropPartitionsForTenant(tenantId: string): Promise<void> {
    const sql = getSqlClient();
    for (const [name, defEntry] of this.schemaDefinitions) {
      const schema = (defEntry as any)?.schema ?? defEntry;
      let config: PartitioningConfig | null = null;
      try { config = normalizePartitioning(schema?.partitioning); } catch { continue; }
      if (!config || config.strategy === 'time') continue;
      const tName = tenantPartitionName(name, tenantId); // validates UUID
      await sql.unsafe(`DROP TABLE IF EXISTS "${tName}" CASCADE`);
      console.log(`[partitioning] Dropped partition "${tName}" for deleted tenant ${tenantId}`);
    }
  }
```

- [ ] **Step 4: Register the hooks in `HooksManager.ts`**

After the `baasix_Sessions` internal hook (~line 257), still inside the one-time-init guard:

```ts
  // Partition lifecycle: create partitions when a tenant is created,
  // drop them (bulk data erase) right before the tenant row is deleted.
  hooksManager.registerHook('baasix_Tenant', 'items.create.after', async (context: HookContext) => {
    const tenantId = context.document?.id ?? context.id;
    if (!tenantId) return context;
    const { schemaManager } = await import('../utils/schemaManager.js');
    await schemaManager.createPartitionsForTenant(String(tenantId));
    return context;
  });

  hooksManager.registerHook('baasix_Tenant', 'items.delete', async (context: HookContext) => {
    const tenantId = context.id;
    if (!tenantId) return context;
    const { schemaManager } = await import('../utils/schemaManager.js');
    await schemaManager.dropPartitionsForTenant(String(tenantId));
    return context;
  });
```

(Match the exact import style of the `schemaManager` export used elsewhere: `schema.route.ts` does `import { schemaManager } from '../utils/schemaManager.js'` — if the module's named export differs, mirror it.)

- [ ] **Step 5: Run tests**

Run: `NODE_OPTIONS='--experimental-vm-modules' npx jest test/partitioning.test.js --runInBand`
Expected: PASS. Also run `test/multitenant.test.js` — tenant create/delete flows there must still pass (they now trigger the hooks; with no partitioned collections in that file the hooks are no-ops).

- [ ] **Step 6: Commit**

```bash
git add packages/core/baasix/utils/schemaManager.ts packages/core/baasix/services/HooksManager.ts packages/core/test/partitioning.test.js
git commit -m "feat(core): tenant lifecycle hooks create/drop partitions"
```

---

### Task 6: Startup reconciliation + daily maintenance timer

**Files:**
- Modify: `packages/core/baasix/utils/schemaManager.ts` — add `reconcilePartitions`; call it in `initialize()` after `loadAllSchemas` (line ~134), before `this.initialized = true`.
- Create: `packages/core/baasix/utils/partitionMaintenance.ts`
- Modify: `packages/core/baasix/app.ts` — start maintenance alongside `startLogCleanup()` (both call sites, ~line 484-489 and ~589-596; skipped when `TEST_MODE=true`).
- Test: `packages/core/test/partitioning.test.js` (append describe block)

**Interfaces:**
- Consumes: `ensurePartitions` (Task 3).
- Produces: `async reconcilePartitions(): Promise<void>` on SchemaManager (public — called by the timer and tests); `startPartitionMaintenance(): void` from `partitionMaintenance.ts`.

- [ ] **Step 1: Write the failing test**

Append to `test/partitioning.test.js` (add `import { schemaManager } from "../baasix/utils/schemaManager.js";` at the top):

```js
describe("partition reconciliation", () => {
  test("recreates a missing tenant partition", async () => {
    const sql = getSqlClient();
    const partName = `part_orders__t_${tenantB.replace(/-/g, "").slice(0, 8)}`;
    await sql.unsafe(`DROP TABLE IF EXISTS "${partName}"`); // simulate drift (partition empty? then re-add data)
    let rows = await sql`SELECT 1 FROM pg_class WHERE relname = ${partName}`;
    expect(rows.length).toBe(0);

    await schemaManager.reconcilePartitions();

    rows = await sql`SELECT 1 FROM pg_class WHERE relname = ${partName}`;
    expect(rows.length).toBe(1);
  });
});
```

Note: dropping tenant B's partition also deletes its rows — order this test AFTER the uniqueness test (which inserted a tenant-B row) or re-insert data afterward if later tests need it. Simplest: keep this as the LAST tenant-strategy describe block before the conversion tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS='--experimental-vm-modules' npx jest test/partitioning.test.js --runInBand`
Expected: FAIL — `schemaManager.reconcilePartitions is not a function`.

- [ ] **Step 3: Implement `reconcilePartitions`**

```ts
  /** Ensure the full expected partition set exists for every partitioned collection. */
  async reconcilePartitions(): Promise<void> {
    for (const [name, defEntry] of this.schemaDefinitions) {
      const schema = (defEntry as any)?.schema ?? defEntry;
      let config: PartitioningConfig | null = null;
      try { config = normalizePartitioning(schema?.partitioning); } catch { continue; }
      if (!config) continue;
      try {
        const partitioned = await this.isTablePartitioned(name);
        if (partitioned === null) continue;
        if (partitioned === false) {
          console.warn(`[partitioning] "${name}" has a partitioning config but the table is not partitioned. ` +
            `Update the collection via PATCH /schemas/${name} to convert it.`);
          continue;
        }
        await this.ensurePartitions(name, schema);
        // Non-empty DEFAULT partitions signal rows that missed their partition
        const sql = getSqlClient();
        const defaults = await sql`
          SELECT relid::regclass::text AS part FROM pg_partition_tree(${'"' + name + '"'}::regclass)
          WHERE isleaf AND relid::regclass::text LIKE '%__default%'`;
        for (const d of defaults) {
          const [{ count }] = await sql.unsafe(`SELECT COUNT(*)::int AS count FROM ${d.part}`);
          if (count > 0) {
            console.warn(`[partitioning] Default partition ${d.part} holds ${count} rows — ` +
              `these rows missed their tenant/time partition.`);
          }
        }
      } catch (error) {
        console.error(`[partitioning] Reconciliation failed for "${name}":`, error);
      }
    }
  }
```

In `initialize()` insert after `await this.loadAllSchemas(needSyncing);` (line ~134):

```ts
      // Step 5: Reconcile partitions (heal drift, pre-create time periods)
      await this.reconcilePartitions();
```

- [ ] **Step 4: Create `partitionMaintenance.ts` and wire into `app.ts`**

`packages/core/baasix/utils/partitionMaintenance.ts` (mirrors `logCleanup.ts` structure):

```ts
import { schemaManager } from "./schemaManager.js";

const DAILY_MS = 24 * 60 * 60 * 1000;
let maintenanceTimer: NodeJS.Timeout | null = null;

async function runPartitionMaintenance(): Promise<void> {
  try {
    await schemaManager.reconcilePartitions();
  } catch (error) {
    console.error("[partitioning] Scheduled partition maintenance failed:", error);
  }
}

/** Pre-creates upcoming time partitions and heals partition drift once a day. */
export function startPartitionMaintenance(): void {
  if (maintenanceTimer) return;
  setTimeout(runPartitionMaintenance, 20000);
  maintenanceTimer = setInterval(runPartitionMaintenance, DAILY_MS);
  if (typeof maintenanceTimer.unref === "function") maintenanceTimer.unref();
}

export function stopPartitionMaintenance(): void {
  if (maintenanceTimer) { clearInterval(maintenanceTimer); maintenanceTimer = null; }
}
```

In `app.ts`: add `import { startPartitionMaintenance } from "./utils/partitionMaintenance.js";` and call `startPartitionMaintenance();` immediately after each `startLogCleanup()` call (two sites — the production `startServer` path ~line 484-489 and the testing path ~589-596; in the testing path it sits inside the same `TEST_MODE` guard as `startLogCleanup`, so it stays off in tests).

- [ ] **Step 5: Run tests**

Run: `NODE_OPTIONS='--experimental-vm-modules' npx jest test/partitioning.test.js --runInBand`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/baasix/utils/schemaManager.ts packages/core/baasix/utils/partitionMaintenance.ts packages/core/baasix/app.ts packages/core/test/partitioning.test.js
git commit -m "feat(core): startup partition reconciliation and daily maintenance"
```

---

### Task 7: Copy-and-swap conversion (partition an existing table / revert)

**Files:**
- Modify: `packages/core/baasix/utils/schemaManager.ts` — add `convertTableLayout`; conversion detection in `updateModel`.
- Test: `packages/core/test/partitioning.test.js` (append describe block)

**Interfaces:**
- Consumes: `buildCreateTableSQL`, `ensurePartitions`, `isTablePartitioned`, `ensureForeignKeyConstraints`, `createIndex`, `createVectorIndex`; porsager transactions: `await sql.begin(async (tx) => { ... tx.unsafe(...) })`.
- Produces: `private async convertTableLayout(collectionName: string, schema: any, config: PartitioningConfig | null): Promise<void>`. `updateModel` routes to it when the physical layout disagrees with the desired config. Backup naming: to-partitioned keeps `<col>__preparted`; to-plain keeps `<col>__prepart_rollback`.

- [ ] **Step 1: Write the failing test**

Append to `test/partitioning.test.js`:

```js
describe("conversion copy-and-swap", () => {
  const collection = "conv_orders";
  const baseSchema = {
    name: "ConvOrder",
    fields: {
      id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
      ref: { type: "String", allowNull: false },
    },
  };

  beforeAll(async () => {
    await authed(request(app).post("/schemas")).send({ collectionName: collection, schema: baseSchema });
    for (let i = 0; i < 5; i++) {
      await authed(request(app).post(`/items/${collection}`))
        .send({ ref: `A-${i}`, tenant_Id: tenantA });
      await authed(request(app).post(`/items/${collection}`))
        .send({ ref: `B-${i}`, tenant_Id: tenantB });
    }
  });

  test("PATCH with partitioning converts the populated table", async () => {
    const sql = getSqlClient();
    const [{ c: before }] = await sql`SELECT COUNT(*)::int AS c FROM "conv_orders"`;
    expect(before).toBe(10);

    const res = await authed(request(app).patch(`/schemas/${collection}`))
      .send({ schema: { ...baseSchema, partitioning: { strategy: "tenant" } } });
    expect(res.status).toBeLessThan(300);

    const [parent] = await sql`SELECT relkind FROM pg_class WHERE relname = 'conv_orders'`;
    expect(parent.relkind).toBe("p");
    const [{ c: after }] = await sql`SELECT COUNT(*)::int AS c FROM "conv_orders"`;
    expect(after).toBe(before);
    const [backup] = await sql`SELECT relkind FROM pg_class WHERE relname = 'conv_orders__preparted'`;
    expect(backup.relkind).toBe("r");
    // rows are routed into tenant partitions, not the default
    const [{ c: inDefault }] = await sql`SELECT COUNT(*)::int AS c FROM "conv_orders__default"`;
    expect(inDefault).toBe(0);
  });

  test("removing partitioning converts back to a plain table", async () => {
    const sql = getSqlClient();
    const res = await authed(request(app).patch(`/schemas/${collection}`))
      .send({ schema: baseSchema });
    expect(res.status).toBeLessThan(300);
    const [parent] = await sql`SELECT relkind FROM pg_class WHERE relname = 'conv_orders'`;
    expect(parent.relkind).toBe("r");
    const [{ c }] = await sql`SELECT COUNT(*)::int AS c FROM "conv_orders"`;
    expect(c).toBe(10);
  });

  test("conversion aborts when rows have NULL tenant_Id", async () => {
    const sql = getSqlClient();
    // drop leftover backup so the name is free, then poke a NULL row in directly
    await sql.unsafe(`DROP TABLE IF EXISTS "conv_orders__preparted" CASCADE`);
    await sql.unsafe(`INSERT INTO "conv_orders" ("id", "ref") VALUES (gen_random_uuid(), 'orphan')`);

    const res = await authed(request(app).patch(`/schemas/${collection}`))
      .send({ schema: { ...baseSchema, partitioning: { strategy: "tenant" } } });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/NULL/i);
    const [parent] = await sql`SELECT relkind FROM pg_class WHERE relname = 'conv_orders'`;
    expect(parent.relkind).toBe("r"); // unchanged
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS='--experimental-vm-modules' npx jest test/partitioning.test.js --runInBand`
Expected: FAIL — after PATCH, `relkind` is still `'r'` (no conversion happens today; `createTableFromSchema` takes the sync path).

- [ ] **Step 3: Implement `convertTableLayout`**

Add to `SchemaManager`:

```ts
  /**
   * Copy-and-swap a table between plain and partitioned layouts.
   * Runs in one transaction; the pre-conversion table is kept as a backup.
   */
  private async convertTableLayout(
    collectionName: string, schema: any, config: PartitioningConfig | null
  ): Promise<void> {
    const sql = getSqlClient();
    const keys = config ? getPartitionKeyColumns(config) : [];
    const tempName = partitionName(collectionName, ['part_new']);
    const backupName = config
      ? partitionName(collectionName, ['preparted'])
      : partitionName(collectionName, ['prepart_rollback']);

    for (const key of keys) {
      const nullRows = await sql.unsafe(
        `SELECT COUNT(*)::int AS count FROM "${collectionName}" WHERE "${key}" IS NULL`);
      if (nullRows[0].count > 0) {
        throw new APIError(`Cannot partition "${collectionName}"`, 400,
          `${nullRows[0].count} rows have NULL "${key}". Assign values to these rows before enabling partitioning.`);
      }
    }
    const backupExists = await sql`SELECT 1 FROM pg_class WHERE relname = ${backupName}`;
    if (backupExists.length > 0) {
      throw new APIError(`Backup table "${backupName}" already exists`, 400,
        `A previous conversion left "${backupName}" behind. Drop or rename it, then retry.`);
    }

    // Copy every real (non-generated) column, in a stable order shared by INSERT and SELECT
    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = ${collectionName} AND table_schema = 'public' AND is_generated = 'NEVER'
      ORDER BY ordinal_position`;
    const colList = cols.map((c: any) => `"${c.column_name}"`).join(', ');

    await sql.begin(async (tx: any) => {
      await tx.unsafe(`LOCK TABLE "${collectionName}" IN ACCESS EXCLUSIVE MODE`);

      // 1. Drop inbound FKs; they are recreated against the new table afterwards
      const inbound = await tx.unsafe(
        `SELECT conname, conrelid::regclass::text AS child_table
         FROM pg_constraint WHERE contype = 'f' AND confrelid = '"${collectionName}"'::regclass`);
      for (const fk of inbound) {
        await tx.unsafe(`ALTER TABLE ${fk.child_table} DROP CONSTRAINT "${fk.conname}"`);
      }

      // 2. New layout under a temp name (schema object carries the DESIRED partitioning already)
      const createSQL = this.buildCreateTableSQL(tempName, schema);
      if (!createSQL) throw new Error(`No columns for "${collectionName}" conversion`);
      await tx.unsafe(createSQL);
      if (config) {
        await this.ensurePartitions(collectionName, schema, { tableName: tempName, sqlClient: tx });
      }

      // 3. Copy all rows (table is exclusively locked, so this is a consistent snapshot)
      await tx.unsafe(`INSERT INTO "${tempName}" (${colList}) SELECT ${colList} FROM "${collectionName}"`);

      // 4. Move the old table aside and free up its index names
      await tx.unsafe(`ALTER TABLE "${collectionName}" RENAME TO "${backupName}"`);
      const oldIndexes = await tx.unsafe(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = '${backupName}'`);
      for (const idx of oldIndexes) {
        await tx.unsafe(
          `ALTER INDEX "${idx.indexname}" RENAME TO "${partitionName(idx.indexname, ['bak'])}"`);
      }
      // 4b. If the old table was partitioned (reverse conversion), rename ITS partitions
      // out of the way too — their canonical names must be free for any future conversion.
      const oldParts = await tx.unsafe(
        `SELECT relid::regclass::text AS name FROM pg_partition_tree('"${backupName}"'::regclass)
         WHERE relid <> '"${backupName}"'::regclass`);
      for (const p of oldParts) {
        const raw = p.name.replace(/^"|"$/g, '');
        await tx.unsafe(`ALTER TABLE ${p.name} RENAME TO "${partitionName(raw, ['bak'])}"`);
      }

      // 5. Promote the new table
      await tx.unsafe(`ALTER TABLE "${tempName}" RENAME TO "${collectionName}"`);

      // 5b. Partitions were created under the temp prefix — rename them to canonical names
      // (renaming the parent does NOT rename its partitions).
      const newParts = await tx.unsafe(
        `SELECT relid::regclass::text AS name FROM pg_partition_tree('"${collectionName}"'::regclass)
         WHERE relid <> '"${collectionName}"'::regclass`);
      for (const p of newParts) {
        const raw = p.name.replace(/^"|"$/g, '');
        if (!raw.startsWith(tempName)) continue;
        const canonical = collectionName + raw.slice(tempName.length);
        await tx.unsafe(`ALTER TABLE ${p.name} RENAME TO "${canonical}"`);
      }
    });

    // 6. Rebuild indexes and FKs with their canonical names (outside the txn, same helpers as create path)
    if (schema.indexes && Array.isArray(schema.indexes)) {
      for (const index of schema.indexes) await this.createIndex(collectionName, index);
    }
    for (const [fieldName, fieldDef] of Object.entries(schema.fields || {})) {
      const fd = fieldDef as any;
      if (fd.type === 'Vector' || fd.type === 'HalfVec' || fd.type === 'SparseVec') {
        await this.createVectorIndex(collectionName, fieldName, fd.type);
      }
    }
    await this.ensureForeignKeyConstraints(collectionName, schema);

    // 7. Recreate inbound FKs from children (composite or skipped per partition rules)
    for (const [childName, childEntry] of this.schemaDefinitions) {
      if (childName === collectionName) continue;
      const childSchema = (childEntry as any)?.schema ?? childEntry;
      const references = Object.values(childSchema?.fields || {}).some(
        (f: any) => f?.relType === 'BelongsTo' && f?.target === collectionName);
      if (references) await this.ensureForeignKeyConstraints(childName, childSchema);
    }

    console.log(`[partitioning] Converted "${collectionName}" ` +
      `(${config ? 'partitioned' : 'plain'} layout). Backup kept as "${backupName}".`);
  }
```

Note on step 4: `ALTER INDEX ... RENAME` also renames the constraint for PK/unique-constraint indexes — verify in the test run; if Postgres rejects renaming a constraint index, use `ALTER TABLE "${backupName}" RENAME CONSTRAINT` for those (detect via `pg_constraint.conindid`).

- [ ] **Step 4: Route `updateModel` to conversion**

In `updateModel`, capture the previous definition BEFORE `this.schemaDefinitions.set(...)` (line ~2161):

```ts
    const previousEntry: any = this.schemaDefinitions.get(collectionName);
    const previousSchema = previousEntry?.schema ?? previousEntry;
    let previousConfig: PartitioningConfig | null = null;
    try { previousConfig = normalizePartitioning(previousSchema?.partitioning); } catch { previousConfig = null; }
```

Then replace the final `await this.createTableFromSchema(collectionName, schema);` with:

```ts
    const physicallyPartitioned = await this.isTablePartitioned(collectionName);
    const wantsPartitioned = !!partitionConfig;
    const layoutChanged = physicallyPartitioned !== null && (
      physicallyPartitioned !== wantsPartitioned ||
      (wantsPartitioned && JSON.stringify(partitionConfig) !== JSON.stringify(previousConfig))
    );
    if (layoutChanged) {
      await this.convertTableLayout(collectionName, schema, partitionConfig);
    } else {
      await this.createTableFromSchema(collectionName, schema);
    }
```

(`partitionConfig` is in scope from Task 2's validation call.)

- [ ] **Step 5: Run tests**

Run: `NODE_OPTIONS='--experimental-vm-modules' npx jest test/partitioning.test.js --runInBand`
Expected: PASS (all describe blocks). Then run the full canary set:
`NODE_OPTIONS='--experimental-vm-modules' npx jest test/multitenant.test.js test/schema.test.js --runInBand` (if `test/schema.test.js` exists; otherwise just multitenant).
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/baasix/utils/schemaManager.ts packages/core/test/partitioning.test.js
git commit -m "feat(core): copy-and-swap conversion between plain and partitioned layouts"
```

---

### Task 8: Time strategy end-to-end (single-tenant), pruning check, spec status

**Files:**
- Test: `packages/core/test/partitioningTime.test.js` (new — separate file because it needs `MULTI_TENANT=false`)
- Modify: `docs/superpowers/specs/2026-07-05-collection-partitioning-design.md` (status line)

**Interfaces:**
- Consumes: everything from Tasks 1–7. No new production code expected; this task hardens the time path and fixes whatever it flushes out.

- [ ] **Step 1: Write the test file**

`packages/core/test/partitioningTime.test.js`:

```js
import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { getSqlClient } from "../baasix/utils/db.js";
import { schemaManager } from "../baasix/utils/schemaManager.js";
import { beforeAll, test, expect, describe } from "@jest/globals";

let app;
let adminToken;
const authed = (req) => req.set("Authorization", `Bearer ${adminToken}`);
const thisYear = new Date().getUTCFullYear();

beforeAll(async () => {
  await destroyAllTablesInDB();
  app = await startServerForTesting({ envOverrides: { MULTI_TENANT: "false" } });
  const login = await request(app).post("/auth/login")
    .send({ email: "admin@baasix.com", password: "admin@123" });
  adminToken = login.body.data.token ?? login.body.token;

  const res = await authed(request(app).post("/schemas")).send({
    collectionName: "event_logs",
    schema: {
      name: "EventLog",
      fields: {
        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
        message: { type: "String", allowNull: false },
      },
      partitioning: { strategy: "time", interval: "year", premake: 1 },
    },
  });
  expect(res.status).toBeLessThan(300);
});

describe("time-partitioned collection (single-tenant)", () => {
  test("current + premade year partitions and default exist", async () => {
    const sql = getSqlClient();
    const parts = await sql`
      SELECT relid::regclass::text AS name FROM pg_partition_tree('"event_logs"'::regclass) WHERE isleaf`;
    const names = parts.map((p) => p.name.replace(/"/g, ""));
    expect(names).toContain(`event_logs__y${thisYear}`);
    expect(names).toContain(`event_logs__y${thisYear + 1}`);
    expect(names).toContain("event_logs__default");
  });

  test("tenant strategy is rejected when MULTI_TENANT=false", async () => {
    const res = await authed(request(app).post("/schemas")).send({
      collectionName: "st_orders",
      schema: {
        name: "StOrder",
        fields: { id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } } },
        partitioning: { strategy: "tenant" },
      },
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/MULTI_TENANT/);
  });

  test("rows are routed by createdAt and planner prunes by date filter", async () => {
    const sql = getSqlClient();
    const created = await authed(request(app).post("/items/event_logs")).send({ message: "hello" });
    expect(created.status).toBeLessThan(300);
    const [row] = await sql`SELECT tableoid::regclass::text AS part FROM "event_logs" WHERE message = 'hello'`;
    expect(row.part.replace(/"/g, "")).toBe(`event_logs__y${thisYear}`);

    // Bounded range — an unbounded ">=" can never prune the DEFAULT partition
    // (it could hold rows beyond the last defined period).
    const plan = await sql.unsafe(
      `EXPLAIN (FORMAT JSON) SELECT * FROM "event_logs" ` +
      `WHERE "createdAt" >= '${thisYear}-01-01' AND "createdAt" < '${thisYear + 1}-01-01'`);
    const planText = JSON.stringify(plan);
    expect(planText).toContain(`event_logs__y${thisYear}`);
    expect(planText).not.toContain(`event_logs__y${thisYear + 1}`);
    expect(planText).not.toContain("event_logs__default");
  });

  test("reconcile recreates a dropped future partition", async () => {
    const sql = getSqlClient();
    await sql.unsafe(`DROP TABLE IF EXISTS "event_logs__y${thisYear + 1}"`);
    await schemaManager.reconcilePartitions();
    const rows = await sql`SELECT 1 FROM pg_class WHERE relname = ${"event_logs__y" + (thisYear + 1)}`;
    expect(rows.length).toBe(1);
  });

  test("FK to a time-partitioned collection is skipped (no constraint, insert still works)", async () => {
    const res = await authed(request(app).post("/schemas")).send({
      collectionName: "event_comments",
      schema: {
        name: "EventComment",
        fields: {
          id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
          body: { type: "String" },
          event: { relType: "BelongsTo", target: "event_logs", foreignKey: "event_Id", as: "event" },
        },
      },
    });
    expect(res.status).toBeLessThan(300);
    const sql = getSqlClient();
    const fk = await sql`SELECT 1 FROM pg_constraint WHERE conname = 'fk_event_comments_event_Id'`;
    expect(fk.length).toBe(0); // skipped with a warning, per design
  });
});
```

- [ ] **Step 2: Run the file**

Run: `NODE_OPTIONS='--experimental-vm-modules' npx jest test/partitioningTime.test.js --runInBand`
Expected: PASS if Tasks 1-7 are correct. Any failure here is a real time-path bug — fix in `partitionUtils.ts` / `schemaManager.ts` (likely spots: RANGE bound formatting for `DateTime_NO_TZ` fields, EXPLAIN plan shape) and re-run until green.

- [ ] **Step 3: Run the full suite**

Run: `npm run testAll` (or at minimum: `NODE_OPTIONS='--experimental-vm-modules' npx jest test/partitionUtils.test.js test/partitioning.test.js test/partitioningTime.test.js test/multitenant.test.js test/tenantStrictIsolation.test.js --runInBand`)
Expected: PASS across the board.

- [ ] **Step 4: Update spec status and commit**

In `docs/superpowers/specs/2026-07-05-collection-partitioning-design.md` change `**Status:** Approved pending spec review` to `**Status:** Implemented (see docs/superpowers/plans/2026-07-05-collection-partitioning.md)`.

```bash
git add packages/core/test/partitioningTime.test.js docs/superpowers/specs/2026-07-05-collection-partitioning-design.md
git commit -m "test(core): time-strategy partitioning e2e, pruning and reconcile coverage"
```
