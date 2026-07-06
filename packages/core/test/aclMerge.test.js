import { mergeACLEntries } from "../baasix/utils/aclMerge";
import { test, expect, describe } from "@jest/globals";

const own = {
    id: "a1",
    name: "Update_Own",
    conditions: { userCreated_Id: { eq: "$CURRENT_USER" } },
    fields: ["*"],
};
const teams = {
    id: "a2",
    name: "Update_Teams",
    conditions: { "team.members.user_Id": { eq: "$CURRENT_USER" } },
    fields: ["title", "status"],
};

describe("mergeACLEntries — conditions", () => {
    test("single entry passes conditions through unwrapped", () => {
        const merged = mergeACLEntries([own]);
        expect(merged.conditions).toEqual({ userCreated_Id: { eq: "$CURRENT_USER" } });
    });

    test("multiple entries OR their conditions in order", () => {
        const merged = mergeACLEntries([own, teams]);
        expect(merged.conditions).toEqual({
            OR: [
                { userCreated_Id: { eq: "$CURRENT_USER" } },
                { "team.members.user_Id": { eq: "$CURRENT_USER" } },
            ],
        });
    });

    test("any entry with empty conditions makes the result unrestricted", () => {
        const readAll = { id: "a3", name: "Read_All", conditions: {}, fields: ["*"] };
        expect(mergeACLEntries([own, readAll]).conditions).toEqual({});
        const nullCond = { id: "a4", name: "NoCond", conditions: null, fields: ["*"] };
        expect(mergeACLEntries([own, nullCond]).conditions).toEqual({});
    });
});

describe("mergeACLEntries — fields", () => {
    test("all entries without fields yields null (unrestricted)", () => {
        const a = { id: "a1", name: "A", conditions: { x: { eq: 1 } } };
        const b = { id: "a2", name: "B", conditions: { y: { eq: 2 } }, fields: null };
        expect(mergeACLEntries([a, b]).fields).toBeNull();
    });

    test("fields union with dedupe, preserving explicit names alongside *", () => {
        const merged = mergeACLEntries([own, teams]);
        expect(merged.fields).toEqual(["*", "title", "status"]);
    });

    test("null fields among non-null lists is treated as * in the union", () => {
        const noFields = { id: "a5", name: "N", conditions: { x: { eq: 1 } } };
        const explicit = { id: "a6", name: "E", conditions: { y: { eq: 2 } }, fields: ["role_Id"] };
        expect(mergeACLEntries([noFields, explicit]).fields).toEqual(["*", "role_Id"]);
    });

    test("duplicate field names are deduped", () => {
        const a = { id: "a1", name: "A", conditions: { x: { eq: 1 } }, fields: ["title", "status"] };
        const b = { id: "a2", name: "B", conditions: { y: { eq: 2 } }, fields: ["status", "body"] };
        expect(mergeACLEntries([a, b]).fields).toEqual(["title", "status", "body"]);
    });
});

describe("mergeACLEntries — defaultValues", () => {
    test("shallow merge in order, later entry wins on conflicts", () => {
        const a = { id: "a1", name: "A", conditions: { x: { eq: 1 } }, defaultValues: { status: "draft", author_Id: "$CURRENT_USER" } };
        const b = { id: "a2", name: "B", conditions: { y: { eq: 2 } }, defaultValues: { status: "published" } };
        expect(mergeACLEntries([a, b]).defaultValues).toEqual({
            status: "published",
            author_Id: "$CURRENT_USER",
        });
    });

    test("no defaultValues anywhere yields empty object", () => {
        expect(mergeACLEntries([own, teams]).defaultValues).toEqual({});
    });
});

describe("mergeACLEntries — relConditions", () => {
    test("any entry without relConditions makes all relations unrestricted", () => {
        const a = { id: "a1", name: "A", conditions: { x: { eq: 1 } }, relConditions: { category: { isPublic: { eq: true } } } };
        const b = { id: "a2", name: "B", conditions: { y: { eq: 2 } } };
        expect(mergeACLEntries([a, b]).relConditions).toEqual({});
    });

    test("relation keys are intersected; shared keys OR their values; unshared keys drop", () => {
        const a = {
            id: "a1", name: "A", conditions: { x: { eq: 1 } },
            relConditions: {
                category: { isPublic: { eq: true } },
                author: { active: { eq: true } },
            },
        };
        const b = {
            id: "a2", name: "B", conditions: { y: { eq: 2 } },
            relConditions: { category: { owner_Id: { eq: "$CURRENT_USER" } } },
        };
        expect(mergeACLEntries([a, b]).relConditions).toEqual({
            category: {
                OR: [{ isPublic: { eq: true } }, { owner_Id: { eq: "$CURRENT_USER" } }],
            },
        });
    });

    test("single entry passes relConditions through unwrapped", () => {
        const a = { id: "a1", name: "A", conditions: { x: { eq: 1 } }, relConditions: { category: { isPublic: { eq: true } } } };
        expect(mergeACLEntries([a]).relConditions).toEqual({ category: { isPublic: { eq: true } } });
    });
});
