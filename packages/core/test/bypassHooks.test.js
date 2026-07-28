import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { hooksManager } from "../baasix/services/HooksManager.js";
import ItemsService from "../baasix/services/ItemsService.js";
import { beforeAll, afterAll, test, expect, describe, beforeEach } from "@jest/globals";

/**
 * `bypassHooks` operation option — documented in skills.md and the extension
 * reference, previously accepted and silently ignored.
 *
 * Main purpose: let a hook write back to its own collection without
 * re-triggering itself (infinite recursion).
 */

let app;
const calls = [];

beforeAll(async () => {
  await destroyAllTablesInDB();

  hooksManager.registerHook("baasix_Role", "items.create", async (ctx) => {
    calls.push("create");
    return ctx;
  });
  hooksManager.registerHook("baasix_Role", "items.create.after", async () => {
    calls.push("create.after");
  });
  hooksManager.registerHook("baasix_Role", "items.update", async (ctx) => {
    calls.push("update");
    return ctx;
  });
  hooksManager.registerHook("baasix_Role", "items.delete", async (ctx) => {
    calls.push("delete");
    return ctx;
  });
  hooksManager.registerHook("baasix_Role", "items.read", async (ctx) => {
    calls.push("read");
    return ctx;
  });

  app = await startServerForTesting();
});
afterAll(async () => { if (app?.server) await new Promise((r) => app.server.close(r)); });
beforeEach(() => { calls.length = 0; });

const svc = () => new ItemsService("baasix_Role", { accountability: undefined });

describe("bypassHooks", () => {
  test("hooks run by default", async () => {
    const id = await svc().createOne({ name: `R_default_${Date.now()}` });
    expect(calls).toContain("create");
    expect(calls).toContain("create.after");
    expect(typeof id === "string" || typeof id === "number").toBe(true);
  });

  test("bypassHooks skips before AND after hooks on create", async () => {
    const id = await svc().createOne(
      { name: `R_bypass_${Date.now()}` }, { bypassHooks: true }
    );
    expect(calls).toEqual([]);
    // The write itself must still succeed.
    const row = await svc().readOne(id, {}, false, undefined, { bypassHooks: true });
    expect(row).toBeTruthy();
  });

  test("bypassHooks works for update and delete", async () => {
    const id = await svc().createOne({ name: `R_ud_${Date.now()}` }, { bypassHooks: true });
    calls.length = 0;

    await svc().updateOne(id, { name: `R_ud2_${Date.now()}` }, { bypassHooks: true });
    expect(calls).toEqual([]);

    await svc().deleteOne(id, { bypassHooks: true });
    expect(calls).toEqual([]);
  });

  test("bypassHooks skips read hooks", async () => {
    await svc().readByQuery({ limit: 1 }, false, undefined, { bypassHooks: true });
    expect(calls).toEqual([]);
    // Control: without the flag the read hook fires.
    await svc().readByQuery({ limit: 1 });
    expect(calls).toContain("read");
  });

  test("data still flows through when bypassed (context returned unchanged)", async () => {
    const name = `R_flow_${Date.now()}`;
    const id = await svc().createOne({ name }, { bypassHooks: true });
    const row = await svc().readOne(id, {}, false, undefined, { bypassHooks: true });
    expect(row.name).toBe(name);
  });

  test("a hook writing to its own collection does not recurse", async () => {
    // The hook listens on the SAME event its self-write triggers (update.after),
    // so without bypassHooks this recurses until the guard throws.
    let depth = 0;
    hooksManager.registerHook("baasix_Tenant", "items.update.after", async ({ id, document }) => {
      depth++;
      if (depth > 5) throw new Error("infinite recursion");
      const s = new ItemsService("baasix_Tenant", { accountability: undefined });
      const current = document?.name ?? "";
      if (current.endsWith("_touched")) return;
      await s.updateOne(id, { name: `${current}_touched` }, { bypassHooks: true });
    });

    const ts = new ItemsService("baasix_Tenant", { accountability: undefined });
    const id = await ts.createOne({ name: `T_${Date.now()}` }, { bypassHooks: true });

    await ts.updateOne(id, { name: `T2_${Date.now()}` });

    // Exactly one entry: the self-write inside the hook was bypassed.
    expect(depth).toBe(1);
    const row = await ts.readOne(id, {}, false, undefined, { bypassHooks: true });
    expect(row.name).toMatch(/_touched$/);
  });
});
