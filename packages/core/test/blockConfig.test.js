import { test, expect, describe } from "@jest/globals";
import { validateBlockData, validatePageData, mergeBlockForUpdate } from "../baasix/services/BlockConfigService.js";

// Stub field maps — no DB, no schemaManager
const stubFields = (map) => (collection) => map;
const nullFields = () => null;
const userLikeFields = stubFields({ name: {}, title: {} });

describe("validateBlockData", () => {
    test("invalid type throws mentioning type", () => {
        expect(() => validateBlockData({ type: "bogus" }, userLikeFields)).toThrow(/type/);
    });

    test("table without collection throws mentioning collection", () => {
        expect(() => validateBlockData({ type: "table" }, userLikeFields)).toThrow(/collection/);
    });

    test("unknown collection (getFields returns null) throws mentioning collection", () => {
        expect(() =>
            validateBlockData({ type: "table", collection: "nope_Collection" }, nullFields)
        ).toThrow(/collection/);
    });

    test("table with unknown column field throws naming the bad field", () => {
        expect(() =>
            validateBlockData(
                { type: "table", collection: "posts", config: { columns: [{ field: "nope" }] } },
                userLikeFields
            )
        ).toThrow(/nope/);
    });

    test("valid table with columns and position does not throw", () => {
        expect(() =>
            validateBlockData(
                {
                    type: "table",
                    collection: "posts",
                    config: { columns: [{ field: "name" }] },
                    position: { row: 0, col: 0, span: 12 },
                },
                userLikeFields
            )
        ).not.toThrow();
    });

    test("position span 13 throws mentioning position", () => {
        expect(() =>
            validateBlockData(
                { type: "table", collection: "posts", position: { row: 0, col: 0, span: 13 } },
                userLikeFields
            )
        ).toThrow(/position/);
    });

    test("position col 12 throws mentioning position", () => {
        expect(() =>
            validateBlockData(
                { type: "table", collection: "posts", position: { row: 0, col: 12, span: 1 } },
                userLikeFields
            )
        ).toThrow(/position/);
    });

    test("form mode bogus throws mentioning mode", () => {
        expect(() =>
            validateBlockData(
                { type: "form", collection: "posts", config: { mode: "bogus" } },
                userLikeFields
            )
        ).toThrow(/mode/);
    });

    test("form mode create with valid fields does not throw", () => {
        expect(() =>
            validateBlockData(
                { type: "form", collection: "posts", config: { mode: "create", fields: [{ field: "name" }] } },
                userLikeFields
            )
        ).not.toThrow();
    });

    test("markdown without collection does not throw", () => {
        expect(() => validateBlockData({ type: "markdown" }, nullFields)).not.toThrow();
    });

    test("dotted field first segment is validated", () => {
        const map = stubFields({ author: {} });
        expect(() =>
            validateBlockData(
                { type: "table", collection: "posts", config: { columns: [{ field: "author.name" }] } },
                map
            )
        ).not.toThrow();
    });
});

describe("validateBlockData – phase 2 types", () => {
    const phase2Fields = stubFields({
        name: {},
        title: {},
        status: {},
        start: {},
        end: {},
        color: {},
        location: {},
        image: {},
        amount: {},
    });

    describe("kanban", () => {
        test("valid kanban config does not throw", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "kanban",
                        collection: "tasks",
                        config: {
                            groupByField: "status",
                            cardTitleField: "name",
                            cardFields: [{ field: "title" }],
                            allowDrag: true,
                        },
                    },
                    phase2Fields
                )
            ).not.toThrow();
        });

        test("kanban config missing groupByField throws mentioning groupByField", () => {
            expect(() =>
                validateBlockData(
                    { type: "kanban", collection: "tasks", config: { cardTitleField: "name" } },
                    phase2Fields
                )
            ).toThrow(/groupByField/);
        });

        test("kanban config missing cardTitleField throws mentioning cardTitleField", () => {
            expect(() =>
                validateBlockData(
                    { type: "kanban", collection: "tasks", config: { groupByField: "status" } },
                    phase2Fields
                )
            ).toThrow(/cardTitleField/);
        });

        test("kanban cardFields with unknown field throws naming the bad field", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "kanban",
                        collection: "tasks",
                        config: {
                            groupByField: "status",
                            cardTitleField: "name",
                            cardFields: [{ field: "nope" }],
                        },
                    },
                    phase2Fields
                )
            ).toThrow(/nope/);
        });

        test("kanban with no config at all does not throw (lenient; renderer is defensive)", () => {
            expect(() =>
                validateBlockData({ type: "kanban", collection: "tasks" }, phase2Fields)
            ).not.toThrow();
        });
    });

    describe("calendar", () => {
        test("valid calendar config does not throw", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "calendar",
                        collection: "events",
                        config: {
                            startField: "start",
                            endField: "end",
                            titleField: "title",
                            colorField: "color",
                            defaultView: "month",
                        },
                    },
                    phase2Fields
                )
            ).not.toThrow();
        });

        test("calendar config missing startField throws mentioning startField", () => {
            expect(() =>
                validateBlockData(
                    { type: "calendar", collection: "events", config: { titleField: "title" } },
                    phase2Fields
                )
            ).toThrow(/startField/);
        });

        test("calendar config missing titleField throws mentioning titleField", () => {
            expect(() =>
                validateBlockData(
                    { type: "calendar", collection: "events", config: { startField: "start" } },
                    phase2Fields
                )
            ).toThrow(/titleField/);
        });

        test("calendar unknown colorField throws naming the bad field", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "calendar",
                        collection: "events",
                        config: { startField: "start", titleField: "title", colorField: "nope" },
                    },
                    phase2Fields
                )
            ).toThrow(/nope/);
        });

        test("calendar invalid defaultView throws mentioning defaultView", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "calendar",
                        collection: "events",
                        config: { startField: "start", titleField: "title", defaultView: "year" },
                    },
                    phase2Fields
                )
            ).toThrow(/defaultView/);
        });
    });

    describe("chart", () => {
        test("valid chart config does not throw", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "chart",
                        collection: "tasks",
                        config: {
                            chartType: "bar",
                            aggregate: { count: { function: "count", field: "*" } },
                            groupBy: ["status"],
                        },
                    },
                    phase2Fields
                )
            ).not.toThrow();
        });

        test("chart invalid chartType throws mentioning chartType", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "chart",
                        collection: "tasks",
                        config: { chartType: "donut", aggregate: { c: { function: "count", field: "*" } } },
                    },
                    phase2Fields
                )
            ).toThrow(/chartType/);
        });

        test("chart missing aggregate throws mentioning aggregate", () => {
            expect(() =>
                validateBlockData(
                    { type: "chart", collection: "tasks", config: { chartType: "bar" } },
                    phase2Fields
                )
            ).toThrow(/aggregate/);
        });

        test("chart empty aggregate object throws mentioning aggregate", () => {
            expect(() =>
                validateBlockData(
                    { type: "chart", collection: "tasks", config: { chartType: "pie", aggregate: {} } },
                    phase2Fields
                )
            ).toThrow(/aggregate/);
        });

        test("chart aggregate with invalid function throws mentioning function", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "chart",
                        collection: "tasks",
                        config: {
                            chartType: "bar",
                            aggregate: { m: { function: "median", field: "amount" } },
                        },
                    },
                    phase2Fields
                )
            ).toThrow(/function/);
        });

        test("chart aggregate with unknown field throws naming the bad field", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "chart",
                        collection: "tasks",
                        config: {
                            chartType: "line",
                            aggregate: { s: { function: "sum", field: "nope" } },
                        },
                    },
                    phase2Fields
                )
            ).toThrow(/nope/);
        });

        test("chart groupBy with unknown field throws naming the bad field", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "chart",
                        collection: "tasks",
                        config: {
                            chartType: "bar",
                            aggregate: { count: { function: "count", field: "*" } },
                            groupBy: ["bogusField"],
                        },
                    },
                    phase2Fields
                )
            ).toThrow(/bogusField/);
        });
    });

    describe("cardlist", () => {
        test("valid cardlist config does not throw", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "cardlist",
                        collection: "posts",
                        config: {
                            titleField: "title",
                            subtitleField: "name",
                            imageField: "image",
                            fields: [{ field: "status" }],
                            columns: 3,
                        },
                    },
                    phase2Fields
                )
            ).not.toThrow();
        });

        test("cardlist config missing titleField throws mentioning titleField", () => {
            expect(() =>
                validateBlockData(
                    { type: "cardlist", collection: "posts", config: { columns: 2 } },
                    phase2Fields
                )
            ).toThrow(/titleField/);
        });

        test("cardlist columns 7 throws mentioning columns", () => {
            expect(() =>
                validateBlockData(
                    { type: "cardlist", collection: "posts", config: { titleField: "title", columns: 7 } },
                    phase2Fields
                )
            ).toThrow(/columns/);
        });

        test("cardlist non-integer columns throws mentioning columns", () => {
            expect(() =>
                validateBlockData(
                    { type: "cardlist", collection: "posts", config: { titleField: "title", columns: 2.5 } },
                    phase2Fields
                )
            ).toThrow(/columns/);
        });
    });

    describe("map", () => {
        test("valid map config does not throw", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "map",
                        collection: "places",
                        config: {
                            geometryField: "location",
                            titleField: "name",
                            popupFields: [{ field: "status" }],
                        },
                    },
                    phase2Fields
                )
            ).not.toThrow();
        });

        test("map config missing geometryField throws mentioning geometryField", () => {
            expect(() =>
                validateBlockData(
                    { type: "map", collection: "places", config: { titleField: "name" } },
                    phase2Fields
                )
            ).toThrow(/geometryField/);
        });

        test("map popupFields with unknown field throws naming the bad field", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "map",
                        collection: "places",
                        config: { geometryField: "location", popupFields: [{ field: "nope" }] },
                    },
                    phase2Fields
                )
            ).toThrow(/nope/);
        });
    });

    describe("markdown", () => {
        test("markdown with string content and no collection does not throw", () => {
            expect(() =>
                validateBlockData({ type: "markdown", config: { content: "# Hello" } }, nullFields)
            ).not.toThrow();
        });

        test("markdown with non-string content throws mentioning content", () => {
            expect(() =>
                validateBlockData({ type: "markdown", config: { content: 42 } }, nullFields)
            ).toThrow(/content/);
        });

        test("markdown with config but missing content throws mentioning content", () => {
            expect(() => validateBlockData({ type: "markdown", config: {} }, nullFields)).toThrow(
                /content/
            );
        });
    });

    describe("buttons", () => {
        test("valid buttons config does not throw (link + workflow items, extra keys pass through)", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "buttons",
                        config: {
                            items: [
                                {
                                    label: "Docs",
                                    action: { type: "link", url: "https://example.com" },
                                    icon: "book",
                                    newTab: true,
                                },
                                {
                                    label: "Run sync",
                                    action: { type: "workflow", workflowId: "wf-1" },
                                    confirm: "Are you sure?",
                                },
                            ],
                        },
                    },
                    nullFields
                )
            ).not.toThrow();
        });

        test("buttons without collection does not throw (collection exempt)", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "buttons",
                        config: { items: [{ label: "Go", action: { type: "link", url: "/x" } }] },
                    },
                    nullFields
                )
            ).not.toThrow();
        });

        test("buttons with no config at all does not throw (lenient)", () => {
            expect(() => validateBlockData({ type: "buttons" }, nullFields)).not.toThrow();
        });

        test("buttons config without items throws mentioning items", () => {
            expect(() => validateBlockData({ type: "buttons", config: {} }, nullFields)).toThrow(
                /items/
            );
        });

        test("buttons config with empty items array throws mentioning items", () => {
            expect(() =>
                validateBlockData({ type: "buttons", config: { items: [] } }, nullFields)
            ).toThrow(/items/);
        });

        test("buttons item with empty label throws mentioning label", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "buttons",
                        config: { items: [{ label: "", action: { type: "link", url: "/x" } }] },
                    },
                    nullFields
                )
            ).toThrow(/label/);
        });

        test("buttons item missing action throws mentioning action", () => {
            expect(() =>
                validateBlockData(
                    { type: "buttons", config: { items: [{ label: "Go" }] } },
                    nullFields
                )
            ).toThrow(/action/);
        });

        test("buttons item with unknown action type throws mentioning action", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "buttons",
                        config: { items: [{ label: "Go", action: { type: "magic" } }] },
                    },
                    nullFields
                )
            ).toThrow(/action/);
        });

        test("buttons link action without url throws mentioning url", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "buttons",
                        config: { items: [{ label: "Go", action: { type: "link" } }] },
                    },
                    nullFields
                )
            ).toThrow(/url/);
        });

        test("buttons workflow action without workflowId throws mentioning workflowId", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "buttons",
                        config: { items: [{ label: "Run", action: { type: "workflow" } }] },
                    },
                    nullFields
                )
            ).toThrow(/workflowId/);
        });

        test("buttons create action with collection does not throw", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "buttons",
                        config: {
                            items: [
                                { label: "New Task", action: { type: "create", collection: "DemoTask" } },
                            ],
                        },
                    },
                    nullFields
                )
            ).not.toThrow();
        });

        test("buttons create action without collection throws mentioning collection", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "buttons",
                        config: { items: [{ label: "New", action: { type: "create" } }] },
                    },
                    nullFields
                )
            ).toThrow(/collection/);
        });

        test("buttons create action with empty collection string throws mentioning collection", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "buttons",
                        config: { items: [{ label: "New", action: { type: "create", collection: "" } }] },
                    },
                    nullFields
                )
            ).toThrow(/collection/);
        });

        test("buttons page action with slug does not throw", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "buttons",
                        config: {
                            items: [
                                { label: "Go to Tasks", action: { type: "page", slug: "tasks" } },
                            ],
                        },
                    },
                    nullFields
                )
            ).not.toThrow();
        });

        test("buttons page action without slug throws mentioning slug", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "buttons",
                        config: { items: [{ label: "Go", action: { type: "page" } }] },
                    },
                    nullFields
                )
            ).toThrow(/slug/);
        });

        test("buttons page action with empty slug throws mentioning slug", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "buttons",
                        config: { items: [{ label: "Go", action: { type: "page", slug: "" } }] },
                    },
                    nullFields
                )
            ).toThrow(/slug/);
        });

        test("buttons view action with no extra keys does not throw (collection/idField optional)", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "buttons",
                        config: {
                            items: [
                                { label: "View", action: { type: "view" } },
                                {
                                    label: "Tenant",
                                    action: { type: "view", collection: "baasix_Tenant", idField: "tenant_Id" },
                                },
                            ],
                        },
                    },
                    nullFields
                )
            ).not.toThrow();
        });

        test("buttons view action with non-string collection/idField throws naming the bad key", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "buttons",
                        config: { items: [{ label: "View", action: { type: "view", collection: 42 } }] },
                    },
                    nullFields
                )
            ).toThrow(/collection/);
            expect(() =>
                validateBlockData(
                    {
                        type: "buttons",
                        config: { items: [{ label: "View", action: { type: "view", idField: 42 } }] },
                    },
                    nullFields
                )
            ).toThrow(/idField/);
        });

        test("buttons item with unknown action type error lists valid types (link, workflow, create, page)", () => {
            let caught;
            try {
                validateBlockData(
                    {
                        type: "buttons",
                        config: { items: [{ label: "Go", action: { type: "export-csv" } }] },
                    },
                    nullFields
                );
            } catch (e) {
                caught = e;
            }
            expect(caught).toBeDefined();
            expect(caught.message).toMatch(/link/);
            expect(caught.message).toMatch(/workflow/);
            expect(caught.message).toMatch(/create/);
            expect(caught.message).toMatch(/page/);
        });
    });

    describe("feed", () => {
        const feedFields = stubFields({ title: {}, content: {}, author: {}, createdAt: {}, updatedAt: {} });

        test("valid feed config with textField does not throw", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "feed",
                        collection: "DemoTask",
                        config: { textField: "title" },
                    },
                    feedFields
                )
            ).not.toThrow();
        });

        test("valid feed config with all optional fields does not throw", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "feed",
                        collection: "DemoTask",
                        config: {
                            textField: "title",
                            authorField: "author",
                            timestampField: "createdAt",
                            order: "desc",
                        },
                    },
                    feedFields
                )
            ).not.toThrow();
        });

        test("feed with order asc does not throw", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "feed",
                        collection: "DemoTask",
                        config: { textField: "title", order: "asc" },
                    },
                    feedFields
                )
            ).not.toThrow();
        });

        test("feed without collection throws mentioning collection", () => {
            expect(() =>
                validateBlockData({ type: "feed" }, feedFields)
            ).toThrow(/collection/);
        });

        test("feed with no config at all does not throw (lenient)", () => {
            expect(() =>
                validateBlockData({ type: "feed", collection: "DemoTask" }, feedFields)
            ).not.toThrow();
        });

        test("feed config missing textField throws mentioning textField", () => {
            expect(() =>
                validateBlockData(
                    { type: "feed", collection: "DemoTask", config: { order: "desc" } },
                    feedFields
                )
            ).toThrow(/textField/);
        });

        test("feed config unknown textField throws naming the bad field", () => {
            expect(() =>
                validateBlockData(
                    { type: "feed", collection: "DemoTask", config: { textField: "nope" } },
                    feedFields
                )
            ).toThrow(/nope/);
        });

        test("feed config unknown authorField throws naming the bad field", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "feed",
                        collection: "DemoTask",
                        config: { textField: "title", authorField: "nope" },
                    },
                    feedFields
                )
            ).toThrow(/nope/);
        });

        test("feed config unknown timestampField throws naming the bad field", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "feed",
                        collection: "DemoTask",
                        config: { textField: "title", timestampField: "nope" },
                    },
                    feedFields
                )
            ).toThrow(/nope/);
        });

        test("feed config with valid fileField does not throw", () => {
            const fieldsWithFile = stubFields({
                title: {},
                content: {},
                author: {},
                createdAt: {},
                file: {},
                file_Id: {},
            });
            expect(() =>
                validateBlockData(
                    {
                        type: "feed",
                        collection: "DemoTask",
                        config: { textField: "title", fileField: "file_Id" },
                    },
                    fieldsWithFile
                )
            ).not.toThrow();
        });

        test("feed config unknown fileField throws naming the bad field", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "feed",
                        collection: "DemoTask",
                        config: { textField: "title", fileField: "nope" },
                    },
                    feedFields
                )
            ).toThrow(/nope/);
        });

        test("feed config invalid order throws mentioning order", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "feed",
                        collection: "DemoTask",
                        config: { textField: "title", order: "random" },
                    },
                    feedFields
                )
            ).toThrow(/order/);
        });
    });

    describe("media", () => {
        test("valid media config does not throw", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "media",
                        collection: "docs",
                        config: { fileField: "image", titleField: "title", viewer: "image" },
                    },
                    phase2Fields
                )
            ).not.toThrow();
        });

        test("media without collection throws mentioning collection", () => {
            expect(() => validateBlockData({ type: "media" }, phase2Fields)).toThrow(/collection/);
        });

        test("media with no config at all does not throw (lenient)", () => {
            expect(() =>
                validateBlockData({ type: "media", collection: "docs" }, phase2Fields)
            ).not.toThrow();
        });

        test("media config missing fileField throws mentioning fileField", () => {
            expect(() =>
                validateBlockData(
                    { type: "media", collection: "docs", config: { titleField: "title" } },
                    phase2Fields
                )
            ).toThrow(/fileField/);
        });

        test("media unknown fileField throws naming the bad field", () => {
            expect(() =>
                validateBlockData(
                    { type: "media", collection: "docs", config: { fileField: "nope" } },
                    phase2Fields
                )
            ).toThrow(/nope/);
        });

        test("media dotted fileField validates first segment", () => {
            expect(() =>
                validateBlockData(
                    { type: "media", collection: "docs", config: { fileField: "image.id" } },
                    phase2Fields
                )
            ).not.toThrow();
        });

        test("media unknown titleField throws naming the bad field", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "media",
                        collection: "docs",
                        config: { fileField: "image", titleField: "bogus" },
                    },
                    phase2Fields
                )
            ).toThrow(/bogus/);
        });

        test("media invalid viewer throws mentioning viewer", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "media",
                        collection: "docs",
                        config: { fileField: "image", viewer: "pdf" },
                    },
                    phase2Fields
                )
            ).toThrow(/viewer/);
        });
    });

    describe("filter", () => {
        test("valid filter config does not throw", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "filter",
                        collection: "tasks",
                        config: { targets: "all", fields: [{ field: "status" }] },
                    },
                    phase2Fields
                )
            ).not.toThrow();
        });

        test("filter without collection throws mentioning collection", () => {
            expect(() => validateBlockData({ type: "filter" }, phase2Fields)).toThrow(/collection/);
        });

        test("filter fields with unknown field throws naming the bad field", () => {
            expect(() =>
                validateBlockData(
                    { type: "filter", collection: "tasks", config: { fields: [{ field: "nope" }] } },
                    phase2Fields
                )
            ).toThrow(/nope/);
        });

        test("filter targets as array of strings does not throw", () => {
            expect(() =>
                validateBlockData(
                    {
                        type: "filter",
                        collection: "tasks",
                        config: { targets: ["block-1", "block-2"], fields: [{ field: "status" }] },
                    },
                    phase2Fields
                )
            ).not.toThrow();
        });

        test("filter targets as a number throws mentioning targets", () => {
            expect(() =>
                validateBlockData(
                    { type: "filter", collection: "tasks", config: { targets: 42 } },
                    phase2Fields
                )
            ).toThrow(/targets/);
        });

        test("filter targets as array with non-string entry throws mentioning targets", () => {
            expect(() =>
                validateBlockData(
                    { type: "filter", collection: "tasks", config: { targets: [1] } },
                    phase2Fields
                )
            ).toThrow(/targets/);
        });
    });
});

describe("validatePageData", () => {
    test("create missing slug throws", () => {
        expect(() => validatePageData({ name: "Home" }, true)).toThrow();
    });

    test("create missing name throws", () => {
        expect(() => validatePageData({ slug: "home" }, true)).toThrow();
    });

    test("bad slug format throws mentioning slug", () => {
        expect(() => validatePageData({ name: "X", slug: "Bad Slug!" }, true)).toThrow(/slug/i);
    });

    test("bad slug format on update throws too", () => {
        expect(() => validatePageData({ slug: "Bad Slug!" }, false)).toThrow(/slug/i);
    });

    test("valid create passes", () => {
        expect(() => validatePageData({ name: "My Page", slug: "my-page-2" }, true)).not.toThrow();
    });

    test("update without slug passes", () => {
        expect(() => validatePageData({ name: "Renamed" }, false)).not.toThrow();
    });
});

describe("validatePageData – roles field", () => {
    test("roles undefined is ok (field not sent)", () => {
        expect(() => validatePageData({ name: "My Page", slug: "my-page" }, true)).not.toThrow();
    });

    test("roles null is ok (visible to all)", () => {
        expect(() => validatePageData({ name: "My Page", slug: "my-page", roles: null }, true)).not.toThrow();
    });

    test("roles as array of strings is ok", () => {
        expect(() =>
            validatePageData({ name: "My Page", slug: "my-page", roles: ["a", "b"] }, true)
        ).not.toThrow();
    });

    test("roles as string throws mentioning roles", () => {
        expect(() =>
            validatePageData({ name: "My Page", slug: "my-page", roles: "x" }, true)
        ).toThrow(/roles/);
    });

    test("roles as array with non-string element throws mentioning roles", () => {
        expect(() =>
            validatePageData({ name: "My Page", slug: "my-page", roles: [1] }, true)
        ).toThrow(/roles/);
    });
});

describe("mergeBlockForUpdate", () => {
    test("patch fields override existing fields", () => {
        const existing = { type: "table", collection: "posts", config: { columns: [] }, position: { row: 0, col: 0, span: 6 } };
        const patch = { config: { columns: [{ field: "title" }] } };
        const merged = mergeBlockForUpdate(existing, patch);
        expect(merged.config).toEqual({ columns: [{ field: "title" }] });
    });

    test("existing fields fill gaps not present in patch", () => {
        const existing = { type: "table", collection: "posts", config: { columns: [] }, position: { row: 0, col: 0, span: 6 } };
        const patch = { config: { columns: [{ field: "title" }] } };
        const merged = mergeBlockForUpdate(existing, patch);
        expect(merged.type).toBe("table");
        expect(merged.collection).toBe("posts");
        expect(merged.position).toEqual({ row: 0, col: 0, span: 6 });
    });

    test("merged result passes validateBlockData when valid", () => {
        const existing = { type: "table", collection: "posts", config: { columns: [] }, position: null };
        const patch = { config: { columns: [{ field: "name" }] } };
        const merged = mergeBlockForUpdate(existing, patch);
        expect(() => validateBlockData(merged, userLikeFields)).not.toThrow();
    });

    test("merged result fails validateBlockData when patch introduces bad column", () => {
        const existing = { type: "table", collection: "posts", config: { columns: [{ field: "name" }] }, position: null };
        const patch = { config: { columns: [{ field: "notReal" }] } };
        const merged = mergeBlockForUpdate(existing, patch);
        expect(() => validateBlockData(merged, userLikeFields)).toThrow(/notReal/);
    });

    test("config-only patch on a collection-requiring type is validated against existing type/collection", () => {
        const existing = { type: "table", collection: "posts", config: {}, position: null };
        const patch = { config: { columns: [{ field: "badField" }] } };
        const merged = mergeBlockForUpdate(existing, patch);
        expect(() => validateBlockData(merged, userLikeFields)).toThrow(/badField/);
    });

    test("does not mutate the existing object", () => {
        const existing = { type: "table", collection: "posts", config: { columns: [] }, position: null };
        const patch = { config: { columns: [{ field: "name" }] } };
        mergeBlockForUpdate(existing, patch);
        expect(existing.config).toEqual({ columns: [] });
    });
});
