import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

let app;
let adminToken;
let userToken;
let testUserId;
let userRoleId;

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

afterAll(async () => {
    if (app.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});
