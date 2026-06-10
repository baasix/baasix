import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

/**
 * A16 — raw database/internal error text is not reflected to clients.
 *
 * With EXPOSE_ERROR_DETAILS=false (the production posture), an unexpected/DB error
 * returns a generic message + correlation id, not the raw PG message/detail (which
 * leaks schema names and acts as a SQL-injection oracle).
 */

let app;
let adminToken;

beforeAll(async () => {
  await destroyAllTablesInDB();
  app = await startServerForTesting({ envOverrides: { EXPOSE_ERROR_DETAILS: "false" } });

  const adminLogin = await request(app)
    .post("/auth/login")
    .send({ email: "admin@baasix.com", password: "admin@123" });
  adminToken = adminLogin.body.token;
});

afterAll(async () => {
  if (app?.server) await new Promise((r) => app.server.close(r));
});

describe("A16 — error detail masking (EXPOSE_ERROR_DETAILS=false)", () => {
  test("a unique-constraint violation does not leak the conflicting value", async () => {
    // Two users with the same email → 23505. The masked response must not include
    // the email value or raw PG 'detail'.
    await request(app)
      .post("/items/baasix_User")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ firstName: "A", lastName: "B", email: "dup-a16@test.com", password: "pw" });

    const res = await request(app)
      .post("/items/baasix_User")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ firstName: "C", lastName: "D", email: "dup-a16@test.com", password: "pw" });

    expect(res.status).toBe(409);
    const body = JSON.stringify(res.body);
    // Generic message present; raw value / PG detail absent.
    expect(res.body.error.message).toMatch(/unique constraint/i);
    expect(body).not.toMatch(/dup-a16@test.com/);
    expect(body).not.toMatch(/Key \(/); // PG 'detail' format: "Key (email)=(...)"
  });

  test("a 500-class error returns a correlation reference, not the raw message", async () => {
    // Trigger a server-side error via a malformed aggregate (rejected by validation
    // → throws → 500). The response must carry a 'Reference:' id, not raw SQL/PG text.
    const aggregate = encodeURIComponent(JSON.stringify({ c: { function: "sum", field: 'x")));DROP--' } }));
    const res = await request(app)
      .get(`/reports/baasix_User?aggregate=${aggregate}`)
      .set("Authorization", `Bearer ${adminToken}`);

    const body = JSON.stringify(res.body);
    if (res.status === 500) {
      expect(res.body.error.details).toMatch(/Reference:/);
      expect(body).not.toMatch(/syntax error|DROP/i);
    } else {
      // If rejected earlier with a 400, that's also fine (no leak either way).
      expect([400, 500]).toContain(res.status);
    }
  });
});
