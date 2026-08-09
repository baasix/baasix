# @baasix/baasix

## 0.2.1

### Patch Changes

- Fixed permission drawer performance issue.

## 0.2.0

### Minor Changes

- WITH CHECK enforcement for writes (Postgres RLS semantics). New nullable `checkConditions` JSON column on baasix_Permission: when set, the written row must satisfy it after create/update, before commit — otherwise 403 and the transaction rolls back atomically (createMany/updateMany batches included). `conditions` keeps exactly one meaning — USING, i.e. which EXISTING rows a grant applies to (read/update/delete) — and never applies to create grants: authoring a create grant with `conditions` is now rejected with a 400 pointing to `checkConditions`. `checkConditions: null` (the default) means no post-write check, so all existing grants behave as before. Dynamic variables ($CURRENT_USER, $CURRENT_USERROLE.*) and `$path$` relation conditions work in checkConditions exactly as in conditions. Admin and bypassPermissions paths are exempt; rejected writes fire no after-hooks and write no audit rows. With ACL-based permissions, checkConditions is read from the permission row itself (ACL entries don't carry it). Requires the updated @baasix/types (PermissionData.checkConditions).

  Note for existing deployments: create-grant `conditions` were never enforced (decorative). They remain unenforced — move them to `checkConditions` to activate real create scoping. Find candidates with:

  ```sql
  SELECT p.id, p.collection, r.name AS role, p.conditions
  FROM "baasix_Permission" p JOIN "baasix_Role" r ON r.id = p."role_Id"
  WHERE p.action = 'create'
    AND p.conditions IS NOT NULL
    AND p.conditions::text NOT IN ('{}', 'null');
  ```

  Also: before-create and before-update hooks now receive the LIVE transaction in `context.transaction` (previously undefined for normal API calls, so transactional hook writes could never roll back — the delete path already behaved correctly). And transactional reads no longer touch the shared cache (uncommitted results could poison it on rollback).

### Patch Changes

- WITH CHECK enforcement for writes (create and update) added.
- Fixed "Style B" relation definitions (a BelongsTo declared without a separately declared FK field): the FK column existed in DDL but not on the runtime Drizzle table object, so inserts SILENTLY DROPPED the FK value and relation-path filters generated broken SQL. Definitions are now normalized — the FK is injected as an explicit SystemGenerated typed field on schema create/update and healed at startup for already-stored definitions — and the Drizzle table builder adds missing BelongsTo FK columns as a safety net. This also makes permission fields:["*"] grants cover such FK columns. Relations created via the relationships route (app UI / MCP) always declared FKs explicitly and are unaffected.
- Updated dependencies
- Updated dependencies
  - @baasix/types@1.0.13

## 0.1.95

### Patch Changes

- Fixed nested relations silently loading as null when the parent relation's attributes were explicitly limited: requesting e.g. fields=["userRoles.organisation_id","userRoles.role.*"] dropped role because the junction SELECT omitted role_Id — the FK the nested BelongsTo/HasOne loader resolves through. The separate-load projection now always includes the foreign keys required by nested includes (both at the HasMany level and one level deeper).
- Search fixes: default full-text search now covers all non-JSON columns (the old string-type detection never matched, silently searching every column including JSONB); JSON/JSONB columns are opt-in via explicit searchFields. Capped to_tsvector input (150k chars) so oversized rows (e.g. baasix_AuditLog.changes) can no longer 500 with "string is too long for tsvector". Cache key now includes searchFields and sortByRelevance (previously different searches could share one cached result). Stopword-only searches (e.g. search=the) now work: they use the 'simple' text-search config (decided client-side against the english stopword list, single query); searches containing any real word keep 'english' stemming as before.
- Fixed search related issues and HasMany relationships not populating when FK is not in select
- Split the PROTECT_PRIVILEGE_FIELDS tri-state into two boolean env vars: PROTECT_PRIVILEGE_FIELDS (true|false — mass-assignment protection only) and ALLOW_PASSWORD_WRITES (default false — delegated non-admin password writes when explicitly granted; still hashed). The old value PROTECT_PRIVILEGE_FIELDS=allow-password keeps working as a deprecated alias (protection ON + password writes ON) and logs a one-time deprecation warning. New startup security-posture advisory when password writes are enabled.

## 0.1.94

### Patch Changes

- Fixed array default values issue

## 0.1.93

### Patch Changes

- Added fix for direct fields not respecting permissions

## 0.1.92

### Patch Changes

- Added fix where array_string column is created as text column

## 0.1.91

### Patch Changes

- Added arrayoverlap operator.

## 0.1.90

### Patch Changes

- Added bypassHooks option in itemservices, which can be used to infinit hook calls in some scenarios.

## 0.1.89

### Patch Changes

- Fixes for missing metadata from settings and minor alias issues in query builder

## 0.1.88

### Patch Changes

- Fixed email verification flow with resend API and cooldown time.

## 0.1.87

### Patch Changes

- Fixed ENUM case mismatch and admin app redirection.
- Updated dependencies
  - @baasix/types@1.0.12

## 0.1.86

### Patch Changes

- Added CURRENT_USERROLE dynamic variable
- Updated dependencies
  - @baasix/types@1.0.11

## 0.1.85

### Patch Changes

- More blocks and customisation added to app builder

## 0.1.84

### Patch Changes

- Named ACL permissions added for easy permission reuse.

## 0.1.83

### Patch Changes

- New session limit structure. 35+ auth providers added along with 2FA. Added option partition table based on tenant and time to improve performance for large systems.
- Updated dependencies
  - @baasix/types@1.0.10

## 0.1.82

### Patch Changes

- Added new session limit checks per role and per tenant.
- Updated dependencies
  - @baasix/types@1.0.9

## 0.1.81

### Patch Changes

- Pre-production version of internal app builder added.

## 0.1.80

### Patch Changes

- Added new env to maintain folder structure in storage- STORAGE_FOLDER_STRUCTURE

## 0.1.79

### Patch Changes

- Security audit and found issues fixed.
- Updated dependencies
  - @baasix/types@1.0.8

## 0.1.78

### Patch Changes

- Added fix for permission routes missing query support

## 0.1.77

### Patch Changes

- Fixed permission edit sheet UI stuck in loop.

## 0.1.76

### Patch Changes

- Optimised permission import.

## 0.1.75

### Patch Changes

- Added vector auto index creation and sorting

## 0.1.74

### Patch Changes

- Added vector sorting

## 0.1.73

### Patch Changes

- Added vector support
- Updated dependencies
  - @baasix/types@1.0.7

## 0.1.72

### Patch Changes

- Added tenant scoping as setting in schema definition itself.
- Updated dependencies
  - @baasix/types@1.0.6

## 0.1.71

### Patch Changes

- Fixed soft deleted related issues and added MCP tool to restore it.

## 0.1.70

### Patch Changes

- Added new MCP tools and Optimised permission import time.

## 0.1.69

### Patch Changes

- Added Hooks to clear sessions on manual deletions

## 0.1.68

### Patch Changes

- Fixed authtype handling in refresh token endpoint.

## 0.1.67

### Patch Changes

- Lexical: Missing table resizer, Schema Auditng enhancements.

## 0.1.66

### Patch Changes

- Fixed ENUM warnings in logs

## 0.1.65

### Patch Changes

- Fixed unwanted text columns creation during startup

## 0.1.64

### Patch Changes

- Fixed timezone issue in dashboard chart.

## 0.1.63

### Patch Changes

- Added diff tool to optimize DB

## 0.1.62

### Patch Changes

- Adde transaction support for read hooks.

## 0.1.61

### Patch Changes

- Added fix for updating not null and default value.

## 0.1.60

### Patch Changes

- Fixed AI SKILLS

## 0.1.59

### Patch Changes

- Fixed roles of user cache not cleared on update

## 0.1.58

### Patch Changes

- Implemented logic to delete processed files when deleting the original file.

## 0.1.57

### Patch Changes

- Expose date in response header

## 0.1.56

### Patch Changes

- TasksService: Increased redis connectionTimeout and updated retryStrategy

## 0.1.54

### Patch Changes

- Updated TasksService with more optimisation to reduce DB calls.
- Updated dependencies
  - @baasix/types@1.0.5

## 0.1.53

### Patch Changes

- Added batch caching for permissions to reduce latency in server start time.

## 0.1.52

### Patch Changes

- Added seperate system cache

## 0.1.51

### Patch Changes

- Added MCP_ENABLED_ACTIONS to restrict Remote MCP allowed actions.

## 0.1.50

### Patch Changes

- Updated admin app to support more filters

## 0.1.49

### Patch Changes

- Fixed HasMany with reports endpoint

## 0.1.48

### Patch Changes

- Updated types

## 0.1.47

### Patch Changes

- Added BODY_SIZE_LIMIT in env for maximum POST data size.

## 0.1.46

### Patch Changes

- Fixed collection filter in permissions screen.

## 0.1.45

### Patch Changes

- Fixed shared asset issues.

## 0.1.44

### Patch Changes

- Added two env to support asset sharing.

## 0.1.43

### Patch Changes

- API: Added fix for aggregate functions in decimal not working

## 0.1.42

### Patch Changes

- Added new dynamic variables CURRENT_TENANT and CURRENT_SETTINGS

## 0.1.41

### Patch Changes

- Fixed default onDelete and onUpdate to cascade

## 0.1.40

### Patch Changes

- Adding format support to assetservice.

## 0.1.39

### Patch Changes

- Add Room listing option

## 0.1.38

### Patch Changes

- REDIS support added for rooms to support multiple instances.

## 0.1.37

### Patch Changes

- Added metadata options for members in room.

## 0.1.36

### Patch Changes

- Added more realtime options - Room host options

## 0.1.35

### Patch Changes

- Restructered code to reduce cold start and DB queries.

## 0.1.34

### Patch Changes

- Added fixes for cascade operations

## 0.1.33

### Patch Changes

- Added fix for update and delete permission checks with OR.

## 0.1.32

### Patch Changes

- MCP: Add clear tool explanation for schema updation.

## 0.1.31

### Patch Changes

- Add more request methods for MCP Authentication.

## 0.1.30

### Patch Changes

- Admin app performance improvements

## 0.1.29

### Patch Changes

- Fixed nested permission checks missing issue.

## 0.1.28

### Patch Changes

- Fixed MCP tool definition more LLM friendly.

## 0.1.27

### Patch Changes

- Added MCP to support all roles.

## 0.1.26

### Patch Changes

- Added zod direct dependency needed for remote MCP

## 0.1.25

### Patch Changes

- Fixed public role having tenant specific enabled by default

## 0.1.24

### Patch Changes

- Fixed non-tenant specific roles access issues.

## 0.1.23

### Patch Changes

- Fixed email templete double header issue

## 0.1.22

### Patch Changes

- Fixed tenant sent in query for csv and json imports.

## 0.1.21

### Patch Changes

- Minor app fixes

## 0.1.20

### Patch Changes

- Added missing tenant selection in import sheets.

## 0.1.19

### Patch Changes

- Fixed sort issue with hasmany fields.

## 0.1.18

### Patch Changes

- Fixed minor bugs and new email template editor.

## 0.1.17

### Patch Changes

- Removed juice

## 0.1.16

### Patch Changes

- Fixed missing accountability fields

## 0.1.15

### Patch Changes

- Added support for custom fields in registeration

## 0.1.14

### Patch Changes

- Fixed date type mismatch issue.

## 0.1.13

### Patch Changes

- Security vulnerability fixed for invalid readone dats

## 0.1.12

### Patch Changes

- Fixed logo issues

## 0.1.11

### Patch Changes

- Fix for multiple body tags in email.

## 0.1.10

### Patch Changes

- Exported more utils and added html wrapper for emails.

## 0.1.9

### Patch Changes

- Fixed mail template adding header and footer by default issue

## 0.1.8

### Patch Changes

- Fixed `/auth/me` response format to return `{ user: ... }` instead of `{ data: ... }` for backwards compatibility with existing code and tests.

## 0.1.7

### Patch Changes

- Added new features and fixes:

  **New Features:**

  - Added `POST /auth/refresh` endpoint for token refresh
  - Added automatic log cleanup service for audit logs and email logs
    - `AUDIT_LOG_CLEANUP_ENABLED` / `AUDIT_LOG_RETENTION_DAYS` env vars
    - `EMAIL_LOG_CLEANUP_ENABLED` / `EMAIL_LOG_RETENTION_DAYS` env vars
    - Manual trigger via `triggerLogCleanup()` utility function

  **Fixes:**

  - Fixed `GET /auth/me` response format to return `{ data: user }` for SDK compatibility

## 0.1.6

### Patch Changes

- Updated documentation

## 0.1.5

### Patch Changes

- Fix package build order and dependencies

  - Add @baasix/types as explicit dependency to @baasix/plugin-stripe
  - Change core's @baasix/types dependency from file:../types to \* for proper workspace resolution
  - Update build script to ensure @baasix/types builds first before dependent packages

## 0.1.4

### Patch Changes

- Remote MCP added
- Easy MCP access

## 0.1.3

### Patch Changes

- Fixed image path in npm package readme.

## 0.1.2

### Patch Changes

- Fixed image path in npm package.

## 0.1.1

### Patch Changes

- Updated to new monorepo structure.
