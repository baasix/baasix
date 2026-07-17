# Role-Based Admin App Access (`app_access`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `app_access` boolean to roles and gate every admin-app session entry point client-side, with `administrator` always allowed.

**Architecture:** Core adds the column to the `baasix_Role` system schema (auto-synced to existing DBs on startup via `ADD COLUMN IF NOT EXISTS`), heals `administrator` to `true` on every startup, and exposes `app_access` in the `/auth/tenants` role projection. The admin app gets one pure helper `roleHasAppAccess` in `auth-session.ts`, called at all six session entry points plus the switcher filter; Roles Management is schema-driven so the field appears in its edit form automatically.

**Tech Stack:** Core: Express/Drizzle system schemas, Jest + supertest. App: Next.js/React, vitest.

**Spec:** `docs/superpowers/specs/2026-07-17-role-app-access-design.md`

## Global Constraints

- Column: `app_access`, Boolean, `allowNull: false`, `defaultValue: false`, `SystemGenerated: "true"`.
- `administrator` is always allowed by NAME check client-side; the DB heal to `true` is cosmetic.
- Fail-open rules in the client helper: no role → allow; `app_access` key absent → allow.
- Rejection copy everywhere, verbatim: `Your role does not have access to the admin app.`
- Never run two jest invocations at once against the core package (shared test DB).
- Core paths are relative to `<baasix-repo>/packages/core/`; app paths to `<app-repo>` (`/home/vivek/Documents/NodeJS/baasix/baasix-drizzle/baasix` and `.../app`). They are separate git repos — commit core tasks in the baasix repo, app tasks in the app repo.

---

### Task 1: Core — schema field, startup heal, tenants projection

**Files:**
- Modify: `baasix/utils/systemschema.ts:41-47` (baasix_Role fields, after `canInviteRoleIds`)
- Modify: `baasix/utils/schemaManager.ts:1890-1892` (end of `checkAndSeedDatabase`)
- Modify: `baasix/auth/routes.ts:1362-1365` (`GET /auth/tenants` role projection)
- Test: `test/roleAppAccess.test.js` (create)

**Interfaces:**
- Consumes: existing test harness `startServerForTesting` / `destroyAllTablesInDB` from `../baasix`; seeded admin login `admin@baasix.com` / `admin@123`.
- Produces: `baasix_Role.app_access` boolean column (default `false`, administrator healed `true`); login response `role.app_access`; `/auth/tenants` items carry `role.app_access`. Task 2's client helper reads exactly these.

- [ ] **Step 1: Write the failing test**

Create `test/roleAppAccess.test.js`:

```js
import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

let app;
beforeAll(async () => {
    app = await startServerForTesting();
}, 60000);
afterAll(async () => { await destroyAllTablesInDB(); });

const adminLogin = () =>
    request(app).post("/auth/login").send({ email: "admin@baasix.com", password: "admin@123" });

describe("Role app_access", () => {
    test("administrator role is healed to app_access=true at startup", async () => {
        const login = await adminLogin();
        expect(login.status).toBe(200);
        expect(login.body.role).toBeDefined();
        expect(login.body.role.app_access).toBe(true);
    });

    test("newly created roles default to app_access=false", async () => {
        const login = await adminLogin();
        const token = login.body.token;
        const created = await request(app)
            .post("/items/baasix_Role")
            .set("Authorization", `Bearer ${token}`)
            .send({ name: "app-access-test-role", description: "t", isTenantSpecific: false });
        expect(created.status).toBe(200);
        const id = created.body.data?.id ?? created.body.data;
        const fetched = await request(app)
            .get(`/items/baasix_Role/${id}`)
            .set("Authorization", `Bearer ${token}`);
        expect(fetched.status).toBe(200);
        expect(fetched.body.data.app_access).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/core/`):
```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest test/roleAppAccess.test.js --detectOpenHandles --forceExit --verbose
```
Expected: FAIL — `role.app_access` is `undefined` in both tests (column doesn't exist yet).

- [ ] **Step 3: Add the schema field**

In `baasix/utils/systemschema.ts`, inside `baasix_Role` → `schema.fields`, directly after the `canInviteRoleIds` block (ends line 47), add:

```js
                    app_access: {
                        type: "Boolean",
                        allowNull: false,
                        defaultValue: false,
                        SystemGenerated: "true",
                        description: "Whether users with this role may log into the admin app",
                    },
```

- [ ] **Step 4: Add the startup heal**

In `baasix/utils/schemaManager.ts`, in `checkAndSeedDatabase()`, after the `await this.seedSystemACLs();` line (1891), add:

```ts
    // administrator always has admin-app access; the client gate checks the
    // role NAME, so this only keeps the Roles Management UI truthful.
    await sql`
      UPDATE "baasix_Role" SET "app_access" = true
      WHERE name = 'administrator' AND "app_access" IS DISTINCT FROM true
    `;
```

- [ ] **Step 5: Expose app_access in the tenants listing**

In `baasix/auth/routes.ts`, `GET ${basePath}/tenants` handler, change the role projection (lines 1362–1365):

```ts
              role: {
                id: ur.role.id,
                name: ur.role.name,
                app_access: (ur.role as any).app_access ?? null,
              },
```

- [ ] **Step 6: Run test to verify it passes**

Run (from `packages/core/`):
```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest test/roleAppAccess.test.js --detectOpenHandles --forceExit --verbose
```
Expected: PASS — both tests.

- [ ] **Step 7: Run adjacent auth suites (one jest at a time)**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest test/auth.test.js test/authDiscovery.test.js test/switch-tenant-session-limits.test.js --runInBand --detectOpenHandles --forceExit
```
Expected: PASS (no assertions anywhere depend on the role field list).

- [ ] **Step 8: Commit (baasix repo)**

```bash
git add baasix/utils/systemschema.ts baasix/utils/schemaManager.ts baasix/auth/routes.ts test/roleAppAccess.test.js
git commit -m "feat: add app_access flag to roles for admin-app gating

Column defaults to false; administrator is healed to true at startup;
/auth/tenants now includes role.app_access for the assignment switcher.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: App — `roleHasAppAccess` helper + unit tests

**Files:**
- Modify: `src/lib/auth-session.ts` (after `isAdminSession`, line 131)
- Test: `src/lib/__tests__/auth-session.test.ts` (create)

**Interfaces:**
- Consumes: existing `SessionRole` interface and `ADMIN_ROLE_NAME` const in the same file.
- Produces: `export function roleHasAppAccess(role: SessionRole | null | undefined): boolean` and `export const APP_ACCESS_DENIED_MESSAGE`. Tasks 3–5 import both from `@/lib/auth-session`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/auth-session.test.ts`:

```ts
import { describe, test, expect } from "vitest";
import { roleHasAppAccess } from "../auth-session";

describe("roleHasAppAccess", () => {
    test("no role (legacy session) is allowed", () => {
        expect(roleHasAppAccess(null)).toBe(true);
        expect(roleHasAppAccess(undefined)).toBe(true);
    });

    test("administrator is always allowed, any casing, even with app_access=false", () => {
        expect(roleHasAppAccess({ id: "1", name: "administrator", app_access: false })).toBe(true);
        expect(roleHasAppAccess({ id: "1", name: "Administrator" })).toBe(true);
    });

    test("role without the app_access field is allowed (older server, fail open)", () => {
        expect(roleHasAppAccess({ id: "2", name: "manager" })).toBe(true);
    });

    test("app_access=true allows, app_access=false blocks", () => {
        expect(roleHasAppAccess({ id: "3", name: "manager", app_access: true })).toBe(true);
        expect(roleHasAppAccess({ id: "3", name: "manager", app_access: false })).toBe(false);
        expect(roleHasAppAccess({ id: "3", name: "manager", app_access: null })).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from the app repo root):
```bash
npx vitest run src/lib/__tests__/auth-session.test.ts
```
Expected: FAIL — `roleHasAppAccess` is not exported.

- [ ] **Step 3: Implement the helper**

In `src/lib/auth-session.ts`, after `isAdminSession()` (line 131), add:

```ts
export const APP_ACCESS_DENIED_MESSAGE = "Your role does not have access to the admin app.";

/**
 * Whether a role may use the admin app. UX gate only — the server enforces
 * real permissions on every request.
 * Fail-open rules: no role (legacy session, matches isAdminSession) and a
 * role object without the app_access key (server older than the column)
 * are both allowed, so an app newer than its server never locks everyone out.
 */
export function roleHasAppAccess(role: SessionRole | null | undefined): boolean {
  if (!role) return true;
  if (role.name?.toLowerCase() === ADMIN_ROLE_NAME) return true;
  if (!("app_access" in role)) return true;
  return role.app_access === true;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/__tests__/auth-session.test.ts
```
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit (app repo)**

```bash
git add src/lib/auth-session.ts src/lib/__tests__/auth-session.test.ts
git commit -m "feat: add roleHasAppAccess admin-app gate helper

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: App — gate auth-provider (login, 2FA, register, check)

**Files:**
- Modify: `src/providers/auth-provider/index.ts:5` (import), `:18-33` (2FA leg), `:48-70` (password leg), `:94-117` (register), `:219-237` (check)

**Interfaces:**
- Consumes: `roleHasAppAccess`, `APP_ACCESS_DENIED_MESSAGE`, `getStoredRole` from `@/lib/auth-session` (Task 2).
- Produces: login/register return `{ success: false, error: { message: "Login failed", name: APP_ACCESS_DENIED_MESSAGE } }` on block; `check()` clears blocked sessions. No new exports.

- [ ] **Step 1: Update the import**

In `src/providers/auth-provider/index.ts`, line 5 currently:

```ts
import { storeAuthSession, clearAuthSession, getStoredPermissions } from "@/lib/auth-session";
```

becomes:

```ts
import {
  storeAuthSession,
  clearAuthSession,
  getStoredPermissions,
  getStoredRole,
  roleHasAppAccess,
  APP_ACCESS_DENIED_MESSAGE,
} from "@/lib/auth-session";
```

- [ ] **Step 2: Add a shared block-result helper and gate the 2FA leg**

Directly above `export const createAuthProvider` add:

```ts
// Shared rejection for session entry points whose role fails the app gate.
// Best-effort server logout so the just-issued token isn't left active.
const blockedLoginResult = (baasixClient: Baasix) => {
  baasixClient.auth.logout().catch(() => {});
  return {
    success: false,
    error: {
      message: "Login failed",
      name: APP_ACCESS_DENIED_MESSAGE,
    },
  };
};
```

In the 2FA leg, between `const response = await baasixClient.auth.twoFactor.verify(...)` and `storeAuthSession({...})`, add:

```ts
        if (!roleHasAppAccess((response as any).role ?? null)) {
          return blockedLoginResult(baasixClient);
        }
```

- [ ] **Step 3: Gate the password leg**

In the password leg, inside `if (response.user) {` before the existing `if ((response as any).role == null)` warning, add:

```ts
        if (!roleHasAppAccess((response as any).role ?? null)) {
          return blockedLoginResult(baasixClient);
        }
```

- [ ] **Step 4: Gate register**

In `register`, between `const response = await baasixClient.auth.register({...})` and `storeAuthSession({...})`, add:

```ts
      if (!roleHasAppAccess((response as any).role ?? null)) {
        return blockedLoginResult(baasixClient);
      }
```

(The surrounding catch already maps thrown errors; this path returns directly.)

- [ ] **Step 5: Gate check()**

Replace the body of `check` (lines 219–237):

```ts
  check: async () => {
    // Just check localStorage for token - don't make API calls
    const token = localStorage.getItem(TOKEN_KEY) || localStorage.getItem(SDK_TOKEN_KEY);

    if (token) {
      // Admin-app gate: a stored session whose role lost app_access (or never
      // had it) is ended here — covers revocation after login. UX only; the
      // server still enforces real permissions.
      if (!roleHasAppAccess(getStoredRole())) {
        clearAuthSession();
        return {
          authenticated: false,
          error: {
            message: APP_ACCESS_DENIED_MESSAGE,
            name: "Unauthorized",
          },
          redirectTo: "/login",
        };
      }
      return {
        authenticated: true,
      };
    }

    return {
      authenticated: false,
      error: {
        message: "Not authenticated",
        name: "Unauthorized",
      },
      redirectTo: "/login",
    };
  },
```

- [ ] **Step 6: Typecheck**

```bash
npx tsc --noEmit
```
Expected: no new errors (pre-existing errors, if any, are unchanged — compare against `git stash; npx tsc --noEmit; git stash pop` if unsure).

- [ ] **Step 7: Commit (app repo)**

```bash
git add src/providers/auth-provider/index.ts
git commit -m "feat: enforce app_access gate in auth provider login/register/check

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: App — gate OAuth callback, magic-link, passkey pages

**Files:**
- Modify: `src/app/(public)/auth/callback/page.tsx:7,29-43`
- Modify: `src/app/(public)/auth/magiclink/[token]/magiclink-client.tsx:6,25-39`
- Modify: `src/components/auth-page/index.tsx:12,166-179`

**Interfaces:**
- Consumes: `roleHasAppAccess`, `APP_ACCESS_DENIED_MESSAGE` from `@/lib/auth-session` (Task 2).
- Produces: nothing new — each page surfaces the message via its existing error state.

- [ ] **Step 1: Gate the OAuth callback page**

In `src/app/(public)/auth/callback/page.tsx`, extend the import on line 7:

```ts
import { storeAuthSession, roleHasAppAccess, APP_ACCESS_DENIED_MESSAGE } from "@/lib/auth-session";
```

In `CallbackInner`'s async IIFE, between `const response = await baasixClient.auth.handleOAuthCallback(token);` and `storeAuthSession({`, add:

```ts
                if (!roleHasAppAccess((response as any).role ?? null)) {
                    baasixClient.auth.logout().catch(() => {});
                    setError(APP_ACCESS_DENIED_MESSAGE);
                    return;
                }
```

- [ ] **Step 2: Gate the magic-link page**

In `src/app/(public)/auth/magiclink/[token]/magiclink-client.tsx`, extend the import on line 6:

```ts
import { storeAuthSession, roleHasAppAccess, APP_ACCESS_DENIED_MESSAGE } from "@/lib/auth-session";
```

Between `const response = await baasixClient.auth.verifyMagicLink(token);` and `storeAuthSession({`, add:

```ts
                if (!roleHasAppAccess((response as any).role ?? null)) {
                    baasixClient.auth.logout().catch(() => {});
                    setError(APP_ACCESS_DENIED_MESSAGE);
                    return;
                }
```

- [ ] **Step 3: Gate passkey sign-in**

In `src/components/auth-page/index.tsx`, extend the import on line 12:

```ts
import { storeAuthSession, roleHasAppAccess, APP_ACCESS_DENIED_MESSAGE } from "@/lib/auth-session";
```

In `handlePasskeyAuth` (line ~166), between `const response = await baasixClient.auth.passkey.authenticate();` and `storeAuthSession({`, add:

```ts
            if (!roleHasAppAccess((response as any).role ?? null)) {
                baasixClient.auth.logout().catch(() => {});
                setPasskeyError(APP_ACCESS_DENIED_MESSAGE);
                setBusy(null);
                return;
            }
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```
Expected: no new errors.

- [ ] **Step 5: Commit (app repo)**

```bash
git add "src/app/(public)/auth/callback/page.tsx" "src/app/(public)/auth/magiclink/[token]/magiclink-client.tsx" src/components/auth-page/index.tsx
git commit -m "feat: enforce app_access gate on oauth, magic-link and passkey entry

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: App — switcher filter + safety net, Roles Management column

**Files:**
- Modify: `src/components/layout/CompactSidebar.tsx:42,49,127-155`
- Modify: `src/components/settings/RolesManagement.tsx:38-51,121`

**Interfaces:**
- Consumes: `roleHasAppAccess`, `APP_ACCESS_DENIED_MESSAGE`, `clearAuthSession` from `@/lib/auth-session` (Task 2); `role.app_access` in `/auth/tenants` items and switch-tenant responses (Task 1).
- Produces: UI behavior only; no new exports.

- [ ] **Step 1: Filter the tenant/assignment list**

In `src/components/layout/CompactSidebar.tsx`, line 42 currently:

```ts
import { isAdminSession, getStoredTenant, storeAuthSession } from "@/lib/auth-session";
```

becomes:

```ts
import { isAdminSession, getStoredTenant, storeAuthSession, clearAuthSession, roleHasAppAccess, APP_ACCESS_DENIED_MESSAGE } from "@/lib/auth-session";
```

Line 49, extend the role shape:

```ts
type TenantWithRole = Tenant & { role?: { id: string; name: string; app_access?: boolean | null } };
```

In `loadTenants`, change the setter line:

```ts
            const list = await baasixClient.auth.getTenants();
            // Only assignments whose role may use the admin app (administrator
            // always passes; roles from servers without the column pass too).
            setTenants(((list as TenantWithRole[]) || []).filter((t) => roleHasAppAccess((t.role as any) ?? null)));
```

- [ ] **Step 2: Safety net on switch**

In `handleSwitchTenant`, between `const response = await baasixClient.auth.switchTenant(tenantId);` and `storeAuthSession({`, add:

```ts
            // Safety net: the list is pre-filtered, but if a switch still lands
            // on a blocked role, end the session rather than run half-gated.
            if (!roleHasAppAccess((response as any).role ?? null)) {
                clearAuthSession();
                alert(APP_ACCESS_DENIED_MESSAGE);
                window.location.href = `${basePath}/login`;
                return;
            }
```

(`alert` matches the component's current bare-bones error handling — `console.error` only; there is no toast system in this sidebar.)

- [ ] **Step 3: Roles Management column and admin lock**

In `src/components/settings/RolesManagement.tsx`:

Add to `customColumnRenderers` after the `isTenantSpecific` entry:

```tsx
        app_access: (value) => (
            <Badge variant={value ? "default" : "secondary"}>
                {value ? "Yes" : "No"}
            </Badge>
        ),
```

In `getDisabledFields`, administrator must keep `app_access` on (name check makes it moot, but the UI shouldn't offer a lie):

```ts
    const getDisabledFields = (record: any): string[] => {
        if (record?.name?.toLowerCase() === "administrator") {
            return ["name", "isTenantSpecific", "app_access"];
        }
        if (PROTECTED_ROLES.includes(record?.name?.toLowerCase())) {
            return ["name", "isTenantSpecific"]; // Disable name and tenant-specific fields for system roles
        }
        return [];
    };
```

Line 121, add the column:

```tsx
                defaultVisibleColumns={["name", "description", "isTenantSpecific", "app_access"]}
```

- [ ] **Step 4: Unit tests, typecheck and build**

```bash
npm test
npx tsc --noEmit
npm run build
```
Expected: vitest suite passes (incl. Task 2's tests); no new type errors; build succeeds. NOTE: never run `npm run build` while a dev server for this app is running (`.next` collision) — check with `ss -tlnp | grep 3001` first and stop any stray dev server you started.

- [ ] **Step 5: Commit (app repo)**

```bash
git add src/components/layout/CompactSidebar.tsx src/components/settings/RolesManagement.tsx
git commit -m "feat: filter switcher by app_access and expose the flag in roles UI

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Manual verification (after all tasks; core + app running locally)

Start core on a free port (8056 belongs to the Methodder project — do not touch it): from `packages/core/`, `PORT=8057 npx dotenv -e .env -- tsx server.js`. The bundled admin app at `http://localhost:8057/admin` is the previously synced build — for app-side checks run the app dev server on :3001 (check :3000/:3001 listeners first) pointed at the core server.

1. Log in as administrator → works; Roles Management shows the "App access" column; administrator row shows Yes and the field is disabled in its edit form.
2. Create role `staff` (app_access defaults to No/false), create a user with that role, log in as them → login rejected with "Your role does not have access to the admin app."
3. Toggle `staff` app_access to Yes → that user can log in.
4. While they're logged in, toggle it back to No → their next navigation (check()) clears the session and lands on /login.
5. Multi-tenant/assignment switcher: assignments with blocked roles don't appear.
