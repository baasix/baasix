import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { hooksManager } from "../baasix/services/HooksManager.js";
import { ItemsService } from "../baasix/services/ItemsService.js";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

/**
 * WITH CHECK enforcement on create (Postgres RLS `INSERT ... WITH CHECK`
 * semantics): after insert, before commit, the created row must satisfy the
 * CREATE grant's `checkConditions` — otherwise 403 + rollback. `conditions`
 * never applies to create grants and is rejected at authoring time.
 *
 * Also covers the companion fix: before-create hooks receive the LIVE
 * transaction (previously they got options.transaction, which is undefined
 * for normal API creates, so hook DB writes could never roll back).
 */

let app;
let adminToken;
let tokenA;
let userAId;
let userBId;
let profileAId;
let profileBId;
let afterHookFired = 0;

const auditCount = async (entity) => {
    const res = await request(app)
        .get("/items/baasix_AuditLog")
        .set("Authorization", `Bearer ${adminToken}`)
        .query({ filter: JSON.stringify({ entity: { eq: entity }, action: { eq: "create" } }), limit: 100 });
    return res.body.totalCount ?? res.body.data.length;
};

const sideEffectCount = async () => {
    const res = await request(app)
        .get("/items/side_effect_log")
        .set("Authorization", `Bearer ${adminToken}`)
        .query({ limit: 100 });
    return res.body.totalCount ?? res.body.data.length;
};

beforeAll(async () => {
    await destroyAllTablesInDB();
    app = await startServerForTesting();

    const login = await request(app)
        .post("/auth/login")
        .send({ email: "admin@baasix.com", password: "admin@123" });
    adminToken = login.body.token;

    // Users A (acting) and B (victim/owner of the other profile).
    // A is created via admin so their ONLY role is "checker" (registration
    // would assign the default role, and the token would act under it).
    const regA = await request(app)
        .post("/items/baasix_User")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ firstName: "A", lastName: "User", email: "a@check.com", password: "password1" });
    userAId = regA.body.data.id;
    const regB = await request(app)
        .post("/auth/register")
        .send({ firstName: "B", lastName: "User", email: "b@check.com", password: "password1" });
    userBId = regB.body.user.id;

    // Collections
    await request(app).post("/schemas").set("Authorization", `Bearer ${adminToken}`).send({
        collectionName: "tasks_wc",
        schema: {
            name: "TaskWC",
            fields: {
                id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                title: { type: "String", allowNull: false },
                owner_Id: { type: "UUID" },
            },
        },
    });
    await request(app).post("/schemas").set("Authorization", `Bearer ${adminToken}`).send({
        collectionName: "tasks_def_wc",
        schema: {
            name: "TaskDefWC",
            fields: {
                id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                title: { type: "String", allowNull: false },
                owner_Id: { type: "UUID" },
            },
        },
    });
    await request(app).post("/schemas").set("Authorization", `Bearer ${adminToken}`).send({
        collectionName: "notes_wc",
        schema: {
            name: "NoteWC",
            fields: {
                id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                body: { type: "String", allowNull: false },
            },
        },
    });
    await request(app).post("/schemas").set("Authorization", `Bearer ${adminToken}`).send({
        collectionName: "staff_profile_wc",
        schema: {
            name: "StaffProfileWC",
            fields: {
                id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                orguser_Id: { type: "UUID" },
            },
        },
    });
    await request(app).post("/schemas").set("Authorization", `Bearer ${adminToken}`).send({
        collectionName: "leave_balance_wc",
        schema: {
            name: "LeaveBalanceWC",
            fields: {
                id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                amount: { type: "Integer" },
                staff_profile_Id: { type: "UUID" },
                staff_profile: {
                    relType: "BelongsTo",
                    target: "staff_profile_wc",
                    foreignKey: "staff_profile_Id",
                    as: "staff_profile",
                },
            },
        },
    });
    await request(app).post("/schemas").set("Authorization", `Bearer ${adminToken}`).send({
        collectionName: "side_effect_log",
        schema: {
            name: "SideEffectLog",
            fields: {
                id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                note: { type: "String" },
            },
        },
    });

    // Profiles owned by A and B
    const pA = await request(app)
        .post("/items/staff_profile_wc")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ orguser_Id: userAId });
    profileAId = pA.body.data.id;
    const pB = await request(app)
        .post("/items/staff_profile_wc")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ orguser_Id: userBId });
    profileBId = pB.body.data.id;

    // Role for user A with scoped create grants (deliberately NO read grants —
    // doubles as T8: create must succeed without read-back visibility)
    const roleRes = await request(app)
        .post("/items/baasix_Role")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "checker", description: "with-check role" });
    const roleId = roleRes.body.data.id;
    await request(app)
        .post("/items/baasix_UserRole")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ user_Id: userAId, role_Id: roleId });

    const grant = (body) =>
        request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({ role_Id: roleId, ...body });

    // T1: direct-column check
    await grant({
        collection: "tasks_wc",
        action: "create",
        fields: ["*"],
        checkConditions: { owner_Id: { eq: "$CURRENT_USER" } },
    });
    // T2: $path$ relation check
    await grant({
        collection: "leave_balance_wc",
        action: "create",
        fields: ["*"],
        checkConditions: { "$staff_profile.orguser_Id$": { eq: "$CURRENT_USER" } },
    });
    // T3: unscoped grant
    await grant({ collection: "notes_wc", action: "create", fields: ["*"] });
    // T4: default fills the condition-satisfying value
    await grant({
        collection: "tasks_def_wc",
        action: "create",
        fields: ["*"],
        checkConditions: { owner_Id: { eq: "$CURRENT_USER" } },
        defaultValues: { owner_Id: "$CURRENT_USER" },
    });
    await request(app).post("/permissions/reload").set("Authorization", `Bearer ${adminToken}`);

    // T9: before-create hook doing transactional work through ctx.transaction
    hooksManager.registerHook("tasks_wc", "items.create", async (ctx) => {
        const svc = new ItemsService("side_effect_log", { accountability: ctx.accountability });
        await svc.createOne({ note: "from-hook" }, { transaction: ctx.transaction, bypassPermissions: true, bypassHooks: true });
        return ctx;
    });
    // T7: after-hook spy
    hooksManager.registerHook("tasks_wc", "items.create.after", async (ctx) => {
        afterHookFired += 1;
        return ctx;
    });

    const loginA = await request(app)
        .post("/auth/login")
        .send({ email: "a@check.com", password: "password1" });
    tokenA = loginA.body.token;
});

afterAll(async () => {
    if (app?.server) await new Promise((r) => app.server.close(r));
});

describe("T1 — direct-column condition", () => {
    test("violating create is rejected with 403 and rolled back", async () => {
        const auditBefore = await auditCount("tasks_wc");
        const res = await request(app)
            .post("/items/tasks_wc")
            .set("Authorization", `Bearer ${tokenA}`)
            .send({ title: "steal", owner_Id: userBId });

        expect(res.status).toBe(403);

        // Row must not exist (rollback proven)
        const check = await request(app)
            .get("/items/tasks_wc")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ filter: JSON.stringify({ title: { eq: "steal" } }) });
        expect(check.body.data.length).toBe(0);

        // T7: no audit row and no after-hook for the rejected create
        expect(await auditCount("tasks_wc")).toBe(auditBefore);
        expect(afterHookFired).toBe(0);
    });

    test("satisfying create succeeds (and fires after-hook exactly once)", async () => {
        const res = await request(app)
            .post("/items/tasks_wc")
            .set("Authorization", `Bearer ${tokenA}`)
            .send({ title: "mine", owner_Id: userAId });

        expect(res.status).toBe(201);
        expect(res.body.data.id).toBeDefined();
        expect(afterHookFired).toBe(1);
    });
});

describe("T2 — $path$ relation condition (cross-parent create)", () => {
    test("create against another user's profile is rejected and rolled back", async () => {
        const res = await request(app)
            .post("/items/leave_balance_wc")
            .set("Authorization", `Bearer ${tokenA}`)
            .send({ amount: 10, staff_profile_Id: profileBId });

        expect(res.status).toBe(403);

        const check = await request(app)
            .get("/items/leave_balance_wc")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ filter: JSON.stringify({ staff_profile_Id: { eq: profileBId } }) });
        expect(check.body.data.length).toBe(0);
    });

    test("create against own profile succeeds", async () => {
        const res = await request(app)
            .post("/items/leave_balance_wc")
            .set("Authorization", `Bearer ${tokenA}`)
            .send({ amount: 5, staff_profile_Id: profileAId });

        expect(res.status).toBe(201);
    });
});

describe("T3 — unscoped grant unchanged", () => {
    test("create with a condition-less grant succeeds", async () => {
        const res = await request(app)
            .post("/items/notes_wc")
            .set("Authorization", `Bearer ${tokenA}`)
            .send({ body: "hello" });

        expect(res.status).toBe(201);
    });
});

describe("T4 — default fills the condition-satisfying value", () => {
    test("payload omitting owner_Id succeeds via permission defaultValues", async () => {
        const res = await request(app)
            .post("/items/tasks_def_wc")
            .set("Authorization", `Bearer ${tokenA}`)
            .send({ title: "defaulted" });

        expect(res.status).toBe(201);

        const check = await request(app)
            .get("/items/tasks_def_wc")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ filter: JSON.stringify({ title: { eq: "defaulted" } }) });
        expect(check.body.data[0].owner_Id).toBe(userAId);
    });
});

describe("T5 — createMany atomicity", () => {
    test("batch with one violating item: 403 and zero rows persisted", async () => {
        const res = await request(app)
            .post("/items/tasks_wc/bulk")
            .set("Authorization", `Bearer ${tokenA}`)
            .send([
                { title: "batch-1", owner_Id: userAId },
                { title: "batch-2", owner_Id: userBId },
                { title: "batch-3", owner_Id: userAId },
            ]);

        expect(res.status).toBe(403);

        const check = await request(app)
            .get("/items/tasks_wc")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ filter: JSON.stringify({ title: { startsWith: "batch-" } }) });
        expect(check.body.data.length).toBe(0);
    });
});

describe("T6 — admin bypasses the check", () => {
    test("admin creates a 'violating' row successfully", async () => {
        const res = await request(app)
            .post("/items/tasks_wc")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ title: "admin-any", owner_Id: userBId });

        expect(res.status).toBe(201);
    });
});

describe("T8 — create scope independent of read scope", () => {
    test("role has NO read grant on tasks_wc yet satisfying create succeeds", async () => {
        // (Every passing create above already proves this — the role has no
        // read grants at all — but assert the read really is denied.)
        const read = await request(app)
            .get("/items/tasks_wc")
            .set("Authorization", `Bearer ${tokenA}`);
        expect(read.status).toBe(403);

        const res = await request(app)
            .post("/items/tasks_wc")
            .set("Authorization", `Bearer ${tokenA}`)
            .send({ title: "no-read-needed", owner_Id: userAId });
        expect(res.status).toBe(201);
    });
});

describe("authoring guard — conditions rejected on create grants", () => {
    test("POST /permissions with action=create and conditions returns 400", async () => {
        const res = await request(app)
            .post("/permissions")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                role_Id: "00000000-0000-0000-0000-000000000000",
                collection: "notes_wc",
                action: "create",
                fields: ["*"],
                conditions: { body: { eq: "x" } },
            });
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).toContain("checkConditions");
    });
});

describe("T9 — before-hook transactional work rolls back with a rejected create", () => {
    test("hook write via ctx.transaction is rolled back on violation, kept on success", async () => {
        const before = await sideEffectCount();

        // Violating create: hook ran (and wrote via ctx.transaction), then the
        // WITH CHECK rejects → EVERYTHING rolls back, including the hook's row.
        const bad = await request(app)
            .post("/items/tasks_wc")
            .set("Authorization", `Bearer ${tokenA}`)
            .send({ title: "hooked-bad", owner_Id: userBId });
        expect(bad.status).toBe(403);
        expect(await sideEffectCount()).toBe(before);

        // Satisfying create: hook row persists.
        const good = await request(app)
            .post("/items/tasks_wc")
            .set("Authorization", `Bearer ${tokenA}`)
            .send({ title: "hooked-good", owner_Id: userAId });
        expect(good.status).toBe(201);
        expect(await sideEffectCount()).toBe(before + 1);
    });
});
