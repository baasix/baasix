import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

/**
 * Tests for the optional total-count behavior on list reads.
 *
 * Behavior under test:
 *  - By default (env COUNT_BY_DEFAULT unset/true) list reads return a numeric totalCount.
 *  - Passing ?count=false skips the COUNT query and returns totalCount: null.
 *  - Passing ?count=true forces the count even when the deployment default is off.
 *  - limit=-1 (return all) with no offset derives totalCount from the result length
 *    without running a separate COUNT query.
 */

let app;
let adminToken;

const COLLECTION = "count_items";
const SEED_COUNT = 7;

beforeAll(async () => {
  await destroyAllTablesInDB();
  app = await startServerForTesting();

  const adminLogin = await request(app).post("/auth/login").send({
    email: "admin@baasix.com",
    password: "admin@123",
  });
  adminToken = adminLogin.body.token;

  // Create a simple test collection
  await request(app)
    .post("/schemas")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      collectionName: COLLECTION,
      schema: {
        name: "CountItem",
        fields: {
          id: { type: "Integer", primaryKey: true, defaultValue: { type: "AUTOINCREMENT" } },
          name: { type: "String", allowNull: false },
        },
      },
    });

  // Seed deterministic rows
  for (let i = 0; i < SEED_COUNT; i++) {
    await request(app)
      .post(`/items/${COLLECTION}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: `item-${i}` });
  }
});

afterAll(async () => {
  if (app?.server) {
    await new Promise((resolve) => app.server.close(resolve));
  }
});

const list = (qs = "") =>
  request(app)
    .get(`/items/${COLLECTION}${qs}`)
    .set("Authorization", `Bearer ${adminToken}`);

describe("count option on list reads", () => {
  test("default: returns numeric totalCount", async () => {
    const res = await list("?limit=3");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(3);
    expect(res.body.totalCount).toBe(SEED_COUNT);
  });

  test("count=false: skips count, returns totalCount null but data intact", async () => {
    const res = await list("?limit=3&count=false");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(3);
    expect(res.body.totalCount).toBeNull();
  });

  test("count=true: explicitly forces count", async () => {
    const res = await list("?limit=3&count=true");
    expect(res.status).toBe(200);
    expect(res.body.totalCount).toBe(SEED_COUNT);
  });

  test("limit=-1 with no offset: totalCount derived from result length", async () => {
    const res = await list("?limit=-1");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(SEED_COUNT);
    // Exact total, computed without a separate COUNT query
    expect(res.body.totalCount).toBe(SEED_COUNT);
  });

  test("limit=-1 with count=false still returns null (explicit override wins)", async () => {
    const res = await list("?limit=-1&count=false");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(SEED_COUNT);
    expect(res.body.totalCount).toBeNull();
  });

  test("filtered count is still accurate when enabled", async () => {
    const filter = encodeURIComponent(JSON.stringify({ name: { eq: "item-0" } }));
    const res = await list(`?filter=${filter}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.totalCount).toBe(1);
  });
});
