# UserRole Fields in Permissions (`$CURRENT_USERROLE`) — Design

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
reference the active UserRole row via `$CURRENT_USERROLE.<field>` (including
relational paths like `$CURRENT_USERROLE.team.name`), and the user can switch
between assignments (rows), with the switched-to row's values applied — e.g.,
team-scoped reads and auto-stamped `team_Id` on create.

## Decisions made during brainstorming

- Syntax: **`$CURRENT_USERROLE.<field>`** — a new sibling of
  `$CURRENT_USER` / `$CURRENT_ROLE` / `$CURRENT_TENANT` / `$CURRENT_SETTINGS`,
  mapping 1:1 to the active `baasix_UserRole` row. Chosen over merging into
  `$CURRENT_USER.role.*` (would need bare-vs-dotted special-casing and
  role/assignment collision-precedence rules) and over `$CURRENT_TENANT`
  (teams are assignment-level, not tenant-level: two users in one tenant — or
  one user with two assignments in one tenant — differ by team).
- Relational paths supported: `$CURRENT_USERROLE.team.name`,
  `$CURRENT_USERROLE.team.manager_Id`, `$CURRENT_USERROLE.role.name`, etc.,
  via the same relational-fallback pattern `$CURRENT_ROLE` uses.
- `$CURRENT_USER.role` keeps its existing meaning (role **name** string);
  nothing about `$CURRENT_USER` changes.
- **Repurpose `/auth/switch-tenant`** to also accept `userRole_Id` (it is not
  used in production); no new endpoint.
- Token must pin the exact **UserRole row ID** (`userRole_Id`), because the
  same role can legitimately appear twice in one tenant.

## Current behavior (verified in code)

- `$CURRENT_USER.role` (bare) resolves to the role **name** — the middleware
  sets `user.role = role.name` (`utils/auth.ts` authMiddleware) and the
  resolver's in-memory fast path serves flat fields from
  `accountability.user`. This stays as-is.
- All three permission payloads (`conditions`, `relConditions`,
  `defaultValues`) flow through `resolveDynamicVariables(obj, accountability)`
  (`PermissionService.ts`, `ItemsService.ts`), so a single resolver addition
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

### 4. Dynamic variable resolver — `$CURRENT_USERROLE`

Add `CURRENT_USERROLE` as a fourth resolvable target in
`collectVariables` / `resolveCollectedVariables` / `replaceVariables`
(mirrors the existing `CURRENT_ROLE` block):

- Bare `$CURRENT_USERROLE` → the row `id`.
- **Flat fields** (`team_Id`, `tenant_Id`, any custom column): served
  in-memory from `accountability.userRole` — no DB query.
- **Relational paths** (`team.name`, `team.manager_Id`, `role.name`,
  `tenant.name`): resolved via
  `ItemsService("baasix_UserRole").readOne(userRole.id, { fields: [...] })`
  with accountability bypassed (same pattern as `$CURRENT_ROLE`'s relational
  branch), expanding BelongsTo aliases defined on `baasix_UserRole` (`role`,
  `tenant`, `user` are built-in; `team` etc. come with the user's custom FK
  fields). Cached per-request via the existing user-resolve request cache
  pattern where applicable.
- No `accountability.userRole` (public access, no assignment) → fields resolve
  to `null`, consistent with existing resolver semantics.
- `MCPService`'s dynamic-variable documentation strings updated to document
  `$CURRENT_USERROLE` (flat + relational examples).

With this in place, permissions like

```json
// condition: team-scoped reads
{ "team_Id": "$CURRENT_USERROLE.team_Id" }

// condition: manager of my team
{ "manager_Id": "$CURRENT_USERROLE.team.manager_Id" }

// defaultValues: auto-stamp on create
{ "team_Id": "$CURRENT_USERROLE.team_Id" }
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
- Resolver: missing `accountability.userRole` → `null` values; unknown field →
  `null` (consistent with existing resolver semantics).

## Caching

- New middleware cache key variant `auth:userrole:<userId>:ur:<userRoleId>`;
  both variants invalidated by the existing `baasix_UserRole` hook.
- Full-row caching replaces the 2-column projection; row sizes are small.
- Resolver does no extra DB work for flat fields (in-memory from
  accountability); relational paths cost one cached query, as with
  `$CURRENT_ROLE`.

## Testing

- Resolver unit tests: bare `$CURRENT_USERROLE` → row id; flat custom field;
  relational `team.name` / `team.manager_Id`; missing field → null; no
  assignment → null; `$CURRENT_USER.role` string semantics unchanged.
- Integration: two UserRole rows, same (user, tenant, role), different
  `team_Id`; switch via `userRole_Id`; verify (a) reads are team-filtered by a
  condition, (b) creates auto-stamp `team_Id` via defaultValues, (c) switching
  flips both, (d) relational condition `team.manager_Id` resolves; legacy
  `tenant_Id`-only switch still works; foreign `userRole_Id` → 403; deleted
  row falls back gracefully.
- Regression: existing auth/permission suites.
