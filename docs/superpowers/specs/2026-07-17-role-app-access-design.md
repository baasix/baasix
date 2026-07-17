# Role-Based Admin App Access (`app_access`) — Design

**Date:** 2026-07-17
**Status:** Approved
**Repos:** baasix (core) + baasix-app (admin app)

## Problem

Any authenticated user can log into the admin app. Feature access is gated
per-collection by permissions, but there is no way to say "this role may not
open the admin app at all." Follow-up from
`2026-07-17-root-browser-redirect-design.md`.

## Decision

Add an `app_access` boolean column to the `baasix_Role` system schema and
gate every admin-app session entry point client-side. The `administrator`
role is always allowed regardless of the column.

- **Default:** `false` — locked by default. After upgrade, only
  `administrator` can open the admin app until an admin toggles
  `app_access` on for specific roles.
- **Blocked assignments are hidden** from the sidebar role/tenant switcher.

## Part 1 — Core (baasix repo)

### Schema

In `packages/core/baasix/utils/systemschema.ts`, add to `baasix_Role` fields:

```js
app_access: {
    type: "Boolean",
    allowNull: false,
    defaultValue: false,
    SystemGenerated: "true",
    description: "Whether users with this role may log into the admin app",
},
```

The system-schema sync adds the column to existing databases on startup.

### Startup heal

Set `app_access = true` on the `administrator` role at startup (idempotent),
so the Roles Management UI reflects reality. The client's name-based check
never depends on this; it is cosmetic consistency only.

### No endpoint changes

Login, 2FA, magic-link, OAuth, and switch-tenant responses already return the
full role record, so `app_access` flows to clients automatically.

## Part 2 — Admin app (app repo)

### Gate helper

In `src/lib/auth-session.ts`:

```ts
export function roleHasAppAccess(role: SessionRole | null | undefined): boolean {
  if (!role) return true;                                   // legacy session (matches isAdminSession)
  if (role.name?.toLowerCase() === ADMIN_ROLE_NAME) return true; // administrator always allowed
  if (!("app_access" in role)) return true;                 // older server without the column — fail open
  return role.app_access === true;
}
```

Fail-open cases exist so an app newer than its server never locks everyone
out; once the server has the column, `false` blocks.

### Enforcement points (all five)

Rejection message everywhere: **"Your role does not have access to the admin app."**

1. **Password login** (`src/providers/auth-provider/index.ts` `login`): check
   `response.role` before `storeAuthSession`; on block, do not store, best-effort
   server logout, return `{ success: false, error }`.
2. **2FA verify leg** (same file): identical check on the verify response.
3. **Register** (same file): identical check.
4. **OAuth callback page** (`src/app/(public)/auth/callback/page.tsx`) and
   **magic-link page** (`src/app/(public)/auth/magiclink/[token]/magiclink-client.tsx`):
   check before `storeAuthSession`; on block, redirect to `/login` with the message.
5. **`check()`** (auth-provider): after the token check, run
   `roleHasAppAccess(getStoredRole())`; on block, `clearAuthSession()` and
   return unauthenticated with `redirectTo: "/login"`. Covers sessions that
   existed before an admin revoked a role's access.

### Sidebar switcher

In the role/tenant assignment switcher (`src/components/layout/CompactSidebar.tsx`
and expandable variant if it renders the same list): filter the assignment list
to roles passing `roleHasAppAccess`. Safety net: if a switch response still
returns a blocked role, clear the session and redirect to `/login` with the
message.

### Roles Management UI

`src/components/settings/RolesManagement.tsx`: an "App access" toggle per role
writing the `app_access` field; rendered on and disabled for `administrator`.

## Security note

This is a **UX gate, not a security boundary**. A crafted client can bypass it
and an issued token still works per server-side permissions — which remain the
real enforcement. Server-side login cannot block globally because public
end-user apps share the same `/auth/login`.

## Testing

**Core:**
- Schema: `baasix_Role` has `app_access`, default `false` on newly created roles.
- Heal: `administrator` role has `app_access = true` after startup.
- Login response: `role.app_access` present.

**App:** no jest harness — typecheck/build must pass, then Playwright manual
verification: blocked role cannot log in (message shown); enabling the toggle
lets it in; revoking while logged in kicks the session on next `check`;
switcher hides blocked assignments; administrator unaffected throughout.

## Out of scope

- Server-side blocking of admin-app logins (shared endpoint).
- Per-app access lists (multiple named apps); single boolean only. YAGNI.
