import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

/**
 * A17b — public settings use an allow-list, not a deny-list.
 *
 * Only known client-safe fields are exposed publicly; SMTP credentials and any
 * non-allow-listed field are withheld — so a newly-added setting can't
 * accidentally leak.
 *
 * `modules` and `metadata` ARE allow-listed: both are client-consumed and both
 * are already returned in full by the public, unauthenticated `GET /`
 * (getProjectInfo), so withholding them here bought no secrecy while breaking
 * module-gated menus. Consequence: metadata is public — apps must not store
 * secrets in it.
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
      smtp_pass: "do-not-leak",
      metadata: { publicFlag: true },
      modules: { features: { logbook: true } },
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

  test("exposes modules and metadata (client-consumed, already public via GET /)", async () => {
    const res = await request(app).get("/settings");
    const data = res.body.data;
    // Feature gating in the admin/app clients reads identity.settings.modules.*
    expect(data.modules).toEqual({ features: { logbook: true } });
    expect(data.metadata).toEqual({ publicFlag: true });
  });

  test("withholds SMTP credentials and non-allow-listed fields", async () => {
    const res = await request(app).get("/settings");
    const data = res.body.data;
    expect(data.smtp_user).toBeUndefined();
    expect(data.smtp_pass).toBeUndefined();
    // Defense-in-depth: the secret value must not appear anywhere in the response.
    expect(JSON.stringify(res.body)).not.toMatch(/do-not-leak/);
  });
});
