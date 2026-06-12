import { test, expect, describe } from "@jest/globals";
import {
    PAGE_BUNDLE_VERSION,
    buildPageBundle,
    collectRequires,
    validateBundleShape,
    suggestSlug,
    remapTargets,
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
