import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

/**
 * Phase 2 WITH CHECK — update path. `conditions` keep their existing meaning
 * (USING: which rows may be updated). A new nullable `checkConditions` on
 * baasix_Permission validates what the row may BECOME: after the update,
 * before commit, the row is re-read with checkConditions applied — no match
 * → 403 + rollback. checkConditions == null → no post-update check (fully
 * backward compatible). checkConditions is the WITH CHECK for BOTH create
 * and update; `conditions` never applies to creates (rejected at authoring).
 */

let app;
let adminToken;
let tokenA;
let userAId;
let userBId;

const mkUser = async (email) => {
    const u = await request(app)
        .post("/items/baasix_User")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ firstName: "U", lastName: "WC", email, password: "password1" });
    return u.body.data.id;
};

beforeAll(async () => {
    await destroyAllTablesInDB();
    app = await startServerForTesting();

    const login = await request(app)
        .post("/auth/login")
        .send({ email: "admin@baasix.com", password: "admin@123" });
    adminToken = login.body.token;

    userAId = await mkUser("a@uwc.com");
    userBId = await mkUser("b@uwc.com");

    await request(app).post("/schemas").set("Authorization", `Bearer ${adminToken}`).send({
        collectionName: "docs_uwc",
        schema: {
            name: "DocUWC",
            fields: {
                id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                title: { type: "String", allowNull: false },
                status: { type: "String", defaultValue: "draft" },
                owner_Id: { type: "UUID" },
            },
        },
    });
    await request(app).post("/schemas").set("Authorization", `Bearer ${adminToken}`).send({
        collectionName: "legacy_uwc",
        schema: {
            name: "LegacyUWC",
            fields: {
                id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                status: { type: "String", defaultValue: "draft" },
            },
        },
    });
    await request(app).post("/schemas").set("Authorization", `Bearer ${adminToken}`).send({
        collectionName: "prec_uwc",
        schema: {
            name: "PrecUWC",
            fields: {
                id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                title: { type: "String", allowNull: false },
                owner_Id: { type: "UUID" },
            },
        },
    });

    const roleRes = await request(app)
        .post("/items/baasix_Role")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "editor", description: "update-with-check role" });
    const roleId = roleRes.body.data.id;
    await request(app)
        .post("/items/baasix_UserRole")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ user_Id: userAId, role_Id: roleId });

    const grant = (body) =>
        request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({ role_Id: roleId, ...body });

    // U1/U2: may update own drafts; result must stay owned by self with an allowed status
    await grant({
        collection: "docs_uwc",
        action: "update",
        fields: ["*"],
        conditions: { owner_Id: { eq: "$CURRENT_USER" }, status: { eq: "draft" } },
        checkConditions: {
            owner_Id: { eq: "$CURRENT_USER" },
            status: { in: ["draft", "submitted"] },
        },
    });
    await grant({ collection: "docs_uwc", action: "read", fields: ["*"] });
    // U3: legacy grant — conditions only, NO checkConditions
    await grant({
        collection: "legacy_uwc",
        action: "update",
        fields: ["*"],
        conditions: { status: { eq: "draft" } },
    });
    // U4: create uses checkConditions (same field, same meaning as update)
    await grant({
        collection: "prec_uwc",
        action: "create",
        fields: ["*"],
        checkConditions: { title: { startsWith: "ok" } },
    });
    await request(app).post("/permissions/reload").set("Authorization", `Bearer ${adminToken}`);

    const loginA = await request(app)
        .post("/auth/login")
        .send({ email: "a@uwc.com", password: "password1" });
    tokenA = loginA.body.token;
});

afterAll(async () => {
    if (app?.server) await new Promise((r) => app.server.close(r));
});

const mkDoc = async (overrides = {}) => {
    const res = await request(app)
        .post("/items/docs_uwc")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ title: "doc", status: "draft", owner_Id: userAId, ...overrides });
    return res.body.data.id;
};

describe("U1 — allowed transitions pass, forbidden results fail + roll back", () => {
    test("draft → submitted succeeds (would fail under naive re-check of conditions)", async () => {
        const id = await mkDoc();
        const res = await request(app)
            .patch(`/items/docs_uwc/${id}`)
            .set("Authorization", `Bearer ${tokenA}`)
            .send({ status: "submitted" });
        expect(res.status).toBe(200);
    });

    test("draft → archived violates checkConditions: 403 and value unchanged", async () => {
        const id = await mkDoc();
        const res = await request(app)
            .patch(`/items/docs_uwc/${id}`)
            .set("Authorization", `Bearer ${tokenA}`)
            .send({ status: "archived" });
        expect(res.status).toBe(403);

        const after = await request(app)
            .get(`/items/docs_uwc/${id}`)
            .set("Authorization", `Bearer ${adminToken}`);
        expect(after.body.data.status).toBe("draft");
    });
});

describe("U2 — cannot move a row out of your own scope", () => {
    test("reassigning owner_Id to another user: 403 + rollback", async () => {
        const id = await mkDoc();
        const res = await request(app)
            .patch(`/items/docs_uwc/${id}`)
            .set("Authorization", `Bearer ${tokenA}`)
            .send({ owner_Id: userBId });
        expect(res.status).toBe(403);

        const after = await request(app)
            .get(`/items/docs_uwc/${id}`)
            .set("Authorization", `Bearer ${adminToken}`);
        expect(after.body.data.owner_Id).toBe(userAId);
    });
});

describe("U3 — no checkConditions: existing behavior untouched", () => {
    test("legacy grant may still move the row out of its update scope", async () => {
        const doc = await request(app)
            .post("/items/legacy_uwc")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ status: "draft" });
        const res = await request(app)
            .patch(`/items/legacy_uwc/${doc.body.data.id}`)
            .set("Authorization", `Bearer ${tokenA}`)
            .send({ status: "anything-goes" });
        expect(res.status).toBe(200);
    });
});

describe("U4 — checkConditions applies uniformly to create", () => {
    test("create satisfying checkConditions succeeds regardless of row ownership", async () => {
        const res = await request(app)
            .post("/items/prec_uwc")
            .set("Authorization", `Bearer ${tokenA}`)
            .send({ title: "ok-doc", owner_Id: userBId });
        expect(res.status).toBe(201);
    });

    test("create violating checkConditions fails", async () => {
        const res = await request(app)
            .post("/items/prec_uwc")
            .set("Authorization", `Bearer ${tokenA}`)
            .send({ title: "bad-doc", owner_Id: userAId });
        expect(res.status).toBe(403);
    });
});

describe("U5 — bulk update atomicity", () => {
    test("batch where one item violates: 403 and NO items changed", async () => {
        const id1 = await mkDoc({ title: "bulk-1" });
        const id2 = await mkDoc({ title: "bulk-2" });

        const res = await request(app)
            .patch("/items/docs_uwc/bulk")
            .set("Authorization", `Bearer ${tokenA}`)
            .send([
                { id: id1, status: "submitted" },
                { id: id2, status: "archived" },
            ]);
        expect(res.status).toBe(403);

        const r1 = await request(app).get(`/items/docs_uwc/${id1}`).set("Authorization", `Bearer ${adminToken}`);
        const r2 = await request(app).get(`/items/docs_uwc/${id2}`).set("Authorization", `Bearer ${adminToken}`);
        expect(r1.body.data.status).toBe("draft");
        expect(r2.body.data.status).toBe("draft");
    });
});

describe("U6 — admin exempt", () => {
    test("admin can set any value regardless of checkConditions", async () => {
        const id = await mkDoc();
        const res = await request(app)
            .patch(`/items/docs_uwc/${id}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ status: "archived", owner_Id: userBId });
        expect(res.status).toBe(200);
    });
});
