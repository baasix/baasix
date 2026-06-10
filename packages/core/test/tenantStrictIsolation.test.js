import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { shouldEnforceTenantContext } from "../baasix/utils/tenantUtils";
import env from "../baasix/utils/env";

/**
 * A11 — strict tenant isolation.
 *
 * A non-tenant-specific role (isTenantSpecific:false) bypasses tenant scoping only
 * when it is the administrator (a genuinely global role). A *non-admin* role marked
 * isTenantSpecific:false (almost always a misconfiguration) is still tenant-scoped
 * when a tenant context exists — preventing accidental cross-tenant data exposure.
 *
 * shouldEnforceTenantContext is pure logic over a service-shaped object, so we test
 * it directly. We boot the server only to load schema metadata (getSchemaDefinition).
 */

let app;

beforeAll(async () => {
  await destroyAllTablesInDB();
  app = await startServerForTesting({ envOverrides: { MULTI_TENANT: "true" } });
});

afterAll(async () => {
  env.set("STRICT_TENANT_ISOLATION", "true"); // restore default
  if (app?.server) await new Promise((r) => app.server.close(r));
});

// A non-system, tenant-scoped collection for these checks.
const COLLECTION = "posts_tenant_a11"; // doesn't need to exist; only baasix_* names branch early

function makeService({ roleName, isTenantSpecific, tenant }) {
  return {
    collection: COLLECTION,
    isMultiTenant: true,
    tenant,
    accountability: {
      tenant,
      role: { name: roleName, isTenantSpecific },
    },
  };
}

describe("A11 — strict tenant isolation (default on)", () => {
  beforeAll(() => env.set("STRICT_TENANT_ISOLATION", "true"));

  test("administrator (global) bypasses tenant scoping", async () => {
    const svc = makeService({ roleName: "administrator", isTenantSpecific: false, tenant: "t1" });
    expect(await shouldEnforceTenantContext(svc)).toBe(false);
  });

  test("non-admin role marked isTenantSpecific:false IS still scoped when a tenant exists", async () => {
    const svc = makeService({ roleName: "sneaky_global", isTenantSpecific: false, tenant: "t1" });
    expect(await shouldEnforceTenantContext(svc)).toBe(true);
  });

  test("normal tenant-specific role is scoped", async () => {
    const svc = makeService({ roleName: "user", isTenantSpecific: true, tenant: "t1" });
    expect(await shouldEnforceTenantContext(svc)).toBe(true);
  });

  test("non-admin global role with NO tenant context is not scoped (nothing to scope to)", async () => {
    const svc = makeService({ roleName: "sneaky_global", isTenantSpecific: false, tenant: null });
    expect(await shouldEnforceTenantContext(svc)).toBe(false);
  });
});

describe("A11 — STRICT_TENANT_ISOLATION=false restores legacy bypass", () => {
  beforeAll(() => env.set("STRICT_TENANT_ISOLATION", "false"));
  afterAll(() => env.set("STRICT_TENANT_ISOLATION", "true"));

  test("any isTenantSpecific:false role bypasses scoping when strict mode is off", async () => {
    const svc = makeService({ roleName: "sneaky_global", isTenantSpecific: false, tenant: "t1" });
    expect(await shouldEnforceTenantContext(svc)).toBe(false);
  });
});
