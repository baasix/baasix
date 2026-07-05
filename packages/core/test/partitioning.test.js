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
