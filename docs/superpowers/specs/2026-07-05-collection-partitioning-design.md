# Collection Partitioning (Tenant / Time) — Design

**Date:** 2026-07-05
**Status:** Implemented (see docs/superpowers/plans/2026-07-05-collection-partitioning.md)
**Scope:** `packages/core` (SchemaManager, tenant lifecycle, schema API validation)

## Motivation

Large deployments accumulate millions of rows in a few hot collections. Two access
patterns dominate:

1. **Multi-tenant entity tables** — every query is already scoped by `tenant_Id`
   (row-level tenancy via `tenantUtils`). Partitioning by tenant gives each tenant a
   physically small table + indexes, and makes tenant deletion a metadata operation.
2. **Append-mostly, time-correlated tables** (audit logs, email logs, notifications,
   workflow execution logs, events). Recent data is hot; history only grows. RANGE
   partitioning by a timestamp keeps the active partition and its indexes small and
   allows old periods to be archived/dropped manually as whole partitions.

Postgres declarative partitioning provides both without any change to the query layer:
the collection remains one logical table; the planner prunes partitions using the
`tenant_Id` filter that `tenantUtils` already injects and/or the caller's date filters.

Explicitly **not** chosen: schema-per-tenant (catalog bloat, N× DDL sync, large rework
of the collection-name-keyed SchemaManager registry) and HASH bucketing (loses
per-tenant drop).

## Decisions (from brainstorming)

| Question | Decision |
| --- | --- |
| Expected tenant count | Tens (< 100) → LIST partition per tenant is fine |
| Populated-table conversion | Auto-convert, inline copy-and-swap during schema update |
| Tenant lifecycle | Auto-create partitions on tenant create; **drop** partitions on tenant delete |
| Conversion execution | Approach A: synchronous, table locked during copy |
| Time-partition retention | None. Partitions are kept until manually dropped |

## Collection setting

New collection-level option in the schema definition JSON (stored in
`baasix_SchemaDefinition`), replacing nothing (net-new). It lives at the **top level**
of the collection schema, alongside `tenantScoped`/`timestamps` (the codebase has no
user-facing `options` wrapper):

```jsonc
{
  "partitioning": {
    "strategy": "tenant" | "time" | "tenant+time",
    "timeField": "createdAt",   // time strategies; any NOT NULL DateTime field; default "createdAt"
    "interval": "month" | "quarter" | "year",  // time strategies; default "year"
    "premake": 1                // time strategies; future periods to pre-create; default 1
  }
}
```

### Validation (in `createOrUpdateModel` / `syncSchema`)

- `tenant` and `tenant+time` require `MULTI_TENANT=true`; rejected otherwise.
- Not allowed on `baasix_` system collections (v1) or `tenantScoped: false` collections
  (for tenant strategies — no `tenant_Id` to partition by).
- `timeField` must resolve to a `DateTime`/`DateTime_NO_TZ` column that is `NOT NULL`
  or has a non-null default (`NOW`); `createdAt` (timestamps) qualifies.
- Postgres `server_version` must be ≥ 12 (every feature used — LIST/RANGE sub-partitioning, DEFAULT partitions, inbound composite FKs, pg_partition_tree — is PG12+); otherwise reject with a clear error.
- Changing `strategy`/`interval`/`timeField` on an existing partitioned collection is
  a conversion (see below) — done via the same copy-and-swap.

## Physical DDL

### Partition layout per strategy

| Strategy | Layout | PK | Example partition names |
| --- | --- | --- | --- |
| `tenant` | `PARTITION BY LIST ("tenant_Id")` | `(id, tenant_Id)` | `orders__t_a1b2c3d4`, `orders__default` |
| `time` | `PARTITION BY RANGE ("createdAt")` | `(id, createdAt)` | `logs__y2026`, `logs__202607` (month), `logs__2026q3` (quarter), `logs__default` |
| `tenant+time` | LIST by `tenant_Id`, each tenant partition `PARTITION BY RANGE (timeField)` | `(id, tenant_Id, createdAt)` | `orders__t_a1b2c3d4__y2026`, per-tenant `__default` |

`__t_<x>` uses the first 8 hex chars of the tenant UUID. All names are derived
deterministically so reconciliation can compute the expected set. Identifier length
stays well under Postgres's 63-char limit for realistic collection names; names are
truncated-with-hash if a collection name would overflow.

### Changes to `createTableFromSchema` / `buildColumnDefinition`

- Emit `PARTITION BY ...` on the parent `CREATE TABLE`.
- Partition-key columns are forced `NOT NULL` (PK requirement). For `tenant`
  strategies this means **rows without a tenant cannot exist in a partitioned
  collection** — intentional, matches strict tenancy.
- No inline `PRIMARY KEY` on the id column; instead a table-level composite PK per the
  table above. Inline `UNIQUE` on a column becomes a table-level
  `UNIQUE (col, <partition keys>)`. Unique indexes already get `tenant_Id` appended in
  multi-tenant mode ([schemaManager.ts:1706]); the same append logic extends to the
  time field for time strategies.
- Always create a `DEFAULT` partition (safety net for races / unexpected keys).
- Indexes — including HNSW vector indexes — are created on the parent; Postgres
  propagates them to all partitions. `syncTableColumns` ALTERs propagate automatically.
- `SERIAL`/`BIGSERIAL` (AUTOINCREMENT) defaults live on the parent and work unchanged.

### Query layer

**No changes.** Same logical table, same Drizzle object built by
`createOrUpdateModel`, same `SchemaManager` maps keyed by collection name, same
`ItemsService`. `getPrimaryKey()` continues to return `id` — the composite PK is a
physical-uniqueness detail; `id` remains the API identifier (UUID/SUID collisions
across partitions are not a practical concern). Partition pruning comes free from the
injected `tenant_Id` filter and caller date filters. Lookups by bare `id` (e.g.
global-admin reads) scan every partition's id index — negligible at tens of partitions.

## Foreign keys

- **Outbound** (partitioned collection → other tables, incl. `tenant_Id →
  baasix_Tenant`): unchanged; supported by Postgres.
- **Inbound** (`BelongsTo` targeting a partitioned collection): the referenced
  constraint must contain the partition key.
  - Target strategy `tenant`, child has `tenant_Id` → composite FK
    `("<fk>", "tenant_Id") REFERENCES target ("id", "tenant_Id")`. Also encodes the
    same-tenant invariant. `ensureForeignKeyConstraints` detects partitioned targets
    and emits this form.
  - Target strategy includes `time`, or child lacks `tenant_Id` → **skip the FK** with
    a logged warning (children cannot reasonably store the parent's timestamp).
    Relation queries are unaffected (joins are on id); integrity remains app-level,
    as it already is for skipped constraints today.

## Partition lifecycle

- **Tenant created** → create that tenant's partition (and, for `tenant+time`, its
  current + `premake` time sub-partitions + per-tenant default) in every
  tenant-partitioned collection. This runs in a **POST-COMMIT** `items.create.after`
  hook (partition DDL is a side effect that must not be rolled back with the row, and
  must not hold DDL locks inside the create transaction). Consequently it is **not**
  transactional with the tenant insert: if provisioning fails, the tenant row already
  exists and the client receives an error, but the collection's `DEFAULT` partition
  keeps absorbing that tenant's writes and startup/daily reconciliation self-heals the
  missing per-tenant partitions on the next pass.
- **Tenant deleted** → for every tenant-partitioned collection, `DROP TABLE` the
  tenant's partition (subtree for `tenant+time`) **before** deleting the
  `baasix_Tenant` row (satisfies FK ordering). Immediate, irreversible bulk erase —
  chosen deliberately; it turns tenant offboarding into a metadata operation. Two
  safeguards apply. **(1) Authorization:** the drop runs in an `items.delete`
  before-hook that fires ahead of the delete permission check, so the hook itself
  verifies the caller is an administrator before dropping — an authenticated
  non-admin who would be rejected with 403 never triggers the `DROP TABLE … CASCADE`.
  A legitimately-authorized non-admin still deletes the tenant row (partitions remain,
  empty, and are ignored/healed by reconciliation). **(2) Transactional:** the DROP
  DDL runs through the SAME transaction as the row delete (PG DDL is transactional), so
  if the delete subsequently fails (permission, 404, or an `ON DELETE RESTRICT` FK) the
  drops roll back and the partitions — and their data — survive intact.
- **Time maintenance** — partitions for the current period + `premake` future periods
  are ensured (a) during startup reconciliation and (b) by a lightweight daily
  interval timer inside `SchemaManager`. The `DEFAULT` partition catches anything that
  slips through; no data is ever lost to a missing partition.
- **Startup reconciliation** (in `SchemaManager.initialize()`): compute expected
  partition set for each partitioned collection (tenants × periods) and create any
  missing ones. Log a warning with row count if a `DEFAULT` partition is non-empty.
- **No retention automation.** Old time partitions accumulate (e.g. one per year)
  until an operator manually drops or detaches them. Documented, not automated.
- **Stranded-DEFAULT limitation.** Postgres will not `CREATE PARTITION ... FOR VALUES`
  for a key that already has matching rows sitting in the `DEFAULT` partition — the new
  partition's bound would conflict with existing default rows, so the CREATE errors.
  Reconciliation therefore logs an error for that collection on **every** pass until the
  stranded rows are moved out of the default by hand. Runbook: during a maintenance
  window, `INSERT INTO "parent" SELECT * FROM "parent__default" WHERE "tenant_Id" = '<id>'`
  (this re-routes the rows into the now-creatable partition — create it first, or move
  then let reconciliation create it), then `DELETE FROM "parent__default" WHERE "tenant_Id" = '<id>'`.

## Converting an existing populated table (flag added/changed/removed)

Inline copy-and-swap, one transaction, in `syncSchema`:

1. **Pre-checks:** partition-key columns contain no NULLs (else abort with row count
   in the error); target layout valid.
2. `LOCK TABLE "col" IN ACCESS EXCLUSIVE MODE` — writes block for the duration
   (maintenance-window operation; roughly minutes per few million rows).
3. Create `"col__part_new"` with the new layout + full partition set; `INSERT INTO ...
   SELECT * FROM "col"`.
4. Rename `"col"` → `"col__preparted"`, `"col__part_new"` → `"col"`. Commit.
5. **After the swap transaction commits**, rebuild secondary indexes, vector (HNSW)
   indexes, and inbound/outbound FKs against the promoted table (same helpers as the
   create path). This is deliberately OUTSIDE the swap txn: there is a brief window
   right after promotion where the new table has no secondary indexes / FKs; any failure
   here is logged per-object and healed by the next schema sync — it does not roll back
   (or endanger) the already-committed data swap.

- The pre-conversion table survives as `"col__preparted"` until manually dropped.
- The data swap (steps 2–4) rolls back atomically on failure; the original table is
  never at risk. Index/FK rebuild (step 5) is post-commit and self-healing, not atomic
  with the swap.
- **Converting a populated table to a `time` strategy** routes existing rows whose
  `timeField` predates the current period into the `DEFAULT` partition. v1 does **not**
  backfill historical period partitions; create/detach older periods manually if needed.
- Removing `partitioning` runs the same machinery toward a plain table (simple PK and
  FKs restored). Backup table name: `"col__prepart_rollback"`.

## Error handling summary

- Validation errors reject the schema update with actionable messages.
- Conversion: the data swap rolls back atomically; NULL-key rows reported with counts.
  Post-commit index/FK rebuild failures are logged and healed by the next sync.
- Tenant-create partition provisioning runs in a **post-commit** hook — on failure the
  tenant row already exists, the client receives an error, and the `DEFAULT` partition +
  reconciliation self-heal the missing partitions (NOT transactional with the insert).
- Tenant-delete partition drop is guarded: it runs only for administrator callers
  (skips ahead of the 403 for non-admins) and executes inside the delete transaction, so
  a failed delete rolls the drops back.
- Reconciliation/maintenance failures log per-collection and continue (startup never
  hard-fails because one partition could not be created; DEFAULT partition absorbs
  writes meanwhile). A stored partitioning config over a physically plain table (drift)
  is warned-and-skipped, never fatal to startup.

## Testing (`test/partitioning.test.js`)

1. `tenant` collection → parent + per-tenant + default partitions exist
   (`pg_partition_tree`); rows land in the right partitions.
2. Tenant create → partitions appear across partitioned collections; tenant delete →
   partitions dropped, other tenants' data intact, tenant row deleted after.
3. `time` collection (single-tenant mode) with `year` interval → current + premade
   partitions; reconciliation creates missing period on simulated clock advance
   (inject period, don't mock `Date` globally).
4. Conversion of a populated table: row count/ids preserved, indexes and FKs correct,
   `__preparted` backup exists; NULL `tenant_Id` rows abort conversion cleanly.
5. Per-tenant uniqueness (same value allowed in two tenants, rejected within one).
6. Composite inbound FK enforced (cross-tenant reference rejected); FK skipped with
   warning for time-partitioned target.
7. Un-partition roundtrip returns a plain table with data intact.
8. Validation: flag rejected when `MULTI_TENANT` off (tenant strategies), on system
   collections, on bad `timeField`.

## Out of scope (v1)

- Automated retention (drop/detach old periods) — future opt-in.
- Background/batched conversion for very large tables (Approach B) — the DDL
  primitives are shared; can be layered on later.
- Partitioning system collections (`baasix_AuditLog` etc.) — the mechanism supports it,
  but v1 keeps system schemas untouched; revisit once user-collection support ships.
- Sub-partition granularity per tenant (all tenants share the collection's interval).
