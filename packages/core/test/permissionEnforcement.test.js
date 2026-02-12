import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

/**
 * Permission Enforcement Tests
 *
 * Tests that verify:
 * 1. Action-level access checks (canAccess) on create, update, delete
 * 2. Nested/relational field permission enforcement on create & update
 * 3. Wildcard depth semantics: "*" = direct fields only, "*.*" = one level deep
 * 4. Field-level write restrictions (only allowed fields can be written)
 */

let app;
let adminToken;
let adminUserId;

// Role A: has read-only permission on "articles"
let readOnlyRoleId;
let readOnlyUserId;
let readOnlyToken;

// Role B: has read + create (specific fields) on "articles", NO update/delete
let createOnlyRoleId;
let createOnlyUserId;
let createOnlyToken;

// Role C: has CRUD on "articles" with fields ["*"] (no nested), and read on "comments"
let starOnlyRoleId;
let starOnlyUserId;
let starOnlyToken;

// Role D: has CRUD on "articles" with fields ["*", "comments.*"] (one level nested)
let nestedAllowedRoleId;
let nestedAllowedUserId;
let nestedAllowedToken;

// Role E: has CRUD on "articles" with fields ["*", "comments.content"] (specific nested field)
let nestedRestrictedRoleId;
let nestedRestrictedUserId;
let nestedRestrictedToken;

beforeAll(async () => {
    await destroyAllTablesInDB();
    app = await startServerForTesting();

    // Admin login
    const adminLogin = await request(app)
        .post("/auth/login")
        .send({ email: "admin@baasix.com", password: "admin@123" });
    adminToken = adminLogin.body.token;
    adminUserId = adminLogin.body.user.id;

    // ── Create schemas ───────────────────────────────────────────────────

    // articles schema
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "articles",
            schema: {
                name: "Article",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    title: { type: "String", allowNull: false },
                    body: { type: "String", allowNull: true },
                    status: { type: "String", defaultValue: { value: "draft" } },
                },
            },
        });

    // comments schema
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "comments",
            schema: {
                name: "Comment",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    content: { type: "String", allowNull: false },
                    rating: { type: "Integer", allowNull: true },
                },
            },
        });

    // tags schema (for M2M testing)
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "articletags",
            schema: {
                name: "ArticleTag",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    name: { type: "String", allowNull: false },
                },
            },
        });

    // comments → articles (M2O / HasMany)
    await request(app)
        .post("/schemas/comments/relationships")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            type: "M2O",
            target: "articles",
            foreignKey: "articleId",
            name: "article",
            alias: "comments",
        });

    // articles ↔ articletags (M2M)
    await request(app)
        .post("/schemas/articles/relationships")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            type: "M2M",
            target: "articletags",
            name: "articletags",
            alias: "articles",
        });

    // ── Create roles & users ─────────────────────────────────────────────

    const createRoleUserAndLogin = async (roleName, email) => {
        // Create role
        const roleResp = await request(app)
            .post("/items/baasix_Role")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ name: roleName, description: `${roleName} role` });
        const roleId = roleResp.body.data.id;

        // Create user
        const userResp = await request(app)
            .post("/items/baasix_User")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                firstName: roleName,
                lastName: "User",
                email,
                password: "password123",
            });
        const userId = userResp.body.data.id;

        // Assign role
        await request(app)
            .post("/items/baasix_UserRole")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ user_Id: userId, role_Id: roleId });

        // Login
        const loginResp = await request(app)
            .post("/auth/login")
            .send({ email, password: "password123" });
        const token = loginResp.body.token;

        return { roleId, userId, token };
    };

    // Role A: read-only
    const roleA = await createRoleUserAndLogin("readonly", "readonly@test.com");
    readOnlyRoleId = roleA.roleId;
    readOnlyUserId = roleA.userId;
    readOnlyToken = roleA.token;

    // Role B: create-only (specific fields)
    const roleB = await createRoleUserAndLogin("createonly", "createonly@test.com");
    createOnlyRoleId = roleB.roleId;
    createOnlyUserId = roleB.userId;
    createOnlyToken = roleB.token;

    // Role C: star-only (["*"])
    const roleC = await createRoleUserAndLogin("staronly", "staronly@test.com");
    starOnlyRoleId = roleC.roleId;
    starOnlyUserId = roleC.userId;
    starOnlyToken = roleC.token;

    // Role D: nested-allowed (["*", "comments.*"])
    const roleD = await createRoleUserAndLogin("nestedallowed", "nestedallowed@test.com");
    nestedAllowedRoleId = roleD.roleId;
    nestedAllowedUserId = roleD.userId;
    nestedAllowedToken = roleD.token;

    // Role E: nested-restricted (["*", "comments.content"])
    const roleE = await createRoleUserAndLogin("nestedrestricted", "nestedrestricted@test.com");
    nestedRestrictedRoleId = roleE.roleId;
    nestedRestrictedUserId = roleE.userId;
    nestedRestrictedToken = roleE.token;

    // ── Create permissions ───────────────────────────────────────────────

    const createPermission = async (perm) => {
        const resp = await request(app)
            .post("/permissions")
            .set("Authorization", `Bearer ${adminToken}`)
            .send(perm);
        return resp.body.id;
    };

    // Role A: read only
    await createPermission({ role_Id: readOnlyRoleId, collection: "articles", action: "read", fields: ["*"] });

    // Role B: read + create (specific fields), NO update, NO delete
    await createPermission({ role_Id: createOnlyRoleId, collection: "articles", action: "read", fields: ["*"] });
    await createPermission({
        role_Id: createOnlyRoleId,
        collection: "articles",
        action: "create",
        fields: ["title", "body"],
    });

    // Role C: full CRUD with ["*"] only (direct fields, no nested)
    await createPermission({ role_Id: starOnlyRoleId, collection: "articles", action: "read", fields: ["*"] });
    await createPermission({ role_Id: starOnlyRoleId, collection: "articles", action: "create", fields: ["*"] });
    await createPermission({ role_Id: starOnlyRoleId, collection: "articles", action: "update", fields: ["*"] });
    await createPermission({ role_Id: starOnlyRoleId, collection: "articles", action: "delete" });
    // Also give read on comments so we can verify
    await createPermission({ role_Id: starOnlyRoleId, collection: "comments", action: "read", fields: ["*"] });

    // Role D: full CRUD with ["*", "comments.*"] (nested allowed)
    await createPermission({ role_Id: nestedAllowedRoleId, collection: "articles", action: "read", fields: ["*", "comments.*"] });
    await createPermission({ role_Id: nestedAllowedRoleId, collection: "articles", action: "create", fields: ["*", "comments.*"] });
    await createPermission({ role_Id: nestedAllowedRoleId, collection: "articles", action: "update", fields: ["*", "comments.*"] });
    await createPermission({ role_Id: nestedAllowedRoleId, collection: "articles", action: "delete" });

    // Role E: CRUD with ["*", "comments.content"] (only content in nested)
    await createPermission({ role_Id: nestedRestrictedRoleId, collection: "articles", action: "read", fields: ["*", "comments.*"] });
    await createPermission({ role_Id: nestedRestrictedRoleId, collection: "articles", action: "create", fields: ["*", "comments.content"] });
    await createPermission({ role_Id: nestedRestrictedRoleId, collection: "articles", action: "update", fields: ["*", "comments.content"] });
    await createPermission({ role_Id: nestedRestrictedRoleId, collection: "articles", action: "delete" });
}, 60000);

// ═══════════════════════════════════════════════════════════════════════════
// 1. ACTION-LEVEL ACCESS CHECKS (canAccess)
// ═══════════════════════════════════════════════════════════════════════════

describe("Action-level permission checks (canAccess)", () => {
    test("Read-only role CANNOT create items (should get 403)", async () => {
        const response = await request(app)
            .post("/items/articles")
            .set("Authorization", `Bearer ${readOnlyToken}`)
            .send({ title: "Should Fail", body: "No create permission" });

        expect(response.status).toBe(403);
        expect(response.body).toHaveProperty("error");
    });

    test("Read-only role CANNOT update items (should get 403)", async () => {
        // Create an article as admin first
        const createResp = await request(app)
            .post("/items/articles")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ title: "Admin Article", body: "Created by admin" });
        const articleId = createResp.body.data.id;

        const response = await request(app)
            .patch(`/items/articles/${articleId}`)
            .set("Authorization", `Bearer ${readOnlyToken}`)
            .send({ title: "Hacked Title" });

        expect(response.status).toBe(403);
        expect(response.body).toHaveProperty("error");
    });

    test("Read-only role CANNOT delete items (should get 403)", async () => {
        const createResp = await request(app)
            .post("/items/articles")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ title: "To Delete", body: "Should not be deletable" });
        const articleId = createResp.body.data.id;

        const response = await request(app)
            .delete(`/items/articles/${articleId}`)
            .set("Authorization", `Bearer ${readOnlyToken}`);

        expect(response.status).toBe(403);
        expect(response.body).toHaveProperty("error");
    });

    test("Create-only role CAN create items", async () => {
        const response = await request(app)
            .post("/items/articles")
            .set("Authorization", `Bearer ${createOnlyToken}`)
            .send({ title: "Created by createOnly", body: "This should work" });

        expect(response.status).toBe(201);
        expect(response.body.data).toBeDefined();
    });

    test("Create-only role CANNOT update items (should get 403)", async () => {
        // Create one with admin, then try to update as createOnly
        const createResp = await request(app)
            .post("/items/articles")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ title: "For Update Test", body: "Content" });
        const articleId = createResp.body.data.id;

        const response = await request(app)
            .patch(`/items/articles/${articleId}`)
            .set("Authorization", `Bearer ${createOnlyToken}`)
            .send({ title: "Should Not Work" });

        expect(response.status).toBe(403);
        expect(response.body).toHaveProperty("error");
    });

    test("Create-only role CANNOT delete items (should get 403)", async () => {
        const createResp = await request(app)
            .post("/items/articles")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ title: "For Delete Test", body: "Content" });
        const articleId = createResp.body.data.id;

        const response = await request(app)
            .delete(`/items/articles/${articleId}`)
            .set("Authorization", `Bearer ${createOnlyToken}`);

        expect(response.status).toBe(403);
        expect(response.body).toHaveProperty("error");
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. FIELD-LEVEL WRITE RESTRICTIONS
// ═══════════════════════════════════════════════════════════════════════════

describe("Field-level write restrictions", () => {
    test("Create-only role can write allowed fields (title, body)", async () => {
        const response = await request(app)
            .post("/items/articles")
            .set("Authorization", `Bearer ${createOnlyToken}`)
            .send({ title: "Allowed", body: "Allowed body" });

        expect(response.status).toBe(201);
    });

    test("Create-only role CANNOT write disallowed field (status) — 403", async () => {
        const response = await request(app)
            .post("/items/articles")
            .set("Authorization", `Bearer ${createOnlyToken}`)
            .send({ title: "Test", body: "Body", status: "published" });

        expect(response.status).toBe(403);
        expect(response.body).toHaveProperty("error");
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. WILDCARD DEPTH: "*" = direct fields only, NOT nested relations
// ═══════════════════════════════════════════════════════════════════════════

describe("Wildcard depth semantics — '*' does NOT include nested", () => {
    test("Star-only role CAN create with direct fields only", async () => {
        const response = await request(app)
            .post("/items/articles")
            .set("Authorization", `Bearer ${starOnlyToken}`)
            .send({ title: "Direct Only", body: "No nested", status: "draft" });

        expect(response.status).toBe(201);
    });

    test("Star-only role CANNOT create with nested HasMany data (comments) — 403", async () => {
        const response = await request(app)
            .post("/items/articles")
            .set("Authorization", `Bearer ${starOnlyToken}`)
            .send({
                title: "With Comments",
                body: "Trying to sneak in nested data",
                comments: [{ content: "Sneaky comment", rating: 5 }],
            });

        expect(response.status).toBe(403);
        expect(response.body).toHaveProperty("error");
    });

    test("Star-only role CANNOT update with nested HasMany data (comments) — 403", async () => {
        // Create article as admin
        const createResp = await request(app)
            .post("/items/articles")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ title: "Admin Article For Star", body: "Content" });
        const articleId = createResp.body.data.id;

        const response = await request(app)
            .patch(`/items/articles/${articleId}`)
            .set("Authorization", `Bearer ${starOnlyToken}`)
            .send({
                title: "Updated Title",
                comments: [{ content: "Sneaky nested update", rating: 1 }],
            });

        expect(response.status).toBe(403);
        expect(response.body).toHaveProperty("error");
    });

    test("Star-only role CAN update direct fields only", async () => {
        const createResp = await request(app)
            .post("/items/articles")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ title: "For Direct Update", body: "Content" });
        const articleId = createResp.body.data.id;

        const response = await request(app)
            .patch(`/items/articles/${articleId}`)
            .set("Authorization", `Bearer ${starOnlyToken}`)
            .send({ title: "Updated Direct Only" });

        expect(response.status).toBe(200);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. NESTED ALLOWED: ["*", "comments.*"] — relations are permitted
// ═══════════════════════════════════════════════════════════════════════════

describe("Nested allowed — ['*', 'comments.*']", () => {
    test("Nested-allowed role CAN create article with nested comments", async () => {
        const response = await request(app)
            .post("/items/articles")
            .set("Authorization", `Bearer ${nestedAllowedToken}`)
            .send({
                title: "Article with Comments",
                body: "Full nested access",
                comments: [
                    { content: "Great article", rating: 5 },
                    { content: "Needs improvement", rating: 2 },
                ],
            });

        expect(response.status).toBe(201);
        expect(response.body.data).toBeDefined();

        // Verify comments were created
        const readResp = await request(app)
            .get(`/items/articles/${response.body.data.id}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ fields: ["*", "comments.*"] });

        expect(readResp.body.data.comments).toHaveLength(2);
    });

    test("Nested-allowed role CAN update article with nested comments", async () => {
        // Create as admin
        const createResp = await request(app)
            .post("/items/articles")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ title: "For Nested Update", body: "Content" });
        const articleId = createResp.body.data.id;

        const response = await request(app)
            .patch(`/items/articles/${articleId}`)
            .set("Authorization", `Bearer ${nestedAllowedToken}`)
            .send({
                title: "Updated With Comments",
                comments: [{ content: "New comment via update", rating: 4 }],
            });

        expect(response.status).toBe(200);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. NESTED RESTRICTED: ["*", "comments.content"] — only specific sub-field
// ═══════════════════════════════════════════════════════════════════════════

describe("Nested restricted — ['*', 'comments.content']", () => {
    test("Nested-restricted role CAN create with allowed nested field (content)", async () => {
        const response = await request(app)
            .post("/items/articles")
            .set("Authorization", `Bearer ${nestedRestrictedToken}`)
            .send({
                title: "Restricted Nested",
                body: "Only content in comments allowed",
                comments: [{ content: "Allowed comment" }],
            });

        expect(response.status).toBe(201);
    });

    test("Nested-restricted role CANNOT create with disallowed nested field (rating) — 403", async () => {
        const response = await request(app)
            .post("/items/articles")
            .set("Authorization", `Bearer ${nestedRestrictedToken}`)
            .send({
                title: "Should Fail",
                body: "Rating not allowed",
                comments: [{ content: "Comment", rating: 5 }],
            });

        expect(response.status).toBe(403);
        expect(response.body).toHaveProperty("error");
    });

    test("Nested-restricted role CANNOT update with disallowed nested field (rating) — 403", async () => {
        const createResp = await request(app)
            .post("/items/articles")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ title: "For Restricted Update", body: "Content" });
        const articleId = createResp.body.data.id;

        const response = await request(app)
            .patch(`/items/articles/${articleId}`)
            .set("Authorization", `Bearer ${nestedRestrictedToken}`)
            .send({
                comments: [{ content: "OK comment", rating: 3 }],
            });

        expect(response.status).toBe(403);
        expect(response.body).toHaveProperty("error");
    });

    test("Nested-restricted role CAN update with only allowed nested field (content)", async () => {
        const createResp = await request(app)
            .post("/items/articles")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ title: "For Allowed Nested Update", body: "Content" });
        const articleId = createResp.body.data.id;

        const response = await request(app)
            .patch(`/items/articles/${articleId}`)
            .set("Authorization", `Bearer ${nestedRestrictedToken}`)
            .send({
                comments: [{ content: "Only content field" }],
            });

        expect(response.status).toBe(200);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. CROSS-CUTTING: ensure admin is NOT affected by these checks
// ═══════════════════════════════════════════════════════════════════════════

describe("Admin bypasses all permission checks", () => {
    test("Admin CAN create with nested data and any fields", async () => {
        const response = await request(app)
            .post("/items/articles")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                title: "Admin Article",
                body: "Admin can do anything",
                status: "published",
                comments: [
                    { content: "Admin comment", rating: 5 },
                ],
            });

        expect(response.status).toBe(201);
    });

    test("Admin CAN update with nested data and any fields", async () => {
        const createResp = await request(app)
            .post("/items/articles")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ title: "For Admin Update", body: "Content" });
        const articleId = createResp.body.data.id;

        const response = await request(app)
            .patch(`/items/articles/${articleId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                title: "Admin Updated",
                status: "published",
                comments: [{ content: "Admin nested comment", rating: 5 }],
            });

        expect(response.status).toBe(200);
    });
});

afterAll(async () => {
    if (app.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});
