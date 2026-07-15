# UserRole Fields in Permissions (`$CURRENT_USER.role.*`) — Design

**Date:** 2026-07-15
**Status:** Approved pending user review

## Problem

Custom fields added to `baasix_UserRole` (e.g., `team_Id`) are invisible to the
permission system. `$CURRENT_ROLE.*` reads only `baasix_Role`, and the auth
middleware discards everything from the UserRole row except `role_Id` and
`tenant_Id`. Additionally, when a user has multiple UserRole rows in the same
tenant (e.g., same role in two teams, distinguished by a custom `team_Id`
column), the system cannot distinguish them: both the middleware and
`/auth/switch-tenant` resolve the assignment with `LIMIT 1` on
`(user_Id, tenant_Id)`.

**Goal:** permission `conditions`, `relConditions`, and `defaultValues` can
reference custom UserRole fields via `$CURRENT_USER.role.<field>`, and the user
can switch between assignments (rows), with the switched-to row's values
applied — e.g., team-scoped reads and auto-stamped `team_Id` on create.

## Decisions made during brainstorming

- Syntax: **`$CURRENT_USER.role.team_id`** (user's choice) — no new
  `$CURRENT_USERROLE` variable.
- **Option A** implementation: `accountability.user.role` stays the role *name
  string* (back-compat); the resolver special-cases `role.*` paths. The full
  active UserRole row travels separately as `accountability.userRole`.
- **Repurpose `/auth/switch-tenant`** to also accept `userRole_Id` (it is not
  used in production); no new endpoint.
- Token must pin the exact **UserRole row ID** (`userRole_Id`), because the
  same role can legitimately appear twice in one tenant.

## Current behavior (verified in code)

- `$CURRENT_USER.role` (bare) already resolves to the role **name** — the
  middleware sets `user.role = role.name` (`utils/auth.ts` authMiddleware) and
  the resolver's in-memory fast path serves flat fields from
  `accountability.user`.
- `$CURRENT_USER.role.x` resolves to `null` today — dotted fields go to the DB
  branch against `baasix_User`, which has no `role` relation.
- All three permission payloads (`conditions`, `relConditions`,
  `defaultValues`) flow through `resolveDynamicVariables(obj, accountability)`
  (`PermissionService.ts`, `ItemsService.ts`), so a single resolver change
  covers filters and default values.
- Middleware caches the assignment under `auth:userrole:<userId>:<tenantKey>`
  (hybrid cache, invalidated by the `baasix_UserRole` hook) and selects only
  `role_Id, tenant_Id`.
- The schema API has no guard preventing custom fields on `baasix_UserRole`.

## Design

### 1. JWT payload + session

- Add optional `userRole_Id` to the JWT payload (alongside existing
  `tenant_Id`, `sessionToken`).
- Tokens without `userRole_Id` (all existing tokens) keep working via the
  current `(user_Id, tenant_Id)` lookup — no forced re-login.
- Login flow unchanged (picks first assignment as today, now with a
  deterministic `ORDER BY "createdAt"`); clients that care switch afterwards.

### 2. `/auth/switch-tenant` extended (role/assignment switching)

Request body: `{ userRole_Id?, tenant_Id?, authType?, authMode? }` — at least
one of `userRole_Id` / `tenant_Id` required.

- `userRole_Id` given: load that row; **validate `row.user_Id` matches the
  authenticated user** (403 otherwise). Tenant context derives from the row's
  `tenant_Id`. Rows with `tenant_Id = null` (global roles) are allowed —
  switching between global assignments is now possible; the existing
  "cannot switch tenant for non-tenant-specific role" rejection applies only
  to the legacy tenant_Id-only path.
- Only `tenant_Id` given: legacy behavior (first row in that tenant), except
  the issued token now also pins that row's `userRole_Id`.
- Session-limit validation, session creation, and token/cookie response are
  unchanged; the new token carries `userRole_Id`.
- Multi-tenant-mode guard: kept for the legacy `tenant_Id` path; the
  `userRole_Id` path works regardless of `MULTI_TENANT` (assignment switching
  is meaningful in single-tenant deployments too).

### 3. Auth middleware

- If `payload.userRole_Id` present: fetch **that row** (all columns, i.e.
  `SELECT *` via the drizzle table), validating `user_Id` matches. Cache key:
  `auth:userrole:<userId>:ur:<userRole_Id>`. If the row was deleted, fall back
  to the legacy `(user, tenant)` lookup (assignment revoked mid-session
  degrades gracefully instead of 500ing).
- Else: legacy `(user_Id, tenant_Id)` lookup, now selecting the **full row**
  and ordered by `createdAt` for determinism.
- New field on accountability: `userRole` — the full row (plain object). The
  `Accountability` type gains `userRole?: Record<string, any>`.
- `accountability.user.role` remains the role name string. `tenant` derivation
  unchanged.
- Same treatment in every other place accountability is constructed with a
  role lookup (SocketService realtime auth; verified at implementation time).

### 4. Dynamic variable resolver

In `resolveCollectedVariables`, for `CURRENT_USER` fields starting with
`role.`:

- Build the merged role object once per resolution:
  `{ ...roleRow, ...assignmentFields }` where `roleRow` is the cached
  `baasix_Role` row (PermissionService hybrid cache, DB fallback) and
  `assignmentFields` is `accountability.userRole` minus the join-table
  plumbing columns `id`, `user_Id`, `role_Id`, `createdAt`, `updatedAt`
  (custom fields and `tenant_Id` are kept; assignment wins on name collision).
- Store it as `resolved.CURRENT_USER.role` **only when a `role.*` path was
  requested**. When the bare field `role` is requested, it resolves to the
  name string exactly as today (special-cased in `replaceVariables` if both
  forms appear in one filter).
- Deeper relational paths (`role.team.name` where `team` is a BelongsTo alias
  on `baasix_UserRole`): if the second path segment is not a flat key of the
  merged object, fall back to
  `ItemsService("baasix_UserRole").readOne(userRole.id, { fields: [rest] })`
  and graft the result under `resolved.CURRENT_USER.role`.
- No accountability → behavior unchanged (early return already exists).
- `MCPService`'s dynamic-variable documentation strings updated to document
  `$CURRENT_USER.role.<field>`.

With this in place, permissions like

```json
// condition: team-scoped reads
{ "team_Id": "$CURRENT_USER.role.team_Id" }

// defaultValues: auto-stamp on create
{ "team_Id": "$CURRENT_USER.role.team_Id" }
```

apply per active assignment, and switching assignments (new token) changes the
resolved values immediately.

### 5. Listing assignments (switcher UI support)

Extend the existing user-tenants listing (`/auth/user-tenants` +
`baasix_get_user_tenants` MCP tool) to return, per entry: `userRole_Id`, role
`id`/`name`, and the UserRole row's custom fields. A client renders these as
switchable "contexts" and calls `/auth/switch-tenant` with the chosen
`userRole_Id`.

### 6. Out of scope (follow-ups)

- SDK helper (`switchRole` / assignment listing types) — next SDK publish.
- App/app-builder switcher UI.
- Selecting an assignment at login time.

## Error handling

- `userRole_Id` not found or belonging to another user → 403 on switch.
- Deleted assignment with a live token → middleware falls back to legacy
  lookup; if no assignment remains, existing "no role" path applies.
- Resolver: missing `accountability.userRole` (e.g., older cached accountability
  or public role) → `role.*` resolves from role fields only; unknown field →
  `null` (consistent with existing resolver semantics).

## Caching

- New middleware cache key variant `auth:userrole:<userId>:ur:<userRoleId>`;
  both variants invalidated by the existing `baasix_UserRole` hook.
- Full-row caching replaces the 2-column projection; row sizes are small.
- Resolver does no extra DB work in the common case (merged object built from
  in-memory accountability + role cache).

## Testing

- Resolver unit tests: bare `role` → name string; `role.name` / `role.id` →
  role fields; `role.<custom>` → assignment field; collision precedence;
  missing field → null; no-accountability early return.
- Integration: two UserRole rows, same (user, tenant, role), different
  `team_Id`; switch via `userRole_Id`; verify (a) reads are team-filtered by a
  condition, (b) creates auto-stamp `team_Id` via defaultValues, (c) switching
  flips both; legacy `tenant_Id`-only switch still works; foreign
  `userRole_Id` → 403; deleted row falls back gracefully.
- Regression: existing auth/permission suites (bare `$CURRENT_USER.role`
  string semantics unchanged).
