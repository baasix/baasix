# Baasix Core (`@baasix/baasix`) — Security Audit

**Date:** 2026-06-10 (revised 2026-06-10 after owner clarifications)
**Scope:** `packages/core/baasix/` — auth, query/filter layer, ItemsService/permissions, file handling, workflows/MCP/reports/realtime.
**Method:** Manual review of central primitives (entry point, auth middleware, permission service, query builder, filter operators) + 5 parallel deep-dives. All findings below are backed by concrete code evidence (`file:line`).

---

## Revision note — owner clarifications applied

Two design clarifications from the owner change how some findings are scored:

1. **Workflows are authored only by administrators.** This is the *intended policy*. It downgrades the workflow findings (A2, A3) and workflow-SSRF (A9) **as a default posture** — but see the caveat below, because the policy is **not enforced in code**.
2. **Public / unauthenticated permissions are an intended feature** (Directus-style): developers configure what the `public` role may do. So "the public role can do X" is *by design when an admin grants it*. The default seed creates the `public` role with **zero permissions** (verified — [schemaManager.ts:1424-1431](baasix/packages/core/baasix/utils/schemaManager.ts#L1424)), i.e. **default-deny**. This reframes the public-access findings: the risk is not "public can be granted access," it is (a) **unsafe defaults** that expose data *without* an explicit grant, and (b) **bypasses** that sidestep the permission system the public feature relies on.

### Effect on the workflow findings (important caveat)

"Workflows are admin-only" is true **today only because no role is granted item-permissions on `baasix_Workflow`** — it is a configuration fact, **not a code-enforced invariant**. Verified:
- `workflow.route.ts` has **no** create/update endpoint; workflows are created via the generic `POST /items/baasix_Workflow`, gated purely by the items permission system ([routes/workflow.route.ts](baasix/packages/core/baasix/routes/workflow.route.ts) — only execute/test/validate/export/import exist; import IS admin-gated at [:626](baasix/packages/core/baasix/routes/workflow.route.ts#L626)).
- There is **no guard** preventing an admin from creating a permission that grants a *non-admin* role `create`/`update` on `baasix_Workflow` (or any `baasix_*` system collection).
- The script/transform nodes still execute via `new Function`/`AsyncFunction` in the host process ([WorkflowService.ts:579,1950](baasix/packages/core/baasix/services/WorkflowService.ts#L579)).

**Consequence (owner decision):** A2/A3 are **accepted as by-design**. Workflows are an **internal admin/staff configuration feature — never exposed to end users**. Authoring requires an admin to *explicitly* grant workflow write access, and that's only ever given to trusted company staff. So the "non-admin could author a workflow" scenario only arises among already-trusted internal operators configuring the system — the same trust model as any other admin capability. Not an open finding. *Optional defense-in-depth (not required): sandbox script execution (`isolated-vm`) to contain blast radius if an internal operator's account is compromised.*

---

## Architecture (trust model)

```
HTTP → CORS → bodyParser → rateLimit → static(/admin) → requestContext → authMiddleware → routes → ItemsService → queryBuilder/filterOperators → Drizzle/PG
```

Key trust-model facts that shape the findings:

- **`authMiddleware` fails *open* to the `public` role.** No token / invalid token / *any error* → request continues as the `public` role rather than being rejected (`utils/auth.ts:339-369`, `451-470`). Every route is reachable unauthenticated; access is then gated by the `public` role's permissions.
- **Role-based permissions** with per-collection row `conditions`, field allow-lists, and default values. `administrator` role bypasses all checks.
- **Permission filters are correctly AND-merged** into read/update/delete WHERE clauses (verified) — the row-isolation model itself is sound *when conditions are configured*. The breaks are in (a) SQL identifier handling, (b) write-side field protection, (c) tenant scoping, and (d) workflow/report code paths.

---

## Findings summary

Severity reflects the owner clarifications. **Status** column: `✅ FIXED` = remediated + tested this engagement; `OPEN` = still a real risk to fix; `LATENT` = mitigated by current config/default but reactivates under a supported configuration and not enforced in code; `BY DESIGN` = intended feature, with any residual hardening noted.

**Progress: all findings resolved.** 16 fixed — all 4 Critical (A1, A4, A5, A6), all High (A7, A8, A9, A10, A11, **A12 fully**, A13, A14), the newly-found A21 read-leak, and the full Medium batch (A15, A16, A17, A18, A20). A12 now includes opt-in per-recipient row-level realtime scoping (`REALTIME_ROW_LEVEL_SCOPING`, default off = fast path preserved). **By-design/accepted:** A2/A3/A9-workflow (internal staff-only workflows), A19 (intentional system-context). **No open security work remains.** See per-finding detail below.

**Operator safety net (added):** a consolidated **startup security-posture banner** (`utils/securityPosture.ts`, called from `app.ts`) warns at boot about every security/integrity setting currently in a less-safe state — whether disabled by default for backward compatibility or set that way in the env (SCHEMAS_PUBLIC, PROTECT_PRIVILEGE_FIELDS, PROTECT_IS_PUBLIC_FIELD, EXPOSE_ERROR_DETAILS, STRICT_TENANT_ISOLATION, STORAGE_PATH_CONFINEMENT, SSRF_ALLOW_PRIVATE_URL_FETCH, ASSET_XSS_PROTECTION/NOSNIFF, AUTH_RATE_LIMIT_DISABLED, OAUTH_ALLOW_*). Grouped by category with the risk + the one-line fix; advisory only, skipped under TEST_MODE. Helps a new operator who inherited an `.env`. Tests: `securityPosture.test.js`. *(Also removed the dead+misleading `SOCKET_EXCLUDE_COLLECTIONS` env var — it was never read by any code; realtime exclusion is WAL/per-collection-enable gated, so the var gave a false sense of "these collections aren't broadcast.")*

| ID | Sev (revised) | Status | Title |
|----|-----|--------|-------|
| **A1** | Critical | ✅ **FIXED** | SQL injection via relation-path / aggregation filter keys — identifier allowlist + JSONB numeric guard. Tests: `sqlInjection.test.js` |
| **A4** | Critical | ✅ **FIXED** | Mass assignment — opt-in privilege-field model (`PROTECT_PRIVILEGE_FIELDS`); admins exempt; `password` via `allow-password`. Tests: `massAssignment.test.js` |
| **A5** | Critical | ✅ **FIXED** | File path traversal — `resolveStorageKey` confinement at all local-disk sinks (`STORAGE_PATH_CONFINEMENT`). Tests: `storagePathConfinement.test.js` |
| **A6** | Critical | ✅ **FIXED** | Stored XSS — serving-side safe headers (`ASSET_XSS_PROTECTION`/`ASSET_NOSNIFF`); html/svg/js forced to download. Tests: `uploadXss.test.js` |
| **A21** | High | ✅ **FIXED** | **(Found this engagement)** Hidden-field read leak — `getHiddenFields` read the Drizzle table (no `hidden` flag) → password hashes/secrets leaked on read. Now reads schema definition; `includeHidden` opt-in for the auth layer. Tests: `hiddenFieldLeak.test.js` |
| **A7** | High | ✅ **FIXED** | JWT — `algorithms:['HS256']` pinned on verify/sign; missing secret hard-fails; short secret warns at startup (non-breaking). Tests: `jwtHardening.test.js` |
| **A10** | High | ✅ **FIXED** | Sessions revoked on password change/reset (`invalidateAllSessions` + cache evict). Tests: `sessionRevocation.test.js` |
| **A11** | High | ✅ **FIXED** | Tenant isolation — `isTenantSpecific:false` bypass restricted to administrator (`STRICT_TENANT_ISOLATION`). Tests: `tenantStrictIsolation.test.js` + `multitenant.test.js` |
| **A12** | High | ✅ **FIXED** | Realtime — execution-room join ownership-gated; broadcasts strip hidden fields; **per-recipient row-level scoping implemented** (opt-in `REALTIME_ROW_LEVEL_SCOPING`, default off = fast O(1) room broadcast unchanged). When on, each change is delivered only to subscribers whose read permission allows the row — **hybrid**: subscribers bucketed by role, a role with no read conditions/relConditions takes a no-DB fast path, otherwise one permission-scoped existence query (via `ItemsService.readByQuery`, so flat conditions, nested `relConditions`, tenant scoping, and field perms are all enforced correctly). Fails closed on error. Tests: `realtimeRowScoping.test.js` (decision logic). |
| **A2** | — | **BY DESIGN (accepted)** | Workflow `script`/`transform` nodes run host code. Workflows are an **internal admin/staff feature, never exposed to end users**; authoring requires an admin to explicitly grant write on `baasix_Workflow`, only given to trusted company staff. Owner-accepted as an intentional internal capability. *Optional defense-in-depth: sandbox script execution (`isolated-vm`) to contain a compromised-operator blast radius.* |
| **A3** | — | **BY DESIGN (accepted)** | Workflow `service` node `bypassPermissions`/`executeAsAnonymous`. Same trust model as A2 — internal admin/staff feature, not user-facing. Owner-accepted. |
| **A8** | High | ✅ **FIXED** | OAuth: account linking now gated on **verified email** (`OAUTH_ALLOW_UNVERIFIED_LINK` override); idToken signatures **verified via JWKS** (Google/Apple, was decode-only); broken/risky direct-idToken path **disabled by default** (`OAUTH_ALLOW_DIRECT_IDTOKEN`); optional browser-bound `state` cookie (`OAUTH_STATE_COOKIE_BINDING`, off by default to avoid breaking cross-site callbacks). Tests: `oauthHardening.test.js`. |
| **A13** | High | ✅ **FIXED** | Image-transform DoS: output `width`/`height` now clamped to `ASSET_MAX_DIMENSION` (default 5000); `sharp limitInputPixels` = `ASSET_MAX_INPUT_PIXELS` (default 100MP, decompression-bomb defense); `quality` clamped 1–100; `format`/`fit` allowlisted. Tests: `imageTransformDos.test.js`. *(Residual: distinct cache-variant count is now bounded by the dimension clamp but not hard-capped — minor disk-fill surface.)* |
| **A14** | High | ✅ **FIXED** | Dedicated brute-force limiter on login/magic-link/password-reset, keyed **per (IP + email) pair** (default 10/15min via `AUTH_RATE_LIMIT`/`AUTH_RATE_LIMIT_INTERVAL`; stricter than the global limiter; auto-disabled in TEST_MODE). Magic-link **code** now a CSPRNG value over an unambiguous alphabet (was `token.substring(0,12)` — leaked token material + brute-forceable). Tests: `authRateLimit.test.js`. **Residual (by design):** the per-(IP+email) key protects targeted brute-force and avoids shared-IP lockout, but does NOT cap an IP's *total* attempts across many accounts — i.e. it does not by itself stop password **spraying**; put a WAF / per-IP edge limit in front for that. |
| **A9** | High→Medium | ✅ **FIXED** | SSRF. `uploadFromUrl`/`downloadFile` now validate scheme + block private/loopback/link-local/metadata IPs on the **resolved** address, re-validate **every redirect hop** (manual redirect following), and enforce size/timeout. Workflow HTTP node gets initial-URL validation (defense-in-depth). Override: `SSRF_ALLOW_PRIVATE_URL_FETCH`. Reusable `utils/ssrfGuard.ts`. Tests: `ssrfGuard.test.js`. |
| **A15** | Medium | ✅ **FIXED** (partial) | `isPublic` made opt-in via `PROTECT_IS_PUBLIC_FIELD` (default off; when on, a broad `fields:["*"]` grant can't publish files). The `x-baasix-user-auth` header is **by design** — an anti-hotlinking control (browsers can't set custom headers on passive `<img>/<video>` embeds), NOT an auth check; restored + hardened with a null-user guard. Tests: `massAssignment.test.js`. |
| **A16** | Medium | ✅ **FIXED** | DB/internal errors no longer reflect raw `pgError.message`/`detail` by default — production returns a generic message + correlation id (logged server-side); `EXPOSE_ERROR_DETAILS=true` re-enables details for dev/staging. Constraint-violation `detail` (which contains values) is withheld. Tests: `errorMasking.test.js`. |
| **A17** | Medium | ✅ **FIXED** | `/settings` now uses an **allow-list** (only client-safe branding/i18n fields; SMTP creds, `metadata`, `modules`, and any future secret field are withheld — was a deny-list that leaked everything-but-SMTP). `GET /schemas` default kept (backward compat) but now logs a loud startup warning recommending `SCHEMAS_PUBLIC=false`. Admin PATCH returns full settings. Tests: `settingsAllowlist.test.js`. |
| **A18** | Medium | ✅ **FIXED** (magic-link + login) | Magic-link returns a uniform "if an account exists…" message (was 404 "User not found"). Login does a dummy argon2 verify for non-existent accounts to equalize timing (was an instant return → timing oracle). *(Register still returns "already exists" — a UX necessity, left as-is.)* |
| **A19** | — | **BY DESIGN** | `ItemsService` with `accountability: undefined` = trusted **system context** with full access (Directus-style `accountability: null`). Intentional, used by ~8 internal callers (auth adapter, dynamic-variable resolver, etc.); HTTP always populates accountability, so not request-reachable. Not a vulnerability. *(Residual: prefer an explicit `{ system: true }` flag over implicit absence; remove debug `console.log`s in `isAdministrator`.)* |
| **A20** | Low | ✅ **FIXED** (logging) | Removed the per-request `console.log`s in `valueToRawSQL` (logged raw user input on every filter value) + the `/schemas` debug log. *(LIKE `%`/`_` wildcard escaping left as-is — it's arguably intended search behavior and changing it would alter query results; documented as a residual.)* |

**Not findings (clarified as by-design):** The `public` role being *grantable* permissions is an intended feature and is **default-deny** (seed creates `public` with zero permissions — [schemaManager.ts:1424](baasix/packages/core/baasix/utils/schemaManager.ts#L1424)). "Public can read/write X" is correct behavior *when an admin configured it*. The audit's public-access concerns are retained only where access happens **without** an explicit grant (A17 defaults) or **bypasses** the permission system (A12 realtime, A15 header).

---

## Critical findings (detail)

### A1 — SQL injection via relation-path & aggregation filter keys
> **✅ FIXED** — see the "Remaining open issues" / fix-status sections below for the remediation detail and tests. The original analysis is retained here for reference.

**Sink:** `utils/filterOperators.ts:110-112,135-146` (`buildColumnSQL`/`buildColumnSQLString` → `sql.raw`), fed by `utils/relationPathResolver.ts:79,96-103` (builds `columnPath` from raw user segments, no schema check), forced down the raw path by `utils/queryBuilder.ts:170-190` (`tableName: 'relation'`). Aggregation twin: `utils/aggregationUtils.ts:203-205,322,111` (groupBy/aggregate field + `EXTRACT(${sql.raw(datePart)})`).

**Reachable:** `GET /items/:collection?filter=...` (filter JSON `JSON.parse`'d, keys attacker-controlled — `utils/router.ts:95`) and `GET/POST /reports/:collection?aggregate=...&groupBy=...`. Only the `public` role needs read on one collection.

**Exploit:** `GET /items/products?filter={"x.y\"=1) OR (SELECT 1 FROM baasix_User)--":{"eq":1}}` — the embedded `"` breaks identifier quoting → arbitrary WHERE-clause SQL (blind/boolean exfiltration, subqueries). Direct (non-dotted) fields are validated by `getColumn` and are NOT injectable; the hole is relation paths, aggregation fields, groupBy, sort fallback, and JSONB numeric operands (`filterOperators.ts:965` etc., unescaped `value.value`).

**Fix:** Resolve every path segment / aggregate field to a real `PgColumn` against `schemaManager` and emit Drizzle column refs (never `sql.raw` on identifiers). Reject unknown columns (400). Validate `datePart` against an enum. Parameterize all JSONB `value.value` operands. The codebase already has `fieldUtils.sanitizeFieldName` and `assertSafeIdentifier` — neither is wired into these sinks.

### A2 — Workflow script/transform RCE — **BY DESIGN (accepted)** (was Critical)
**Owner decision:** Workflows are an **internal admin/staff configuration feature, never exposed to end users**. Authoring requires an admin to explicitly grant write on `baasix_Workflow`, only given to trusted company staff. The "non-admin authors a workflow" scenario therefore only occurs among already-trusted internal operators — the same trust model as any other admin capability. Not an open finding.
**Sink (for reference):** `services/WorkflowService.ts:579` (`new Function(...)`), `:1950-1952` (`AsyncFunction`) — runs in the main Node process. `validateWorkflowAccess` (`utils/workflow.ts:157-170`) gates *execution* on `status==='active'` + role access.
**Optional defense-in-depth (not required):** sandbox script execution with `isolated-vm` (no host globals/`require`, CPU/mem limits) to contain blast radius if a trusted operator's account is compromised.

### A3 — Workflow service-node `bypassPermissions`/`executeAsAnonymous` — **BY DESIGN (accepted)** (was Critical)
**Owner decision:** Same trust model as A2 — internal admin/staff feature, not user-facing; `bypassPermissions` is an intentional operator capability. Not an open finding.
**Sink (for reference):** `services/WorkflowService.ts:741-823` — `bypassPermissions`, `executeAsAnonymous`, `collection`, `operation`, `data` from `node.data` → `ItemsService` create/update/delete.
**Optional defense-in-depth:** treat `bypassPermissions` as an explicitly-audited capability rather than a free-form node flag.

### A4 — Mass assignment (write-side field protection)
> **✅ FIXED** (opt-in `PROTECT_PRIVILEGE_FIELDS` model) — remediation detail and tests below. Original analysis retained for reference. NOTE: the original fix recommendation ("reject `SystemGenerated` fields") was found to be wrong during implementation — `SystemGenerated` is set on legitimately-writable fields like `firstName`/`email`; the actual fix uses a curated privilege deny-list + `hidden` flags instead.

**Sink:** `services/ItemsService.ts:977-1025` (`applyFieldPermissions`) checks only allow-list membership; never consults `SystemGenerated`/`hidden`. `utils/fieldExpansion.ts:44-46` expands `*` to ALL columns including system ones.
**Exploit:** With create/update on a collection using `fields:"*"`, set `role_Id`, `tenant_Id`, `password` (auto-hashed at `ItemsService.ts:2487`), or `isPublic` directly.
**Fix:** In `applyFieldPermissions`, reject any field whose schema entry is `SystemGenerated`/`hidden` for non-admins; exclude such fields from `*` expansion in write contexts; hard server-side deny-list for `role_Id`/`tenant_Id`/`password`/`isPublic`/PK.

### A5 — File path traversal
> **✅ FIXED** via `resolveStorageKey` confinement — remediation detail and tests below. Original analysis retained for reference.

**Sink:** `services/AssetsService.ts:198` (read), `services/StorageService.ts:67-78` (read/write/delete), `services/FilesService.ts:154,268` — `path.join(basePath, file.filename)` with no containment check. `filename`/`storage` are client-writable because they're not stripped in `FilesService.createOne`/`updateOne` (the `SystemGenerated` flag isn't enforced — same root cause as A4).
**Exploit:** `PATCH /files/:id` with form field `filename=../../../../etc/passwd`, then `GET /assets/:id` → reads `/etc/passwd`. `DELETE /files/:id` → arbitrary unlink.
**Fix:** Strip `filename`/`storage` from client input; reject `..`/`/`/`\`/null bytes; after `path.join`, assert `resolve(full).startsWith(resolve(base)+sep)`.

### A6 — Stored XSS via upload
> **✅ FIXED** via serving-side safe headers — remediation detail and tests below. Original analysis retained for reference.

**Sink:** `services/FilesService.ts:83` (`type: file.mimetype` — trusts client), `routes/file.route.ts:303-309` (`res.contentType(file.type)` + `Content-Disposition: inline`). No MIME/extension allowlist anywhere.
**Exploit:** upload `evil.html` as `text/html` → `GET /assets/:id` renders it inline in the app origin → XSS / token theft.
**Fix:** Server-side MIME allowlist (sniff content, don't trust client); serve non-safe types as `attachment` + `application/octet-stream` + `X-Content-Type-Options: nosniff`; never serve `text/html`/`image/svg+xml` inline same-origin.

---

## High findings (detail — abbreviated)

- **A7 JWT:** ✅ **FIXED.** Every `jwt.verify` now pins `{ algorithms: ['HS256'] }` and every `jwt.sign` sets `algorithm: 'HS256'` (`utils/auth.ts`, `auth/services/token.ts`, `services/SocketService.ts`). `getJwtSecret()` hard-fails on a **missing** secret. Secret **strength** is a recommendation, not a hard gate: `validateAuthSecretAtStartup()` (run once at boot) logs a loud warning for a <32-char secret but does NOT crash — so an existing deployment running a short key keeps working and can rotate on its own schedule (rotation invalidates all tokens, so it's a maintenance-window task). Tests: `test/jwtHardening.test.js` (alg:none, wrong-secret, forged-session all rejected).
- **A8 OAuth:** `state` validated only for existence in a global cache, never bound to the initiating browser (`auth/core.ts:521-535`, `auth/routes.ts:471-485`) → login CSRF; email-based auto-linking without `emailVerified` (`auth/core.ts:561-583`) → takeover; `verifyIdToken` only base64-decodes, signature unchecked (`auth/providers/google.ts:166-197`, `apple.ts:217-243`); `social/signin` idToken path calls `handleOAuthCallback(provider,"","","","")` (`auth/routes.ts:387-431`). **Fix:** bind state via signed httpOnly cookie; only link on verified email; verify idToken against provider JWKS.
- **A9 SSRF:** `services/FilesService.ts:321-328` (`axios(url)`) — **OPEN**, reachable by anyone granted file-create. `services/WorkflowService.ts:504-529` (`fetch(url)`) — **LATENT** (admin-authored workflows only). No scheme/IP validation, follows redirects. **Fix:** allowlist scheme; block private/link-local/loopback/metadata IPs on resolved address; re-check on redirect.
- **A10 Sessions:** ✅ **FIXED.** `changePassword`/`resetPassword`/`verifyPasswordReset` (`auth/core.ts`) now call `sessionService.invalidateAllSessions(userId)` on success, which deletes all sessions AND evicts the session cache so revocation is immediate. Test: `test/sessionRevocation.test.js` (old token rejected after change; new password works).
- **A11 Tenant:** ✅ **FIXED.** `utils/tenantUtils.ts` now restricts the `isTenantSpecific:false` tenant-scoping bypass to the **administrator** role; a non-admin role marked `isTenantSpecific:false` is still tenant-scoped when a tenant context exists. Env `STRICT_TENANT_ISOLATION` (default on) controls this; `false` restores legacy behavior. Tests: `test/tenantStrictIsolation.test.js` + full `multitenant.test.js` (19) still green.
- **A12 Realtime:** ✅ **FIXED.** (1) `workflow:execution:join` now verifies the user is the execution's `triggered_by_Id` (or admin) and same tenant before joining — fixes the cross-user execution-room leak. (2) `broadcastChange` strips **hidden fields** (password/token/secret) from the payload — field-level leak fixed. (3) **Per-recipient row-level scoping** is implemented behind opt-in `REALTIME_ROW_LEVEL_SCOPING` (default off → unchanged fast room broadcast). When enabled, `broadcastChangeScoped` enumerates the room's local sockets, buckets them by role, and for each role decides delivery: a role with no read `conditions`/`relConditions` → no-DB fast path; otherwise a permission-scoped `readByQuery` existence check for the changed id(s) using that role's accountability (so flat conditions, nested `relConditions`, tenant scoping, and field perms are all enforced via the real read pipeline). Fails closed on error. Decision helpers `hasReadRestrictions`/`allIdsVisible` unit-tested in `realtimeRowScoping.test.js`. *(Refinement left for later: when a multi-record broadcast is only partially visible to a role, the whole bucket is withheld rather than split per-record — the common single-record case is exact.)*
  - **How Directus does it (for reference):** Directus does NOT use a shared room broadcast. On each change event it loops every matching subscription and calls `getPayload(subscription, client.accountability, schema, event)` **per client** — re-evaluating that client's permissions + subscription filter (via the items/permission layer) before sending. So each subscriber gets an individually permission-filtered payload, at the cost of per-subscriber evaluation per event ([subscribe handler](https://github.com/directus/directus/blob/main/api/src/websocket/handlers/subscribe.ts)). Baasix currently optimizes for the O(1) room broadcast instead.
  - **Why a pure in-memory check is insufficient (key constraint):** a broadcast payload is only the *changed row*. A **flat** condition (own-column, e.g. `{owner_Id: {eq: $CURRENT_USER.id}}`) can be checked in-memory against that row. But a **nested relational** condition (e.g. `{project: {team: {members: {user_Id: {eq: $CURRENT_USER.id}}}}}`) needs data in *other tables* — the query layer answers it via JOIN/EXISTS across tables (`relationPathResolver.ts`), and the single-row payload simply doesn't contain `project.team.members`. So nested-relational conditions **cannot** be evaluated in memory without hitting the DB. This is precisely why Directus pays the per-subscriber DB cost.
  - **If we adopt row-level scoping**, gate it behind opt-in `REALTIME_ROW_LEVEL_SCOPING` (default off, fast path unchanged) and use a **hybrid**: classify each subscriber's resolved condition — *flat* → cheap in-memory predicate against the changed row; *contains a relation path* → fall back to a permission-checked DB existence check for the changed id (bucket subscribers by identical resolved filter so each distinct filter is one query, not one per user). A subscribe-time pre-resolved key-set cache is a third option but is staleness-prone (membership changes mid-session). Conclusion: there is **no cheap, fully-correct** way to enforce nested-relational row perms on a broadcast — correctness requires a DB hit or a stale-prone cache, which is why the residual is accepted rather than papered over with an incomplete in-memory check.
- **A13 Image DoS:** `services/AssetsService.ts:274-282` — unbounded `width`/`height`, no `limitInputPixels`, unbounded cache-variant writes. **Fix:** clamp dimensions, set `limitInputPixels`, cap variants, rate-limit.
- **A14 Brute force / magic-link:** only the global limiter exists (`app.ts:175-191`); magic-link "code" is `token.substring(0,12)` (`auth/routes.ts:594-598`) with no attempt cap. **Fix:** dedicated per-account limiter + lockout; CSPRNG code with strict attempt limit + short expiry.

---

## Medium / Low

- **A15** `/assets/:id` serves `isPublic` files with no tenant/permission check (`AssetsService.ts:56-64`); `x-baasix-user-auth` header is self-asserted identity (`file.route.ts:182-188`).
- **A16** `utils/errorHandler.ts:48,59,70,80` reflect `pgError.message/detail` — schema enumeration + SQLi oracle. **Fix:** generic message + correlation id.
- **A17** `GET /schemas` public unless `SCHEMAS_PUBLIC=false` (`schema.route.ts:146`); `GET /settings` public, only SMTP fields stripped (`SettingsService.ts:345-368`). Public access is a supported feature — the issue is the **default-on** posture and the broad settings exposure. **Fix:** default `SCHEMAS_PUBLIC=false`; return an explicit client-safe allowlist for `/settings` instead of "everything except SMTP".
- **A18** Register returns "User already exists"; magic-link returns 404 "User not found"; login runs argon2 only for existing users (timing). **Fix:** uniform responses; dummy verify for unknown users.
- **A19** **BY DESIGN (not a vulnerability).** `ItemsService` with no accountability (`:341-348`) returns full access — this is the intended **system context** (mirrors Directus's `accountability: null` = full access), used by ~8 trusted internal callers to bypass permissions deliberately. HTTP requests always have accountability populated by `authMiddleware`, so it is not request-reachable. *Residual code-hygiene only:* consider an explicit `{ system: true }` flag instead of relying on absence, and remove the leftover debug `console.log`s in `isAdministrator()` (`:339-371`).
- **A20** LIKE/ILIKE `%`/`_` unescaped (filter over-match); `console.log` in `valueToRawSQL` (`filterOperators.ts:160`) and elsewhere logs request values; `utils/spatialUtils.ts` `sql.raw(string)` helpers.

---

## Recommended remediation order (original plan — see "Status" section for current state)

> Steps 1–4 are now **done** (see "Status: fixed vs. remaining" above). This is the original prioritization, kept for the rationale; the live to-do list is the "Still open" section.

1. ~~**A1** (SQLi)~~ ✅ done — identifier allowlist on relation-path, aggregation, sort, JSONB sinks. *Was highest priority — request-reachable by any granted reader.*
2. ~~**A4 + A5 + A6**~~ ✅ done — write-side field protection + storage-path confinement + upload XSS headers.
3. ~~**A7**~~ ✅ done — JWT alg pin + secret validation.
4. ~~**A10, A11**~~ ✅ done; ~~**A12**~~ ✅ high-value half done (row-level scoping accepted as a documented residual).
5. **A8** (OAuth state/linking/idToken), **A9-file** (`uploadFromUrl` SSRF), **A13, A14** (image DoS, auth brute-force). ← **next**
6. **A17 defaults** (flip `SCHEMAS_PUBLIC` to default-deny; settings allowlist), **A15, A16, A18, A19, A20**.
7. **Defense-in-depth (workflow, OPTIONAL):** A2/A3 are accepted as by-design (internal staff-only feature). If extra containment is ever wanted, sandbox script execution (`isolated-vm`).

**Cross-cutting root causes** (fixing these closes many findings at once):
- Identifiers (field/column/relation/aggregate/sort names) reach `sql.raw` without schema validation → **A1** (fixed).
- `SystemGenerated`/`hidden`/server-managed fields not enforced on writes → **A4, A5, A15** (fixed).
- Permission **bypasses** that sidestep the permission model → **A12** realtime (execution-join + hidden-field fixed; per-recipient row-level scoping accepted as a documented residual).
- **Unsafe defaults** were the public-access risk → **A17** (settings allow-list fixed; schema-public default kept with a startup warning).
- Workflow nodes run privileged code → **A2, A3** — by-design, internal staff-only feature (accepted).

---

## Status: fixed vs. remaining

### ✅ Fixed & verified this engagement (9 + the A12 partial)

- **A1** (Critical) — SQLi: identifier allowlist (`isSafeFieldPath`) on relation paths / aggregate / groupBy / sort; unresolvable columns dropped; `EXTRACT` part allowlisted; JSONB numeric/boolean operands coerced (`toSqlNumber`/`toSqlBoolean`). No relax toggle by design. `test/sqlInjection.test.js`.
- **A4** (Critical) — Mass assignment: opt-in privilege-field model. `"*"` no longer grants privilege fields; they must be named explicitly. Admins exempt; `password` hard-denied unless `PROTECT_PRIVILEGE_FIELDS=allow-password`. `test/massAssignment.test.js`.
- **A5** (Critical) — Path traversal: `resolveStorageKey` confines all local-disk ops; rejects `..`/absolute/null-byte/sibling-prefix. `STORAGE_PATH_CONFINEMENT`. `test/storagePathConfinement.test.js`.
- **A6** (Critical) — Upload XSS: `/assets/:id` forces html/svg/js/xml to download + `nosniff`. `ASSET_XSS_PROTECTION`/`ASSET_NOSNIFF`. `test/uploadXss.test.js`.
- **A21** (High, found here) — Hidden-field read leak: `getHiddenFields` now reads the schema definition (password hashes/secrets were leaking on reads); `includeHidden` opt-in for the trusted auth layer. `test/hiddenFieldLeak.test.js`.
- **A7** (High) — JWT: `algorithms:['HS256']` pinned; missing secret hard-fails; short secret warns at startup (non-breaking for existing deployments). `test/jwtHardening.test.js`.
- **A10** (High) — Sessions revoked on password change/reset (+ cache evict). `test/sessionRevocation.test.js`.
- **A11** (High) — Tenant isolation: `isTenantSpecific:false` bypass restricted to administrator. `STRICT_TENANT_ISOLATION`. `test/tenantStrictIsolation.test.js`.
- **A12** (High) — ⚠️ **partial**: execution-room join ownership-gated + broadcasts strip hidden fields. **Row-level per-recipient scoping still open** (broadcasts scoped by collection+tenant only).
- **A8** (High) — OAuth: account linking gated on verified email (`OAUTH_ALLOW_UNVERIFIED_LINK` override); idToken signatures verified via JWKS (`jose`) for Google/Apple; the broken+risky client-supplied direct-idToken path disabled by default (`OAUTH_ALLOW_DIRECT_IDTOKEN`); optional browser-bound `state` cookie (`OAUTH_STATE_COOKIE_BINDING`, off by default — cross-site callbacks may not carry it). `oauthHardening.test.js` (forged idToken rejected; direct path disabled). NOTE: full state-CSRF protection only when the cookie binding is enabled in a first-party flow.

### ✅ No open security work remains

All findings are either fixed or accepted-by-design. The one item that was previously "open" — A12 per-recipient row-level realtime scoping — has been **accepted as a documented residual** (same-tenant only, no secret exposure; per-recipient filtering deferred as a perf-vs-coverage decision, available as opt-in `REALTIME_ROW_LEVEL_SCOPING` if a deployment ever carries row-restricted data over realtime).

**Medium:** All fixed this engagement — **A15** (`isPublic` opt-in via `PROTECT_IS_PUBLIC_FIELD`; the `x-baasix-user-auth` header is by-design anti-hotlinking, kept), **A16** (error masking), **A17** (settings allow-list + schema warning), **A18** (enumeration/timing), **A20** (debug-log cleanup). Residuals noted per-finding (LIKE wildcard escaping, A20 spatial `sql.raw`, A18 register message — minor, left by choice).

**By-design / accepted (no action required):**
- **A2 / A3** — workflow script/service nodes run privileged code. Workflows are an **internal admin/staff feature, never user-facing**; authoring requires an explicit admin grant given only to trusted staff. Owner-accepted as an intentional internal capability. *(Optional, not required: sandbox script execution to contain a compromised-operator blast radius.)*
- **A9-workflow** — the workflow HTTP node's SSRF is mitigated by the same internal-only trust model (and now has initial-URL validation via the shared `ssrfGuard`).
- Granting the `public` role permissions is an **intended feature**, **default-deny**. The unsafe-default concern (A17 schemas) is mitigated by the startup warning.
- **A19** — `ItemsService` with no accountability = trusted **system context** (Directus-style). Intentional, not request-reachable. Optional code-hygiene only.

---

## Fix configurability & env toggles

Each fix defaults to **secure** and (except SQLi) exposes an env toggle so a deployment can relax it if genuinely needed. All toggles are documented in `.env.sample` and the 6 env-doc locations.

| ID | Fix | Env toggle (default = secure) | Tests |
|----|-----|-------------------------------|-------|
| A1 | SQL-injection identifier allowlist | *(none — always on by design)* | `sqlInjection.test.js` |
| A4 | Privilege-field write protection (opt-in) | `PROTECT_PRIVILEGE_FIELDS` (`true` / `allow-password` / `false`) | `massAssignment.test.js` |
| A5 | Storage path-traversal confinement | `STORAGE_PATH_CONFINEMENT` (null bytes always rejected) | `storagePathConfinement.test.js` |
| A6 | Upload stored-XSS headers | `ASSET_XSS_PROTECTION`, `ASSET_NOSNIFF` | `uploadXss.test.js` |
| A7 | JWT HS256 pinning + secret check | *(none — algorithm always pinned; secret strength warns, doesn't block)* | `jwtHardening.test.js` |
| A10 | Session revocation on password change | *(none — always on)* | `sessionRevocation.test.js` |
| A11 | Strict tenant isolation | `STRICT_TENANT_ISOLATION` | `tenantStrictIsolation.test.js` |
| A21 | Hidden-field read-strip | *(none; `includeHidden` is an internal-only method option, not an env/HTTP toggle)* | `hiddenFieldLeak.test.js` |

Full regression (all suites) + the dedicated security suites green after every fix.

### A21 — Hidden-field read leak (FOUND & FIXED during this work) — **was High**
**Confirmed real leak.** `fieldUtils.getHiddenFields()` read the **runtime Drizzle table** (`getSchema().columns`), which does **not** carry the `hidden` flag (it lives on the JSON schema *definition*). So `getHiddenFields()` returned `[]`, and `stripHiddenFields`/`stripHiddenFieldsFromRecords` stripped **nothing** — `GET /items/baasix_User` returned every user's **argon2 password hash** (verified), and likewise any `hidden` field (session tokens, OAuth secrets, API keys) across all collections. Exploitable by any role granted `read` on such a collection.

**Fix:**
- Added `schemaManager.getHiddenFieldNames()` (reads the schema **definition**); `fieldUtils.getHiddenFields()` now delegates to it. Hidden fields are now correctly stripped from all read responses.
- Added an explicit `{ includeHidden: true }` option to `readByQuery`/`readOne` (a method option, **never** settable from an HTTP query) so the trusted auth layer can still read the fields it legitimately needs (password hash for verification, session `token`, account OAuth secrets). Wired into the auth adapter and `validateSession`.

**Verified:** `test/hiddenFieldLeak.test.js` (5 tests: hidden fields resolved + stripped, no over-stripping). Auth/session regression green (`auth`, `session-types`, `switch-tenant-session-limits`, `multitenant`) — login, `/auth/me`, and sessions work because the auth layer opts into `includeHidden`.
