import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";
import env from "../baasix/utils/env";

/**
 * A4 — write-side mass assignment.
 *
 * A non-admin role with create/update permission and fields:["*"] must NOT be able
 * to set privilege/security-sensitive fields that are never legitimately client-set
 * through the data API: role_Id, tenant_Id, userCreated_Id/userUpdated_Id,
 * emailVerified, and hidden fields (password). "*" expands to all columns including
 * these, so the permission layer must deny them explicitly for non-admins.
 *
 * Legitimate fields (firstName, email, etc.) must still be writable.
 */

let app;
let adminToken;
let userToken;
let testUserId;
let userRoleId;
let adminRoleId;

beforeAll(async () => {
  await destroyAllTablesInDB();
  app = await startServerForTesting();

  const adminLogin = await request(app)
    .post("/auth/login")
    .send({ email: "admin@baasix.com", password: "admin@123" });
  adminToken = adminLogin.body.token;

  // Look up the administrator role id (target for the escalation attempt)
  const roles = await request(app)
    .get("/items/baasix_Role")
    .set("Authorization", `Bearer ${adminToken}`);
  adminRoleId = roles.body.data.find((r) => r.name === "administrator").id;

  // Test role
  const roleRes = await request(app)
    .post("/items/baasix_Role")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: "massassign", description: "Mass-assignment test role" });
  userRoleId = roleRes.body.data.id;

  // Test user
  const userRes = await request(app)
    .post("/items/baasix_User")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ firstName: "Mass", lastName: "Assign", email: "massassign@test.com", password: "userpassword" });
  testUserId = userRes.body.data.id;

  await request(app)
    .post("/items/baasix_UserRole")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ user_Id: testUserId, role_Id: userRoleId });

  // Grant the role broad item permissions WITH fields:["*"] on the two sensitive
  // system collections — this is the realistic "developer enabled writes" config.
  const grant = (collection, action) =>
    request(app)
      .post("/permissions")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ role_Id: userRoleId, collection, action, fields: ["*"] });

  await grant("baasix_UserRole", "create");
  await grant("baasix_UserRole", "read");
  await grant("baasix_User", "update");
  await grant("baasix_User", "read");

  await request(app).post("/permissions/reload").set("Authorization", `Bearer ${adminToken}`);

  const userLogin = await request(app)
    .post("/auth/login")
    .send({ email: "massassign@test.com", password: "userpassword" });
  userToken = userLogin.body.token;
});

afterAll(async () => {
  if (app?.server) await new Promise((r) => app.server.close(r));
});

describe("A4 — mass assignment of privilege fields is denied for non-admins", () => {
  test("non-admin cannot self-promote by setting role_Id on baasix_UserRole", async () => {
    // Even with create + fields:["*"] on baasix_UserRole, granting yourself the
    // administrator role must be rejected.
    const res = await request(app)
      .post("/items/baasix_UserRole")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ user_Id: testUserId, role_Id: adminRoleId });

    expect(res.status).toBe(403);
  });

  test("non-admin cannot set emailVerified on a user via update", async () => {
    const res = await request(app)
      .patch(`/items/baasix_User/${testUserId}`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ emailVerified: true });

    expect(res.status).toBe(403);
  });

  test("non-admin cannot set password directly via the data API", async () => {
    const res = await request(app)
      .patch(`/items/baasix_User/${testUserId}`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ password: "hijacked-hash" });

    expect(res.status).toBe(403);
  });

  test("legitimate non-sensitive field updates still succeed", async () => {
    const res = await request(app)
      .patch(`/items/baasix_User/${testUserId}`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ firstName: "Renamed" });

    expect(res.status).toBe(200);
  });

  test("admin can still set privilege fields (no regression for admins)", async () => {
    const res = await request(app)
      .post("/items/baasix_UserRole")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ user_Id: testUserId, role_Id: userRoleId });

    expect([200, 201]).toContain(res.status);
  });

  test("opt-in: explicitly granting role_Id lets a delegated non-admin set it", async () => {
    // Create a separate role whose permission EXPLICITLY names role_Id (a
    // deliberate "user-manager"-style delegation), and verify it can assign roles.
    const mgrRoleRes = await request(app)
      .post("/items/baasix_Role")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "usermanager", description: "Delegated role manager" });
    const mgrRoleId = mgrRoleRes.body.data.id;

    const mgrUserRes = await request(app)
      .post("/items/baasix_User")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ firstName: "Mgr", lastName: "User", email: "usermgr@test.com", password: "userpassword" });
    const mgrUserId = mgrUserRes.body.data.id;
    await request(app)
      .post("/items/baasix_UserRole")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ user_Id: mgrUserId, role_Id: mgrRoleId });

    // Explicit grant: fields includes role_Id by name (not just "*")
    await request(app)
      .post("/permissions")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ role_Id: mgrRoleId, collection: "baasix_UserRole", action: "create", fields: ["*", "role_Id", "user_Id"] });
    await request(app).post("/permissions/reload").set("Authorization", `Bearer ${adminToken}`);

    const mgrLogin = await request(app)
      .post("/auth/login")
      .send({ email: "usermgr@test.com", password: "userpassword" });
    const mgrToken = mgrLogin.body.token;

    const res = await request(app)
      .post("/items/baasix_UserRole")
      .set("Authorization", `Bearer ${mgrToken}`)
      .send({ user_Id: testUserId, role_Id: userRoleId });

    // Explicitly-granted privilege field → allowed
    expect([200, 201]).toContain(res.status);
  });

  test("password stays denied even when explicitly named in fields", async () => {
    // Grant the test role update on baasix_User with password EXPLICITLY listed —
    // it must STILL be rejected (credentials only via the auth flow).
    await request(app)
      .post("/permissions")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ role_Id: userRoleId, collection: "baasix_User", action: "update", fields: ["*", "password"] });
    await request(app).post("/permissions/reload").set("Authorization", `Bearer ${adminToken}`);

    const res = await request(app)
      .patch(`/items/baasix_User/${testUserId}`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ password: "still-hijacked" });

    expect(res.status).toBe(403);
  });
});

describe("PROTECT_PRIVILEGE_FIELDS=allow-password (delegated password reset)", () => {
  // A dedicated user + role so we don't disturb the default-mode tests above.
  let mgrToken;
  let subUserId;
  let mgrRoleId;

  beforeAll(async () => {
    // Subject whose password the delegated role will reset.
    // Needs a role assignment so it can actually log in (to prove the hash works).
    const subRoleRes = await request(app)
      .post("/items/baasix_Role")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "subrole", description: "Subject role" });
    const subRes = await request(app)
      .post("/items/baasix_User")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ firstName: "Sub", lastName: "Ordinate", email: "sub@test.com", password: "originalpw" });
    subUserId = subRes.body.data.id;
    await request(app)
      .post("/items/baasix_UserRole")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ user_Id: subUserId, role_Id: subRoleRes.body.data.id });

    // Delegated "user-manager"-style role with password EXPLICITLY granted
    const roleRes = await request(app)
      .post("/items/baasix_Role")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "pwmanager", description: "Delegated password manager" });
    mgrRoleId = roleRes.body.data.id;

    const mgrUserRes = await request(app)
      .post("/items/baasix_User")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ firstName: "PwMgr", lastName: "User", email: "pwmgr@test.com", password: "mgrpw" });
    await request(app)
      .post("/items/baasix_UserRole")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ user_Id: mgrUserRes.body.data.id, role_Id: mgrRoleId });

    await request(app)
      .post("/permissions")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ role_Id: mgrRoleId, collection: "baasix_User", action: "update", fields: ["*", "password"] });
    await request(app).post("/permissions/reload").set("Authorization", `Bearer ${adminToken}`);

    const mgrLogin = await request(app)
      .post("/auth/login")
      .send({ email: "pwmgr@test.com", password: "mgrpw" });
    mgrToken = mgrLogin.body.token;

    // Enable the delegated-password mode for this describe block
    env.set("PROTECT_PRIVILEGE_FIELDS", "allow-password");
  });

  afterAll(() => {
    // Restore secure default so other suites/tests are unaffected
    env.set("PROTECT_PRIVILEGE_FIELDS", "true");
  });

  test("explicitly-granted password CAN be set in allow-password mode, and is hashed (login works)", async () => {
    const res = await request(app)
      .patch(`/items/baasix_User/${subUserId}`)
      .set("Authorization", `Bearer ${mgrToken}`)
      .send({ password: "reset-by-manager" });

    expect(res.status).toBe(200);

    // Proof it was hashed (not stored plaintext): the new password logs in.
    const login = await request(app)
      .post("/auth/login")
      .send({ email: "sub@test.com", password: "reset-by-manager" });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeTruthy();
  });

  test("password is still NOT grantable via '*' alone in allow-password mode", async () => {
    // A role with only fields:["*"] (no explicit password) must still be denied.
    const roleRes = await request(app)
      .post("/items/baasix_Role")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "staronly", description: "Wildcard-only role" });
    const starRoleId = roleRes.body.data.id;
    const u = await request(app)
      .post("/items/baasix_User")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ firstName: "Star", lastName: "Only", email: "staronly@test.com", password: "starpw" });
    await request(app)
      .post("/items/baasix_UserRole")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ user_Id: u.body.data.id, role_Id: starRoleId });
    await request(app)
      .post("/permissions")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ role_Id: starRoleId, collection: "baasix_User", action: "update", fields: ["*"] });
    await request(app).post("/permissions/reload").set("Authorization", `Bearer ${adminToken}`);

    const starLogin = await request(app)
      .post("/auth/login")
      .send({ email: "staronly@test.com", password: "starpw" });

    const res = await request(app)
      .patch(`/items/baasix_User/${subUserId}`)
      .set("Authorization", `Bearer ${starLogin.body.token}`)
      .send({ password: "via-wildcard" });

    expect(res.status).toBe(403);
  });
});

describe("A15 — PROTECT_IS_PUBLIC_FIELD protects isPublic on baasix_File", () => {
  let fileUserToken;
  let fileRoleId;

  beforeAll(async () => {
    env.set("PROTECT_IS_PUBLIC_FIELD", "true");

    const roleRes = await request(app)
      .post("/items/baasix_Role")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "fileuser", description: "File user role" });
    fileRoleId = roleRes.body.data.id;
    const u = await request(app)
      .post("/items/baasix_User")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ firstName: "File", lastName: "User", email: "fileuser@test.com", password: "pw" });
    await request(app)
      .post("/items/baasix_UserRole")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ user_Id: u.body.data.id, role_Id: fileRoleId });
    // Grant create on baasix_File with a broad "*" (NOT naming isPublic).
    await request(app)
      .post("/permissions")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ role_Id: fileRoleId, collection: "baasix_File", action: "create", fields: ["*"] });
    await request(app).post("/permissions/reload").set("Authorization", `Bearer ${adminToken}`);

    const login = await request(app)
      .post("/auth/login")
      .send({ email: "fileuser@test.com", password: "pw" });
    fileUserToken = login.body.token;
  });

  afterAll(() => env.set("PROTECT_IS_PUBLIC_FIELD", "false"));

  test("a fields:['*'] grant cannot set isPublic when PROTECT_IS_PUBLIC_FIELD=true", async () => {
    const res = await request(app)
      .post("/items/baasix_File")
      .set("Authorization", `Bearer ${fileUserToken}`)
      .send({ filename: "x.txt", isPublic: true });
    expect(res.status).toBe(403);
  });
});
