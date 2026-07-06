import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

let app;
let adminToken;
let userToken;
let testUserId;
let userRoleId;
let secondUserToken;
let secondUserId;

beforeAll(async () => {
    await destroyAllTablesInDB();
    app = await startServerForTesting();

    const adminLoginResponse = await request(app)
        .post("/auth/login")
        .send({ email: "admin@baasix.com", password: "admin@123" });
    adminToken = adminLoginResponse.body.token;

    // Create a test user role
    const userRoleResponse = await request(app)
        .post("/items/baasix_Role")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "testuser", description: "Test user role" });
    userRoleId = userRoleResponse.body.data?.id;

    // Create a test user
    const createUserResponse = await request(app)
        .post("/items/baasix_User")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            firstName: "Test",
            lastName: "User",
            email: "testuser@test.com",
            password: "userpassword",
        });
    testUserId = createUserResponse.body.data.id;

    // Assign role to the test user
    await request(app).post("/items/baasix_UserRole").set("Authorization", `Bearer ${adminToken}`).send({
        user_Id: testUserId,
        role_Id: userRoleId,
    });

    // Login as test user
    const userLoginResponse = await request(app).post("/auth/login").send({
        email: "testuser@test.com",
        password: "userpassword",
    });
    userToken = userLoginResponse.body.token;

    // Create a second test user with the same testuser role
    const createSecondUserResponse = await request(app)
        .post("/items/baasix_User")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            firstName: "Second",
            lastName: "User",
            email: "seconduser@test.com",
            password: "userpassword",
        });
    secondUserId = createSecondUserResponse.body.data.id;

    await request(app).post("/items/baasix_UserRole").set("Authorization", `Bearer ${adminToken}`).send({
        user_Id: secondUserId,
        role_Id: userRoleId,
    });

    const secondUserLoginResponse = await request(app).post("/auth/login").send({
        email: "seconduser@test.com",
        password: "userpassword",
    });
    secondUserToken = secondUserLoginResponse.body.token;
});

describe("System ACL seeding", () => {
    test("seeds the five built-in system ACL entries at startup", async () => {
        const response = await request(app)
            .get("/items/baasix_ACL")
            .query({ limit: -1 })
            .set("Authorization", `Bearer ${adminToken}`);

        expect(response.status).toBe(200);
        const names = response.body.data.map((e) => e.name).sort();
        expect(names).toEqual(["Delete_Own", "Own_Tenant", "Read_All", "Read_Own", "Update_Own"]);
        for (const entry of response.body.data) {
            expect(entry.system).toBe(true);
        }

        const updateOwn = response.body.data.find((e) => e.name === "Update_Own");
        expect(updateOwn.conditions).toEqual({ userCreated_Id: { eq: "$CURRENT_USER" } });
        expect(updateOwn.fields).toEqual(["*"]);

        const readAll = response.body.data.find((e) => e.name === "Read_All");
        expect(readAll.conditions).toEqual({});
    });
});

describe("ACL Routes", () => {
    let aclId;

    test("Create a named ACL entry", async () => {
        const response = await request(app).post("/acls").set("Authorization", `Bearer ${adminToken}`).send({
            name: "Update_Teams",
            description: "Rows belonging to the user's teams",
            conditions: { "team.members.user_Id": { eq: "$CURRENT_USER" } },
            fields: ["title", "status"],
        });

        expect(response.status).toBe(201);
        expect(response.body).toHaveProperty("id");
        expect(response.body.system).toBe(false);
        aclId = response.body.id;
    });

    test("List ACL entries includes seeds and the new entry", async () => {
        const response = await request(app).get("/acls").set("Authorization", `Bearer ${adminToken}`);
        expect(response.status).toBe(200);
        const names = response.body.data.map((e) => e.name);
        expect(names).toContain("Update_Teams");
        expect(names).toContain("Update_Own");
    });

    test("Get a single ACL entry", async () => {
        const response = await request(app).get(`/acls/${aclId}`).set("Authorization", `Bearer ${adminToken}`);
        expect(response.status).toBe(200);
        expect(response.body.data.name).toBe("Update_Teams");
    });

    test("Update a non-system ACL entry", async () => {
        const response = await request(app)
            .patch(`/acls/${aclId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ description: "Updated description" });
        expect(response.status).toBe(200);
        expect(response.body.description).toBe("Updated description");
    });

    test("Cannot set system flag through the API", async () => {
        // Include a real field alongside `system` so the update payload is
        // non-empty after the route strips the system key.
        const response = await request(app)
            .patch(`/acls/${aclId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ system: true, description: "attempted system escalation" });
        expect(response.status).toBe(200);
        expect(response.body.system).toBe(false);
    });

    test("Cannot update a system ACL entry", async () => {
        const list = await request(app).get("/acls").set("Authorization", `Bearer ${adminToken}`);
        const updateOwn = list.body.data.find((e) => e.name === "Update_Own");

        const response = await request(app)
            .patch(`/acls/${updateOwn.id}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ description: "hacked" });
        expect(response.status).toBe(403);
    });

    test("Cannot delete a system ACL entry", async () => {
        const list = await request(app).get("/acls").set("Authorization", `Bearer ${adminToken}`);
        const readAll = list.body.data.find((e) => e.name === "Read_All");

        const response = await request(app)
            .delete(`/acls/${readAll.id}`)
            .set("Authorization", `Bearer ${adminToken}`);
        expect(response.status).toBe(403);
    });

    test("Cannot delete an ACL entry referenced by a permission (409 lists usage)", async () => {
        const perm = await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: userRoleId,
            collection: "acl_guard_collection",
            action: "read",
            acl_Ids: [aclId],
        });
        expect(perm.status).toBe(201);

        const response = await request(app).delete(`/acls/${aclId}`).set("Authorization", `Bearer ${adminToken}`);
        expect(response.status).toBe(409);
        expect(response.body.error.details.usedBy).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ collection: "acl_guard_collection", action: "read" }),
            ])
        );

        // Detach and delete succeeds
        await request(app).delete(`/permissions/${perm.body.id}`).set("Authorization", `Bearer ${adminToken}`);
        const retry = await request(app).delete(`/acls/${aclId}`).set("Authorization", `Bearer ${adminToken}`);
        expect(retry.status).toBe(204);
    });

    test("Rejects malformed payloads with 400", async () => {
        const badConditions = await request(app).post("/acls").set("Authorization", `Bearer ${adminToken}`).send({
            name: "Bad_Conditions",
            conditions: "not-an-object",
        });
        expect(badConditions.status).toBe(400);

        const badFields = await request(app).post("/acls").set("Authorization", `Bearer ${adminToken}`).send({
            name: "Bad_Fields",
            fields: [1, 2],
        });
        expect(badFields.status).toBe(400);

        const noName = await request(app).post("/acls").set("Authorization", `Bearer ${adminToken}`).send({
            conditions: { x: { eq: 1 } },
        });
        expect(noName.status).toBe(400);
    });

    test("Non-admin cannot write ACL entries", async () => {
        const response = await request(app).post("/acls").set("Authorization", `Bearer ${userToken}`).send({
            name: "Sneaky",
            conditions: {},
        });
        expect(response.status).toBe(403);
    });
});

describe("ACL-based enforcement (end to end)", () => {
    let postAId; // created by testuser
    let postBId; // created by seconduser

    beforeAll(async () => {
        // Collection with user tracking so seeded *_Own ACLs apply
        await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                collectionName: "acl_posts",
                schema: {
                    name: "ACLPost",
                    // Enables auto-set userCreated_Id on create (ItemsService.ts:2414).
                    // If the created rows come back without userCreated_Id, check where
                    // the create-schema route expects this flag (schema level vs top
                    // level) via the baasix_create_schema handler in MCPService.ts:791.
                    usertrack: true,
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        title: { type: "String", allowNull: false },
                        status: { type: "String" },
                    },
                },
            });

        // Look up seeded ACL ids
        const acls = await request(app).get("/acls").set("Authorization", `Bearer ${adminToken}`);
        const byName = Object.fromEntries(acls.body.data.map((e) => [e.name, e.id]));

        // testuser role: create (open) + read own + update own
        await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: userRoleId,
            collection: "acl_posts",
            action: "create",
            fields: ["*"],
        });
        await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: userRoleId,
            collection: "acl_posts",
            action: "read",
            acl_Ids: [byName["Read_Own"]],
        });
        await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: userRoleId,
            collection: "acl_posts",
            action: "update",
            acl_Ids: [byName["Update_Own"]],
        });

        // Each user creates one post
        const postA = await request(app)
            .post("/items/acl_posts")
            .set("Authorization", `Bearer ${userToken}`)
            .send({ title: "post by testuser", status: "draft" });
        postAId = postA.body.data.id;

        const postB = await request(app)
            .post("/items/acl_posts")
            .set("Authorization", `Bearer ${secondUserToken}`)
            .send({ title: "post by seconduser", status: "draft" });
        postBId = postB.body.data.id;
    });

    test("Read_Own: user sees only their own rows", async () => {
        const response = await request(app)
            .get("/items/acl_posts")
            .set("Authorization", `Bearer ${userToken}`);
        expect(response.status).toBe(200);
        const ids = response.body.data.map((p) => p.id);
        expect(ids).toContain(postAId);
        expect(ids).not.toContain(postBId);
    });

    test("Update_Own: user can update own row, not another user's", async () => {
        const ok = await request(app)
            .patch(`/items/acl_posts/${postAId}`)
            .set("Authorization", `Bearer ${userToken}`)
            .send({ title: "updated by owner" });
        expect(ok.status).toBe(200);

        const denied = await request(app)
            .patch(`/items/acl_posts/${postBId}`)
            .set("Authorization", `Bearer ${userToken}`)
            .send({ title: "should not work" });
        expect([403, 404]).toContain(denied.status);
    });

    test("Multiple ACLs OR: adding Read_All widens read access to all rows", async () => {
        const acls = await request(app).get("/acls").set("Authorization", `Bearer ${adminToken}`);
        const byName = Object.fromEntries(acls.body.data.map((e) => [e.name, e.id]));

        const perms = await request(app)
            .get("/permissions")
            .query({ filter: JSON.stringify({ AND: [{ collection: { eq: "acl_posts" } }, { action: { eq: "read" } }] }) })
            .set("Authorization", `Bearer ${adminToken}`);
        const readPerm = perms.body.data[0];

        const patch = await request(app)
            .patch(`/permissions/${readPerm.id}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ acl_Ids: [byName["Read_Own"], byName["Read_All"]] });
        expect(patch.status).toBe(200);

        const response = await request(app)
            .get("/items/acl_posts")
            .set("Authorization", `Bearer ${userToken}`);
        const ids = response.body.data.map((p) => p.id);
        expect(ids).toContain(postAId);
        expect(ids).toContain(postBId);

        // Restore Read_Own only
        await request(app)
            .patch(`/permissions/${readPerm.id}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ acl_Ids: [byName["Read_Own"]] });
    });

    test("ACL edit propagates through reload without restart", async () => {
        // Create a custom status-scoped ACL and assign as the role's only read ACL
        const created = await request(app).post("/acls").set("Authorization", `Bearer ${adminToken}`).send({
            name: "Read_Published_Only",
            conditions: { status: { eq: "published" } },
            fields: ["*"],
        });
        const perms = await request(app)
            .get("/permissions")
            .query({ filter: JSON.stringify({ AND: [{ collection: { eq: "acl_posts" } }, { action: { eq: "read" } }] }) })
            .set("Authorization", `Bearer ${adminToken}`);
        const readPerm = perms.body.data[0];
        await request(app)
            .patch(`/permissions/${readPerm.id}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ acl_Ids: [created.body.id] });

        // Nothing is published yet — user sees no rows
        const before = await request(app).get("/items/acl_posts").set("Authorization", `Bearer ${userToken}`);
        expect(before.body.data.length).toBe(0);

        // Edit the ACL to match drafts instead — takes effect via route-triggered reload
        await request(app)
            .patch(`/acls/${created.body.id}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ conditions: { status: { eq: "draft" } } });

        const after = await request(app).get("/items/acl_posts").set("Authorization", `Bearer ${userToken}`);
        expect(after.body.data.length).toBeGreaterThan(0);

        // Restore Read_Own for later tests
        const acls = await request(app).get("/acls").set("Authorization", `Bearer ${adminToken}`);
        const byName = Object.fromEntries(acls.body.data.map((e) => [e.name, e.id]));
        await request(app)
            .patch(`/permissions/${readPerm.id}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ acl_Ids: [byName["Read_Own"]] });
    });

    test("Dangling ACL ids fail closed (no access)", async () => {
        await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: userRoleId,
            collection: "acl_posts",
            action: "delete",
            acl_Ids: ["00000000-0000-4000-8000-000000000000"],
        });

        const response = await request(app)
            .delete(`/items/acl_posts/${postAId}`)
            .set("Authorization", `Bearer ${userToken}`);
        expect(response.status).toBe(403);
    });
});

describe("Permission acl_Ids validation", () => {
    test("Rejects unknown acl_Ids with 400 listing them", async () => {
        const bogus = "11111111-1111-4111-8111-111111111111";
        const response = await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: userRoleId,
            collection: "acl_validation_collection",
            action: "read",
            acl_Ids: [bogus],
        });
        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toContain(bogus);
    });

    test("Rejects payloads mixing acl_Ids with inline conditions", async () => {
        const acls = await request(app).get("/acls").set("Authorization", `Bearer ${adminToken}`);
        const readAllId = acls.body.data.find((e) => e.name === "Read_All").id;

        const response = await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: userRoleId,
            collection: "acl_validation_collection",
            action: "read",
            acl_Ids: [readAllId],
            conditions: { status: { eq: "published" } },
        });
        expect(response.status).toBe(400);
    });

    test("Rejects non-array acl_Ids", async () => {
        const response = await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: userRoleId,
            collection: "acl_validation_collection",
            action: "read",
            acl_Ids: "not-an-array",
        });
        expect(response.status).toBe(400);
    });

    test("PATCH validates acl_Ids the same way", async () => {
        const created = await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: userRoleId,
            collection: "acl_validation_collection",
            action: "update",
        });
        expect(created.status).toBe(201);

        const response = await request(app)
            .patch(`/permissions/${created.body.id}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ acl_Ids: ["22222222-2222-4222-8222-222222222222"] });
        expect(response.status).toBe(400);

        await request(app).delete(`/permissions/${created.body.id}`).set("Authorization", `Bearer ${adminToken}`);
    });
});

afterAll(async () => {
    if (app.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});
