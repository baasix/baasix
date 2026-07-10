import { test, expect, describe, beforeAll } from "@jest/globals";
import request from "supertest";
import {
    PAGE_BUNDLE_VERSION,
    buildPageBundle,
    collectRequires,
    validateBundleShape,
    suggestSlug,
    remapTargets,
    analyzeImport,
    resolveRoleIds,
    resolveThemeId,
} from "../baasix/services/PageBundleService.js";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";

const page = (over = {}) => ({
    id: "p1", name: "Tasks", slug: "tasks", icon: "list", description: null,
    parent_Id: null, sort: 0, isPublic: false, enabled: true,
    options: { menuGroup: false }, roles: null,
    tenant_Id: "t1", createdAt: "x", updatedAt: "x",
    userCreated_Id: "u1", userUpdated_Id: "u1",
    ...over,
});
const block = (over = {}) => ({
    id: "b1", page_Id: "p1", type: "table", collection: "DemoTask",
    position: { row: 0, col: 0, span: 12 },
    config: { columns: [{ field: "title" }] }, configVersion: 1,
    tenant_Id: "t1", createdAt: "x", updatedAt: "x",
    ...over,
});

describe("buildPageBundle", () => {
    test("strips tenant/usertrack/timestamps but keeps ids", () => {
        const bundle = buildPageBundle([page()], [block()], {
            baasixVersion: "1.0.0", exportedAt: "2026-06-12T00:00:00Z",
            roleNames: {},
        });
        expect(bundle.bundleVersion).toBe(PAGE_BUNDLE_VERSION);
        expect(bundle.pages[0].id).toBe("p1");
        expect(bundle.pages[0].tenant_Id).toBeUndefined();
        expect(bundle.pages[0].createdAt).toBeUndefined();
        expect(bundle.pages[0].userCreated_Id).toBeUndefined();
        expect(bundle.blocks[0].id).toBe("b1");
        expect(bundle.blocks[0].page_Id).toBe("p1");
        expect(bundle.blocks[0].tenant_Id).toBeUndefined();
        expect(bundle.requires.collections.DemoTask).toContain("title");
    });

    test("includes only roleNames for ids referenced by roles/homeFor", () => {
        const bundle = buildPageBundle(
            [page({ roles: ["r1"], options: { homeFor: ["r2"] } })],
            [],
            { baasixVersion: "1.0.0", exportedAt: "x",
              roleNames: { r1: "user", r2: "manager", r3: "unused" } }
        );
        expect(bundle.roleNames).toEqual({ r1: "user", r2: "manager" });
    });

    test("bundles without any options.theme.themeId round-trip byte-identically (no themes/themeNames noise)", () => {
        const bundle = buildPageBundle([page()], [block()], {
            baasixVersion: "1.0.0", exportedAt: "2026-06-12T00:00:00Z", roleNames: {},
        });
        const bundleWithMeta = buildPageBundle([page()], [block()], {
            baasixVersion: "1.0.0", exportedAt: "2026-06-12T00:00:00Z", roleNames: {},
            themesById: { "th-unused": { name: "Unused", tokens: {}, isDefault: false } },
        });
        expect(bundle).toEqual(bundleWithMeta);
        expect(bundle.themes).toEqual([]);
        expect(bundle.themeNames).toEqual({});
        expect(bundle.pages[0].options).toEqual({ menuGroup: false });
    });

    test("embeds the theme referenced by options.theme.themeId, deduped by id, options left untouched", () => {
        const themesById = {
            "th1": { name: "Ocean", tokens: { light: { primary: "199 89% 48%" } }, isDefault: true },
            "th2": { name: "Forest", tokens: { light: { primary: "120 40% 40%" } }, isDefault: false },
        };
        const p1 = page({ id: "p1", slug: "tasks", options: { theme: { themeId: "th1" } } });
        const p2 = page({ id: "p2", slug: "tasks2", options: { theme: { themeId: "th1", overrides: { dark: { accent: "160 60% 45%" } } } } });
        const p3 = page({ id: "p3", slug: "tasks3", options: { theme: { themeId: "th2" } } });
        const bundle = buildPageBundle([p1, p2, p3], [], {
            baasixVersion: "1.0.0", exportedAt: "x", roleNames: {}, themesById,
        });
        expect(bundle.themes).toEqual([
            { name: "Ocean", tokens: { light: { primary: "199 89% 48%" } }, isDefault: true },
            { name: "Forest", tokens: { light: { primary: "120 40% 40%" } }, isDefault: false },
        ]);
        expect(bundle.themeNames).toEqual({ th1: "Ocean", th2: "Forest" });
        // Page options are untouched — themeId still points at the original bundle id, overrides preserved.
        expect(bundle.pages[0].options).toEqual({ theme: { themeId: "th1" } });
        expect(bundle.pages[1].options).toEqual({ theme: { themeId: "th1", overrides: { dark: { accent: "160 60% 45%" } } } });
    });

    test("ignores a themeId that doesn't resolve to a known theme (not embedded, not an error)", () => {
        const p1 = page({ options: { theme: { themeId: "ghost" } } });
        const bundle = buildPageBundle([p1], [], {
            baasixVersion: "1.0.0", exportedAt: "x", roleNames: {}, themesById: {},
        });
        expect(bundle.themes).toEqual([]);
        expect(bundle.themeNames).toEqual({});
        expect(bundle.pages[0].options).toEqual({ theme: { themeId: "ghost" } });
    });
});

describe("collectRequires", () => {
    test("collects fields from table columns, filter keys and sheetTitle", () => {
        const req = collectRequires([block({
            config: {
                columns: [{ field: "title" }, { field: "_x", label: "C", compute: "row.a" }],
                filter: { status: { eq: "open" }, and: [{ dueAt: { gt: "$NOW" } }] },
                sheetTitle: { fields: ["title", "status"] },
            },
        })]);
        expect(req.collections.DemoTask.sort()).toEqual(["dueAt", "status", "title"]);
    });

    test("collects scalar *Field keys, groupBy, aggregate fields and action collections", () => {
        const req = collectRequires([
            block({ type: "kanban", collection: "DemoTask",
                config: { groupByField: "status", cardTitleField: "title",
                    cardAction: { type: "view", collection: "DemoNote", idField: "note_Id" } } }),
            block({ id: "b2", type: "chart", collection: "DemoPlace",
                config: { aggregate: { total: { function: "count", field: "id" } },
                    groupBy: ["country"], timeField: "createdAt" } }),
        ]);
        expect(req.collections.DemoTask.sort()).toEqual(["note_Id", "status", "title"]);
        expect(req.collections.DemoPlace.sort()).toEqual(["country", "createdAt", "id"]);
        expect(req.collections.DemoNote).toEqual([]);
    });

    test("dotted field paths record only the first segment; collectionless blocks skipped", () => {
        const req = collectRequires([
            block({ type: "code", collection: "DemoTask", config: { recordField: "assignee.name" } }),
            block({ id: "b2", type: "markdown", collection: null, config: { content: "hi" } }),
        ]);
        expect(req.collections.DemoTask).toEqual(["assignee"]);
        expect(Object.keys(req.collections)).toEqual(["DemoTask"]);
    });
    test("wildcard '*' field references are not recorded as requirements", () => {
        const req = collectRequires([{
            id: "b1", page_Id: "p1", type: "table", collection: "C",
            config: { columns: [{ field: "*" }], filter: { "*": { eq: 1 }, title: { eq: "x" } },
                sheetTitle: { fields: ["*", "name"] } },
        }]);
        expect(req.collections.C.sort()).toEqual(["name", "title"]);
    });

    test("deeply nested filters don't blow the stack", () => {
        let filter = { status: { eq: "x" } };
        for (let i = 0; i < 5000; i += 1) filter = { and: [filter] };
        expect(() => collectRequires([{
            id: "b1", page_Id: "p1", type: "table", collection: "C",
            config: { filter },
        }])).not.toThrow();
    });
});

describe("validateBundleShape", () => {
    test("accepts a minimal valid bundle", () => {
        expect(validateBundleShape({
            bundleVersion: 1, pages: [{ id: "p", name: "n", slug: "s" }], blocks: [],
        })).toEqual([]);
    });
    test("rejects wrong version, missing arrays, pages without slug", () => {
        expect(validateBundleShape({ bundleVersion: 99, pages: [], blocks: [] })).not.toEqual([]);
        expect(validateBundleShape({ bundleVersion: 1, pages: "x", blocks: [] })).not.toEqual([]);
        expect(validateBundleShape({ bundleVersion: 1, pages: [{ id: "p" }], blocks: [] })).not.toEqual([]);
        expect(validateBundleShape(null)).not.toEqual([]);
    });
    test("rejects blocks referencing pages not in the bundle", () => {
        const errors = validateBundleShape({
            bundleVersion: 1,
            pages: [{ id: "p1", name: "n", slug: "s" }],
            blocks: [{ id: "b1", page_Id: "ghost", type: "table" }],
        });
        expect(errors.join(" ")).toMatch(/ghost/);
    });
    test("rejects duplicate page ids", () => {
        expect(validateBundleShape({
            bundleVersion: 1,
            pages: [{ id: "p", name: "a", slug: "a" }, { id: "p", name: "b", slug: "b" }],
            blocks: [],
        })).not.toEqual([]);
    });
    test("rejects malformed requires shapes", () => {
        const base = { bundleVersion: 1, pages: [{ id: "p", name: "n", slug: "s" }], blocks: [] };
        expect(validateBundleShape({ ...base, requires: { collections: ["DemoTask"] } })).not.toEqual([]);
        expect(validateBundleShape({ ...base, requires: { collections: { A: "title" } } })).not.toEqual([]);
        expect(validateBundleShape({ ...base, requires: "junk" })).not.toEqual([]);
        expect(validateBundleShape({ ...base, requires: { collections: { A: ["title"] } } })).toEqual([]);
    });
});

describe("suggestSlug", () => {
    test("appends -2, -3… skipping taken slugs", () => {
        expect(suggestSlug("tasks", new Set(["tasks"]))).toBe("tasks-2");
        expect(suggestSlug("tasks", new Set(["tasks", "tasks-2"]))).toBe("tasks-3");
        expect(suggestSlug("fresh", new Set([]))).toBe("fresh");
    });
});

describe("remapTargets", () => {
    test("remaps known ids, drops unknown, leaves 'all' untouched", () => {
        const map = new Map([["old1", "new1"]]);
        expect(remapTargets({ targets: ["old1", "gone"] }, map)).toEqual({ targets: ["new1"] });
        expect(remapTargets({ targets: "all" }, map)).toBeNull();
        expect(remapTargets({ columns: [] }, map)).toBeNull();
    });
    test("returns null when nothing changed", () => {
        expect(remapTargets({ targets: ["new1"] }, new Map([["new1", "new1"]]))).toBeNull();
    });
});

describe("resolveRoleIds", () => {
    const ctx = {
        roleIdExists: (id) => id === "r-local",
        roleIdByName: (name) => (name === "user" ? "r-user-local" : undefined),
    };
    test("keeps ids that exist locally", () => {
        expect(resolveRoleIds(["r-local"], {}, ctx)).toEqual({ resolved: ["r-local"], unknown: [] });
    });
    test("re-resolves foreign ids by name via roleNames", () => {
        expect(resolveRoleIds(["r-foreign"], { "r-foreign": "user" }, ctx))
            .toEqual({ resolved: ["r-user-local"], unknown: [] });
    });
    test("drops and reports unresolvable ids (by name when known)", () => {
        expect(resolveRoleIds(["r-gone"], { "r-gone": "ops" }, ctx))
            .toEqual({ resolved: [], unknown: ["ops"] });
        expect(resolveRoleIds(["r-mystery"], {}, ctx))
            .toEqual({ resolved: [], unknown: ["r-mystery"] });
    });
});

describe("resolveThemeId", () => {
    const ctx = {
        themeIdExists: (id) => id === "th-local",
        themeIdByName: (name) => (name === "Ocean" ? "th-ocean-local" : undefined),
    };
    test("keeps an id that already exists locally", () => {
        expect(resolveThemeId("th-local", {}, ctx)).toEqual({ resolved: "th-local", name: null });
    });
    test("re-resolves a foreign id by name via themeNames", () => {
        expect(resolveThemeId("th-foreign", { "th-foreign": "Ocean" }, ctx))
            .toEqual({ resolved: "th-ocean-local", name: "Ocean" });
    });
    test("reports an unresolvable id (by name when known) so the caller can create it", () => {
        expect(resolveThemeId("th-gone", { "th-gone": "Forest" }, ctx))
            .toEqual({ resolved: null, name: "Forest" });
        expect(resolveThemeId("th-mystery", {}, ctx)).toEqual({ resolved: null, name: null });
    });
    test("null/undefined themeId resolves to null with no name", () => {
        expect(resolveThemeId(null, {}, ctx)).toEqual({ resolved: null, name: null });
        expect(resolveThemeId(undefined, {}, ctx)).toEqual({ resolved: null, name: null });
    });
});

describe("analyzeImport", () => {
    const baseBundle = () => ({
        bundleVersion: 1, baasixVersion: "1", exportedAt: "x",
        pages: [
            { id: "p1", name: "Tasks", slug: "tasks", parent_Id: null, roles: null, options: {} },
            { id: "p2", name: "Child", slug: "child", parent_Id: "p1", roles: ["r-gone"], options: {} },
            { id: "p3", name: "Orphan", slug: "orphan", parent_Id: "p-not-in-bundle", roles: null, options: {} },
        ],
        blocks: [
            { id: "b1", page_Id: "p1", type: "table", collection: "DemoTask",
              config: { columns: [{ field: "title" }] }, position: { row: 0, col: 0, span: 12 } },
            { id: "b2", page_Id: "p1", type: "table", collection: "MissingCol", config: {} },
        ],
        roleNames: { "r-gone": "ops" },
        requires: { collections: { DemoTask: ["title", "nope"], MissingCol: ["x"] } },
    });
    const ctx = {
        existingPagesBySlug: new Map([["tasks", { id: "x1", name: "Tasks (existing)" }]]),
        getFields: (collection) => (collection === "DemoTask" ? { title: {}, status: {} } : null),
        roleIdExists: () => false,
        roleIdByName: () => undefined,
        validateBlock: (data) => {
            if (data.collection === "MissingCol") throw new Error(`Unknown collection "MissingCol" for block`);
        },
    };

    test("flags slug conflicts with suggestion; new pages pass", () => {
        const report = analyzeImport(baseBundle(), ctx);
        const tasks = report.pages.find((p) => p.slug === "tasks");
        expect(tasks.status).toBe("conflict");
        expect(tasks.existingPage).toEqual({ id: "x1", name: "Tasks (existing)" });
        expect(tasks.suggestedSlug).toBe("tasks-2");
        expect(report.pages.find((p) => p.slug === "child").status).toBe("new");
    });

    test("reports missing collections and missing fields from requires", () => {
        const report = analyzeImport(baseBundle(), ctx);
        expect(report.collections.MissingCol).toEqual({ exists: false, missingFields: [] });
        expect(report.collections.DemoTask).toEqual({ exists: true, missingFields: ["nope"] });
    });

    test("collects per-block validation errors and unknown roles and unresolved parents", () => {
        const report = analyzeImport(baseBundle(), ctx);
        expect(report.blockIssues).toEqual([
            { blockId: "b2", pageSlug: "tasks", type: "table", collection: "MissingCol",
              error: `Unknown collection "MissingCol" for block` },
        ]);
        expect(report.pages.find((p) => p.slug === "child").unknownRoles).toEqual(["ops"]);
        expect(report.pages.find((p) => p.slug === "orphan").unresolvedParent).toBe(true);
        expect(report.pages.find((p) => p.slug === "child").unresolvedParent).toBe(false);
    });
    test("new pages get suggestedSlug null; null parent is not unresolved", () => {
        const report = analyzeImport(baseBundle(), ctx);
        const child = report.pages.find((p) => p.slug === "child");
        expect(child.suggestedSlug).toBeNull();
        expect(report.pages.find((p) => p.slug === "tasks").unresolvedParent).toBe(false);
    });
    test("blockCount uses a precomputed map (multi-block pages counted right)", () => {
        const b = baseBundle();
        b.blocks.push({ id: "b3", page_Id: "p2", type: "markdown", collection: null, config: { content: "x" } });
        const report = analyzeImport(b, ctx);
        expect(report.pages.find((p) => p.slug === "tasks").blockCount).toBe(2);
        expect(report.pages.find((p) => p.slug === "child").blockCount).toBe(1);
        expect(report.pages.find((p) => p.slug === "orphan").blockCount).toBe(0);
    });

    test("bundle without themeNames/theme ctx accessors reports themes: {} (regression: no crash on old ctx shape)", () => {
        const report = analyzeImport(baseBundle(), ctx);
        expect(report.themes).toEqual({});
    });

    test("themes report: existing (by id or name) vs to-be-created", () => {
        const b = baseBundle();
        b.themeNames = { "th-local": "Brand", "th-foreign": "Ocean", "th-gone": "Forest" };
        const themeCtx = {
            ...ctx,
            themeIdExists: (id) => id === "th-local",
            themeIdByName: (name) => (name === "Ocean" ? "th-ocean-local" : undefined),
        };
        const report = analyzeImport(b, themeCtx);
        expect(report.themes).toEqual({
            Brand: { exists: true },
            Ocean: { exists: true },
            Forest: { exists: false },
        });
    });
});

describe("page bundle theme embedding (GET /pages/export, POST /pages/import)", () => {
    let app; let adminToken;
    const auth = (r) => r.set("Authorization", `Bearer ${adminToken}`);

    beforeAll(async () => {
        await destroyAllTablesInDB();
        app = await startServerForTesting();
        const login = await request(app).post("/auth/login").send({ email: "admin@baasix.com", password: "admin@123" });
        adminToken = login.body.token;
    });

    test("export embeds the referenced theme with options untouched", async () => {
        const theme = await auth(request(app).post("/items/baasix_Theme"))
            .send({ name: "Sunset", tokens: { light: { primary: "20 90% 55%" } } });
        expect(theme.status).toBe(201);
        const themeId = theme.body.data?.id ?? theme.body.id;

        const page = await auth(request(app).post("/items/baasix_Page"))
            .send({ name: "Themed", slug: "themed-page", options: { theme: { themeId } } });
        expect(page.status).toBe(201);

        const exportRes = await auth(request(app).get("/pages/export")).query({ pages: "all" });
        expect(exportRes.status).toBe(200);
        const bundle = JSON.parse(exportRes.text);
        expect(bundle.themes).toContainEqual({ name: "Sunset", tokens: { light: { primary: "20 90% 55%" } }, isDefault: false });
        expect(bundle.themeNames[String(themeId)]).toBe("Sunset");
        const exportedPage = bundle.pages.find((p) => p.slug === "themed-page");
        expect(exportedPage.options).toEqual({ theme: { themeId: String(themeId) } });
    });

    test("import creates an unresolvable bundle theme (find-or-create) and remaps the imported page's themeId", async () => {
        // Simulates importing a bundle exported from a *different* instance: the bundle
        // theme id doesn't exist locally and no local theme shares its name yet, so the
        // import must create the theme and remap the page to the new local id.
        const bundle = {
            bundleVersion: PAGE_BUNDLE_VERSION, baasixVersion: "1", exportedAt: "x",
            pages: [{ id: "px", name: "Foreign Themed", slug: "foreign-themed-page", icon: null, description: null,
                      parent_Id: null, sort: 0, isPublic: false, enabled: true, roles: null,
                      options: { theme: { themeId: "22222222-2222-2222-2222-222222222222" } } }],
            blocks: [],
            roleNames: {},
            themes: [{ name: "Foreign Theme", tokens: { light: { primary: "260 60% 50%" } }, isDefault: false }],
            themeNames: { "22222222-2222-2222-2222-222222222222": "Foreign Theme" },
            requires: { collections: {} },
        };

        const before = await auth(request(app).get("/pages/themes"));
        expect(before.body.themes.some((t) => t.name === "Foreign Theme")).toBe(false);

        const importRes = await auth(request(app).post("/pages/import")).send({ bundle });
        expect(importRes.status).toBe(200);
        const created = importRes.body.results.find((r) => r.action === "created" && r.slug === "foreign-themed-page");
        expect(created).toBeTruthy();

        const after = await auth(request(app).get("/pages/themes"));
        const foreignThemes = after.body.themes.filter((t) => t.name === "Foreign Theme");
        expect(foreignThemes).toHaveLength(1);
        expect(foreignThemes[0].id).not.toBe("22222222-2222-2222-2222-222222222222"); // genuinely new row

        const importedPage = await auth(request(app).get(`/items/baasix_Page/${created.id}`));
        expect(importedPage.body.data.options.theme.themeId).toBe(foreignThemes[0].id);
    });

    test("importing the same bundle again matches the theme by name instead of duplicating it", async () => {
        const theme = await auth(request(app).post("/items/baasix_Theme"))
            .send({ name: "Sunset2", tokens: { light: { primary: "20 90% 55%" } } });
        const themeId = theme.body.data?.id ?? theme.body.id;
        const bundle = {
            bundleVersion: PAGE_BUNDLE_VERSION, baasixVersion: "1", exportedAt: "x",
            pages: [{ id: "px", name: "Second", slug: "second-themed-page", icon: null, description: null,
                      parent_Id: null, sort: 0, isPublic: false, enabled: true, roles: null,
                      options: { theme: { themeId: String(themeId) } } }],
            blocks: [],
            roleNames: {},
            themes: [{ name: "Sunset2", tokens: { light: { primary: "20 90% 55%" } }, isDefault: false }],
            themeNames: { [String(themeId)]: "Sunset2" },
            requires: { collections: {} },
        };

        const before = await auth(request(app).get("/pages/themes"));
        const sunsetCountBefore = before.body.themes.filter((t) => t.name === "Sunset2").length;
        expect(sunsetCountBefore).toBe(1);

        const importRes = await auth(request(app).post("/pages/import")).send({ bundle });
        expect(importRes.status).toBe(200);
        const created = importRes.body.results.find((r) => r.action === "created" && r.slug === "second-themed-page");
        expect(created).toBeTruthy();

        const after = await auth(request(app).get("/pages/themes"));
        const sunsetThemes = after.body.themes.filter((t) => t.name === "Sunset2");
        expect(sunsetThemes).toHaveLength(1); // matched by name, not duplicated
        expect(sunsetThemes[0].id).toBe(String(themeId)); // reused the existing row

        const importedPage = await auth(request(app).get(`/items/baasix_Page/${created.id}`));
        expect(importedPage.body.data.options.theme.themeId).toBe(sunsetThemes[0].id);
    });

    test("dryRun import reports the theme's create-vs-exists status without writing", async () => {
        const bundle = {
            bundleVersion: PAGE_BUNDLE_VERSION, baasixVersion: "1", exportedAt: "x",
            pages: [{ id: "py", name: "DryRun", slug: "dry-run-themed-page", icon: null, description: null,
                      parent_Id: null, sort: 0, isPublic: false, enabled: true, roles: null,
                      options: { theme: { themeId: "11111111-1111-1111-1111-111111111111" } } }],
            blocks: [],
            roleNames: {},
            themes: [{ name: "GhostTheme", tokens: {}, isDefault: false }],
            themeNames: { "11111111-1111-1111-1111-111111111111": "GhostTheme" },
            requires: { collections: {} },
        };
        const before = await auth(request(app).get("/pages/themes"));
        const dryRunRes = await auth(request(app).post("/pages/import")).query({ dryRun: "true" }).send({ bundle });
        expect(dryRunRes.status).toBe(200);
        expect(dryRunRes.body.report.themes).toEqual({ GhostTheme: { exists: false } });

        const after = await auth(request(app).get("/pages/themes"));
        expect(after.body.themes.length).toBe(before.body.themes.length); // dryRun wrote nothing
    });

    test("a bundle without any themes round-trips with no theme side effects", async () => {
        const page = await auth(request(app).post("/items/baasix_Page")).send({ name: "Plain", slug: "plain-page" });
        expect(page.status).toBe(201);

        const exportRes = await auth(request(app).get("/pages/export")).query({ pages: page.body.data.id });
        expect(exportRes.status).toBe(200);
        const bundle = JSON.parse(exportRes.text);
        expect(bundle.themes).toEqual([]);
        expect(bundle.themeNames).toEqual({});

        const before = await auth(request(app).get("/pages/themes"));
        const importRes = await auth(request(app).post("/pages/import"))
            .send({ bundle, resolutions: { "plain-page": { rename: "plain-page-2" } } });
        expect(importRes.status).toBe(200);
        const after = await auth(request(app).get("/pages/themes"));
        expect(after.body.themes.length).toBe(before.body.themes.length);
    });
});
