import postgres from "postgres";
import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe, jest } from "@jest/globals";
import { getSqlClient } from "../baasix/utils/db.js";
import { schemaManager } from "../baasix/utils/schemaManager.js";
import { tenantPartitionName, partitionName } from "../baasix/utils/partitionUtils.js";

let app;
let adminToken;
let tenantA;
let tenantB;

const authed = (req) => req.set("Authorization", `Bearer ${adminToken}`);

// Regression coverage for the bare ±HH-offset bug (schemaManager.parseRangeStart): Postgres
// renders partition bounds (pg_get_expr on relpartbound) per SESSION timezone. This dev
// machine's PG default is Asia/Kolkata, which always renders a full '+05:30' offset — the one
// shape `new Date()` parses natively — so the bug never showed up locally. To exercise the
// UTC-rendering path ('...+00') deterministically, force the whole suite's session timezone to
// UTC via `ALTER DATABASE ... SET timezone` BEFORE the app's connection pool is created: once a
// pooled connection is established it keeps whatever session TimeZone was in effect at connect
// time, so the ALTER must land before `startServerForTesting()` opens the pool, not mid-suite.
// Tests run with --runInBand, so no other suite shares this database concurrently; the setting
// is restored in the top-level afterAll regardless of pass/fail. No test in this file depends
// on non-UTC wall-clock semantics (all date assertions use getUTC*), so running the entire file
// under UTC is safe.
beforeAll(async () => {
  const admin = postgres(process.env.DATABASE_URL);
  try {
    await admin.unsafe(`ALTER DATABASE ${new URL(process.env.DATABASE_URL).pathname.slice(1)} SET timezone TO 'UTC'`);
  } finally {
    await admin.end();
  }

  await destroyAllTablesInDB();
  app = await startServerForTesting({ envOverrides: { MULTI_TENANT: "true" } });
  const login = await request(app).post("/auth/login")
    .send({ email: "admin@baasix.com", password: "admin@123" });
  adminToken = login.body.token ?? login.body.data?.token;
});

afterAll(async () => {
  const admin = postgres(process.env.DATABASE_URL);
  try {
    await admin.unsafe(`ALTER DATABASE ${new URL(process.env.DATABASE_URL).pathname.slice(1)} RESET timezone`);
  } finally {
    await admin.end();
  }
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

  test("PATCH with invalid partitioning is rejected and not persisted", async () => {
    // Create a valid collection first
    const createRes = await authed(request(app).post("/schemas")).send({
      collectionName: "good_part",
      schema: {
        name: "GoodPart",
        fields: { id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } } },
      },
    });
    expect(createRes.status).toBe(201);

    // Attempt to PATCH in an invalid partitioning strategy
    const patchRes = await authed(request(app).patch("/schemas/good_part")).send({
      schema: {
        name: "GoodPart",
        fields: { id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } } },
        partitioning: { strategy: "hash" },
      },
    });
    expect(patchRes.status).toBe(400);
    expect(JSON.stringify(patchRes.body)).toMatch(/strategy/i);

    // The invalid config must not have been persisted
    const getRes = await authed(request(app).get("/schemas/good_part"));
    expect(getRes.status).toBe(200);
    expect(JSON.stringify(getRes.body.data.schema)).not.toMatch(/hash/);
  });
});

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

describe("FKs to partitioned collections", () => {
  beforeAll(async () => {
    const res = await authed(request(app).post("/schemas")).send({
      collectionName: "part_order_lines",
      schema: {
        name: "PartOrderLine",
        fields: {
          id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
          qty: { type: "Integer" },
          // order_Id is declared explicitly (not just inferred from the relation) so it is
          // a first-class writable column: relying on relation-only inference to backfill
          // the FK column into schema.fields is a separate, pre-existing gap unrelated to
          // partitioning and out of scope here.
          order_Id: { type: "UUID", allowNull: true },
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
    // pg_get_constraintdef only re-quotes identifiers that need it, so plain
    // lowercase names like "id" and "part_orders" come back unquoted.
    expect(fk.def).toContain('REFERENCES part_orders(id, "tenant_Id")');
  });

  test("cross-tenant reference is rejected by the FK", async () => {
    const orders = await authed(request(app).get("/items/part_orders")).query({ limit: 50 });
    const anOrder = (orders.body.data ?? orders.body).find((o) => o.tenant_Id === tenantA);
    const res = await authed(request(app).post("/items/part_order_lines"))
      .send({ qty: 1, order_Id: anOrder.id, tenant_Id: tenantB });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

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

  test("warns when rows land in the DEFAULT partition (missed their tenant partition)", async () => {
    const sql = getSqlClient();
    // A tenant id with no baasix_Tenant row and therefore no partition. We bypass the
    // FK (via session_replication_role, superuser-only) purely to plant an orphan row —
    // reconcilePartitions() must never be able to create a partition for a tenant that
    // isn't in baasix_Tenant, so a real tenant insert isn't used/needed here; this also
    // avoids Postgres's "updated partition constraint for default partition would be
    // violated" error that a real tenant row would trigger once its partition gets created.
    const orphanTenantId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

    await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL session_replication_role = replica`);
      await tx.unsafe(
        `INSERT INTO "part_orders" (id, sku, amount, "tenant_Id") ` +
        `VALUES (gen_random_uuid(), 'SKU-ORPHAN', 1, '${orphanTenantId}')`
      );
    });

    try {
      const [row] = await sql`
        SELECT tableoid::regclass::text AS part FROM "part_orders" WHERE sku = 'SKU-ORPHAN'`;
      expect(row.part.replace(/"/g, "")).toBe("part_orders__default");

      const warnSpy = jest.spyOn(console, "warn");
      await schemaManager.reconcilePartitions();

      const matched = warnSpy.mock.calls.some(
        (args) => /part_orders__default/.test(args.join(" ")) && /holds \d+ rows/.test(args.join(" "))
      );
      expect(matched).toBe(true);
      warnSpy.mockRestore();
    } finally {
      await sql`DELETE FROM "part_orders" WHERE sku = 'SKU-ORPHAN'`;
    }
  });
});

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

describe("conversion long-name canonical partition rename", () => {
  // 48-char name: partitionName(name, ['part_new']) is 58 (fits), but the temp tenant
  // partition is 70 → hash-truncated, so it does NOT start with the temp prefix. The old
  // prefix-strip rename skipped it, leaving a non-canonical partition and breaking later
  // CREATE/DROP. Bound-derived renaming must land the canonical name regardless.
  const collection = "conv_long_collection_name_for_canonical_rename_x"; // exactly 48 chars

  beforeAll(async () => {
    expect(collection.length).toBe(48);
    await authed(request(app).post("/schemas")).send({
      collectionName: collection,
      schema: {
        name: "ConvLong",
        fields: {
          id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
          ref: { type: "String", allowNull: false },
        },
      },
    });
    for (let i = 0; i < 3; i++) {
      await authed(request(app).post(`/items/${collection}`)).send({ ref: `LA-${i}`, tenant_Id: tenantA });
      await authed(request(app).post(`/items/${collection}`)).send({ ref: `LB-${i}`, tenant_Id: tenantB });
    }
  });

  test("converts and names partitions canonically (bound-derived, not prefix-strip)", async () => {
    const sql = getSqlClient();
    const [{ c: before }] = await sql.unsafe(`SELECT COUNT(*)::int AS c FROM "${collection}"`);
    expect(before).toBe(6);

    const res = await authed(request(app).patch(`/schemas/${collection}`)).send({
      schema: {
        name: "ConvLong",
        fields: {
          id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
          ref: { type: "String", allowNull: false },
        },
        partitioning: { strategy: "tenant" },
      },
    });
    expect(res.status).toBeLessThan(300);

    // relkind 'p' and row count preserved
    const [parent] = await sql`SELECT relkind FROM pg_class WHERE relname = ${collection}`;
    expect(parent.relkind).toBe("p");
    const [{ c: after }] = await sql.unsafe(`SELECT COUNT(*)::int AS c FROM "${collection}"`);
    expect(after).toBe(before);

    // Partitions carry CANONICAL names — computed via the SAME helpers the app uses.
    const parts = await sql.unsafe(
      `SELECT relid::regclass::text AS name FROM pg_partition_tree('"${collection}"'::regclass) WHERE isleaf`);
    const names = parts.map((p) => p.name.replace(/"/g, ""));
    const canonA = tenantPartitionName(collection, tenantA);
    const canonB = tenantPartitionName(collection, tenantB);
    const canonDefault = partitionName(collection, ["default"]);
    expect(names).toContain(canonA);
    expect(names).toContain(canonB);
    expect(names).toContain(canonDefault);
    // and NO leftover temp-named / hash-suffixed partition survives
    expect(names.some((n) => n.includes("part_new"))).toBe(false);

    // rows routed into tenant partitions, not the default
    const [{ c: inDefault }] = await sql.unsafe(`SELECT COUNT(*)::int AS c FROM "${canonDefault}"`);
    expect(inDefault).toBe(0);
  });

  test("reconcilePartitions runs clean — no 'would overlap' for this collection", async () => {
    const errSpy = jest.spyOn(console, "error");
    await schemaManager.reconcilePartitions();
    const badForThis = errSpy.mock.calls.filter((args) => {
      const s = args.join(" ");
      return s.includes(collection) && /overlap/i.test(s);
    });
    expect(badForThis).toEqual([]);
    errSpy.mockRestore();
  });

  test("deleting a fresh tenant actually drops its (canonical) partition", async () => {
    const sql = getSqlClient();
    const created = await authed(request(app).post("/items/baasix_Tenant")).send({ name: "ConvLong Tenant C" });
    const tenantC = created.body.data?.id ?? created.body.id;
    const canonC = tenantPartitionName(collection, tenantC);

    // its partition was created on tenant creation
    let rows = await sql`SELECT 1 FROM pg_class WHERE relname = ${canonC}`;
    expect(rows.length).toBe(1);

    // insert a row for tenant C, then delete tenant C
    await authed(request(app).post(`/items/${collection}`)).send({ ref: "LC-0", tenant_Id: tenantC });
    const del = await authed(request(app).delete(`/items/baasix_Tenant/${tenantC}`));
    expect(del.status).toBeLessThan(300);

    // the canonical partition (and tenant C's data) is gone — not a no-op on a stale name
    rows = await sql`SELECT 1 FROM pg_class WHERE relname = ${canonC}`;
    expect(rows.length).toBe(0);
  });
});

describe("conversion drops schema field while enabling partitioning", () => {
  // colList must be the INTERSECTION of old and new columns. A field removed from the schema
  // in the same PATCH is physically still on the old table but absent from the temp table;
  // copying it would blow up the INSERT. It must be skipped (data stays in the backup).
  const collection = "conv_drop_field";

  beforeAll(async () => {
    await authed(request(app).post("/schemas")).send({
      collectionName: collection,
      schema: {
        name: "ConvDropField",
        fields: {
          id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
          ref: { type: "String", allowNull: false },
          legacy_note: { type: "String", allowNull: true },
        },
      },
    });
    await authed(request(app).post(`/items/${collection}`))
      .send({ ref: "keep-1", legacy_note: "drop-me-1", tenant_Id: tenantA });
    await authed(request(app).post(`/items/${collection}`))
      .send({ ref: "keep-2", legacy_note: "drop-me-2", tenant_Id: tenantB });
  });

  test("removing a field AND enabling partitioning succeeds; dropped column absent, backup retains it", async () => {
    const sql = getSqlClient();
    // PATCH: legacy_note removed from schema.fields, partitioning enabled — same request.
    const res = await authed(request(app).patch(`/schemas/${collection}`)).send({
      schema: {
        name: "ConvDropField",
        fields: {
          id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
          ref: { type: "String", allowNull: false },
        },
        partitioning: { strategy: "tenant" },
      },
    });
    expect(res.status).toBeLessThan(300);

    const [parent] = await sql`SELECT relkind FROM pg_class WHERE relname = ${collection}`;
    expect(parent.relkind).toBe("p");

    // row count preserved
    const [{ c }] = await sql.unsafe(`SELECT COUNT(*)::int AS c FROM "${collection}"`);
    expect(c).toBe(2);

    // dropped column is not present on the new table
    const newCols = await sql.unsafe(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = '${collection}' AND table_schema = 'public'`);
    expect(newCols.map((r) => r.column_name)).not.toContain("legacy_note");

    // ref data survives on the new table
    const refs = await sql.unsafe(`SELECT ref FROM "${collection}" ORDER BY ref`);
    expect(refs.map((r) => r.ref)).toEqual(["keep-1", "keep-2"]);

    // the backup still holds legacy_note values (dropped-field data is recoverable)
    const backupName = partitionName(collection, ["preparted"]);
    const backup = await sql.unsafe(
      `SELECT legacy_note FROM "${backupName}" ORDER BY legacy_note`);
    expect(backup.map((r) => r.legacy_note)).toEqual(["drop-me-1", "drop-me-2"]);
  });
});

describe("conversion to time strategy under a UTC session timezone", () => {
  // See the top-level beforeAll/afterAll: this whole file's session timezone is forced to UTC
  // before the app's connection pool is created, specifically so this suite can exercise the
  // '...+00'-rendered partition bound shape (as opposed to this dev machine's PG default of
  // Asia/Kolkata, which always renders a full '+05:30' offset).
  const collection = "conv_time_orders";

  beforeAll(async () => {
    await authed(request(app).post("/schemas")).send({
      collectionName: collection,
      schema: {
        name: "ConvTimeOrder",
        fields: {
          id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
          ref: { type: "String", allowNull: false },
        },
      },
    });
    for (let i = 0; i < 4; i++) {
      await authed(request(app).post(`/items/${collection}`)).send({ ref: `T-${i}` });
    }
  });

  test("session reports UTC for the duration of this suite", async () => {
    const sql = getSqlClient();
    const [{ tz }] = await sql`SELECT current_setting('TimeZone') AS tz`;
    expect(tz).toBe("UTC");
  });

  test("converts to time strategy with canonical partition names and no skip-warnings", async () => {
    const sql = getSqlClient();
    const [{ c: before }] = await sql.unsafe(`SELECT COUNT(*)::int AS c FROM "${collection}"`);
    expect(before).toBe(4);

    const warnSpy = jest.spyOn(console, "warn");
    const res = await authed(request(app).patch(`/schemas/${collection}`)).send({
      schema: {
        name: "ConvTimeOrder",
        fields: {
          id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
          ref: { type: "String", allowNull: false },
        },
        partitioning: { strategy: "time", interval: "year", premake: 0 },
      },
    });
    expect(res.status).toBeLessThan(300);

    const [parent] = await sql`SELECT relkind FROM pg_class WHERE relname = ${collection}`;
    expect(parent.relkind).toBe("p");
    const [{ c: after }] = await sql.unsafe(`SELECT COUNT(*)::int AS c FROM "${collection}"`);
    expect(after).toBe(before);

    const year = new Date().getUTCFullYear();
    const parts = await sql.unsafe(
      `SELECT relid::regclass::text AS name FROM pg_partition_tree('"${collection}"'::regclass) WHERE isleaf`);
    const names = parts.map((p) => p.name.replace(/"/g, ""));
    // canonical time-range partition name, derived from the (UTC-rendered) bound
    expect(names).toContain(`${collection}__y${year}`);
    expect(names).toContain(partitionName(collection, ["default"]));

    // No "Could not derive canonical name" skip-warning fired for this collection — i.e. the
    // bare '+00'/UTC-rendered bound parsed correctly instead of falling through to skip-with-warn.
    const badForThis = warnSpy.mock.calls.filter((args) => {
      const s = args.join(" ");
      return s.includes(collection) && /Could not derive canonical name/i.test(s);
    });
    expect(badForThis).toEqual([]);
    warnSpy.mockRestore();
  });
});
