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
