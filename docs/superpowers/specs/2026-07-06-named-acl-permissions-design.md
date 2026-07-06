# Named ACL Permissions — Design

**Date:** 2026-07-06
**Status:** Approved (design), pending implementation plan

## Summary

Introduce named, reusable access-control entries (ACLs) — e.g. `Update_Own`, `Delete_Teams`, `Read_All` — stored in a new `baasix_ACL` system collection. A permission row (`baasix_Permission`) may reference one or more ACL entries via a new `acl_Ids` JSON array column. When ACLs are assigned, they **replace** the row's inline `conditions`/`relConditions`/`fields`/`defaultValues`, and multiple assigned ACLs combine **additively (OR semantics)**, Directus-policy style: assigning more ACLs can only ever grant more access, never narrow it.

Scope: backend + admin UI. SDK support deferred.

## Decisions (agreed)

1. **Storage:** named ACL entries live in their own system table (`baasix_ACL`); literal condition JSON per entry (no parameterization — a collection with a different owner field gets its own entry, e.g. `Update_Own_Author`).
2. **Replace, not mix:** if `acl_Ids` is non-empty, inline permission fields are ignored; API rejects payloads setting both.
3. **Full template, additive merge:** ACL entries carry `conditions`, `relConditions`, `fields`, `defaultValues`; multiple entries merge additively (rules below).
4. **Seed built-ins:** ship system entries (`system: true`, read-only): `Read_All`, `Read_Own`, `Update_Own`, `Delete_Own`, `Own_Tenant`.
5. **Global scope:** ACL entries are system-wide (no `tenant_Id`), matching `baasix_Role`/`baasix_Permission`. Tenant-aware behavior comes from `$CURRENT_TENANT` inside conditions.
6. **Assignment storage:** `acl_Ids` JSON array column on `baasix_Permission`, assignment-ordered (order matters for `defaultValues` merge).

## Data Model

### New system collection: `baasix_ACL`

Defined in `packages/core/baasix/utils/systemschema.ts` alongside `baasix_Permission` (~line 76).

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `name` | String | unique, not null | e.g. `Update_Own` |
| `description` | String | nullable | shown in admin UI |
| `conditions` | JSON | nullable | filter DSL; `$CURRENT_USER`, `$CURRENT_ROLE`, `$CURRENT_TENANT`, `$NOW±…` allowed |
| `relConditions` | JSON | nullable | per-relation filters, keyed by relation name |
| `fields` | JSON | nullable | allowed field list, e.g. `["*"]` |
| `defaultValues` | JSON | nullable | auto-injected values on create/update |
| `system` | Boolean | default false | seeded entries; immutable via API |

### Change to `baasix_Permission`

- New column `acl_Ids` (JSON array of `baasix_ACL` UUIDs, nullable). Order = assignment order.
- Existing unique index `(role_Id, collection, action)` unchanged.

### Seeded system entries

Seeded via the migrations mechanism (respects `MIGRATIONS_AUTO_RUN`; records a row in `baasix_Migration`):

| name | conditions | fields |
|---|---|---|
| `Read_All` | `{}` (unrestricted) | `["*"]` |
| `Read_Own` | `{"userCreated_Id": {"eq": "$CURRENT_USER"}}` | `["*"]` |
| `Update_Own` | `{"userCreated_Id": {"eq": "$CURRENT_USER"}}` | `["*"]` |
| `Delete_Own` | `{"userCreated_Id": {"eq": "$CURRENT_USER"}}` | — |
| `Own_Tenant` | `{"tenant_Id": {"eq": "$CURRENT_TENANT"}}` | `["*"]` |

`Read_Own`/`Update_Own`/`Delete_Own` assume the collection has `userCreated_Id` (auto-added when `userTracking` is enabled). Collections using a different owner field need their own user-created entry.

## Expansion & Merge Semantics

Expansion happens **once, at cache-load time** in `PermissionService.loadPermissions()` (`packages/core/baasix/services/PermissionService.ts` ~199–263) — never per-request. While building the per-role cache (`permissions:role:{role_Id}`), any permission row with non-empty `acl_Ids` has its entries resolved and merged; the **merged result** is what gets cached. Everything downstream — `getFullPermissionData`, `getFilter`, `ItemsService` enforcement, `SocketService` subscriptions, `resolveDynamicVariables` — operates on the cached merged shape and is unchanged.

Merge rules (additive — more ACLs ⇒ equal-or-more access):

- **conditions** → OR'd: `{OR: [aclA.conditions, aclB.conditions, ...]}`. A single ACL is used as-is (no wrapper). An entry with empty/null `conditions` means unrestricted ⇒ the merged conditions short-circuit to unrestricted (no filter).
- **fields** → set union of all entries' `fields`; `["*"]` in any entry wins. All entries null ⇒ treat as no explicit grant (same as a permission row with null `fields` today).
- **defaultValues** → shallow merge in `acl_Ids` order; later entries win on key conflicts.
- **relConditions** → per relation key: if **any** assigned ACL has no restriction for that relation (missing key or null), the relation is unrestricted; otherwise the per-relation conditions are OR'd.

Dynamic variables (`$CURRENT_USER` etc.) are **not** resolved at merge time — they remain in the cached JSON and are resolved per-request by `resolveDynamicVariables`, exactly as inline conditions are today.

Known trade-off (accepted): per-part merging approximates true "policy A OR policy B" row semantics — a user could combine ACL A's field grants with row access matched by ACL B's conditions. This is the same trade-off Directus makes.

### Failure handling (fail-closed)

- Dangling `acl_Ids` entry at load time → log a warning, skip that id.
- All ids dangling (or `acl_Ids` non-empty but nothing resolvable) → the permission grants **no access** (cached as deny), rather than falling back to inline values.

### Cache invalidation

ACL create/update/delete triggers `permissionService.loadPermissions()` + `invalidateAuthCache()`, mirroring what permission write routes do today (`routes/permission.route.ts:48–153`). The existing `POST /permissions/reload` flow also picks up ACL changes because expansion happens inside `loadPermissions()`.

## API Surface

### New routes: `routes/acl.route.ts` (writes `adminOnly`, mirroring `permission.route.ts`)

- `GET /acls` — list (default `limit ?? -1`).
- `GET /acls/:id` — single.
- `POST /acls` — create. Validates `name` uniqueness (DB constraint) and that `conditions`/`relConditions` parse against the filter DSL. On success: reload + invalidate caches.
- `PATCH /acls/:id` — update. **403** for `system: true` entries. Reload + invalidate.
- `DELETE /acls/:id` — delete. **403** for `system: true`. **409** if any `baasix_Permission.acl_Ids` references the id; the 409 body lists referencing permissions as `{role name, collection, action}` so the admin knows what to detach.

### Changes to permission routes (`routes/permission.route.ts`)

On `POST /permissions` and `PATCH /permissions/:id`:
- **400** if any id in `acl_Ids` does not exist (body lists unknown ids).
- **400** if the payload sets both a non-empty `acl_Ids` and any inline `conditions`/`relConditions`/`fields`/`defaultValues` (one source of truth).

### MCP tools (`services/MCPService.ts`)

- New: `baasix_list_acls`, `baasix_get_acl`, `baasix_create_acl`, `baasix_update_acl`, `baasix_delete_acl` — thin wrappers over the routes above, like existing permission tools.
- Updated: `baasix_create_permission` / `baasix_update_permission` input schemas and inline docs gain `acl_Ids` (with the replace-inline and OR-merge semantics documented).

## Admin UI (Next.js app)

1. **ACL management screen** — new "Access Control Lists" page in the admin area (near Permissions/Roles):
   - Table: name, description, `system` badge, "used by N permissions" count.
   - Create/edit drawer reusing the existing condition/fields editors from the permission editor.
   - System entries render read-only.
2. **ACL picker on the permission editor**:
   - Ordered multi-select of ACL entries (order shown, reorderable — `defaultValues` merge respects it).
   - When ≥1 ACL selected: inline condition/fields/defaults editors are hidden/disabled with a note — "Defined by assigned ACLs (OR-combined)" — and a read-only preview of the effective merged conditions is shown.
   - Clearing the picker re-enables inline editing.

## Testing

New `test/acl.test.js` following `test/permission.test.js` patterns (single jest invocation at a time):

- **CRUD:** create/read/update/delete; unique-name violation; `system` entry PATCH/DELETE → 403; delete-in-use → 409 with referencing-permission list; unknown `acl_Ids` on permission create → 400; both `acl_Ids` + inline conditions → 400.
- **Merge unit tests:** single ACL passthrough; multi-ACL conditions OR; empty-conditions short-circuit; fields union + `["*"]` wins; defaultValues order precedence; relConditions additive rule (missing key ⇒ unrestricted); dangling-id fail-closed deny.
- **End-to-end enforcement:** role with `Update_Own` assigned updates own row (200) and another user's row (403); role with `Read_Own` + `Own_Tenant` reads the union of matching rows; ACL edit followed by reload changes effective access without restart.
- **Cache:** `loadPermissions()` produces merged shape in `permissions:role:{id}`; ACL write invalidates and reloads.

## Out of Scope

- SDK (`@baasix/sdk`) typed support — follow-up (separate repo/publish).
- Parameterized templates (`$OWNER_FIELD`-style placeholders).
- Tenant-scoped ACL entries.
- Per-policy (non-merged) evaluation semantics.
