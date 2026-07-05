import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, test, expect, describe } from "@jest/globals";
import { getSqlClient } from "../baasix/utils/db.js";

let app;
let adminToken;
let tenantA;
let tenantB;

const authed = (req) => req.set("Authorization", `Bearer ${adminToken}`);

beforeAll(async () => {
  await destroyAllTablesInDB();
  app = await startServerForTesting({ envOverrides: { MULTI_TENANT: "true" } });
  const login = await request(app).post("/auth/login")
    .send({ email: "admin@baasix.com", password: "admin@123" });
  adminToken = login.body.token ?? login.body.data?.token;
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
