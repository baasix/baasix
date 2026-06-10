import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

/**
 * A14 — brute-force protection on auth-sensitive endpoints.
 *
 * A dedicated limiter throttles login / magic-link / password-reset attempts much
 * more strictly than the global API limiter. We force-enable it here (it's
 * auto-disabled under TEST_MODE) with a tiny threshold and confirm that repeated
 * failed logins are eventually rejected with 429.
 */

let app;

beforeAll(async () => {
  await destroyAllTablesInDB();
  app = await startServerForTesting({
    envOverrides: {
      // Opt back into the limiter despite TEST_MODE, with a small window/threshold.
      AUTH_RATE_LIMIT_DISABLED: "false",
      AUTH_RATE_LIMIT: "3",
      AUTH_RATE_LIMIT_INTERVAL: "60000",
    },
  });
});

afterAll(async () => {
  if (app?.server) await new Promise((r) => app.server.close(r));
});

describe("A14 — auth rate limiting", () => {
  test("repeated failed logins for the same email are rate-limited (429)", async () => {
    const attempt = () =>
      request(app)
        .post("/auth/login")
        .send({ email: "bruteforce@test.com", password: "wrong-password" });

    // First few attempts: allowed (and fail auth normally, not 429).
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      const res = await attempt();
      statuses.push(res.status);
    }

    // With AUTH_RATE_LIMIT=3, at least one later attempt must be 429.
    expect(statuses).toContain(429);
    // The early attempts should NOT be 429 (limiter lets the first ones through).
    expect(statuses[0]).not.toBe(429);
  });

  test("a different email is tracked separately (per IP+email key)", async () => {
    // A fresh email should still be allowed initially even after the above ran
    // (different key), proving the limiter isn't a blanket IP block of all auth.
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "different-user@test.com", password: "wrong-password" });
    expect(res.status).not.toBe(429);
  });
});
