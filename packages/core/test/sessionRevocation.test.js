import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

/**
 * A10 — sessions are revoked on password change/reset.
 *
 * After a password change, any pre-existing session/token must stop working, so a
 * stolen or old session can't survive the change. The user re-authenticates with
 * the new password.
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

  // A user with a role so it can log in / use /auth/me
  const roleRes = await request(app)
    .post("/items/baasix_Role")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: "revuser", description: "Session-revocation test role" });
  const userRes = await request(app)
    .post("/items/baasix_User")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ firstName: "Rev", lastName: "User", email: "rev@test.com", password: "originalpw" });
  await request(app)
    .post("/items/baasix_UserRole")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ user_Id: userRes.body.data.id, role_Id: roleRes.body.data.id });
});

afterAll(async () => {
  if (app?.server) await new Promise((r) => app.server.close(r));
});

describe("A10 — password change revokes existing sessions", () => {
  test("old token stops working after the user changes their password", async () => {
    // 1. Log in → get a session token.
    const login = await request(app)
      .post("/auth/login")
      .send({ email: "rev@test.com", password: "originalpw" });
    expect(login.status).toBe(200);
    const oldToken = login.body.token;

    // The token works now.
    const before = await request(app).get("/auth/me").set("Authorization", `Bearer ${oldToken}`);
    expect(before.status).toBe(200);

    // 2. Change the password using that session.
    const change = await request(app)
      .post("/auth/password/change")
      .set("Authorization", `Bearer ${oldToken}`)
      .send({ currentPassword: "originalpw", newPassword: "brand-new-pw" });
    expect(change.status).toBe(200);

    // 3. The OLD token must now be rejected (session revoked).
    const after = await request(app).get("/auth/me").set("Authorization", `Bearer ${oldToken}`);
    expect(after.status).toBe(401);

    // 4. The new password works for a fresh login.
    const reLogin = await request(app)
      .post("/auth/login")
      .send({ email: "rev@test.com", password: "brand-new-pw" });
    expect(reLogin.status).toBe(200);
    expect(reLogin.body.token).toBeTruthy();
  });
});
