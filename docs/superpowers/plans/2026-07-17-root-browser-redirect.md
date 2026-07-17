# Root Browser Redirect to Admin App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Browsers opening the server root (`GET /`) get a 302 redirect to the bundled admin app at `/admin`; JSON clients keep getting the project-info payload.

**Architecture:** Pure content negotiation inside the existing `GET /` handler in the settings route — `req.accepts(["json", "html"])` returns `"html"` only when the client's Accept header quality-prefers HTML (i.e. a browser). No env var, no settings field, no new files besides the test.

**Tech Stack:** Express 4 (`req.accepts`, `res.redirect`), Jest + supertest (existing core test harness).

**Spec:** `docs/superpowers/specs/2026-07-17-root-browser-redirect-design.md`

## Global Constraints

- Redirect target is the relative path `/admin` with status `302` — never an absolute URL.
- `POST /` behavior must not change.
- The JSON project-info response for `GET /` (including the `project.auth` discovery block) must be byte-identical to today for non-HTML clients.
- Never run two jest invocations at once against this package — tests share one database (known collision issue).
- All paths below are relative to `packages/core/` in the baasix repo (`/home/vivek/Documents/NodeJS/baasix/baasix-drizzle/baasix`).

---

### Task 1: Content-negotiated redirect on GET /

**Files:**
- Modify: `baasix/routes/settings.route.ts:8-16` (the `app.get("/")` handler)
- Test: `test/rootRedirect.test.js` (create)

**Interfaces:**
- Consumes: `startServerForTesting` / `destroyAllTablesInDB` from `../baasix` (existing test harness exports, same as every other route test).
- Produces: nothing consumed by later tasks (single-task plan).

- [ ] **Step 1: Write the failing test**

Create `test/rootRedirect.test.js`:

```js
import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

let app;
beforeAll(async () => {
    app = await startServerForTesting();
}, 60000);
afterAll(async () => { await destroyAllTablesInDB(); });

// Real Chrome navigation Accept header — html q=1, json only via */*;q=0.8
const BROWSER_ACCEPT =
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

describe("GET / content negotiation", () => {
    test("browser visit (Accept prefers html) redirects to /admin", async () => {
        const res = await request(app).get("/").set("Accept", BROWSER_ACCEPT);
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe("/admin");
    });

    test("JSON client still gets project info", async () => {
        const res = await request(app).get("/").set("Accept", "application/json");
        expect(res.status).toBe(200);
        expect(res.body.project).toBeDefined();
    });

    test("wildcard Accept (curl default) still gets project info", async () => {
        const res = await request(app).get("/").set("Accept", "*/*");
        expect(res.status).toBe(200);
        expect(res.body.project).toBeDefined();
    });

    test("POST / is unaffected by browser Accept header", async () => {
        const res = await request(app).post("/").set("Accept", BROWSER_ACCEPT);
        expect(res.status).toBe(200);
        expect(res.body.project).toBeDefined();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/core/`):
```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest test/rootRedirect.test.js --detectOpenHandles --forceExit --verbose
```
Expected: FAIL — first test gets `200` (JSON served) instead of `302`; the other three tests PASS (they describe current behavior).

- [ ] **Step 3: Implement the redirect**

In `baasix/routes/settings.route.ts`, change the `GET /` handler (lines 8–16) to:

```ts
  // Get project information (public). Browsers (Accept prefers text/html)
  // are redirected to the bundled admin app; API clients get JSON.
  app.get("/", async (req, res, next) => {
    try {
      if (req.accepts(["json", "html"]) === "html") {
        return res.redirect(302, "/admin");
      }
      const tenantId = req.query.tenant_id as string;
      const projectInfo = await settingsService.getProjectInfo(tenantId);
      res.json(projectInfo);
    } catch (error) {
      next(error);
    }
  });
```

Leave `POST /` and everything else in the file untouched.

- [ ] **Step 4: Run test to verify it passes**

Run (from `packages/core/`):
```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest test/rootRedirect.test.js --detectOpenHandles --forceExit --verbose
```
Expected: PASS — all 4 tests.

- [ ] **Step 5: Confirm discovery tests still pass**

The auth-methods discovery payload rides on `GET /`; supertest sends no Accept
header by default, which resolves to `"json"`, so these must stay green.

Run (from `packages/core/`, after Step 4's run has fully exited — one jest at a time):
```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest test/authDiscovery.test.js --detectOpenHandles --forceExit --verbose
```
Expected: PASS — "project info includes the auth block".

- [ ] **Step 6: Commit**

```bash
git add baasix/routes/settings.route.ts test/rootRedirect.test.js
git commit -m "feat: redirect browser visits on GET / to the admin app

Content-negotiated: Accept preferring text/html gets 302 /admin; JSON
clients (SDK discovery, MCP, curl) keep the project-info payload.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Manual verification (after implementation)

With the dev server running on :8056:
- `curl -i http://localhost:8056/` → `200`, JSON body.
- `curl -i -H "Accept: text/html,application/xhtml+xml,*/*;q=0.8" http://localhost:8056/` → `302`, `Location: /admin`.
- Open `http://localhost:8056/` in a browser → lands on the admin app.
