# Named ACL Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Named, reusable ACL entries (`Update_Own`, `Read_All`, …) stored in a new `baasix_ACL` system collection, assignable (one or many, OR/additive-combined) to `baasix_Permission` rows via a new `acl_Ids` JSON column, replacing inline conditions when assigned.

**Architecture:** A pure merge utility (`utils/aclMerge.ts`) implements the Directus-style additive merge. Expansion happens once at cache-load time inside `PermissionService.loadPermissions()`, so all downstream enforcement (ItemsService, sockets, dynamic variables) is untouched. New `/acls` CRUD routes carry the guards (system-entry protection, delete-in-use 409). System entries are seeded idempotently at startup by `schemaManager` (`ON CONFLICT (name) DO NOTHING`), NOT via a migration — `MIGRATIONS_AUTO_RUN` is frequently disabled, and startup seeding covers fresh and existing installs alike. Admin UI adds an ACL management screen and an ACL picker in the permission drawer, calling `/acls` through the SDK's raw `baasix.request` client (no SDK changes needed).

**Tech Stack:** TypeScript ESM (Node), Drizzle/postgres.js, Express-style routes, jest + supertest, Next.js + Refine + shadcn/ui admin app.

**Spec:** `docs/superpowers/specs/2026-07-06-named-acl-permissions-design.md`

## Global Constraints

- Backend root: `packages/core/baasix/`; tests in `packages/core/test/`; admin app in a **separate top-level folder** `app/` (sibling of the `baasix/` repo — it is `/home/vivek/Documents/NodeJS/baasix/baasix-drizzle/app`, outside this git repo).
- Merge semantics (from spec, exact): conditions → OR'd (single entry used as-is, no wrapper; any entry with empty/null conditions ⇒ unrestricted `{}`); fields → union (all-null ⇒ `null`; a null list among non-null lists is treated as `["*"]` in the union to preserve explicit privilege-field grants); defaultValues → shallow merge in `acl_Ids` order, later wins; relConditions → per-relation key intersection across all entries, values OR'd (any entry with empty/null relConditions ⇒ `{}`).
- `acl_Ids` non-empty ⇒ inline `conditions`/`relConditions`/`fields`/`defaultValues` are ignored at expansion and rejected (400) when both sent in one API payload.
- Fail closed: permission whose `acl_Ids` resolve to zero entries grants no access (action omitted from cache).
- Seeded system entries (`system: true`, immutable via API): `Read_All`, `Read_Own`, `Update_Own`, `Delete_Own`, `Own_Tenant`.
- NEVER run two jest invocations at once. Run tests one file at a time: `npm test -- test/<file>.test.js` from `packages/core/`.
- All backend commits in the `baasix/` repo; admin-app commits in the `app/` folder only if it is under its own git (check `git -C app rev-parse` first; if not a repo, skip commits for app files and say so).
- Route writes are `adminOnly`; every ACL write triggers `permissionService.loadPermissions()` + `invalidateAuthCache()`.

---

### Task 1: ACL merge utility (pure logic)

**Files:**
- Create: `packages/core/baasix/utils/aclMerge.ts`
- Test: `packages/core/test/aclMerge.test.js`

**Interfaces:**
- Produces: `mergeACLEntries(entries: ACLEntry[]): MergedACL` where `ACLEntry = { id, name, conditions?, relConditions?, fields?, defaultValues? }` and `MergedACL = { conditions: object, relConditions: object, fields: string[] | null, defaultValues: object }`. Caller must pass ≥1 entry. Task 4 imports this from `../utils/aclMerge.js`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/aclMerge.test.js`:

```js
import { mergeACLEntries } from "../baasix/utils/aclMerge";
import { test, expect, describe } from "@jest/globals";

const own = {
    id: "a1",
    name: "Update_Own",
    conditions: { userCreated_Id: { eq: "$CURRENT_USER" } },
    fields: ["*"],
};
const teams = {
    id: "a2",
    name: "Update_Teams",
    conditions: { "team.members.user_Id": { eq: "$CURRENT_USER" } },
    fields: ["title", "status"],
};

describe("mergeACLEntries — conditions", () => {
    test("single entry passes conditions through unwrapped", () => {
        const merged = mergeACLEntries([own]);
        expect(merged.conditions).toEqual({ userCreated_Id: { eq: "$CURRENT_USER" } });
    });

    test("multiple entries OR their conditions in order", () => {
        const merged = mergeACLEntries([own, teams]);
        expect(merged.conditions).toEqual({
            OR: [
                { userCreated_Id: { eq: "$CURRENT_USER" } },
                { "team.members.user_Id": { eq: "$CURRENT_USER" } },
            ],
        });
    });

    test("any entry with empty conditions makes the result unrestricted", () => {
        const readAll = { id: "a3", name: "Read_All", conditions: {}, fields: ["*"] };
        expect(mergeACLEntries([own, readAll]).conditions).toEqual({});
        const nullCond = { id: "a4", name: "NoCond", conditions: null, fields: ["*"] };
        expect(mergeACLEntries([own, nullCond]).conditions).toEqual({});
    });
});

describe("mergeACLEntries — fields", () => {
    test("all entries without fields yields null (unrestricted)", () => {
        const a = { id: "a1", name: "A", conditions: { x: { eq: 1 } } };
        const b = { id: "a2", name: "B", conditions: { y: { eq: 2 } }, fields: null };
        expect(mergeACLEntries([a, b]).fields).toBeNull();
    });

    test("fields union with dedupe, preserving explicit names alongside *", () => {
        const merged = mergeACLEntries([own, teams]);
        expect(merged.fields).toEqual(["*", "title", "status"]);
    });

    test("null fields among non-null lists is treated as * in the union", () => {
        const noFields = { id: "a5", name: "N", conditions: { x: { eq: 1 } } };
        const explicit = { id: "a6", name: "E", conditions: { y: { eq: 2 } }, fields: ["role_Id"] };
        expect(mergeACLEntries([noFields, explicit]).fields).toEqual(["*", "role_Id"]);
    });

    test("duplicate field names are deduped", () => {
        const a = { id: "a1", name: "A", conditions: { x: { eq: 1 } }, fields: ["title", "status"] };
        const b = { id: "a2", name: "B", conditions: { y: { eq: 2 } }, fields: ["status", "body"] };
        expect(mergeACLEntries([a, b]).fields).toEqual(["title", "status", "body"]);
    });
});

describe("mergeACLEntries — defaultValues", () => {
    test("shallow merge in order, later entry wins on conflicts", () => {
        const a = { id: "a1", name: "A", conditions: { x: { eq: 1 } }, defaultValues: { status: "draft", author_Id: "$CURRENT_USER" } };
        const b = { id: "a2", name: "B", conditions: { y: { eq: 2 } }, defaultValues: { status: "published" } };
        expect(mergeACLEntries([a, b]).defaultValues).toEqual({
            status: "published",
            author_Id: "$CURRENT_USER",
        });
    });

    test("no defaultValues anywhere yields empty object", () => {
        expect(mergeACLEntries([own, teams]).defaultValues).toEqual({});
    });
});

describe("mergeACLEntries — relConditions", () => {
    test("any entry without relConditions makes all relations unrestricted", () => {
        const a = { id: "a1", name: "A", conditions: { x: { eq: 1 } }, relConditions: { category: { isPublic: { eq: true } } } };
        const b = { id: "a2", name: "B", conditions: { y: { eq: 2 } } };
        expect(mergeACLEntries([a, b]).relConditions).toEqual({});
    });

    test("relation keys are intersected; shared keys OR their values; unshared keys drop", () => {
        const a = {
            id: "a1", name: "A", conditions: { x: { eq: 1 } },
            relConditions: {
                category: { isPublic: { eq: true } },
                author: { active: { eq: true } },
            },
        };
        const b = {
            id: "a2", name: "B", conditions: { y: { eq: 2 } },
            relConditions: { category: { owner_Id: { eq: "$CURRENT_USER" } } },
        };
        expect(mergeACLEntries([a, b]).relConditions).toEqual({
            category: {
                OR: [{ isPublic: { eq: true } }, { owner_Id: { eq: "$CURRENT_USER" } }],
            },
        });
    });

    test("single entry passes relConditions through unwrapped", () => {
        const a = { id: "a1", name: "A", conditions: { x: { eq: 1 } }, relConditions: { category: { isPublic: { eq: true } } } };
        expect(mergeACLEntries([a]).relConditions).toEqual({ category: { isPublic: { eq: true } } });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run from `packages/core/`: `npm test -- test/aclMerge.test.js`
Expected: FAIL — cannot find module `../baasix/utils/aclMerge`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/baasix/utils/aclMerge.ts`:

```ts
/**
 * ACL merge utility — combines multiple named ACL entries assigned to one
 * permission into a single effective permission payload.
 *
 * Semantics are ADDITIVE (Directus-policy style): assigning more ACL entries
 * can only grant more access, never narrow it.
 * - conditions:     OR of all entries; an entry with no conditions means
 *                   unrestricted, which short-circuits the whole result to {}.
 * - fields:         union; all-null => null (unrestricted). A null list among
 *                   non-null lists contributes "*" so explicit names from
 *                   other entries survive (privilege fields are writable only
 *                   when explicitly named — see getFullPermissionData rawFields).
 * - defaultValues:  shallow merge in assignment order, later entries win.
 * - relConditions:  a relation is restricted only if EVERY entry restricts it
 *                   (key intersection); shared keys OR their conditions.
 */

export interface ACLEntry {
  id: string;
  name: string;
  description?: string | null;
  conditions?: Record<string, any> | null;
  relConditions?: Record<string, any> | null;
  fields?: string[] | null;
  defaultValues?: Record<string, any> | null;
  system?: boolean;
}

export interface MergedACL {
  conditions: Record<string, any>;
  relConditions: Record<string, any>;
  fields: string[] | null;
  defaultValues: Record<string, any>;
}

function isEmptyObject(value: Record<string, any> | null | undefined): boolean {
  return !value || Object.keys(value).length === 0;
}

export function mergeACLEntries(entries: ACLEntry[]): MergedACL {
  if (!entries || entries.length === 0) {
    throw new Error("mergeACLEntries requires at least one ACL entry");
  }

  // --- conditions: OR, unrestricted short-circuit ---
  let conditions: Record<string, any>;
  if (entries.some((e) => isEmptyObject(e.conditions))) {
    conditions = {};
  } else if (entries.length === 1) {
    conditions = entries[0].conditions!;
  } else {
    conditions = { OR: entries.map((e) => e.conditions) };
  }

  // --- fields: union; all-null => null; null among lists => "*" ---
  let fields: string[] | null = null;
  const hasAnyFields = entries.some((e) => Array.isArray(e.fields) && e.fields.length > 0);
  if (hasAnyFields) {
    const union: string[] = [];
    for (const entry of entries) {
      const list = Array.isArray(entry.fields) && entry.fields.length > 0 ? entry.fields : ["*"];
      for (const field of list) {
        if (!union.includes(field)) union.push(field);
      }
    }
    fields = union;
  }

  // --- defaultValues: shallow merge in order ---
  const defaultValues: Record<string, any> = {};
  for (const entry of entries) {
    if (entry.defaultValues && typeof entry.defaultValues === "object") {
      Object.assign(defaultValues, entry.defaultValues);
    }
  }

  // --- relConditions: key intersection, OR values ---
  let relConditions: Record<string, any> = {};
  if (!entries.some((e) => isEmptyObject(e.relConditions))) {
    const keySets = entries.map((e) => Object.keys(e.relConditions!));
    const sharedKeys = keySets.reduce((acc, keys) => acc.filter((k) => keys.includes(k)));
    for (const key of sharedKeys) {
      const values = entries.map((e) => e.relConditions![key]);
      relConditions[key] = values.length === 1 ? values[0] : { OR: values };
    }
  }

  return { conditions, relConditions, fields, defaultValues };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/aclMerge.test.js`
Expected: PASS, all 12 tests green.

- [ ] **Step 5: Commit**

```bash
git add baasix/utils/aclMerge.ts test/aclMerge.test.js
git commit -m "feat(acl): additive merge utility for named ACL entries"
```

---

### Task 2: `baasix_ACL` schema, `acl_Ids` column, startup seeding

**Files:**
- Modify: `packages/core/baasix/utils/systemschema.ts` (insert new schema object after the `baasix_Permission` entry which ends at line 113; add `acl_Ids` field to `baasix_Permission` after `relConditions` at line 93)
- Modify: `packages/core/baasix/utils/schemaManager.ts` (new `seedSystemACLs()` method; call it in `checkAndSeedDatabase()` at line 1827)
- Test: `packages/core/test/acl.test.js` (new file — seed verification section)

**Interfaces:**
- Produces: DB table `baasix_ACL` (columns `id, name, description, conditions, relConditions, fields, defaultValues, system, createdAt, updatedAt`), unique index `baasix_ACL_name_unique` on `name`; `baasix_Permission.acl_Ids` JSONB column; 5 seeded rows with `system = true`. Schema sync creates the table and column automatically at startup — no migration file.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/acl.test.js`:

```js
import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

let app;
let adminToken;

beforeAll(async () => {
    await destroyAllTablesInDB();
    app = await startServerForTesting();

    const adminLoginResponse = await request(app)
        .post("/auth/login")
        .send({ email: "admin@baasix.com", password: "admin@123" });
    adminToken = adminLoginResponse.body.token;
});

describe("System ACL seeding", () => {
    test("seeds the five built-in system ACL entries at startup", async () => {
        const response = await request(app)
            .get("/items/baasix_ACL")
            .query({ limit: -1 })
            .set("Authorization", `Bearer ${adminToken}`);

        expect(response.status).toBe(200);
        const names = response.body.data.map((e) => e.name).sort();
        expect(names).toEqual(["Delete_Own", "Own_Tenant", "Read_All", "Read_Own", "Update_Own"]);
        for (const entry of response.body.data) {
            expect(entry.system).toBe(true);
        }

        const updateOwn = response.body.data.find((e) => e.name === "Update_Own");
        expect(updateOwn.conditions).toEqual({ userCreated_Id: { eq: "$CURRENT_USER" } });
        expect(updateOwn.fields).toEqual(["*"]);

        const readAll = response.body.data.find((e) => e.name === "Read_All");
        expect(readAll.conditions).toEqual({});
    });
});

afterAll(async () => {
    if (app.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/acl.test.js`
Expected: FAIL — `baasix_ACL` collection does not exist (404 or empty data).

- [ ] **Step 3: Add `baasix_ACL` to systemschema.ts**

In `packages/core/baasix/utils/systemschema.ts`, insert this object into the `schemas` array immediately after the `baasix_Permission` entry (after line 113's closing `},`):

```ts
        {
            collectionName: "baasix_ACL",
            schema: {
                name: "ACL",
                timestamps: true,
                fields: {
                    id: {
                        type: "UUID",
                        primaryKey: true,
                        defaultValue: { type: "UUIDV4" },
                        SystemGenerated: "true",
                    },
                    name: { type: "String", allowNull: false, SystemGenerated: "true" },
                    description: { type: "String", SystemGenerated: "true" },
                    conditions: { type: "JSON", SystemGenerated: "true" },
                    relConditions: { type: "JSON", SystemGenerated: "true" },
                    fields: { type: "JSON", SystemGenerated: "true" },
                    defaultValues: { type: "JSON", SystemGenerated: "true" },
                    system: {
                        type: "Boolean",
                        allowNull: false,
                        defaultValue: false,
                        SystemGenerated: "true",
                        description: "Built-in entry seeded by Baasix; immutable via API",
                    },
                },
                indexes: [
                    {
                        fields: ["name"],
                        unique: true,
                        name: "baasix_ACL_name_unique",
                        SystemGenerated: "true",
                    },
                ],
            },
        },
```

- [ ] **Step 4: Add `acl_Ids` to `baasix_Permission`**

In the same file, inside the `baasix_Permission` fields object, add after the `relConditions` line (line 93):

```ts
                    acl_Ids: {
                        type: "JSON",
                        SystemGenerated: "true",
                        description:
                            "Ordered array of baasix_ACL UUIDs. When non-empty, assigned ACL entries replace this row's inline conditions/relConditions/fields/defaultValues (OR/additive merge).",
                    },
```

- [ ] **Step 5: Add idempotent seeding to schemaManager.ts**

In `packages/core/baasix/utils/schemaManager.ts`, change `checkAndSeedDatabase()` (line 1827) so system ACLs are seeded on EVERY startup (not just empty DBs). At the end of the method, after the `if (parseInt(userCount...) { ... }` block, add:

```ts
    // Seed built-in ACL entries on every startup (idempotent)
    await this.seedSystemACLs();
```

Then add this private method right after `seedDatabase()` (after line 1907):

```ts
  /**
   * Seed built-in system ACL entries (idempotent — ON CONFLICT DO NOTHING).
   * Runs on every startup so existing installs get them without migrations.
   */
  private async seedSystemACLs(): Promise<void> {
    const sql = getSqlClient();

    const tableExists = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'baasix_ACL'
      )
    `;
    if (!tableExists[0].exists) {
      console.log('baasix_ACL table does not exist yet, skipping ACL seeding');
      return;
    }

    const ownerCondition = { userCreated_Id: { eq: '$CURRENT_USER' } };
    const systemACLs = [
      { name: 'Read_All', description: 'Read all rows, all fields', conditions: {}, fields: ['*'] },
      { name: 'Read_Own', description: 'Read rows created by the current user (requires usertrack)', conditions: ownerCondition, fields: ['*'] },
      { name: 'Update_Own', description: 'Update rows created by the current user (requires usertrack)', conditions: ownerCondition, fields: ['*'] },
      { name: 'Delete_Own', description: 'Delete rows created by the current user (requires usertrack)', conditions: ownerCondition, fields: null },
      { name: 'Own_Tenant', description: "Rows belonging to the current user's tenant", conditions: { tenant_Id: { eq: '$CURRENT_TENANT' } }, fields: ['*'] },
    ];

    for (const acl of systemACLs) {
      await sql`
        INSERT INTO "baasix_ACL" (id, name, description, conditions, fields, system)
        VALUES (
          gen_random_uuid(),
          ${acl.name},
          ${acl.description},
          ${JSON.stringify(acl.conditions)}::jsonb,
          ${acl.fields ? JSON.stringify(acl.fields) : null}::jsonb,
          true
        )
        ON CONFLICT (name) DO NOTHING
      `;
    }

    console.log('System ACL entries verified/seeded');
  }
```

Note: `ON CONFLICT (name)` relies on the unique index from Step 3; schema sync creates it before seeding runs. If startup logs show `there is no unique or exclusion constraint matching the ON CONFLICT specification`, the index didn't sync — check the `indexes` array from Step 3 was added correctly.

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- test/acl.test.js`
Expected: PASS (1 test).

- [ ] **Step 7: Commit**

```bash
git add baasix/utils/systemschema.ts baasix/utils/schemaManager.ts test/acl.test.js
git commit -m "feat(acl): baasix_ACL system collection, acl_Ids column, startup seeding"
```

---

### Task 3: `/acls` CRUD routes with guards

**Files:**
- Create: `packages/core/baasix/routes/acl.route.ts`
- Test: `packages/core/test/acl.test.js` (extend)

**Interfaces:**
- Consumes: `baasix_ACL` table from Task 2.
- Produces: HTTP routes `GET /acls`, `GET /acls/:id`, `POST /acls`, `PATCH /acls/:id`, `DELETE /acls/:id`. Error contracts used by Tasks 6/8: PATCH/DELETE on `system: true` → 403; DELETE while referenced by any `baasix_Permission.acl_Ids` → 409 with `details.usedBy = [{ permission_Id, collection, action, role_Id }]`; invalid payload types → 400. Routes auto-register (any `routes/*.route.ts` with default export `{ id, handler }` is loaded by `utils/router.ts`).

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/acl.test.js`, inside the file after the seeding describe block (also add `let userToken;` next to the other `let` declarations and create a test user in `beforeAll`, mirroring `test/permission.test.js:24-53` exactly — role `testuser`, user `testuser@test.com` / `userpassword`, `/items/baasix_UserRole` assignment, login):

```js
describe("ACL Routes", () => {
    let aclId;

    test("Create a named ACL entry", async () => {
        const response = await request(app).post("/acls").set("Authorization", `Bearer ${adminToken}`).send({
            name: "Update_Teams",
            description: "Rows belonging to the user's teams",
            conditions: { "team.members.user_Id": { eq: "$CURRENT_USER" } },
            fields: ["title", "status"],
        });

        expect(response.status).toBe(201);
        expect(response.body).toHaveProperty("id");
        expect(response.body.system).toBe(false);
        aclId = response.body.id;
    });

    test("List ACL entries includes seeds and the new entry", async () => {
        const response = await request(app).get("/acls").set("Authorization", `Bearer ${adminToken}`);
        expect(response.status).toBe(200);
        const names = response.body.data.map((e) => e.name);
        expect(names).toContain("Update_Teams");
        expect(names).toContain("Update_Own");
    });

    test("Get a single ACL entry", async () => {
        const response = await request(app).get(`/acls/${aclId}`).set("Authorization", `Bearer ${adminToken}`);
        expect(response.status).toBe(200);
        expect(response.body.data.name).toBe("Update_Teams");
    });

    test("Update a non-system ACL entry", async () => {
        const response = await request(app)
            .patch(`/acls/${aclId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ description: "Updated description" });
        expect(response.status).toBe(200);
        expect(response.body.description).toBe("Updated description");
    });

    test("Cannot set system flag through the API", async () => {
        // Include a real field alongside `system` so the update payload is
        // non-empty after the route strips the system key.
        const response = await request(app)
            .patch(`/acls/${aclId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ system: true, description: "attempted system escalation" });
        expect(response.status).toBe(200);
        expect(response.body.system).toBe(false);
    });

    test("Cannot update a system ACL entry", async () => {
        const list = await request(app).get("/acls").set("Authorization", `Bearer ${adminToken}`);
        const updateOwn = list.body.data.find((e) => e.name === "Update_Own");

        const response = await request(app)
            .patch(`/acls/${updateOwn.id}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ description: "hacked" });
        expect(response.status).toBe(403);
    });

    test("Cannot delete a system ACL entry", async () => {
        const list = await request(app).get("/acls").set("Authorization", `Bearer ${adminToken}`);
        const readAll = list.body.data.find((e) => e.name === "Read_All");

        const response = await request(app)
            .delete(`/acls/${readAll.id}`)
            .set("Authorization", `Bearer ${adminToken}`);
        expect(response.status).toBe(403);
    });

    test("Cannot delete an ACL entry referenced by a permission (409 lists usage)", async () => {
        const perm = await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: userRoleId,
            collection: "acl_guard_collection",
            action: "read",
            acl_Ids: [aclId],
        });
        expect(perm.status).toBe(201);

        const response = await request(app).delete(`/acls/${aclId}`).set("Authorization", `Bearer ${adminToken}`);
        expect(response.status).toBe(409);
        expect(response.body.details.usedBy).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ collection: "acl_guard_collection", action: "read" }),
            ])
        );

        // Detach and delete succeeds
        await request(app).delete(`/permissions/${perm.body.id}`).set("Authorization", `Bearer ${adminToken}`);
        const retry = await request(app).delete(`/acls/${aclId}`).set("Authorization", `Bearer ${adminToken}`);
        expect(retry.status).toBe(204);
    });

    test("Rejects malformed payloads with 400", async () => {
        const badConditions = await request(app).post("/acls").set("Authorization", `Bearer ${adminToken}`).send({
            name: "Bad_Conditions",
            conditions: "not-an-object",
        });
        expect(badConditions.status).toBe(400);

        const badFields = await request(app).post("/acls").set("Authorization", `Bearer ${adminToken}`).send({
            name: "Bad_Fields",
            fields: [1, 2],
        });
        expect(badFields.status).toBe(400);

        const noName = await request(app).post("/acls").set("Authorization", `Bearer ${adminToken}`).send({
            conditions: { x: { eq: 1 } },
        });
        expect(noName.status).toBe(400);
    });

    test("Non-admin cannot write ACL entries", async () => {
        const response = await request(app).post("/acls").set("Authorization", `Bearer ${userToken}`).send({
            name: "Sneaky",
            conditions: {},
        });
        expect(response.status).toBe(403);
    });
});
```

Note: the 409 test also exercises `POST /permissions` with `acl_Ids` — permission creation stores the column as plain data (no validation yet; Task 5 adds it), which already works via ItemsService.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/acl.test.js`
Expected: seeding test passes; all "ACL Routes" tests FAIL with 404 (routes don't exist).

- [ ] **Step 3: Implement the routes**

Create `packages/core/baasix/routes/acl.route.ts`:

```ts
import type { Express } from "../types/index.js";
import permissionService from "../services/PermissionService.js";
import ItemsService from "../services/ItemsService.js";
import { adminOnly } from "../utils/auth.js";
import { APIError } from "../utils/errorHandler.js";
import { invalidateAuthCache } from "../utils/common.js";
import { parseQueryParams } from "../utils/router.js";

/**
 * Validate the shape of an ACL create/update payload.
 * Conditions use the same filter DSL as queries; deep validation happens when
 * they are applied — here we guard the payload types.
 */
const validateACLPayload = (data: Record<string, any>, isCreate: boolean): void => {
    if (isCreate && (typeof data.name !== "string" || data.name.trim() === "")) {
        throw new APIError("ACL entry requires a non-empty name", 400);
    }
    for (const key of ["conditions", "relConditions", "defaultValues"]) {
        if (data[key] != null && (typeof data[key] !== "object" || Array.isArray(data[key]))) {
            throw new APIError(`ACL ${key} must be a JSON object`, 400);
        }
    }
    if (data.fields != null) {
        if (!Array.isArray(data.fields) || !data.fields.every((f: any) => typeof f === "string")) {
            throw new APIError("ACL fields must be an array of strings", 400);
        }
    }
};

const reloadAndInvalidate = async (): Promise<void> => {
    await permissionService.loadPermissions();
    await invalidateAuthCache();
};

const registerEndpoint = (app: Express) => {
    // List ACL entries
    app.get("/acls", async (req, res, next) => {
        try {
            const query = parseQueryParams(req.query);
            const itemsService = new ItemsService("baasix_ACL", {
                accountability: req.accountability as any,
            });
            const result = await itemsService.readByQuery({
                ...query,
                limit: query.limit ?? -1,
            });
            res.json(result);
        } catch (error) {
            next(error);
        }
    });

    // Get single ACL entry
    app.get("/acls/:id", async (req, res, next) => {
        try {
            const itemsService = new ItemsService("baasix_ACL", {
                accountability: req.accountability as any,
            });
            const entry = await itemsService.readOne(req.params.id);
            res.json({ data: entry });
        } catch (error) {
            next(error);
        }
    });

    // Create ACL entry
    app.post("/acls", adminOnly, async (req, res, next) => {
        try {
            const data = { ...req.body };
            validateACLPayload(data, true);
            delete data.system; // system entries are created only by seeding

            const itemsService = new ItemsService("baasix_ACL", {
                accountability: req.accountability as any,
            });
            const newId = await itemsService.createOne(data);
            const created = await itemsService.readOne(newId);

            await reloadAndInvalidate();
            res.status(201).json(created);
        } catch (error) {
            next(error);
        }
    });

    // Update ACL entry
    app.patch("/acls/:id", adminOnly, async (req, res, next) => {
        try {
            const { id } = req.params;
            const data = { ...req.body };
            validateACLPayload(data, false);
            delete data.system;

            const itemsService = new ItemsService("baasix_ACL", {
                accountability: req.accountability as any,
            });
            const existing = await itemsService.readOne(id);
            if (existing.system) {
                throw new APIError("System ACL entries cannot be modified", 403);
            }

            await itemsService.updateOne(id, data);
            const updated = await itemsService.readOne(id);

            await reloadAndInvalidate();
            res.json(updated);
        } catch (error) {
            next(error);
        }
    });

    // Delete ACL entry
    app.delete("/acls/:id", adminOnly, async (req, res, next) => {
        try {
            const { id } = req.params;

            const itemsService = new ItemsService("baasix_ACL", {
                accountability: req.accountability as any,
            });
            const existing = await itemsService.readOne(id);
            if (existing.system) {
                throw new APIError("System ACL entries cannot be deleted", 403);
            }

            // Guard: block deletion while any permission references this entry
            const permissionsService = new ItemsService("baasix_Permission", {
                accountability: req.accountability as any,
            });
            const usage = await permissionsService.readByQuery({
                filter: { acl_Ids: { jsonbContains: [id] } },
                fields: ["id", "collection", "action", "role_Id"],
                limit: -1,
            });
            if (usage.data.length > 0) {
                throw new APIError(
                    `ACL entry '${existing.name}' is assigned to ${usage.data.length} permission(s). Detach it first.`,
                    409,
                    {
                        usedBy: usage.data.map((p: any) => ({
                            permission_Id: p.id,
                            collection: p.collection,
                            action: p.action,
                            role_Id: p.role_Id,
                        })),
                    }
                );
            }

            await itemsService.deleteOne(id);
            await reloadAndInvalidate();
            res.status(204).end();
        } catch (error) {
            next(error);
        }
    });
};

export default {
    id: "acls",
    handler: registerEndpoint,
};
```

Check how the error handler serializes `APIError.details` (see `utils/errorHandler.ts`) — the 409 test asserts `response.body.details.usedBy`. If the handler emits details under another key (e.g. `errors`), adjust the test assertion to the actual envelope, not the route.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/acl.test.js`
Expected: PASS. If the 409 test fails on `jsonbContains`, verify the operator name in `utils/filterOperators.ts:807-813` (`{ acl_Ids: { jsonbContains: [id] } }` compiles to `"acl_Ids" @> '["<id>"]'::jsonb`).

- [ ] **Step 5: Commit**

```bash
git add baasix/routes/acl.route.ts test/acl.test.js
git commit -m "feat(acl): /acls CRUD routes with system-entry and delete-in-use guards"
```

---

### Task 4: ACL expansion in PermissionService

**Files:**
- Modify: `packages/core/baasix/services/PermissionService.ts:199-263` (`loadPermissions`)
- Test: `packages/core/test/acl.test.js` (extend — end-to-end enforcement)

**Interfaces:**
- Consumes: `mergeACLEntries` from Task 1, `baasix_ACL` table from Task 2.
- Produces: per-role permission cache entries whose `fields/conditions/relConditions/defaultValues` are the MERGED values whenever the permission row has non-empty `acl_Ids`. No downstream API changes — `getFullPermissionData`, `getFilter`, `getDefaultValues`, `getAllowedFields` operate on the cache unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/acl.test.js`. Add `let secondUserToken; let secondUserId;` declarations, and in `beforeAll` (after the first test user setup) create a second user the same way (`seconduser@test.com` / `userpassword`, same `testuser` role via `/items/baasix_UserRole`, then login to get `secondUserToken` and keep its id in `secondUserId`). Then:

```js
describe("ACL-based enforcement (end to end)", () => {
    let postAId; // created by testuser
    let postBId; // created by seconduser

    beforeAll(async () => {
        // Collection with user tracking so seeded *_Own ACLs apply
        await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                collectionName: "acl_posts",
                schema: {
                    name: "ACLPost",
                    // Enables auto-set userCreated_Id on create (ItemsService.ts:2414).
                    // If the created rows come back without userCreated_Id, check where
                    // the create-schema route expects this flag (schema level vs top
                    // level) via the baasix_create_schema handler in MCPService.ts:791.
                    usertrack: true,
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        title: { type: "String", allowNull: false },
                        status: { type: "String" },
                    },
                },
            });

        // Look up seeded ACL ids
        const acls = await request(app).get("/acls").set("Authorization", `Bearer ${adminToken}`);
        const byName = Object.fromEntries(acls.body.data.map((e) => [e.name, e.id]));

        // testuser role: create (open) + read own + update own
        await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: userRoleId,
            collection: "acl_posts",
            action: "create",
            fields: ["*"],
        });
        await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: userRoleId,
            collection: "acl_posts",
            action: "read",
            acl_Ids: [byName["Read_Own"]],
        });
        await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: userRoleId,
            collection: "acl_posts",
            action: "update",
            acl_Ids: [byName["Update_Own"]],
        });

        // Each user creates one post
        const postA = await request(app)
            .post("/items/acl_posts")
            .set("Authorization", `Bearer ${userToken}`)
            .send({ title: "post by testuser", status: "draft" });
        postAId = postA.body.data.id;

        const postB = await request(app)
            .post("/items/acl_posts")
            .set("Authorization", `Bearer ${secondUserToken}`)
            .send({ title: "post by seconduser", status: "draft" });
        postBId = postB.body.data.id;
    });

    test("Read_Own: user sees only their own rows", async () => {
        const response = await request(app)
            .get("/items/acl_posts")
            .set("Authorization", `Bearer ${userToken}`);
        expect(response.status).toBe(200);
        const ids = response.body.data.map((p) => p.id);
        expect(ids).toContain(postAId);
        expect(ids).not.toContain(postBId);
    });

    test("Update_Own: user can update own row, not another user's", async () => {
        const ok = await request(app)
            .patch(`/items/acl_posts/${postAId}`)
            .set("Authorization", `Bearer ${userToken}`)
            .send({ title: "updated by owner" });
        expect(ok.status).toBe(200);

        const denied = await request(app)
            .patch(`/items/acl_posts/${postBId}`)
            .set("Authorization", `Bearer ${userToken}`)
            .send({ title: "should not work" });
        expect([403, 404]).toContain(denied.status);
    });

    test("Multiple ACLs OR: adding Read_All widens read access to all rows", async () => {
        const acls = await request(app).get("/acls").set("Authorization", `Bearer ${adminToken}`);
        const byName = Object.fromEntries(acls.body.data.map((e) => [e.name, e.id]));

        const perms = await request(app)
            .get("/permissions")
            .query({ filter: JSON.stringify({ AND: [{ collection: { eq: "acl_posts" } }, { action: { eq: "read" } }] }) })
            .set("Authorization", `Bearer ${adminToken}`);
        const readPerm = perms.body.data[0];

        const patch = await request(app)
            .patch(`/permissions/${readPerm.id}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ acl_Ids: [byName["Read_Own"], byName["Read_All"]] });
        expect(patch.status).toBe(200);

        const response = await request(app)
            .get("/items/acl_posts")
            .set("Authorization", `Bearer ${userToken}`);
        const ids = response.body.data.map((p) => p.id);
        expect(ids).toContain(postAId);
        expect(ids).toContain(postBId);

        // Restore Read_Own only
        await request(app)
            .patch(`/permissions/${readPerm.id}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ acl_Ids: [byName["Read_Own"]] });
    });

    test("ACL edit propagates through reload without restart", async () => {
        // Create a custom status-scoped ACL and assign as the role's only read ACL
        const created = await request(app).post("/acls").set("Authorization", `Bearer ${adminToken}`).send({
            name: "Read_Published_Only",
            conditions: { status: { eq: "published" } },
            fields: ["*"],
        });
        const perms = await request(app)
            .get("/permissions")
            .query({ filter: JSON.stringify({ AND: [{ collection: { eq: "acl_posts" } }, { action: { eq: "read" } }] }) })
            .set("Authorization", `Bearer ${adminToken}`);
        const readPerm = perms.body.data[0];
        await request(app)
            .patch(`/permissions/${readPerm.id}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ acl_Ids: [created.body.id] });

        // Nothing is published yet — user sees no rows
        const before = await request(app).get("/items/acl_posts").set("Authorization", `Bearer ${userToken}`);
        expect(before.body.data.length).toBe(0);

        // Edit the ACL to match drafts instead — takes effect via route-triggered reload
        await request(app)
            .patch(`/acls/${created.body.id}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ conditions: { status: { eq: "draft" } } });

        const after = await request(app).get("/items/acl_posts").set("Authorization", `Bearer ${userToken}`);
        expect(after.body.data.length).toBeGreaterThan(0);

        // Restore Read_Own for later tests
        const acls = await request(app).get("/acls").set("Authorization", `Bearer ${adminToken}`);
        const byName = Object.fromEntries(acls.body.data.map((e) => [e.name, e.id]));
        await request(app)
            .patch(`/permissions/${readPerm.id}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ acl_Ids: [byName["Read_Own"]] });
    });

    test("Dangling ACL ids fail closed (no access)", async () => {
        await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: userRoleId,
            collection: "acl_posts",
            action: "delete",
            acl_Ids: ["00000000-0000-4000-8000-000000000000"],
        });

        const response = await request(app)
            .delete(`/items/acl_posts/${postAId}`)
            .set("Authorization", `Bearer ${userToken}`);
        expect(response.status).toBe(403);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/acl.test.js`
Expected: earlier sections pass; the new enforcement tests FAIL — with `acl_Ids` set but unexpanded, the permission row's inline conditions are empty `{}`, so "Read_Own: user sees only their own rows" fails (user sees both posts) and "Dangling ACL ids" fails (delete succeeds).

- [ ] **Step 3: Implement expansion in loadPermissions**

In `packages/core/baasix/services/PermissionService.ts`:

Add the import at the top (after line 4):

```ts
import { mergeACLEntries } from '../utils/aclMerge.js';
```

In `loadPermissions()` (line 199), after the permissions are fetched (after the `if (role_Id) {...} else {...}` block ending at line 220), add:

```ts
      // Load all ACL entries once per reload; permissions referencing them are
      // expanded here so the cached shape stays identical for all consumers.
      let aclById = new Map<string, any>();
      try {
        const ACLTable = schemaManager.getTable('baasix_ACL');
        const aclRows = await db.select().from(ACLTable);
        aclById = new Map(aclRows.map((row: any) => [String(row.id), row]));
      } catch (aclError) {
        console.warn('[PermissionService] baasix_ACL table not available yet, skipping ACL expansion');
      }
```

Then replace the body of the per-permission loop (lines 231-246). The existing assignment:

```ts
        rolePermissions[collectionName][permission.action] = {
          fields: this.parseFields(permission.fields),
          conditions: permission.conditions || {},
          relConditions: permission.relConditions || {},
          defaultValues: permission.defaultValues || {},
        };
```

becomes:

```ts
        const aclIds: string[] | null = Array.isArray(permission.acl_Ids) ? permission.acl_Ids : null;

        if (aclIds && aclIds.length > 0) {
          // Named ACL entries replace this row's inline values (additive OR merge)
          const entries = [];
          for (const aclId of aclIds) {
            const entry = aclById.get(String(aclId));
            if (entry) {
              entries.push(entry);
            } else {
              console.warn(
                `[PermissionService] Permission ${permission.id} (${permission.collection}/${permission.action}) references missing ACL ${aclId} — skipping that entry`
              );
            }
          }

          if (entries.length === 0) {
            // Fail closed: no resolvable ACL entries means no access for this action
            console.warn(
              `[PermissionService] Permission ${permission.id} (${permission.collection}/${permission.action}) has no resolvable ACL entries — denying access`
            );
            continue;
          }

          const merged = mergeACLEntries(entries);
          rolePermissions[collectionName][permission.action] = {
            fields: this.parseFields(merged.fields),
            conditions: merged.conditions,
            relConditions: merged.relConditions,
            defaultValues: merged.defaultValues,
          };
        } else {
          rolePermissions[collectionName][permission.action] = {
            fields: this.parseFields(permission.fields),
            conditions: permission.conditions || {},
            relConditions: permission.relConditions || {},
            defaultValues: permission.defaultValues || {},
          };
        }
```

(The `continue` targets the `for (const permission of permissions)` loop. Note the `rolePermissions[collectionName] = rolePermissions[collectionName] || {};` line at 239 stays before this block.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/acl.test.js`
Expected: PASS, all sections.

- [ ] **Step 5: Regression-check the existing permission suite**

Run: `npm test -- test/permission.test.js`
Expected: PASS — inline-conditions permissions behave exactly as before.

- [ ] **Step 6: Commit**

```bash
git add baasix/services/PermissionService.ts test/acl.test.js
git commit -m "feat(acl): expand assigned ACL entries at permission cache load, fail closed on dangling ids"
```

---

### Task 5: Permission route validation for `acl_Ids`

**Files:**
- Modify: `packages/core/baasix/routes/permission.route.ts:48-124` (POST and PATCH handlers)
- Test: `packages/core/test/acl.test.js` (extend)

**Interfaces:**
- Consumes: `/acls` data from Task 2.
- Produces: `POST /permissions` and `PATCH /permissions/:id` reject (400) unknown `acl_Ids` (message lists them) and payloads that set both non-empty `acl_Ids` and any inline `conditions`/`relConditions`/`fields`/`defaultValues`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/acl.test.js`:

```js
describe("Permission acl_Ids validation", () => {
    test("Rejects unknown acl_Ids with 400 listing them", async () => {
        const bogus = "11111111-1111-4111-8111-111111111111";
        const response = await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: userRoleId,
            collection: "acl_validation_collection",
            action: "read",
            acl_Ids: [bogus],
        });
        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toContain(bogus);
    });

    test("Rejects payloads mixing acl_Ids with inline conditions", async () => {
        const acls = await request(app).get("/acls").set("Authorization", `Bearer ${adminToken}`);
        const readAllId = acls.body.data.find((e) => e.name === "Read_All").id;

        const response = await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: userRoleId,
            collection: "acl_validation_collection",
            action: "read",
            acl_Ids: [readAllId],
            conditions: { status: { eq: "published" } },
        });
        expect(response.status).toBe(400);
    });

    test("Rejects non-array acl_Ids", async () => {
        const response = await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: userRoleId,
            collection: "acl_validation_collection",
            action: "read",
            acl_Ids: "not-an-array",
        });
        expect(response.status).toBe(400);
    });

    test("PATCH validates acl_Ids the same way", async () => {
        const created = await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: userRoleId,
            collection: "acl_validation_collection",
            action: "update",
        });
        expect(created.status).toBe(201);

        const response = await request(app)
            .patch(`/permissions/${created.body.id}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ acl_Ids: ["22222222-2222-4222-8222-222222222222"] });
        expect(response.status).toBe(400);

        await request(app).delete(`/permissions/${created.body.id}`).set("Authorization", `Bearer ${adminToken}`);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/acl.test.js`
Expected: the four new tests FAIL (201/200 instead of 400).

- [ ] **Step 3: Implement validation**

In `packages/core/baasix/routes/permission.route.ts`, add after the imports (line 7):

```ts
/**
 * Validate acl_Ids on permission writes:
 * - must be an array of existing baasix_ACL UUIDs
 * - cannot be combined with inline conditions/relConditions/fields/defaultValues
 *   (assigned ACL entries fully replace inline values — one source of truth)
 */
const validateAclIds = async (data: Record<string, any>, accountability: any): Promise<void> => {
    if (data.acl_Ids == null) return;

    if (!Array.isArray(data.acl_Ids) || !data.acl_Ids.every((id: any) => typeof id === "string")) {
        throw new APIError("acl_Ids must be an array of ACL entry UUIDs", 400);
    }

    if (data.acl_Ids.length > 0) {
        const inlineKeys = ["conditions", "relConditions", "fields", "defaultValues"].filter(
            (key) => data[key] != null
        );
        if (inlineKeys.length > 0) {
            throw new APIError(
                `A permission cannot set both acl_Ids and inline ${inlineKeys.join("/")}. Assigned ACL entries replace inline values.`,
                400
            );
        }

        const aclService = new ItemsService("baasix_ACL", { accountability });
        const found = await aclService.readByQuery({
            filter: { id: { in: data.acl_Ids } },
            fields: ["id"],
            limit: -1,
        });
        const foundIds = new Set(found.data.map((e: any) => String(e.id)));
        const unknown = data.acl_Ids.filter((id: string) => !foundIds.has(String(id)));
        if (unknown.length > 0) {
            throw new APIError(`Unknown ACL entry id(s): ${unknown.join(", ")}`, 400);
        }
    }
};
```

In the `POST /permissions` handler, after `const data = req.body;` (line 50), add:

```ts
      await validateAclIds(data, req.accountability);
```

In the `PATCH /permissions/:id` handler, after `const data = req.body;` (line 80), add the same line:

```ts
      await validateAclIds(data, req.accountability);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/acl.test.js`
Expected: PASS, all sections.

- [ ] **Step 5: Regression-check permission suite**

Run: `npm test -- test/permission.test.js`
Expected: PASS (all its payloads use inline conditions without `acl_Ids`, unaffected).

- [ ] **Step 6: Commit**

```bash
git add baasix/routes/permission.route.ts test/acl.test.js
git commit -m "feat(acl): validate acl_Ids on permission writes (existence + no inline mixing)"
```

---

### Task 6: MCP tools with ACL-first guidance

**Files:**
- Modify: `packages/core/baasix/services/MCPService.ts` — new input interfaces near line 216, TOOL_ACTION_MAP entries after line 537, server instructions near line 610, new tools after `baasix_reload_permissions` (line 1745), doc updates to `baasix_create_permission` (line 1603) and `baasix_update_permission` (line 1686)

**Interfaces:**
- Consumes: `/acls` routes from Task 3, permission validation from Task 5.
- Produces: MCP tools `baasix_list_acls`, `baasix_get_acl`, `baasix_create_acl`, `baasix_update_acl`, `baasix_delete_acl`; `acl_Ids` param on `baasix_create_permission` / `baasix_update_permission`.

- [ ] **Step 1: Add input interfaces**

Near the other input interfaces (around `interface CreatePermissionInput` at line 216), add:

```ts
interface ListACLsInput {
  filter?: Record<string, any>;
  sort?: string;
  page?: number;
  limit?: number;
}

interface ACLIdInput {
  id: string;
}

interface CreateACLInput {
  name: string;
  description?: string;
  conditions?: Record<string, any>;
  relConditions?: Record<string, any>;
  fields?: string[];
  defaultValues?: Record<string, any>;
}

interface UpdateACLInput extends Partial<CreateACLInput> {
  id: string;
}
```

Also extend the existing `CreatePermissionInput` and `UpdatePermissionInput` interfaces with:

```ts
  acl_Ids?: string[];
```

- [ ] **Step 2: Register actions in TOOL_ACTION_MAP**

After `baasix_update_permissions: "update",` (line 537), add:

```ts
  baasix_list_acls: "read",
  baasix_get_acl: "read",
  baasix_create_acl: "create",
  baasix_update_acl: "update",
  baasix_delete_acl: "delete",
```

- [ ] **Step 3: Update server instructions**

In the `instructions` template (line 589+), change the task-mapping line at 610 from:

```
- "Set permissions" → use baasix_create_permission or baasix_update_permissions
```

to:

```
- "Set permissions" → PREFER named ACLs: baasix_list_acls to find/reuse an entry, baasix_create_acl if none fits, then baasix_create_permission with acl_Ids. Use inline conditions only for one-off rules.
```

- [ ] **Step 4: Register the five ACL tools**

Insert after the `baasix_reload_permissions` registration (after line 1745), before the Settings section:

```ts
  // ==================== ACL (named permission templates) Tools ====================

  registerTool(
    "baasix_list_acls",
    `List named ACL entries — reusable access-control templates (e.g. Update_Own, Read_All) that can be assigned to permissions via acl_Ids.

ALWAYS check this list before writing inline permission conditions. Reusing a named ACL is preferred because entries are:
- reusable across roles and collections
- self-documenting ("Update_Own" reads better than raw condition JSON)
- centrally editable (fix the rule once — every permission using it updates on reload)

Built-in system entries (system: true, immutable): Read_All, Read_Own, Update_Own, Delete_Own, Own_Tenant. The *_Own entries match rows where userCreated_Id = $CURRENT_USER (collections created with usertrack: true).`,
    {
      filter: z.record(z.any()).optional().describe("Filter, e.g. {\"name\": {\"like\": \"Own\"}} or {\"system\": {\"eq\": true}}"),
      sort: z.string().optional().describe("Sort as 'field:asc' or 'field:desc'"),
      page: z.number().optional().default(1).describe("Page number"),
      limit: z.number().optional().default(-1).describe("Entries per page. Default -1 (all)."),
    },
    async (args: ListACLsInput, extra: ToolExtra): Promise<ToolResult> => {
      const { filter, sort, page, limit } = args;
      try {
        const params = new URLSearchParams();
        if (page) params.set('page', String(page));
        if (limit) params.set('limit', String(limit));
        if (filter) params.set('filter', JSON.stringify(filter));
        if (sort) {
          const [field, direction] = sort.split(":");
          params.set('sort', JSON.stringify([direction?.toLowerCase() === "desc" ? `-${field}` : field]));
        }
        const qs = params.toString();
        const res = await callRoute('GET', `/acls${qs ? '?' + qs : ''}`, extra);
        if (!res.ok) return errorResult(res.error || 'Failed to list ACL entries');
        return successResult(res.data);
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  registerTool(
    "baasix_get_acl",
    "Get a single named ACL entry by UUID, including its conditions, relConditions, fields, and defaultValues.",
    {
      id: z.string().describe("ACL entry UUID — get from baasix_list_acls"),
    },
    async (args: ACLIdInput, extra: ToolExtra): Promise<ToolResult> => {
      try {
        const res = await callRoute('GET', `/acls/${encodeURIComponent(args.id)}`, extra);
        if (!res.ok) return errorResult(res.error || 'Failed to get ACL entry');
        return successResult(res.data);
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  registerTool(
    "baasix_create_acl",
    `Create a named, reusable ACL entry (access-control template) that can be assigned to any permission via acl_Ids.

THIS IS THE PREFERRED WAY to define access rules. Workflow:
1. baasix_list_acls — check whether a matching entry already exists
2. Reuse it via acl_Ids on baasix_create_permission / baasix_update_permission
3. Only if none fits, create a new named entry here — then assign it
Reserve inline permission conditions for genuinely one-off, permission-specific rules.

An ACL entry is a full permission template: conditions, relConditions, fields, defaultValues. When MULTIPLE entries are assigned to one permission they merge ADDITIVELY (OR semantics — more entries can only grant more access):
- conditions: OR'd — {"OR": [entryA, entryB]}. An entry with empty conditions = unrestricted.
- fields: union of all lists; an entry without fields contributes "*"
- defaultValues: shallow-merged in acl_Ids order, later entries win
- relConditions: a relation stays restricted only if EVERY entry restricts it; shared relations OR their conditions

--- CONDITIONS (row-level security / RLS) ---
Same filter operators as baasix_list_items. Enforced as security constraints — ANDed with any user query, cannot be bypassed.
Only published: {"published": {"eq": true}}
Only own records: {"userCreated_Id": {"eq": "$CURRENT_USER"}}
Multiple: {"AND": [{"status": {"in": ["active", "draft"]}}, {"userCreated_Id": {"eq": "$CURRENT_USER"}}]}

DYNAMIC VARIABLES in conditions and defaultValues:
$CURRENT_USER → current user's ID
$CURRENT_USER.fieldName → any field on the user (e.g. $CURRENT_USER.department_Id)
$CURRENT_ROLE → current role ID
$CURRENT_TENANT → current tenant ID
$NOW, $NOW+DAYS_7, $NOW-MONTHS_1 → timestamp math

--- FIELDS (column-level access) ---
["*"] → all columns; ["name", "price"] → only these columns.

--- RELCONDITIONS (RLS on related tables) ---
Keys are relation names: {"category": {"isPublic": {"eq": true}}}

--- DEFAULTVALUES (auto-injected on create/update) ---
{"author_Id": "$CURRENT_USER", "status": "draft"}

--- EXAMPLE: reusable team access ---
baasix_create_acl {"name": "Update_Teams", "conditions": {"team.members.user_Id": {"eq": "$CURRENT_USER"}}, "fields": ["title", "status"]}
then:
baasix_create_permission {"role_Id": "<uuid>", "collection": "tasks", "action": "update", "acl_Ids": ["<Update_Own id>", "<Update_Teams id>"]}
→ the role may update rows it owns OR rows of teams it belongs to (fields union to ["*", "title", "status"]).`,
    {
      name: z.string().describe("Unique name, e.g. Update_Teams. Convention: Action_Scope."),
      description: z.string().optional().describe("What this entry grants — shown in the admin UI"),
      conditions: z.record(z.any()).optional().describe("Row-level security filter. Empty/omitted = unrestricted."),
      relConditions: z.record(z.any()).optional().describe("Row-level security on related tables, keyed by relation name"),
      fields: z.array(z.string()).optional().describe("Allowed columns: [\"*\"] or specific names. Omit for all."),
      defaultValues: z.record(z.any()).optional().describe("Auto-injected values on create/update"),
    },
    async (args: CreateACLInput, extra: ToolExtra): Promise<ToolResult> => {
      try {
        const res = await callRoute('POST', '/acls', extra, args as Record<string, unknown>);
        if (!res.ok) return errorResult(res.error || 'Failed to create ACL entry');
        return successResult(res.data);
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  registerTool(
    "baasix_update_acl",
    `Update a named ACL entry. Only pass fields to change. System entries (system: true) cannot be modified (403).
CAUTION: the change applies to EVERY permission that has this entry assigned, across all roles, on the next cache reload (automatic).
See baasix_create_acl for the full conditions/relConditions/fields/defaultValues reference.`,
    {
      id: z.string().describe("ACL entry UUID — get from baasix_list_acls"),
      name: z.string().optional().describe("Rename the entry (must stay unique)"),
      description: z.string().optional().describe("Change the description"),
      conditions: z.record(z.any()).optional().describe("Change row-level security conditions"),
      relConditions: z.record(z.any()).optional().describe("Change related-table conditions"),
      fields: z.array(z.string()).optional().describe("Change allowed columns"),
      defaultValues: z.record(z.any()).optional().describe("Change auto-injected values"),
    },
    async (args: UpdateACLInput, extra: ToolExtra): Promise<ToolResult> => {
      const { id, ...updateData } = args;
      try {
        const res = await callRoute('PATCH', `/acls/${encodeURIComponent(id)}`, extra, updateData);
        if (!res.ok) return errorResult(res.error || 'Failed to update ACL entry');
        return successResult(res.data);
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  registerTool(
    "baasix_delete_acl",
    "Delete a named ACL entry. Fails with 403 for system entries and 409 if any permission still references it (the error lists the referencing permissions — detach acl_Ids there first).",
    {
      id: z.string().describe("ACL entry UUID — get from baasix_list_acls"),
    },
    async (args: ACLIdInput, extra: ToolExtra): Promise<ToolResult> => {
      try {
        const res = await callRoute('DELETE', `/acls/${encodeURIComponent(args.id)}`, extra);
        if (!res.ok) return errorResult(res.error || 'Failed to delete ACL entry');
        return successResult({ success: true, message: `ACL entry '${args.id}' deleted` });
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );
```

- [ ] **Step 5: Update the permission tools**

`baasix_create_permission` (line 1603): prepend to its description string, right after the first line ("Grant a role permission..."):

```
PREFERRED: assign named ACL entries via acl_Ids instead of writing inline conditions. Workflow: baasix_list_acls → reuse a matching entry → if none fits, baasix_create_acl → assign here. Multiple acl_Ids merge additively (OR). When acl_Ids is set, do NOT pass conditions/relConditions/fields/defaultValues (400 — ACLs replace inline values). Inline conditions remain fine for one-off rules.
```

Add to its zod schema (after `relConditions`, line 1666):

```ts
      acl_Ids: z.array(z.string()).optional().describe("Ordered ACL entry UUIDs (from baasix_list_acls). Replaces inline conditions/fields/etc.; multiple entries OR together (additive)."),
```

And in its handler after `if (relConditions) data.relConditions = relConditions;` (line 1675):

```ts
        if (args.acl_Ids) data.acl_Ids = args.acl_Ids;
```

(also add `acl_Ids` to the destructuring on line 1669 or reference via `args.acl_Ids` as shown).

`baasix_update_permission` (line 1686): add to the description:

```
To switch a permission to named ACLs, pass acl_Ids (and null out inline fields if previously set). Pass acl_Ids: [] to detach all ACL entries and return to inline conditions.
```

Add to its zod schema (after `relConditions`, line 1700):

```ts
      acl_Ids: z.array(z.string()).optional().describe("Ordered ACL entry UUIDs. [] detaches all. Replaces inline values when non-empty."),
```

(its handler spreads `...updateData`, so no handler change is needed.)

- [ ] **Step 6: Verify typecheck and server boot**

Run from `packages/core/`: `npx tsc --noEmit 2>&1 | grep -i "MCPService\|aclMerge\|acl.route" || echo "no new errors"`
Expected: no new errors in the touched files (pre-existing errors elsewhere are out of scope).

Then re-run: `npm test -- test/acl.test.js`
Expected: PASS (server boots with the new tool registrations).

- [ ] **Step 7: Commit**

```bash
git add baasix/services/MCPService.ts
git commit -m "feat(acl): MCP ACL tools with ACL-first guidance in permission tool docs"
```

---

### Task 7: User-facing documentation

**Files:**
- Create: `packages/core/docs/access-control-lists.md`
- Modify: `packages/core/README.md` (Features section, line ~466 where "Permissions — Role-based access control management" is listed)

**Interfaces:** none (documentation only). Content requirements come from the spec's "Usage Documentation (deliverable)" section.

- [ ] **Step 1: Write the guide**

Create `packages/core/docs/access-control-lists.md` covering, in this order (write full prose — this outline lists required content, each bullet becomes a section):

1. **Concept** — what a named ACL entry is; why ACL-first beats inline conditions (reuse across roles/collections, central edits propagate everywhere, `Update_Own` is self-documenting); when inline is still right (one-off rules used exactly once).
2. **Quick start** — full request/response walkthrough: `GET /acls` to list; `POST /permissions` with `{"role_Id": "...", "collection": "tasks", "action": "update", "acl_Ids": ["<Update_Own id>"]}`; verify as the target role. Include the curl commands.
3. **Semantics reference** — multiple ACLs = OR/additive; replace-inline rule (400 on mixing); the four merge rules exactly as in this plan's Global Constraints; dynamic variables table (`$CURRENT_USER`, `$CURRENT_USER.field`, `$CURRENT_ROLE`, `$CURRENT_TENANT`, `$CURRENT_SETTINGS.field`, `$NOW±`).
4. **Built-in entries** — table of the 5 seeds with their exact conditions/fields, the `userCreated_Id` / `usertrack: true` assumption, and the note that a collection with a different owner field needs its own entry (e.g. `Update_Own_Author` with `author_Id`).
5. **Admin UI walkthrough** — Settings → Access Control Lists (manage entries, system badge, usage count); permission drawer ACL picker (ordered multi-select, inline editors disabled while ACLs assigned).
6. **API reference** — the five `/acls` routes with methods, auth (writes admin-only), and error cases: 400 (bad payload / unknown acl_Ids / mixing inline), 403 (system entry write), 409 (delete-in-use, `details.usedBy` shape); plus the five MCP tools by name.

- [ ] **Step 2: Link from README**

In `packages/core/README.md`, find the Features bullet (line ~466):

```
- **Permissions** — Role-based access control management
```

change to:

```
- **Permissions** — Role-based access control management with named, reusable ACL entries ([guide](docs/access-control-lists.md))
```

- [ ] **Step 3: Self-check**

Re-read the guide against the spec's "Usage Documentation (deliverable)" list — all 6 items present, no TBDs, examples use real seeded entry names.

- [ ] **Step 4: Commit**

```bash
git add docs/access-control-lists.md README.md
git commit -m "docs(acl): access control lists usage guide"
```

---

### Task 8: Admin UI — ACL management screen

**Files:**
- Modify: `app/src/providers/data-provider/index.ts` (resource config at line 7-47, plus the `getList`/`getOne`/`create`/`update`/`deleteOne` switches)
- Create: `app/src/components/acls/ACLDrawer.tsx`
- Create: `app/src/components/acls/index.ts`
- Create: `app/src/components/settings/ACLsManagement.tsx`
- Modify: `app/src/components/settings/index.ts` (export ACLsManagement — check the file's existing export style and match it)
- Create: `app/src/app/(authenticated)/settings/acls/page.tsx`
- Modify: `app/src/components/layout/ExpandableSidebar.tsx:420-428` (settings items) — also grep `CompactSidebar.tsx` for the same `settingsItems`/"Permissions" list and mirror the addition if present

**Interfaces:**
- Consumes: `/acls` routes (Task 3) via `baasix.request` (raw HttpClient — `baasix.request.get/post/patch/delete`, available on the installed SDK).
- Produces: refine resource `"acls"`; `ACLDrawer` props `{ open, onClose, aclId?, mode: "create" | "edit" }`; settings page at `/settings/acls`.

Note: this folder may not be a git repository (it is outside the `baasix/` repo) — if `git -C app rev-parse` fails, skip the commit steps for app files and note it in the task report. There are no automated tests in `app/`; verification is `npm run build` (NEVER while a dev server is running — see memory note) or visual via the dev server on **:3001** (check :3000's owner first; never kill it).

- [ ] **Step 1: Add the `acls` resource to the data provider**

In `app/src/providers/data-provider/index.ts`:

In `getResourceConfig` (after the permissions branch at line 21):

```ts
  // Named ACL entries (reusable permission templates)
  if (resource === "acls" || resource === "baasix_ACL") {
    return { type: "acls" as const };
  }
```

In the `getList` switch (after `case "permissions":` at line 359-361):

```ts
          case "acls": {
            const qs = new URLSearchParams();
            qs.set("page", String(params.page));
            qs.set("limit", String(params.limit));
            if (params.filter && Object.keys(params.filter).length > 0) {
              qs.set("filter", JSON.stringify(params.filter));
            }
            if (params.sort) qs.set("sort", JSON.stringify(params.sort));
            response = await baasix.request.get(`/acls?${qs.toString()}`);
            break;
          }
```

In the `getOne` switch (after `case "permissions":` at line 395-397):

```ts
          case "acls": {
            const response = await baasix.request.get(`/acls/${id}`);
            data = response.data;
            break;
          }
```

In the `create` switch (after `case "permissions":` at line 435-437):

```ts
          case "acls":
            data = await baasix.request.post("/acls", variables as any);
            break;
```

In the `update` switch (after `case "permissions":` at line 471-473):

```ts
          case "acls":
            data = await baasix.request.patch(`/acls/${id}`, variables as any);
            break;
```

In the `deleteOne` switch (after `case "permissions":` at line 506-508):

```ts
          case "acls":
            await baasix.request.delete(`/acls/${id}`);
            break;
```

Before relying on these, open the SDK's HttpClient typing (`app/node_modules/@baasix/sdk/dist/index.d.ts:2222-2233`) and confirm the get/post/patch/delete signatures (`get(path)`, `post(path, body)` etc.); adjust the calls if the client wraps responses differently (e.g. returns `{ data }` vs the raw body — mirror whatever `baasix.permissions.find` returns so `getList` keeps yielding `{ data, total }`).

- [ ] **Step 2: Create the ACL drawer**

Create `app/src/components/acls/ACLDrawer.tsx` — follow `PermissionDrawer.tsx` structure (Sheet + form + delete Dialog + refine hooks) with these differences:

- Form state: `{ name: string; description: string; conditions: any; relConditions: any; fields: string[] | null; defaultValues: any }`.
- `useOne({ resource: "acls", id: aclId, queryOptions: { enabled: open && mode === "edit" && !!aclId } })`, `useCreate`/`useUpdate`/`useDelete` against resource `"acls"`.
- Fields: `name` (required text Input), `description` (Textarea), then four `JSONField` editors for `conditions`, `relConditions`, `fields` (JSON array, placeholder `'["*"]'`), `defaultValues` — same `JSONField` component as PermissionDrawer.tsx:504-560.
- When editing an entry with `system === true`: render all inputs `disabled`, hide Save/Delete, and show a Badge "System entry — read-only".
- Validation before submit: non-empty `name`; error toasts on failure exactly like PermissionDrawer's `onError` handlers (surface `error.message` — the 403/409 messages from the routes are user-readable).
- On delete error (409): show the server message in the toast so the admin sees which permissions still use the entry.

Create `app/src/components/acls/index.ts`:

```ts
export { ACLDrawer } from "./ACLDrawer";
```

- [ ] **Step 3: Create the management screen**

Create `app/src/components/settings/ACLsManagement.tsx` — follow the structure of `PermissionsManagement.tsx` (read it first): page header ("Access Control Lists" + description "Named, reusable permission templates. Assign one or more to a permission; multiple entries combine additively (OR)."), a "Create ACL" Button, and a table via `useList({ resource: "acls", pagination: { pageSize: -1 } })` with columns:

- **Name** (mono font)
- **Description**
- **System** — Badge when `system === true`
- **Used by** — count of permissions referencing the entry. Fetch once with `useList({ resource: "permissions", pagination: { pageSize: -1 }, meta: { fields: ["id", "acl_Ids"] } })` and count client-side: `permissions.filter(p => Array.isArray(p.acl_Ids) && p.acl_Ids.includes(entry.id)).length`.
- Row click → opens `ACLDrawer` in edit mode.

Register the export in `app/src/components/settings/index.ts` following the existing pattern in that file.

- [ ] **Step 4: Create the page and sidebar entry**

Create `app/src/app/(authenticated)/settings/acls/page.tsx`:

```tsx
"use client";

import React from "react";
import { ACLsManagement } from "@/components/settings";

const ACLsPage: React.FC = () => {
    return <ACLsManagement />;
};

export default ACLsPage;
```

In `app/src/components/layout/ExpandableSidebar.tsx` (line 420-428), add after the permissions item:

```ts
                    { key: "acls", label: "Access Control Lists" },
```

Then `grep -n "permissions" app/src/components/layout/CompactSidebar.tsx` — if it has the same settings list, add the same entry there.

- [ ] **Step 5: Verify**

From `app/`: ensure no dev server is running (`.next` collision — see Global Constraints), then `npm run build`.
Expected: build succeeds. Optionally verify visually: start dev on :3001, open Settings → Access Control Lists, confirm the 5 system entries render with System badges, create/edit/delete a custom entry, confirm deleting a system entry is blocked.

- [ ] **Step 6: Commit (if `app/` is a git repo)**

```bash
git -C app rev-parse 2>/dev/null && git -C app add src/providers/data-provider/index.ts src/components/acls src/components/settings src/app/\(authenticated\)/settings/acls src/components/layout && git -C app commit -m "feat(acl): ACL management screen in settings"
```

---

### Task 9: Admin UI — ACL picker in the permission drawer

**Files:**
- Modify: `app/src/components/permissions/PermissionDrawer.tsx`

**Interfaces:**
- Consumes: resource `"acls"` from Task 8; `acl_Ids` on permission payloads (Tasks 2/5).
- Produces: permission create/edit payloads that send either `acl_Ids` or inline values, never both.

- [ ] **Step 1: Extend form state and loading**

In `PermissionDrawer.tsx`:

- Add `acl_Ids: string[]` to the `formData` type and initial state (line 184-200): `acl_Ids: []`.
- In the edit-mode `useEffect` (line 249-257) add `acl_Ids: Array.isArray(data.acl_Ids) ? data.acl_Ids : [],`; in create mode and `handleClose` reset to `[]`.
- Load ACL entries: `const { data: aclsData } = useList({ resource: "acls", pagination: { pageSize: -1 }, queryOptions: { enabled: open } });` and `const aclEntries = useMemo(() => aclsData?.data || [], [aclsData]);`.

- [ ] **Step 2: Render the picker**

Insert a new section in the form ABOVE the Fields section (before line 468), visible for every action:

- Label "Access Control Lists" with helper text: *"Assign named ACL entries instead of inline rules. Multiple entries combine additively (OR) — order matters for default values. When any are assigned, the inline editors below are disabled."*
- An ordered multi-select: render `formData.acl_Ids` as a vertical list of rows (entry name + `system` Badge + up/down arrow Buttons to reorder + X Button to remove), followed by a select/dropdown of not-yet-assigned entries (`aclEntries.filter(e => !formData.acl_Ids.includes(e.id))`) with an "Add" action appending to `formData.acl_Ids`. Use existing shadcn `Button`, `Badge`, `Card` components; a simple Select from `@/components/ui/select` is fine (check it exists; PermissionsManagement.tsx will show the app's select idiom — reuse it).
- Below the list, when `formData.acl_Ids.length > 0`, render a read-only merged-conditions preview inside a `Card`:

```tsx
{formData.acl_Ids.length > 0 && (
    <Card>
        <CardContent className="p-3">
            <p className="text-xs font-medium mb-1">Effective conditions (OR-combined)</p>
            <pre className="text-xs overflow-x-auto">
                {JSON.stringify(
                    formData.acl_Ids.length === 1
                        ? aclEntries.find((e: any) => e.id === formData.acl_Ids[0])?.conditions ?? {}
                        : { OR: formData.acl_Ids.map((id) => aclEntries.find((e: any) => e.id === id)?.conditions ?? {}) },
                    null,
                    2
                )}
            </pre>
        </CardContent>
    </Card>
)}
```

- [ ] **Step 3: Disable inline editors while ACLs are assigned**

Wrap the existing Fields / Conditions / Relational Conditions / Default Values sections (lines 468-562): when `formData.acl_Ids.length > 0`, replace them with a single muted note:

```tsx
<p className="text-sm text-muted-foreground border rounded-md p-3">
    Fields, conditions, and default values are defined by the assigned ACL entries (OR-combined).
    Remove all ACL entries to edit inline values.
</p>
```

(conditional render: `{formData.acl_Ids.length === 0 && ( ...existing four sections... )}`).

- [ ] **Step 4: Fix the submit payload**

Replace the `formattedValues` construction (line 323-331) with:

```tsx
            const usingACLs = formData.acl_Ids.length > 0;
            const formattedValues = {
                collection: formData.collection,
                role_Id: formData.role_Id,
                action: formData.action,
                acl_Ids: formData.acl_Ids,
                // acl_Ids and inline values are mutually exclusive (server enforces 400)
                fields: usingACLs ? null : (formData.fields.length > 0 ? formData.fields : ["*"]),
                conditions: usingACLs ? null : (formData.conditions || null),
                relConditions: usingACLs ? null : (formData.relConditions || null),
                defaultValues: usingACLs ? null : (formData.defaultValues || null),
            };
```

- [ ] **Step 5: Verify**

From `app/` (no dev server running): `npm run build`.
Expected: build succeeds. Visual check on :3001: open Settings → Permissions, edit a permission, assign `Update_Own` + `Read_All`, confirm inline editors collapse to the note and the preview shows the OR JSON; save; reopen and confirm `acl_Ids` round-trips; remove all entries and confirm inline editors return.

- [ ] **Step 6: Commit (if `app/` is a git repo)**

```bash
git -C app rev-parse 2>/dev/null && git -C app add src/components/permissions/PermissionDrawer.tsx && git -C app commit -m "feat(acl): ACL picker with additive-merge preview in permission drawer"
```

---

### Task 10: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Run the feature suites sequentially (never in parallel)**

From `packages/core/`, one at a time:

```bash
npm test -- test/aclMerge.test.js
npm test -- test/acl.test.js
npm test -- test/permission.test.js
npm test -- test/defaultValues.test.js
```

Expected: all PASS. (`permission.test.js` and `defaultValues.test.js` are the regression canaries for the PermissionService and permission-route changes. Known flaky files per memory notes are unrelated to this feature.)

- [ ] **Step 2: Typecheck**

From `packages/core/`: `npx tsc --noEmit 2>&1 | grep -iE "aclMerge|acl\.route|permission\.route|PermissionService|MCPService|schemaManager|systemschema" || echo "no new errors"`
Expected: `no new errors`.

- [ ] **Step 3: Spec coverage check**

Walk the spec (`docs/superpowers/specs/2026-07-06-named-acl-permissions-design.md`) section by section and confirm: data model (Task 2), merge semantics (Tasks 1/4), fail-closed (Task 4), cache invalidation (Tasks 3/4), API surface incl. error codes (Tasks 3/5), MCP ACL-first (Task 6), usage docs (Task 7), admin UI both pieces (Tasks 8/9). Note the one deliberate deviation for the final report: seeding is idempotent-at-startup instead of a migration file (rationale in the plan header).

- [ ] **Step 4: Commit any stragglers and report**

```bash
git status --short
```

Everything backend should already be committed per-task. Report results to the user, including test output summaries and the seeding deviation.
