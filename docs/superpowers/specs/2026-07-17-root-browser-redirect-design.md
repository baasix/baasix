# Root Browser Redirect to Admin App — Design

**Date:** 2026-07-17
**Status:** Approved

## Problem

Opening the server root (e.g. `http://localhost:8056/`) in a browser shows the raw
project-info JSON. Humans landing there almost always want the admin app, which the
same server already serves at `/admin`.

## Decision

Content-negotiate `GET /` — no env var, no settings field:

- Request prefers HTML (browser visit) → `302` redirect to `/admin` (relative, same origin).
- Otherwise → project-info JSON, exactly as today.

## Behavior

In the `GET /` handler in `packages/core/baasix/routes/settings.route.ts`, use
Express negotiation:

```ts
if (req.accepts(["json", "html"]) === "html") {
  return res.redirect(302, "/admin");
}
```

`req.accepts(["json", "html"])` resolves per quality values:

| Client | Accept header | Result |
|---|---|---|
| Browser | `text/html,application/xhtml+xml,...,*/*;q=0.8` | `html` → 302 `/admin` |
| SDK / MCP / fetch | `application/json` | `json` → project info |
| curl / health checks | `*/*` | `json` (listed first) → project info |

## Unchanged

- `POST /` keeps returning project-info JSON.
- SDK discovery payload (auth methods) on `GET /` for JSON clients.
- All other routes.

## Testing

Supertest cases on `GET /`:

1. Browser-style `Accept: text/html,...` → 302, `Location: /admin`.
2. `Accept: application/json` → 200, project-info JSON body.
3. `Accept: */*` → 200, project-info JSON body.

## Out of scope (follow-up feature)

Role-based restriction on admin-app login. Today no such setting exists: the
`baasix_Role` schema has no `admin_access`/`app_access` flag and any authenticated
user can log into `/admin`; feature access is gated only by per-collection
permissions. Restricting which roles may log into the admin app touches the Role
schema, login flow, and settings UI — a separate feature.
