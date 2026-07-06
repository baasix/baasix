# Access Control Lists (Named ACL Entries)

Baasix permissions can restrict rows (`conditions`), related-table rows (`relConditions`), columns (`fields`), and auto-injected values (`defaultValues`) directly on a `baasix_Permission` row. Named ACL entries let you define these rule sets once, give them a name, and assign them to any number of permissions instead of retyping the same JSON everywhere.

This guide covers the concept, a working walkthrough, the exact merge semantics, the five built-in entries, the admin UI, and the full API/MCP reference.

## 1. Concept

An **ACL entry** (`baasix_ACL` collection) is a reusable permission template. It carries the same four fields a permission can define inline:

- `conditions` — row-level security filter (same filter DSL as query filters)
- `relConditions` — row-level security on related tables, keyed by relation name
- `fields` — allowed columns (`["*"]` for all, or an explicit list)
- `defaultValues` — values auto-injected on create/update

A permission (`baasix_Permission`) assigns zero or more ACL entries via an ordered array of UUIDs, `acl_Ids`. When `acl_Ids` is non-empty, the entries it references are merged into the permission's effective conditions/fields/relConditions/defaultValues at evaluation time (see the merge rules in section 3). The permission's own inline `conditions`/`relConditions`/`fields`/`defaultValues` columns are ignored in that case.

### Why ACL-first beats inline conditions

- **Reuse across roles and collections.** The same rule — "only rows the current user created" — typically applies to many collections and many roles. Written inline, that's the same JSON copy-pasted into every permission row. Written as a named entry (`Update_Own`), it's created once and assigned everywhere it applies.
- **Central edits propagate everywhere.** If the rule needs to change (e.g. broaden `Read_Own` to include a manager override), editing the one ACL entry updates every permission that references it on the next cache reload — no need to hunt down and edit N permission rows.
- **Self-documenting.** `acl_Ids: ["<Update_Own id>"]` tells a reviewer what a permission does. `conditions: {"userCreated_Id": {"eq": "$CURRENT_USER"}}` requires reading and understanding raw filter JSON to reach the same conclusion.

### When inline conditions are still the right choice

Named ACL entries add a layer of indirection that only pays for itself when a rule is reused or benefits from a name. For a condition that is genuinely specific to one permission row and used exactly once — e.g. a one-off filter like `{"status": {"eq": "archived"}}` scoped to a single role/collection/action combination that won't be reused elsewhere — inline `conditions` on the permission remain simpler. Don't create a named entry you'll only ever assign to one permission.

## 2. Quick start

This walkthrough assigns the built-in `Update_Own` entry to a role's `update` permission on a `tasks` collection, then verifies the effect. It assumes `tasks` was created with `usertrack: true` (required for `Update_Own` — see section 4) and that you're authenticated as an administrator for the write calls.

**Step 1 — list the available ACL entries:**

```bash
curl -X GET "http://localhost:8056/acls" \
  -H "Authorization: Bearer <admin-access-token>"
```

Response (abbreviated — five system entries are seeded on startup):

```json
{
  "data": [
    { "id": "b1e7...", "name": "Read_All", "description": "Read all rows, all fields", "conditions": {}, "fields": ["*"], "system": true },
    { "id": "c2f8...", "name": "Update_Own", "description": "Update rows created by the current user (requires usertrack)", "conditions": { "userCreated_Id": { "eq": "$CURRENT_USER" } }, "fields": ["*"], "system": true }
  ],
  "total": 5
}
```

Note the `id` of `Update_Own` — you'll need it for the next step.

**Step 2 — assign it to a permission:**

```bash
curl -X POST "http://localhost:8056/permissions" \
  -H "Authorization: Bearer <admin-access-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "role_Id": "<role-uuid>",
    "collection": "tasks",
    "action": "update",
    "acl_Ids": ["c2f8..."]
  }'
```

Do not also send `conditions`, `relConditions`, `fields`, or `defaultValues` in this request — the server returns `400` if any of those are set alongside a non-empty `acl_Ids` (see section 3). The route reloads the in-memory permission cache and invalidates the auth cache before responding, so the change is effective immediately for new requests.

**Step 3 — verify as the target role:**

Sign in (or reuse a session) as a user who holds `<role-uuid>`, then attempt to update a `tasks` row that user did not create, and one that they did:

```bash
# Row created by someone else — expect a 403/empty result, the row is outside the ACL's conditions
curl -X PATCH "http://localhost:8056/items/tasks/<other-users-row-id>" \
  -H "Authorization: Bearer <member-access-token>" \
  -H "Content-Type: application/json" \
  -d '{"title": "Attempted edit"}'

# Row created by this user — expect success
curl -X PATCH "http://localhost:8056/items/tasks/<own-row-id>" \
  -H "Authorization: Bearer <member-access-token>" \
  -H "Content-Type: application/json" \
  -d '{"title": "Updated title"}'
```

The second call succeeds because `Update_Own`'s condition `{"userCreated_Id": {"eq": "$CURRENT_USER"}}` resolves `$CURRENT_USER` to the requesting user's id and matches only rows that user created.

## 3. Semantics reference

### Multiple ACLs on one permission: additive (OR)

`acl_Ids` is evaluated as an ordered list. Assigning more than one entry to a permission can only **grant more access, never narrow it** — this mirrors policy-style (Directus-style) additive merging. There is no way to express "AND" between two ACL entries assigned to the same permission; if you need a rule that's a strict intersection of two conditions, express that as a single ACL entry (or inline condition) rather than two assigned entries.

### Replace-inline rule

A permission's `acl_Ids` and its inline `conditions`/`relConditions`/`fields`/`defaultValues` are mutually exclusive:

- When `acl_Ids` is a non-empty array, the assigned entries' conditions/relConditions/fields/defaultValues are used, and the permission's own inline columns are not consulted.
- Sending a non-empty `acl_Ids` **and** any of `conditions`, `relConditions`, `fields`, or `defaultValues` in the *same* create/update payload is rejected with **400**: `A permission cannot set both acl_Ids and inline conditions/relConditions/fields/defaultValues. Assigned ACL entries replace inline values.` This is a payload-level guard (`validateAclIds` in `permission.route.ts`) — it does not stop you from having stale inline values sitting in the database column from before ACLs were assigned; it only stops you from setting both in one request.
- Sending `acl_Ids: []` explicitly **detaches** all ACL entries from the permission, reverting it to using its inline conditions.

### The four merge rules (exact)

When a permission resolves two or more ACL entries, they are combined with `mergeACLEntries` (`baasix/utils/aclMerge.ts`) as follows:

1. **conditions — OR, with unrestricted short-circuit.** If any assigned entry has empty/null conditions, the merged result is `{}` (unrestricted) regardless of the other entries — an unrestricted entry always wins because the merge is additive. If there's exactly one entry, its `conditions` is used as-is (no wrapper). With two or more entries and none unrestricted, the result is `{"OR": [entryA.conditions, entryB.conditions, ...]}`.
2. **fields — union; all-null means unrestricted.** If no assigned entry defines a non-empty `fields` array, the merged `fields` is `null` (all columns). If at least one entry defines fields, the merged result is the union of every entry's field list; an entry that has no `fields` (null/empty) contributes `"*"` into that union so that explicit field names granted by other entries still survive (this matters for privilege fields that are only writable when named explicitly).
3. **defaultValues — shallow merge in assignment order, later wins.** Entries are merged with `Object.assign` in the order they appear in `acl_Ids`; if two entries set the same key, the later entry (further along in `acl_Ids`) overwrites the earlier one.
4. **relConditions — key intersection, OR'd values.** If any assigned entry has empty/null `relConditions`, the merged result is `{}` (unrestricted). Otherwise a relation key is present in the merged result only if **every** assigned entry restricts that same relation (set intersection of keys across all entries); for each shared key, the values from all entries are OR'd together (`{"OR": [...]}`, or the single value as-is if only one entry defines that key after intersection).

### Dynamic variables

Both inline conditions/defaultValues and ACL-entry conditions/defaultValues support the same dynamic variable syntax, resolved per-request against the caller's `accountability`:

| Variable | Resolves to |
|---|---|
| `$CURRENT_USER` | The authenticated user's id |
| `$CURRENT_USER.field` | Any field on the authenticated user's row, e.g. `$CURRENT_USER.tenant_Id`, `$CURRENT_USER.department_Id` |
| `$CURRENT_ROLE` | The id of the role the request is evaluated under |
| `$CURRENT_ROLE.field` | Any field on that role's row |
| `$CURRENT_TENANT` | The current tenant id (from `accountability.tenant`) |
| `$CURRENT_TENANT.field` | Any field on the current tenant's row |
| `$CURRENT_SETTINGS.field` | A field from tenant-aware settings (merged with global settings) |
| `$NOW` | The current timestamp |
| `$NOW+DAYS_7`, `$NOW-MONTHS_1`, etc. | Timestamp math — `$NOW` offset by a signed amount of `DAYS_N`, `MONTHS_N`, and similar unit suffixes |

Variables can appear as filter values (e.g. `{"userCreated_Id": {"eq": "$CURRENT_USER"}}`) or as `defaultValues` (e.g. `{"tenant_Id": "$CURRENT_TENANT"}`).

## 4. Built-in entries

Five system ACL entries are seeded automatically on server startup (`seedSystemACLs()`, idempotent — re-running startup does not duplicate or reset them). They have `system: true` and cannot be modified or deleted through the API (see section 6).

| Name | Conditions | Fields | Notes |
|---|---|---|---|
| `Read_All` | `{}` (unrestricted) | `["*"]` | Read every row, every column. |
| `Read_Own` | `{"userCreated_Id": {"eq": "$CURRENT_USER"}}` | `["*"]` | Read only rows the current user created. |
| `Update_Own` | `{"userCreated_Id": {"eq": "$CURRENT_USER"}}` | `["*"]` | Update only rows the current user created. |
| `Delete_Own` | `{"userCreated_Id": {"eq": "$CURRENT_USER"}}` | `null` (no field restriction; delete doesn't select columns) | Delete only rows the current user created. |
| `Own_Tenant` | `{"tenant_Id": {"eq": "$CURRENT_TENANT"}}` | `["*"]` | Rows belonging to the caller's current tenant. |

### The `userCreated_Id` / `usertrack` assumption

`Read_Own`, `Update_Own`, and `Delete_Own` all filter on `userCreated_Id`. That column only exists — and is only populated — on collections whose schema was created with `usertrack: true`. Enabling `usertrack` adds `userCreated_Id`/`userUpdated_Id` tracking columns and Baasix populates `userCreated_Id` from `accountability.user.id` on every create.

If you assign `Update_Own` to a permission on a collection that does **not** have `usertrack: true`, the condition will filter on a column that is always null, and the permission will effectively grant access to nothing (fail closed) rather than erroring.

### Collections with a different owner field

If your collection tracks ownership under a different column name — for example an `author_Id` foreign key instead of the generic `userCreated_Id` — the `*_Own` system entries do not apply directly, because they're hard-coded to `userCreated_Id`. Create your own named entry pointing at the right column, e.g.:

```bash
curl -X POST "http://localhost:8056/acls" \
  -H "Authorization: Bearer <admin-access-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Update_Own_Author",
    "description": "Update rows authored by the current user (author_Id column)",
    "conditions": { "author_Id": { "eq": "$CURRENT_USER" } },
    "fields": ["*"]
  }'
```

Then assign `Update_Own_Author`'s id via `acl_Ids` on the relevant permission(s), the same way you would assign the built-in `Update_Own`.

## 5. Admin UI walkthrough

ACL entries and the permission drawer's ACL picker are managed from the admin app (Settings).

**Settings → Access Control Lists.** A dedicated management screen lists every ACL entry in a table with columns for name, description, a "System" badge on the five built-in entries, and a usage count showing how many permissions currently reference each entry (computed by matching each permission's `acl_Ids` against the entry's id). Clicking "Create ACL" opens a drawer to define a new entry's `name`, `description`, `conditions`, `relConditions`, `fields`, and `defaultValues`; clicking a row opens the same drawer in edit mode. System entries open read-only — their inputs are disabled and there is no save or delete action, matching the API's 403 on write/delete for `system: true` entries. Deleting a custom entry that is still referenced by one or more permissions is blocked with the server's usage-count error surfaced in the UI, the same 409 the API returns.

**Permission drawer — ACL picker.** The permission create/edit drawer (Settings → Permissions) includes an "Access Control Lists" section above the inline Fields/Conditions/Default Values editors. It renders `acl_Ids` as an ordered, reorderable multi-select: assigned entries appear as a list (with a system badge where applicable, and controls to reorder or remove), plus a dropdown to add any not-yet-assigned entry. Order matters because `defaultValues` merge with "later wins" semantics (section 3). As soon as one or more ACL entries are assigned, the inline Fields/Conditions/Relational Conditions/Default Values editors are disabled (replaced with a note explaining that those are now controlled by the assigned entries) — this mirrors the API's replace-inline rule so the UI can never produce a payload that mixes both. A read-only preview shows the merged/OR'd effective conditions for the currently assigned entries. Removing all assigned entries re-enables the inline editors.

## 6. API reference

All ACL routes operate on the `baasix_ACL` collection. Reads are subject to normal collection permissions; writes are restricted to administrators (`adminOnly` middleware). Every successful write reloads the permission cache and invalidates the auth cache so the effect is immediate; updates additionally invalidate the item-query cache for every collection that has a permission referencing the changed entry.

Errors follow Baasix's standard error envelope: `{ "error": { "message": "...", "details": ..., "statusCode": ... } }`.

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/acls` | Standard collection read permissions | List ACL entries. Supports the usual query params (`filter`, `sort`, `page`, `limit`). |
| `GET` | `/acls/:id` | Standard collection read permissions | Get a single ACL entry by id, including `conditions`, `relConditions`, `fields`, `defaultValues`, `system`. |
| `POST` | `/acls` | Admin only | Create a new ACL entry. `name` is required and must be unique. `system` in the request body is ignored/stripped — entries created through the API are never system entries. |
| `PATCH` | `/acls/:id` | Admin only | Update an existing ACL entry. Rejected for entries where `system: true`. |
| `DELETE` | `/acls/:id` | Admin only | Delete an ACL entry. Rejected for `system: true` entries, and rejected if any permission still references the entry. |

### Error cases

- **400 — bad payload.** `POST`/`PATCH /acls`: creating without a non-empty string `name` (create only), or sending `conditions`/`relConditions`/`defaultValues` as something other than a JSON object, or `fields` as something other than an array of strings.
- **400 — unknown ACL id(s).** `POST`/`PATCH /permissions` with an `acl_Ids` entry that doesn't exist: `Unknown ACL entry id(s): <id, id, ...>` (all unresolved ids are listed in the message).
- **400 — mixing inline and acl_Ids.** `POST`/`PATCH /permissions` with a non-empty `acl_Ids` plus any of `conditions`/`relConditions`/`fields`/`defaultValues` in the same payload: `A permission cannot set both acl_Ids and inline <keys>. Assigned ACL entries replace inline values.`
- **403 — system entry write.** `PATCH`/`DELETE /acls/:id` on an entry with `system: true`: `System ACL entries cannot be modified` / `System ACL entries cannot be deleted`.
- **409 — delete in use.** `DELETE /acls/:id` when one or more permissions still reference the entry via `acl_Ids`. The response's `error.details.usedBy` is an array describing every referencing permission:

  ```json
  {
    "error": {
      "message": "ACL entry 'Update_Own_Author' is assigned to 2 permission(s). Detach it first.",
      "details": {
        "usedBy": [
          { "permission_Id": "...", "collection": "articles", "action": "update", "role_Id": "..." },
          { "permission_Id": "...", "collection": "articles", "action": "delete", "role_Id": "..." }
        ]
      },
      "statusCode": 409
    }
  }
  ```

  Detach the entry from each listed permission (e.g. `acl_Ids: []`, or remove just that id from the array) before retrying the delete.

### MCP tools

Five MCP tools mirror the REST routes for AI-driven administration, plus `acl_Ids` support on the existing permission tools:

- **`baasix_list_acls`** — list ACL entries (`filter`, `sort`, `page`, `limit`); use this before writing inline conditions to check for a reusable entry.
- **`baasix_get_acl`** — get one ACL entry by `id`.
- **`baasix_create_acl`** — create a new ACL entry (`name`, `description`, `conditions`, `relConditions`, `fields`, `defaultValues`).
- **`baasix_update_acl`** — update an existing entry by `id`; fails for system entries.
- **`baasix_delete_acl`** — delete an entry by `id`; fails 403 for system entries, 409 if any permission still references it.
- **`baasix_create_permission`** / **`baasix_update_permission`** — both accept an optional `acl_Ids` array of ordered ACL entry UUIDs. On `baasix_update_permission`, passing `acl_Ids: []` detaches all assigned entries and reverts the permission to its inline values.
