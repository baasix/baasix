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

### Endpoint changes

Login, 2FA, magic-link, OAuth, passkey, and switch-tenant responses already
return the full role record, so `app_access` flows to clients automatically.
Two projections needed the field added:

- `GET /auth/tenants` (assignment-switcher listing) projected the role down
  to `{ id, name }` — now includes `app_access` so the switcher can filter.
- The session accountability role (`req.accountability.role`, returned by
  `GET /auth/me`) projected to `{ id, name, isTenantSpecific }` — now
  includes `app_access` so the app can revalidate a live session. Both role
  caches feeding it (`PermissionService.loadRoles` and the infinite-TTL
  `auth:role:<id>:permissions` entry in `getRolesAndPermissions`) carry the
  field. Note: pre-existing infinite-TTL Redis entries keep the old shape
  until the role is next edited — role edits invalidate them, and a shape
  without the key fails open client-side, so this is safe.

While wiring `/auth/me`: the endpoint returned the raw user row including
the argon2 password hash and 2FA secrets. Fixed — the user object is now
passed through `fieldUtils.stripHiddenFields` (regression-tested).

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

### Enforcement points (all six)

Rejection message everywhere: **"Your role does not have access to the admin app."**

1. **Password login** (`src/providers/auth-provider/index.ts` `login`): check
   `response.role` before `storeAuthSession`; on block, do not store, best-effort
   server logout, return `{ success: false, error }`.
2. **2FA verify leg** (same file): identical check on the verify response.
3. **Register** (same file): identical check.
4. **OAuth callback page** (`src/app/(public)/auth/callback/page.tsx`) and
   **magic-link page** (`src/app/(public)/auth/magiclink/[token]/magiclink-client.tsx`):
   check before `storeAuthSession`; on block, show the message (these pages
   already render an error state with a back-to-login link).
5. **Passkey sign-in** (`src/components/auth-page/index.tsx`
   `handlePasskeyAuth`): check before `storeAuthSession`; on block, surface
   the message via the existing passkey error state.
6. **`check()`** (auth-provider): after the token check, run
   `roleHasAppAccess(getStoredRole())`; on block, `clearAuthSession()` and
   return unauthenticated with `redirectTo: "/login"`. Since the stored role
   goes stale, `check()` also fires a throttled (60s) fire-and-forget fetch
   of `GET /auth/me`; when the fresh role carries the `app_access` key it is
   re-stored, and a failing role clears the session and redirects to
   `/login`. Revoking a role's access therefore ends live sessions within
   about a minute. A response without the key (older server) neither blocks
   nor overwrites the richer stored role.

Additionally, because the app configures no Refine notificationProvider,
auth mutation failures were invisible. Login, 2FA, and register mutate calls
now surface failures (including the denial message) via sonner toasts.

### Sidebar switcher

In the role/tenant assignment switcher (`src/components/layout/CompactSidebar.tsx`
and expandable variant if it renders the same list): filter the assignment list
to roles passing `roleHasAppAccess`. Safety net: if a switch response still
returns a blocked role, clear the session and redirect to `/login` with the
message.

### Roles Management UI

`src/components/settings/RolesManagement.tsx` is a schema-driven
`DataBrowserInner` over `baasix_Role`, so the new field appears in the edit
form automatically. Add: `app_access` to `defaultVisibleColumns` with a
Yes/No badge renderer (same as `isTenantSpecific`), and disable the field in
the edit form for the `administrator` role via `getDisabledFields`.

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

**App:** vitest unit test for `roleHasAppAccess` (pure function) covering
legacy-null, administrator-name, missing-field fail-open, true, and false
cases; `npm run build` must pass; then Playwright manual verification:
blocked role cannot log in (message shown); enabling the toggle lets it in;
revoking while logged in kicks the session on next `check`; switcher hides
blocked assignments; administrator unaffected throughout.

## Out of scope

- Server-side blocking of admin-app logins (shared endpoint).
- Per-app access lists (multiple named apps); single boolean only. YAGNI.
