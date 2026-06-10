import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

/**
 * A17b — public settings use an allow-list, not a deny-list.
 *
 * Only known client-safe fields are exposed publicly; SMTP credentials and any
 * non-allow-listed field (metadata, modules, or a hypothetical secret) are
 * withheld — so a newly-added setting can't accidentally leak.
 */

let app;
let adminToken;

beforeAll(async () => {
  await destroyAllTablesInDB();
  app = await startServerForTesting();

  const adminLogin = await request(app)
    .post("/auth/login")
    .send({ email: "admin@baasix.com", password: "admin@123" });
  adminToken = adminLogin.body.token;

  // Set a mix of safe and sensitive-ish fields via the admin PATCH.
  await request(app)
    .patch("/settings")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      project_name: "Allowlist Test",
      smtp_user: "secret-user",
      smtp_pass: "secret-pass",
      metadata: { internalSecret: "do-not-leak" },
    });
});

afterAll(async () => {
  if (app?.server) await new Promise((r) => app.server.close(r));
});

describe("A17b — public /settings allow-list", () => {
  test("exposes client-safe fields", async () => {
    const res = await request(app).get("/settings");
    expect(res.status).toBe(200);
    expect(res.body.data.project_name).toBe("Allowlist Test");
  });

  test("withholds SMTP credentials and non-allow-listed fields", async () => {
    const res = await request(app).get("/settings");
    const data = res.body.data;
    expect(data.smtp_user).toBeUndefined();
    expect(data.smtp_pass).toBeUndefined();
    // metadata is NOT in the allow-list → must not be exposed (even though it
    // isn't on the old SMTP deny-list).
    expect(data.metadata).toBeUndefined();
    // Defense-in-depth: the secret value must not appear anywhere in the response.
    expect(JSON.stringify(res.body)).not.toMatch(/do-not-leak/);
  });
});
