# `$CURRENT_USERROLE` Variable + Assignment Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the active `baasix_UserRole` row to permissions/defaultValues via a new `$CURRENT_USERROLE` dynamic variable, and let users switch between role assignments (rows) via `/auth/switch-tenant` with the exact row pinned in the JWT.

**Architecture:** The JWT gains an optional `userRole_Id`; the auth middleware loads the full pinned row (fallback: oldest row for `(user, tenant)`) onto `accountability.userRole`; the dynamic-variable resolver adds `CURRENT_USERROLE` as a fourth sibling target (flat fields in-memory, dotted paths via `ItemsService("baasix_UserRole")` relational expansion). `/auth/switch-tenant` accepts `userRole_Id`, and `/auth/refresh` preserves it.

**Tech Stack:** TypeScript ESM, Express, Drizzle ORM (Postgres), Jest + supertest integration tests.

**Spec:** `docs/superpowers/specs/2026-07-15-userrole-fields-in-permissions-design.md`

## Global Constraints

- Repo root: `/home/vivek/Documents/NodeJS/baasix/baasix-drizzle/baasix` (git repo). Core package: `packages/core`. All commands below run from `packages/core` unless stated.
- Tests: integration `.test.js` files in `packages/core/test/`, run as `npm test -- test/<file>.test.js`. **Never run two jest invocations concurrently** (shared test DB).
- `@baasix/types` (`packages/types`) compiles to `dist/` — after editing its `src/`, run `npm run build` inside `packages/types`.
- `$CURRENT_USER.role` (bare) MUST keep resolving to the role **name string** — regression-guarded by existing suites.
- Legacy tokens (no `userRole_Id`) must keep working: fallback lookup = oldest row (`ORDER BY "createdAt" ASC`) for `(user_Id, tenant_Id)`.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Type + token plumbing (`userRole_Id` in JWT, `userRole` on Accountability)

**Files:**
- Modify: `packages/types/src/auth.ts:163-169` (Accountability)
- Modify: `packages/core/baasix/auth/types.ts:443-450` (JWTPayload)
- Modify: `packages/core/baasix/auth/services/token.ts:42-47, 84-96` (generateUserToken)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `Accountability.userRole?: Record<string, any>`; `JWTPayload.userRole_Id?: string | null`; `generateUserToken({ user, role, session, tenant?, userRoleId? })` — later tasks rely on these exact names.

- [ ] **Step 1: Add `userRole` to Accountability** in `packages/types/src/auth.ts`:

```ts
export interface Accountability {
  user?: { id: string | number; email?: string; isAdmin?: boolean; [key: string]: any };
  role?: { id: string | number; name?: string; isTenantSpecific?: boolean } | string | number;
  /** Full active baasix_UserRole row (assignment) — custom columns included. */
  userRole?: Record<string, any>;
  permissions?: any[];
  tenant?: string | number;
  ipaddress?: string;
}
```

- [ ] **Step 2: Add `userRole_Id` to JWTPayload** in `packages/core/baasix/auth/types.ts`:

```ts
export interface JWTPayload {
  id: string;
  role_Id?: string;
  tenant_Id?: string | null;
  /** Pinned baasix_UserRole row id (assignment switching). Absent on legacy tokens. */
  userRole_Id?: string | null;
  sessionToken: string;
  iat?: number;
  exp?: number;
}
```

- [ ] **Step 3: Extend `generateUserToken`** in `packages/core/baasix/auth/services/token.ts`. Interface (line 42):

```ts
  generateUserToken(data: {
    user: User;
    role: Role;
    session: Session;
    tenant?: Tenant | null;
    userRoleId?: string | null;
  }): string;
```

Implementation (line 84):

```ts
    generateUserToken({ user, role, session, tenant, userRoleId }) {
      const payload: Partial<JWTPayload> = {
        id: user.id,
        role_Id: role.id,
        sessionToken: session.token,
      };

      if (tenant) {
        payload.tenant_Id = tenant.id;
      }

      if (userRoleId) {
        payload.userRole_Id = userRoleId;
      }

      return this.generateToken(payload);
    },
```

- [ ] **Step 4: Build the types package**

Run: `cd ../types && npm run build && cd ../core`
Expected: tsup build succeeds, `dist/` refreshed.

- [ ] **Step 5: Typecheck core**

Run: `npx tsc --noEmit 2>&1 | tail -20`
Expected: no NEW errors (compare against `git stash`-clean run if unsure; pre-existing errors, if any, are not yours).

- [ ] **Step 6: Commit**

```bash
git add ../types/src/auth.ts baasix/auth/types.ts baasix/auth/services/token.ts
git commit -m "feat(auth): userRole_Id in JWT payload, userRole on Accountability"
```

---

### Task 2: Middleware + shared auth util load the full assignment row

**Files:**
- Modify: `packages/core/baasix/utils/auth.ts:167-288` (getUserRolesPermissionsAndTenant), `:401-473` (authMiddleware)
- Modify: `packages/core/baasix/services/SocketService.ts:338` (pass userRole_Id through)

**Interfaces:**
- Consumes: `JWTPayload.userRole_Id` (Task 1).
- Produces: `req.accountability.userRole` = full row (plain object) or `undefined`; `getUserRolesPermissionsAndTenant(userId, tenantId?, userRoleId?)` now returns `{ role, permissions, tenant?, userRole? }`.

- [ ] **Step 1: authMiddleware — pinned lookup + full row.** In `packages/core/baasix/utils/auth.ts`, add `asc` to the existing `drizzle-orm` import (the file already imports `and`, `eq`). Replace the assignment-lookup block (currently lines 401-436, from `const cache = getCache();` through the `cache.set` block) with:

```ts
    // Get user's role assignment — cached, invalidated by baasix_UserRole hook
    const cache = getCache();
    const tenantKey = payload.tenant_Id ?? 'global';
    const pinnedUserRoleId = payload.userRole_Id ?? null;
    const userRoleCacheKey = pinnedUserRoleId
      ? `auth:userrole:${user.id}:ur:${pinnedUserRoleId}`
      : `auth:userrole:${user.id}:${tenantKey}`;
    let userRole = await cache.get(userRoleCacheKey);

    if (!userRole) {
      const userRoleTable = schemaManager.getTable("baasix_UserRole");
      let userRoles: any[] | undefined;

      // Pinned assignment (token carries userRole_Id) — must belong to this user
      if (pinnedUserRoleId) {
        userRoles = await db
          .select()
          .from(userRoleTable)
          .where(and(
            eq(userRoleTable.id, pinnedUserRoleId),
            eq(userRoleTable.user_Id, user.id)
          ))
          .limit(1);
      }

      // Legacy tokens, or pinned row deleted mid-session: oldest assignment wins
      if (!userRoles || userRoles.length === 0) {
        if (payload.tenant_Id !== undefined && payload.tenant_Id !== null) {
          userRoles = await db
            .select()
            .from(userRoleTable)
            .where(and(
              eq(userRoleTable.user_Id, user.id),
              eq(userRoleTable.tenant_Id, payload.tenant_Id)
            ))
            .orderBy(asc(userRoleTable.createdAt))
            .limit(1);
        } else {
          userRoles = await db
            .select()
            .from(userRoleTable)
            .where(eq(userRoleTable.user_Id, user.id))
            .orderBy(asc(userRoleTable.createdAt))
            .limit(1);
        }
      }
      userRole = userRoles?.[0] || null;
      if (userRole) {
        await cache.set(userRoleCacheKey, userRole); // Hybrid key: TTL ignored, invalidated by baasix_UserRole hook
      }
    }
```

Note: `.select()` with no projection returns ALL columns — custom fields included. `createdAt` exists (`baasix_UserRole` has `timestamps: true`).

- [ ] **Step 2: put the row on accountability.** In the same function, the `req.accountability = { ... }` literal (currently lines 463-473) gains one property after `tenant`:

```ts
    req.accountability = {
      user: {
        ...sanitizedUser,
        isAdmin: isAdmin,
        role: role.name,
      } as any,
      role: role as any,
      tenant: tenantContext,
      userRole: userRole || undefined,
      permissions: permissions || [],
      ipaddress: req.ip || req.connection?.remoteAddress,
    };
```

`user.role` stays the name string — do not change it.

- [ ] **Step 3: getUserRolesPermissionsAndTenant — full row + optional pin.** Same file, lines 167-288. Change signature and return type:

```ts
export async function getUserRolesPermissionsAndTenant(
  userId: string | number,
  tenantId: string | number | null = null,
  userRoleId: string | number | null = null
): Promise<{
  role: {
    id: string | number;
    name: string;
    description?: string;
    isTenantSpecific?: boolean;
  };
  permissions: any;
  tenant?: any;
  userRole?: any;
}> {
```

Replace the `let userRoles; if (tenantId) {...} else {...}` block (lines 184-207) with the following. Control-flow constraint: when a `tenantId` was given and has no rows, do NOT fall through to an any-tenant lookup — the original "User role not found" error must still fire (the `userRoles.length === 0` throw below the block is unchanged). Only a stale `userRoleId` falls back:

```ts
    let userRoles: any[] = [];
    if (userRoleId) {
      userRoles = await sql`
        SELECT ur.*
        FROM "baasix_UserRole" ur
        WHERE ur.id = ${userRoleId} AND ur."user_Id" = ${userId}
        LIMIT 1
      `;
    }
    if (userRoles.length === 0) {
      if (tenantId) {
        userRoles = await sql`
          SELECT ur.*
          FROM "baasix_UserRole" ur
          WHERE ur."user_Id" = ${userId} AND ur."tenant_Id" = ${tenantId}
          ORDER BY ur."createdAt" ASC
          LIMIT 1
        `;
      } else {
        userRoles = await sql`
          SELECT ur.*
          FROM "baasix_UserRole" ur
          WHERE ur."user_Id" = ${userId}
          ORDER BY ur."createdAt" ASC
          LIMIT 1
        `;
      }
    }
```

The rest of the function references `userRole.role_Id` / `userRole.tenant_Id` — `SELECT ur.*` still provides both (drop the old aliased-column shape; `userRoleId` alias is gone, use `userRole.id` if needed). Extend the final return:

```ts
    return {
      role: {
        id: role.id,
        name: role.name,
        description: role.description,
        isTenantSpecific: role.isTenantSpecific,
      },
      permissions: permissionsObj,
      tenant,
      userRole,
    };
```

- [ ] **Step 4: SocketService passes the pin through.** In `packages/core/baasix/services/SocketService.ts` line 338, change:

```ts
    const { role, permissions, tenant } = await getUserRolesPermissionsAndTenant(decoded.id, decoded.tenant_Id);
```

to:

```ts
    const { role, permissions, tenant, userRole } = await getUserRolesPermissionsAndTenant(decoded.id, decoded.tenant_Id, decoded.userRole_Id ?? null);
```

Then run `grep -n "accountability" baasix/services/SocketService.ts` — for every accountability object the socket layer constructs from these values (objects that set `user`/`role`/`tenant` together), add `userRole` alongside. If the socket stores them as `socket.userRole = role` style properties (line 327), also store `socket.userRoleRow = userRole;` next to it and include `userRole: socket.userRoleRow` wherever an Accountability object is later assembled from socket properties.

- [ ] **Step 5: Typecheck + regression**

Run: `npx tsc --noEmit 2>&1 | tail -20`
Expected: no new errors.

Run: `npm test -- test/auth.test.js`
Expected: PASS (middleware behavior unchanged for legacy tokens; full-row select is invisible to existing assertions).

- [ ] **Step 6: Commit**

```bash
git add baasix/utils/auth.ts baasix/services/SocketService.ts
git commit -m "feat(auth): middleware loads full pinned UserRole row onto accountability"
```

---

### Task 3: Resolver — `$CURRENT_USERROLE` (TDD)

**Files:**
- Modify: `packages/core/baasix/utils/dynamicVariableResolver.ts`
- Test: `packages/core/test/userRoleVariable.test.js` (create)

**Interfaces:**
- Consumes: `accountability.userRole` (Task 2).
- Produces: `$CURRENT_USERROLE` → row id; `$CURRENT_USERROLE.<flat>` → row column; `$CURRENT_USERROLE.<rel>.<field>` → relational expansion. Used by Task 4's tests.

- [ ] **Step 1: Write the failing integration test.** Create `packages/core/test/userRoleVariable.test.js`:

```js
import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, test, expect, describe } from "@jest/globals";

let app;
let adminToken;
let userToken; // legacy-style token: no pinned assignment
let testUserId;
let roleId;
let teamAlphaId;
let teamBetaId;
let assignmentA; // oldest assignment -> Team Alpha
let assignmentB; // second assignment -> Team Beta

const admin = () => ({ Authorization: `Bearer ${adminToken}` });

beforeAll(async () => {
    await destroyAllTablesInDB();
    app = await startServerForTesting();

    const adminLogin = await request(app).post("/auth/login").send({
        email: "admin@baasix.com",
        password: "admin@123",
    });
    adminToken = adminLogin.body.token;

    const reg = await request(app).post("/auth/register").send({
        firstName: "Team",
        lastName: "User",
        email: "teamuser@test.com",
        password: "userpassword",
    });
    testUserId = reg.body.user.id;
    roleId = reg.body.role.id;

    // Teams collection
    await request(app).post("/schemas").set(admin()).send({
        collectionName: "teams",
        schema: {
            name: "Team",
            fields: {
                id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                name: { type: "String", allowNull: false },
            },
        },
    });

    // M2O on the JOIN TABLE: adds team_Id FK + `team` BelongsTo alias to baasix_UserRole
    await request(app).post("/schemas/baasix_UserRole/relationships").set(admin()).send({
        type: "M2O",
        target: "teams",
        name: "team",
        alias: "memberships",
    });

    // Item create responses are 201 with { data: { id } }
    const alpha = await request(app).post("/items/teams").set(admin()).send({ name: "Team Alpha" });
    teamAlphaId = alpha.body.data.id;
    const beta = await request(app).post("/items/teams").set(admin()).send({ name: "Team Beta" });
    teamBetaId = beta.body.data.id;

    // Assignment A = the user's existing (oldest) row, pointed at Team Alpha.
    // Register may or may not have created one — handle both.
    const existing = await request(app)
        .get("/items/baasix_UserRole")
        .query({ filter: JSON.stringify({ user_Id: { eq: testUserId } }) })
        .set(admin());
    if (existing.body.data?.length > 0) {
        assignmentA = existing.body.data[0].id;
        await request(app)
            .patch(`/items/baasix_UserRole/${assignmentA}`)
            .set(admin())
            .send({ team_Id: teamAlphaId });
    } else {
        const created = await request(app).post("/items/baasix_UserRole").set(admin()).send({
            user_Id: testUserId,
            role_Id: roleId,
            team_Id: teamAlphaId,
        });
        assignmentA = created.body.data.id;
    }

    // Assignment B = same user, SAME role, different team
    const createdB = await request(app).post("/items/baasix_UserRole").set(admin()).send({
        user_Id: testUserId,
        role_Id: roleId,
        team_Id: teamBetaId,
    });
    assignmentB = createdB.body.data.id;

    // Tasks collection
    await request(app).post("/schemas").set(admin()).send({
        collectionName: "tasks",
        schema: {
            name: "Task",
            fields: {
                id: { type: "Integer", primaryKey: true, defaultValue: { type: "AUTOINCREMENT" } },
                title: { type: "String", allowNull: false },
                team_Id: { type: "UUID", allowNull: true },
                teamName: { type: "String", allowNull: true },
            },
        },
    });

    // Permissions on tasks for the test user's role:
    // create -> defaultValues stamp team from the ACTIVE ASSIGNMENT (flat + relational)
    await request(app).post("/permissions").set(admin()).send({
        role_Id: roleId,
        collection: "tasks",
        action: "create",
        fields: "*",
        defaultValues: {
            team_Id: "$CURRENT_USERROLE.team_Id",
            teamName: "$CURRENT_USERROLE.team.name",
        },
    });
    // read -> team-scoped
    await request(app).post("/permissions").set(admin()).send({
        role_Id: roleId,
        collection: "tasks",
        action: "read",
        fields: "*",
        conditions: { team_Id: { eq: "$CURRENT_USERROLE.team_Id" } },
    });

    const login = await request(app).post("/auth/login").send({
        email: "teamuser@test.com",
        password: "userpassword",
    });
    userToken = login.body.token;
});

describe("$CURRENT_USERROLE resolution (unpinned token -> oldest assignment)", () => {
    test("defaultValues stamps flat custom field team_Id from active assignment", async () => {
        const res = await request(app)
            .post("/items/tasks")
            .set("Authorization", `Bearer ${userToken}`)
            .send({ title: "Alpha task 1" });
        expect(res.status).toBe(201);

        const created = await request(app)
            .get(`/items/tasks/${res.body.data.id}`)
            .set(admin());
        expect(created.body.data.team_Id).toBe(teamAlphaId);
    });

    test("defaultValues resolves relational path team.name", async () => {
        const res = await request(app)
            .post("/items/tasks")
            .set("Authorization", `Bearer ${userToken}`)
            .send({ title: "Alpha task 2" });
        expect(res.status).toBe(201);

        const created = await request(app)
            .get(`/items/tasks/${res.body.data.id}`)
            .set(admin());
        expect(created.body.data.teamName).toBe("Team Alpha");
    });

    test("read condition team-scopes the list", async () => {
        // seed one task per team as admin (admin bypasses defaultValues stamping)
        await request(app).post("/items/tasks").set(admin()).send({ title: "admin alpha", team_Id: teamAlphaId });
        await request(app).post("/items/tasks").set(admin()).send({ title: "admin beta", team_Id: teamBetaId });

        const list = await request(app)
            .get("/items/tasks")
            .set("Authorization", `Bearer ${userToken}`);
        expect(list.status).toBe(200);
        const teamIds = [...new Set(list.body.data.map((t) => t.team_Id))];
        expect(teamIds).toEqual([teamAlphaId]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/userRoleVariable.test.js`
Expected: FAIL — `team_Id` comes back `null`/`undefined` (the literal `$CURRENT_USERROLE.team_Id` string is not a known variable, so it passes through / resolves to nothing).

- [ ] **Step 3: Implement `CURRENT_USERROLE` in the resolver.** In `packages/core/baasix/utils/dynamicVariableResolver.ts`:

3a. Header doc comment (lines 1-12): add two lines to the list:

```
 * - $CURRENT_USERROLE -> active baasix_UserRole assignment row id
 * - $CURRENT_USERROLE.field / $CURRENT_USERROLE.rel.field -> assignment fields (custom columns, relations)
```

3b. `collectVariables` — all THREE target checks (string branch line 89, array branch line 105, object-key branch line 126) change from:

```ts
if (target === "CURRENT_USER" || target === "CURRENT_ROLE" || target === "CURRENT_TENANT" || target === "CURRENT_SETTINGS") {
```

to:

```ts
if (target === "CURRENT_USER" || target === "CURRENT_ROLE" || target === "CURRENT_USERROLE" || target === "CURRENT_TENANT" || target === "CURRENT_SETTINGS") {
```

3c. `replaceVariables` — BOTH target checks (string branch line 315, object-key branch line 336): same addition of `|| target === "CURRENT_USERROLE"`.

3d. `resolveDynamicVariables` — init map (line 360) and `resolveCollectedVariables` init (line 150) each gain:

```ts
    CURRENT_USERROLE: new Set(),
```
```ts
    CURRENT_USERROLE: {},
```

3e. In `resolveCollectedVariables`, AFTER the existing `CURRENT_ROLE` block (line 296) and before the final `return resolved;`, add:

```ts
  // Resolve CURRENT_USERROLE - the active baasix_UserRole assignment row
  // (accountability.userRole, loaded in full by the auth middleware).
  const accUserRole = (accountability as any)?.userRole;
  if (variablesToResolve.CURRENT_USERROLE.size > 0 && accUserRole?.id) {
    const fields = Array.from(variablesToResolve.CURRENT_USERROLE);

    // Flat fields come straight off the in-memory row; dotted paths need a
    // DB query with relational expansion (same pattern as CURRENT_ROLE).
    const inMemory: Record<string, any> = { id: accUserRole.id };
    const relationalFields: string[] = [];

    for (const field of fields) {
      if (field.includes('.')) {
        relationalFields.push(field);
      } else if (field in accUserRole) {
        inMemory[field] = accUserRole[field];
      }
    }

    resolved.CURRENT_USERROLE = inMemory;

    if (relationalFields.length > 0) {
      try {
        const userRoleItemsService = new ItemsService("baasix_UserRole", { accountability: undefined });
        const dbRow = await userRoleItemsService.readOne(accUserRole.id, {
          fields: ['id', ...relationalFields],
        });
        resolved.CURRENT_USERROLE = { ...inMemory, ...(dbRow || {}) };
      } catch (error: any) {
        console.error(`Error resolving userRole data: ${error.message}`);
      }
    }
  }
```

Placement: after the `CURRENT_ROLE` block, i.e. below the `if (!accountability?.user?.id) return resolved;` early return — correct, because `CURRENT_USERROLE` requires a logged-in user (public requests have no assignment and resolve to `null` via the empty `{}`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/userRoleVariable.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Regression — bare `$CURRENT_USER.role` and existing variables**

Run: `npm test -- test/defaultValues.test.js`
Expected: PASS.

Run: `npm test -- test/permission.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add baasix/utils/dynamicVariableResolver.ts test/userRoleVariable.test.js
git commit -m "feat(permissions): \$CURRENT_USERROLE dynamic variable (flat + relational)"
```

---

### Task 4: Assignment switching — `/auth/switch-tenant` accepts `userRole_Id`, `/auth/refresh` preserves it (TDD)

**Files:**
- Modify: `packages/core/baasix/auth/routes.ts:1350-1445` (switch-tenant), `:664-725` (refresh)
- Modify: `packages/core/baasix/auth/adapters/baasix-adapter.ts:386-400` (deterministic order)
- Test: `packages/core/test/userRoleVariable.test.js` (extend)

**Interfaces:**
- Consumes: `generateUserToken({ ..., userRoleId })` (Task 1), middleware pinning (Task 2), `$CURRENT_USERROLE` (Task 3).
- Produces: `POST /auth/switch-tenant { userRole_Id }` → `{ token, userRole_Id, tenant, role }`; refresh carries `userRole_Id` forward. Task 5 reuses nothing further.

- [ ] **Step 1: Write the failing tests.** Append to `packages/core/test/userRoleVariable.test.js`:

```js
describe("assignment switching via /auth/switch-tenant { userRole_Id }", () => {
    let switchedToken;

    test("switch to assignment B returns a pinned token", async () => {
        const res = await request(app)
            .post("/auth/switch-tenant")
            .set("Authorization", `Bearer ${userToken}`)
            .send({ userRole_Id: assignmentB });
        expect(res.status).toBe(200);
        expect(res.body.token).toBeDefined();
        expect(res.body.userRole_Id).toBe(assignmentB);
        switchedToken = res.body.token;
    });

    test("switched token stamps and reads Team Beta", async () => {
        const create = await request(app)
            .post("/items/tasks")
            .set("Authorization", `Bearer ${switchedToken}`)
            .send({ title: "Beta task 1" });
        expect(create.status).toBe(201);

        const created = await request(app)
            .get(`/items/tasks/${create.body.data.id}`)
            .set(admin());
        expect(created.body.data.team_Id).toBe(teamBetaId);
        expect(created.body.data.teamName).toBe("Team Beta");

        const list = await request(app)
            .get("/items/tasks")
            .set("Authorization", `Bearer ${switchedToken}`);
        const teamIds = [...new Set(list.body.data.map((t) => t.team_Id))];
        expect(teamIds).toEqual([teamBetaId]);
    });

    test("original unpinned token still resolves oldest assignment (Team Alpha)", async () => {
        const list = await request(app)
            .get("/items/tasks")
            .set("Authorization", `Bearer ${userToken}`);
        const teamIds = [...new Set(list.body.data.map((t) => t.team_Id))];
        expect(teamIds).toEqual([teamAlphaId]);
    });

    test("refresh preserves the pinned assignment", async () => {
        const refresh = await request(app)
            .post("/auth/refresh")
            .set("Authorization", `Bearer ${switchedToken}`)
            .send({});
        expect(refresh.status).toBe(200);
        const refreshedToken = refresh.body.token;
        expect(refreshedToken).toBeDefined();

        const create = await request(app)
            .post("/items/tasks")
            .set("Authorization", `Bearer ${refreshedToken}`)
            .send({ title: "Beta task after refresh" });
        expect(create.status).toBe(201);

        const created = await request(app)
            .get(`/items/tasks/${create.body.data.id}`)
            .set(admin());
        expect(created.body.data.team_Id).toBe(teamBetaId);
    });

    test("deleted pinned assignment falls back to oldest assignment", async () => {
        // Third assignment -> switch to it -> delete it -> token still works,
        // resolving the OLDEST remaining assignment (Team Alpha).
        const createdC = await request(app).post("/items/baasix_UserRole").set(admin()).send({
            user_Id: testUserId,
            role_Id: roleId,
            team_Id: teamBetaId,
        });
        const assignmentC = createdC.body.data.id;

        const sw = await request(app)
            .post("/auth/switch-tenant")
            .set("Authorization", `Bearer ${userToken}`)
            .send({ userRole_Id: assignmentC });
        expect(sw.status).toBe(200);
        const pinnedToken = sw.body.token;

        await request(app).delete(`/items/baasix_UserRole/${assignmentC}`).set(admin());

        const create = await request(app)
            .post("/items/tasks")
            .set("Authorization", `Bearer ${pinnedToken}`)
            .send({ title: "task after assignment deletion" });
        expect(create.status).toBe(201);

        const created = await request(app)
            .get(`/items/tasks/${create.body.data.id}`)
            .set(admin());
        expect(created.body.data.team_Id).toBe(teamAlphaId);
    });

    test("foreign/unknown userRole_Id is rejected with 403", async () => {
        const res = await request(app)
            .post("/auth/switch-tenant")
            .set("Authorization", `Bearer ${userToken}`)
            .send({ userRole_Id: "00000000-0000-4000-8000-000000000000" });
        expect(res.status).toBe(403);
    });

    test("missing both userRole_Id and tenant_Id is a 400", async () => {
        const res = await request(app)
            .post("/auth/switch-tenant")
            .set("Authorization", `Bearer ${userToken}`)
            .send({});
        expect(res.status).toBe(400);
    });
});
```

Note the refresh test: `/auth/refresh` invalidates the old session — order tests so `switchedToken` is not reused after the refresh test (it is last-but-one; only the 403/400 tests follow and they use `userToken`).

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm test -- test/userRoleVariable.test.js`
Expected: Task 3's tests PASS; the new describe FAILS (`userRole_Id` ignored → 400 "Tenant ID is required" today, missing-both currently 400 with the wrong message but the switch tests fail decisively).

- [ ] **Step 3: Rework the switch-tenant handler.** In `packages/core/baasix/auth/routes.ts` replace the handler body (lines 1350 down to just before its closing `});`) with:

```ts
  app.post(`${basePath}/switch-tenant`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const { userRole_Id, tenant_Id, authType, authMode = "jwt" } = req.body;

      if (!userRole_Id && !tenant_Id) {
        return res.status(400).json({ message: "userRole_Id or tenant_Id is required" });
      }

      let userRole: any = null;

      if (userRole_Id) {
        // Assignment switching — works regardless of multi-tenant mode.
        // Row must exist AND belong to the authenticated user.
        const userRoles = await auth.adapter.findUserRolesByUserId(req.accountability.user.id);
        userRole = (userRoles || []).find((ur: any) => String(ur.id) === String(userRole_Id)) || null;
        if (!userRole) {
          return res.status(403).json({ message: "Access denied for specified role assignment" });
        }
      } else {
        // Legacy tenant switching.
        const isMultiTenant = options.multiTenant?.enabled || options.env?.get("MULTI_TENANT") === "true";
        if (!isMultiTenant) {
          return res.status(400).json({ message: "Multi-tenant mode is not enabled" });
        }

        const userRoles = await auth.adapter.findUserRolesByUserId(req.accountability.user.id, tenant_Id);
        if (!userRoles || userRoles.length === 0) {
          return res.status(403).json({ message: "Access denied for specified tenant" });
        }
        userRole = userRoles[0];

        if (!userRole.role?.isTenantSpecific) {
          return res.status(400).json({ message: "Cannot switch tenant for non-tenant-specific role" });
        }
      }

      const role = userRole.role;
      const tenant = userRole.tenant_Id ? await auth.adapter.findTenantById(userRole.tenant_Id) : null;
      if (userRole.tenant_Id && !tenant) {
        return res.status(404).json({ message: "Tenant not found" });
      }

      // Validate session limits if authType is specified
      if (authType && authType !== "default") {
        const { validateSessionLimits } = await import("../utils/auth.js");
        const validation = await validateSessionLimits(
          req.accountability.user as any,
          authType,
          tenant?.id ?? null,
          role
        );

        if (!validation.isValid) {
          return res.status(403).json({ message: validation.error });
        }
      }

      // Create new session
      const ipAddress = req.ip || (req.connection as any)?.remoteAddress || null;
      const userAgent = req.headers["user-agent"] || null;

      const session = await auth.sessionService.createSession({
        user: req.accountability.user as any,
        tenantId: tenant?.id ?? null,
        ipAddress,
        userAgent,
        type: authType || "default",
      });

      // Generate new token pinned to the exact assignment row
      const token = auth.tokenService.generateUserToken({
        user: req.accountability.user as any,
        role,
        session,
        tenant,
        userRoleId: userRole.id,
      });

      // Set token in response based on authMode
      const tokenResponse = setTokenInResponse(res, token, authMode, options.env);
```

Then adapt the existing success `res.json({...})` (keep whatever fields it already returns — read it first) to ALSO include `userRole_Id: userRole.id`, and make any `tenant`-referencing fields null-safe (`tenant?.id ?? null`, `tenant?.name ?? null`). Do not remove existing response fields — clients may rely on them.

- [ ] **Step 4: Preserve `userRole_Id` on refresh.** In the same file, refresh handler (~line 664): the block that decodes the old token for `sessionType` (ends ~line 682) already has `decodedToken`. That block is conditional — hoist the decode so it always runs. Change:

```ts
      let sessionType = "default";
      const decodedToken = auth.tokenService.decodeToken(token);
      if (decodedToken?.sessionToken) {
        const existingSession = await auth.sessionService.validateSession(decodedToken.sessionToken);
        if (existingSession?.session?.type) {
          sessionType = existingSession.session.type;
        }
      }
      const preservedUserRoleId = decodedToken?.userRole_Id ?? null;
```

(If the decode already happens unconditionally, just add the `preservedUserRoleId` line after it.) Then the `generateUserToken` call at line 708 becomes:

```ts
      const newToken = auth.tokenService.generateUserToken({
        user: user as any,
        role,
        session,
        tenant,
        userRoleId: preservedUserRoleId,
      });
```

- [ ] **Step 5: Deterministic adapter ordering.** In `packages/core/baasix/auth/adapters/baasix-adapter.ts` (line 386), add a sort to the query:

```ts
      const result = await service.readByQuery({
        filter,
        fields: ["*", "role.*"],
        sort: ["createdAt"],
      });
```

- [ ] **Step 6: Run the full test file**

Run: `npm test -- test/userRoleVariable.test.js`
Expected: PASS (all 10 tests: 3 from Task 3 + 7 new).

- [ ] **Step 7: Regression — legacy tenant switching and session limits**

Run: `npm test -- test/multitenant.test.js`
Expected: PASS.

Run: `npm test -- test/switch-tenant-session-limits.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add baasix/auth/routes.ts baasix/auth/adapters/baasix-adapter.ts test/userRoleVariable.test.js
git commit -m "feat(auth): switch-tenant accepts userRole_Id; refresh preserves pinned assignment"
```

---

### Task 5: `/auth/tenants` lists `userRole_Id` + custom assignment fields (TDD)

**Files:**
- Modify: `packages/core/baasix/auth/routes.ts:1309-1346` (tenants listing)
- Test: `packages/core/test/multitenant.test.js` (extend — this suite already boots with `MULTI_TENANT: "true"` and real tenants)

**Interfaces:**
- Consumes: adapter rows (`findUserRolesByUserId` returns `["*", "role.*"]` — custom columns included).
- Produces: each `/auth/tenants` entry gains `userRole_Id` and the assignment's custom columns.

- [ ] **Step 1: Write the failing test.** In `packages/core/test/multitenant.test.js`, existing `GET /auth/tenants` calls are at lines ~675 and ~737 (inside invite/switch tests with locally-scoped tokens). Add a standalone test in the same describe block that contains the line-737 test, using the file's top-level `tenant1UserToken` variable (declared near the top, populated in setup):

```js
    test("GET /auth/tenants includes userRole_Id per entry", async () => {
        const response = await request(app)
            .get("/auth/tenants")
            .set("Authorization", `Bearer ${tenant1UserToken}`);

        expect(response.status).toBe(200);
        expect(response.body.tenants.length).toBeGreaterThan(0);
        for (const t of response.body.tenants) {
            expect(t.userRole_Id).toBeDefined();
            expect(t.role?.id).toBeDefined();
            expect(t.role?.name).toBeDefined();
        }
    });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- test/multitenant.test.js`
Expected: the new test FAILS (`userRole_Id` undefined); everything else PASSES.

- [ ] **Step 3: Extend the endpoint.** In `packages/core/baasix/auth/routes.ts` lines 1325-1340, replace the loop body with:

```ts
      const tenants = [];
      for (const ur of userRoles) {
        if (ur.tenant_Id && ur.role?.isTenantSpecific) {
          const tenant = await auth.adapter.findTenantById(ur.tenant_Id);
          if (tenant) {
            // Everything on the assignment row beyond the join-table plumbing
            // is a user-defined custom column (e.g. team_Id) — expose it so
            // clients can render an assignment switcher.
            const { id: _id, user_Id: _u, role_Id: _r, tenant_Id: _t, role: _role, user: _user,
                    createdAt: _c, updatedAt: _up, ...customFields } = ur;
            tenants.push({
              id: tenant.id,
              name: tenant.name,
              userRole_Id: ur.id,
              role: {
                id: ur.role.id,
                name: ur.role.name,
              },
              ...customFields,
            });
          }
        }
      }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- test/multitenant.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add baasix/auth/routes.ts test/multitenant.test.js
git commit -m "feat(auth): /auth/tenants returns userRole_Id and assignment custom fields"
```

---

### Task 6: MCP documentation strings + full regression

**Files:**
- Modify: `packages/core/baasix/services/MCPService.ts:1302-1303, 1668, 1869-1870` (dynamic-variable doc strings)

**Interfaces:**
- Consumes: nothing new. Documentation-only + verification.

- [ ] **Step 1: Update MCP doc strings.** In `packages/core/baasix/services/MCPService.ts`, at EACH of the three locations listing dynamic variables (lines 1302-1303, 1668, 1869-1870 — re-grep with `grep -n "CURRENT_ROLE" baasix/services/MCPService.ts` since earlier tasks shifted lines), add directly below the `$CURRENT_ROLE` lines:

```
$CURRENT_USERROLE → active role-assignment (baasix_UserRole) row ID
$CURRENT_USERROLE.fieldName → any field on the assignment row (custom columns like team_Id; relations like team.name)
```

Match the surrounding formatting exactly (some sites list only the bare form — add only the matching granularity there).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | tail -20`
Expected: no new errors.

- [ ] **Step 3: Full affected-suite regression run (sequentially, never parallel)**

Run: `npm test -- test/userRoleVariable.test.js test/auth.test.js test/defaultValues.test.js test/permission.test.js test/multitenant.test.js test/switch-tenant-session-limits.test.js`
Expected: ALL PASS. (Known daily/standalone flakes exist in other suites — if an unrelated test flakes, re-run that file alone before investigating.)

- [ ] **Step 4: Commit**

```bash
git add baasix/services/MCPService.ts
git commit -m "docs(mcp): document \$CURRENT_USERROLE dynamic variable"
```

---

## Follow-ups (explicitly out of scope, per spec)

- SDK: `switchRole`/assignment-listing helpers + types (bundle into next `@baasix/sdk` publish).
- App/app-builder assignment-switcher UI.
- Landing-site docs (`landing/content/docs/...filter-reference`, permissions guide) — separate directory, not this git repo; document `$CURRENT_USERROLE` there when docs are next touched.
- Selecting an assignment at login time.
