import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

/**
 * Test for relational field permission filtering
 * 
 * This tests the fix for the issue where O2M relation permission fields were not being enforced.
 * For example, if a role has permission to access only "members.id" and "members.fullName",
 * but requests "members.*", they should only get the allowed fields, not all fields.
 */

let app;
let adminToken;
let testUserToken;
let testRoleId;
let testUserId;
let teamId;
let memberId;

beforeAll(async () => {
    await destroyAllTablesInDB();
    app = await startServerForTesting();

    // Login as admin
    const adminLoginResponse = await request(app)
        .post("/auth/login")
        .send({ email: "admin@baasix.com", password: "admin@123" });
    adminToken = adminLoginResponse.body.token;

    // Create test schema - team collection
    const teamSchemaResponse = await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "test_team",
            schema: {
                name: "TestTeam",
                fields: {
                    id: { type: "Integer", primaryKey: true, defaultValue: { type: "AUTOINCREMENT" } },
                    name: { type: "String", allowNull: false }
                }
            }
        });
    expect(teamSchemaResponse.status).toBe(201);

    // Create M2O relationship from baasix_User to test_team (which creates O2M alias)
    const relationResponse = await request(app)
        .post("/schemas/baasix_User/relationships")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            name: "team",
            type: "M2O",
            target: "test_team",
            alias: "members"  // This creates O2M access from test_team.members
        });
    expect(relationResponse.status).toBe(201);

    // Create a test role with limited relational field access
    const testRoleResponse = await request(app)
        .post("/items/baasix_Role")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "limited_team_viewer", description: "Can only see specific team member fields" });
    testRoleId = testRoleResponse.body.data?.id;

    // Create a test user for the limited role
    const createTestUserResponse = await request(app)
        .post("/items/baasix_User")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            firstName: "Limited",
            lastName: "Viewer",
            email: "limited@test.com",
            password: "password123",
        });
    testUserId = createTestUserResponse.body.data.id;

    // Assign the limited role to test user
    await request(app)
        .post("/items/baasix_UserRole")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            user_Id: testUserId,
            role_Id: testRoleId,
        });

    // Create a team
    const teamResponse = await request(app)
        .post("/items/test_team")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Test Team" });
    expect(teamResponse.status).toBe(201);
    teamId = teamResponse.body.data.id;

    // Create a member user associated with the team
    const memberResponse = await request(app)
        .post("/items/baasix_User")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            firstName: "John",
            lastName: "Member",
            email: "member@test.com",
            password: "password123",
            team_id: teamId
        });
    memberId = memberResponse.body.data.id;

    // Create another member
    await request(app)
        .post("/items/baasix_User")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            firstName: "Jane",
            lastName: "Member",
            email: "member2@test.com",
            password: "password123",
            team_id: teamId
        });

    // Create permission for the test role:
    // - Can read test_team with only specific member fields: members.id and members.firstName
    const permResponse = await request(app)
        .post("/permissions")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            role_Id: testRoleId,
            collection: "test_team",
            action: "read",
            fields: ["id", "name", "members.id", "members.firstName"],  // Only these relational fields allowed
        });

    // Login as test user
    const testUserLoginResponse = await request(app)
        .post("/auth/login")
        .send({ email: "limited@test.com", password: "password123" });
    testUserToken = testUserLoginResponse.body.token;
}, 60000);

describe("Relational Field Permission Filtering", () => {

    test("Should return only allowed relational fields when requesting wildcard (members.*)", async () => {
        // Request team with members.* - should only get members.id and members.firstName
        const response = await request(app)
            .get(`/items/test_team/${teamId}`)
            .set("Authorization", `Bearer ${testUserToken}`)
            .query({
                fields: JSON.stringify(["id", "name", "members.*"])
            });

        expect(response.status).toBe(200);
        expect(response.body.data).toBeDefined();

        const team = response.body.data;
        expect(team.members).toBeDefined();
        expect(Array.isArray(team.members)).toBe(true);
        expect(team.members.length).toBe(2);

        // Check that only allowed fields are present
        for (const member of team.members) {
            expect(member.id).toBeDefined();
            expect(member.firstName).toBeDefined();
            
            // These fields should NOT be present (not in allowed fields)
            expect(member.lastName).toBeUndefined();
            expect(member.email).toBeUndefined();
            expect(member.password).toBeUndefined();
        }
    });

    test("Should return only specifically requested allowed fields", async () => {
        // Request only members.firstName - should work since it's allowed
        const response = await request(app)
            .get(`/items/test_team/${teamId}`)
            .set("Authorization", `Bearer ${testUserToken}`)
            .query({
                fields: JSON.stringify(["id", "name", "members.firstName"])
            });

        expect(response.status).toBe(200);
        expect(response.body.data).toBeDefined();

        const team = response.body.data;
        expect(team.members).toBeDefined();
        
        for (const member of team.members) {
            expect(member.id).toBeDefined();  // id is always included for relations
            expect(member.firstName).toBeDefined();
            expect(member.lastName).toBeUndefined();
            expect(member.email).toBeUndefined();
        }
    });

    test("Admin should get all fields when requesting wildcard", async () => {
        // Admin should get all fields
        const response = await request(app)
            .get(`/items/test_team/${teamId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                fields: JSON.stringify(["id", "name", "members.*"])
            });

        expect(response.status).toBe(200);
        expect(response.body.data).toBeDefined();

        const team = response.body.data;
        expect(team.members).toBeDefined();
        
        for (const member of team.members) {
            expect(member.id).toBeDefined();
            expect(member.firstName).toBeDefined();
            expect(member.lastName).toBeDefined();  // Admin should see all fields
            expect(member.email).toBeDefined();     // Admin should see all fields
        }
    });

    test("Should filter nested relation fields with permission restriction", async () => {
        // This tests that the filtering works for list queries too
        const response = await request(app)
            .get("/items/test_team")
            .set("Authorization", `Bearer ${testUserToken}`)
            .query({
                fields: JSON.stringify(["id", "name", "members.*"])
            });

        expect(response.status).toBe(200);
        expect(response.body.data).toBeDefined();
        expect(Array.isArray(response.body.data)).toBe(true);

        for (const team of response.body.data) {
            if (team.members && team.members.length > 0) {
                for (const member of team.members) {
                    expect(member.id).toBeDefined();
                    expect(member.firstName).toBeDefined();
                    
                    // These should NOT be present
                    expect(member.lastName).toBeUndefined();
                    expect(member.email).toBeUndefined();
                }
            }
        }
    });
});

afterAll(async () => {
    // Clean up
    if (app && app.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});
