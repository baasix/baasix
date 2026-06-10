import request from "supertest";
import jwt from "jsonwebtoken";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";
import { google } from "../baasix/auth/providers/google";

/**
 * A8 — OAuth hardening.
 *
 * A8c: verifyIdToken now verifies the JWT SIGNATURE against the provider's JWKS,
 *      not just decodes it — a forged token (right claims, wrong/no signature) is
 *      rejected.
 * A8a: the client-supplied direct-idToken sign-in path is OFF by default
 *      (OAUTH_ALLOW_DIRECT_IDTOKEN), so it can't be abused; the standard redirect
 *      flow is unaffected.
 */

let app;

beforeAll(async () => {
  await destroyAllTablesInDB();
  app = await startServerForTesting();
});

afterAll(async () => {
  if (app?.server) await new Promise((r) => app.server.close(r));
});

describe("A8c — idToken signature is actually verified", () => {
  test("a forged Google idToken with correct claims but wrong signature is rejected", async () => {
    const provider = google({ clientId: "test-client-id", clientSecret: "x" });

    // Forge a token with the exact iss/aud Google expects, signed with an attacker
    // key. The old decode-only check would ACCEPT this; JWKS verification rejects it.
    const forged = jwt.sign(
      {
        iss: "https://accounts.google.com",
        aud: "test-client-id",
        sub: "victim-google-id",
        email: "victim@example.com",
        email_verified: true,
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      "attacker-controlled-secret",
      { algorithm: "HS256" }
    );

    const ok = await provider.verifyIdToken(forged);
    expect(ok).toBe(false);
  });

  test("a structurally invalid token is rejected", async () => {
    const provider = google({ clientId: "test-client-id", clientSecret: "x" });
    expect(await provider.verifyIdToken("not.a.jwt")).toBe(false);
    expect(await provider.verifyIdToken("")).toBe(false);
  });
});

describe("A8a — direct idToken sign-in is disabled by default", () => {
  test("social/signin with an idToken is refused unless explicitly enabled", async () => {
    const res = await request(app)
      .post("/auth/social/signin")
      .send({ provider: "google", idToken: { token: "anything" } });

    // OAUTH_ALLOW_DIRECT_IDTOKEN is not set → path disabled → 400.
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/disabled|redirect flow/i);
  });
});
