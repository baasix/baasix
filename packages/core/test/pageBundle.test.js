import { test, expect, describe } from "@jest/globals";
import {
    PAGE_BUNDLE_VERSION,
    buildPageBundle,
    collectRequires,
    validateBundleShape,
    suggestSlug,
    remapTargets,
    analyzeImport,
    resolveRoleIds,
} from "../baasix/services/PageBundleService.js";

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
});
