import postgres from "postgres";
import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { getSqlClient } from "../baasix/utils/db.js";
import { schemaManager } from "../baasix/utils/schemaManager.js";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

let app;
let adminToken;
const authed = (req) => req.set("Authorization", `Bearer ${adminToken}`);
const thisYear = new Date().getUTCFullYear();

// Same UTC-pinning rationale as test/partitioning.test.js: this dev machine's PG session
// timezone defaults to Asia/Kolkata, which always renders partition bounds with a full
// '+05:30' offset (the shape `new Date()` parses natively) — the bare '+00'/UTC-rendered
// bound shape never gets exercised locally unless the session timezone is forced to UTC
// BEFORE the app's connection pool is opened (a pooled connection keeps whatever session
// TimeZone was in effect at connect time). Tests run with --runInBand, so no other suite
// shares this database concurrently; the setting is restored in afterAll regardless of
// pass/fail. All date assertions in this file use getUTC*, so running under UTC is safe.
beforeAll(async () => {
  const admin = postgres(process.env.DATABASE_URL);
  try {
    await admin.unsafe(`ALTER DATABASE ${new URL(process.env.DATABASE_URL).pathname.slice(1)} SET timezone TO 'UTC'`);
  } finally {
    await admin.end();
  }

  await destroyAllTablesInDB();
  app = await startServerForTesting({ envOverrides: { MULTI_TENANT: "false" } });
  const login = await request(app).post("/auth/login")
    .send({ email: "admin@baasix.com", password: "admin@123" });
  adminToken = login.body.token ?? login.body.data?.token;

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

afterAll(async () => {
  const admin = postgres(process.env.DATABASE_URL);
  try {
    await admin.unsafe(`ALTER DATABASE ${new URL(process.env.DATABASE_URL).pathname.slice(1)} RESET timezone`);
  } finally {
    await admin.end();
  }
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
