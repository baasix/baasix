import request from "supertest";
import jwt from "jsonwebtoken";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";
import env from "../baasix/utils/env";

/**
 * A7 — JWT algorithm pinning.
 *
 * Every jwt.verify pins algorithms:['HS256']. An attacker-forged token using a
 * different algorithm (notably `alg:none`, or HS256 signed with the wrong key)
 * must be rejected. The auth middleware then falls back to the public role
 * (unauthenticated), so a protected admin route returns 401/403 — never accepts
 * the forged identity.
 */

let app;

beforeAll(async () => {
  await destroyAllTablesInDB();
  app = await startServerForTesting();
});

afterAll(async () => {
  if (app?.server) await new Promise((r) => app.server.close(r));
});

describe("A7 — JWT algorithm pinning rejects forged tokens", () => {
  test("an alg:none unsigned token is not accepted as an admin", async () => {
    // Forge an unsigned token claiming an admin-ish identity.
    const forged = jwt.sign(
      { id: "00000000-0000-0000-0000-000000000000", sessionToken: "fake", role_Id: "admin" },
      "",
      { algorithm: "none" }
    );

    // A schema mutation requires the administrator role. The forged token must NOT
    // authenticate → the request is treated as public and rejected (401/403).
    const res = await request(app)
      .post("/schemas")
      .set("Authorization", `Bearer ${forged}`)
      .send({ collectionName: "hack_attempt", schema: { name: "Hack", fields: { id: { type: "Integer", primaryKey: true } } } });

    expect([401, 403]).toContain(res.status);
  });

  test("an HS256 token signed with the WRONG secret is rejected", async () => {
    const forged = jwt.sign(
      { id: "00000000-0000-0000-0000-000000000000", sessionToken: "fake" },
      "a-totally-different-wrong-secret-value",
      { algorithm: "HS256" }
    );

    const res = await request(app)
      .post("/schemas")
      .set("Authorization", `Bearer ${forged}`)
      .send({ collectionName: "hack_attempt2", schema: { name: "Hack2", fields: { id: { type: "Integer", primaryKey: true } } } });

    expect([401, 403]).toContain(res.status);
  });

  test("a validly-signed token with a non-existent session does not grant admin", async () => {
    // Even signed with the REAL secret, a token whose session isn't in the DB must
    // not authenticate (the middleware validates the session, then falls back to public).
    const secret = env.get("SECRET_KEY");
    const forged = jwt.sign(
      { id: "00000000-0000-0000-0000-000000000000", sessionToken: "nonexistent-session" },
      secret,
      { algorithm: "HS256" }
    );

    const res = await request(app)
      .post("/schemas")
      .set("Authorization", `Bearer ${forged}`)
      .send({ collectionName: "hack_attempt3", schema: { name: "Hack3", fields: { id: { type: "Integer", primaryKey: true } } } });

    expect([401, 403]).toContain(res.status);
  });
});
