import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";
import { workflowsEnabled } from "../baasix/services/WorkflowService";
import env from "../baasix/utils/env";

/**
 * WORKFLOWS_ENABLED master kill-switch.
 *
 * When false: the /workflows/* routes are disabled, no item-event hooks are
 * registered (no per-request workflow overhead), and no workflow code executes.
 * Default (unset/true) keeps existing behavior.
 */

let app;
let adminToken;

beforeAll(async () => {
  await destroyAllTablesInDB();
  app = await startServerForTesting({ envOverrides: { WORKFLOWS_ENABLED: "false" } });

  const login = await request(app)
    .post("/auth/login")
    .send({ email: "admin@baasix.com", password: "admin@123" });
  adminToken = login.body.token;
});

afterAll(async () => {
  env.set("WORKFLOWS_ENABLED", "");
  if (app?.server) await new Promise((r) => app.server.close(r));
});

describe("WORKFLOWS_ENABLED=false", () => {
  test("the helper reflects the env", () => {
    expect(workflowsEnabled()).toBe(false);
  });

  test("workflow execution endpoint is disabled (404)", async () => {
    const res = await request(app)
      .post("/workflows/some-id/execute")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).toMatch(/disabled|WORKFLOWS_ENABLED/i);
  });

  test("other workflow routes are disabled too", async () => {
    const res = await request(app)
      .get("/workflows/some-id/stats")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  test("regular item API still works with workflows off", async () => {
    // Confirms the kill-switch doesn't break normal API usage.
    const res = await request(app)
      .post("/items/baasix_User")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ firstName: "NoWF", lastName: "User", email: "nowf@test.com", password: "pw" });
    expect([200, 201]).toContain(res.status);
  });
});

describe("WORKFLOWS_ENABLED default", () => {
  test("defaults to enabled when unset", () => {
    env.set("WORKFLOWS_ENABLED", "");
    expect(workflowsEnabled()).toBe(true);
    env.set("WORKFLOWS_ENABLED", "false"); // restore for afterAll cleanup symmetry
  });
});
