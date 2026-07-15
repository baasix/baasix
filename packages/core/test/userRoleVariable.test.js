import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, test, expect, describe } from "@jest/globals";

let app;
let adminToken;
let userToken; // legacy-style token: no pinned assignment
let testUserId;
let roleId;
let teamAlphaId;
let teamBetaId;
let assignmentA; // oldest assignment -> Team Alpha
let assignmentB; // second assignment -> Team Beta

const admin = () => ({ Authorization: `Bearer ${adminToken}` });

beforeAll(async () => {
    await destroyAllTablesInDB();
    app = await startServerForTesting();

    const adminLogin = await request(app).post("/auth/login").send({
        email: "admin@baasix.com",
        password: "admin@123",
    });
    adminToken = adminLogin.body.token;

    const reg = await request(app).post("/auth/register").send({
        firstName: "Team",
        lastName: "User",
        email: "teamuser@test.com",
        password: "userpassword",
    });
    testUserId = reg.body.user.id;
    roleId = reg.body.role.id;

    // Teams collection
    await request(app).post("/schemas").set(admin()).send({
        collectionName: "teams",
        schema: {
            name: "Team",
            fields: {
                id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                name: { type: "String", allowNull: false },
            },
        },
    });

    // M2O on the JOIN TABLE: adds a FK + `team` BelongsTo alias to baasix_UserRole.
    // NOTE (test-setup deviation): POST /schemas/:collection/relationships derives
    // the FK column name as `${name}_id` (all-lowercase suffix) when `foreignKey`
    // is omitted -- unlike the `_Id` (capital I) convention used for columns
    // declared inline in a collection schema (e.g. baasix_UserRole's own role_Id/
    // user_Id/tenant_Id). So the physical column this call creates is `team_id`,
    // not `team_Id`. This matches existing fixtures elsewhere (e.g.
    // test/casting.test.js's `department_id`). All references to the
    // baasix_UserRole FK below use `team_id` to match; `tasks.team_Id` is our own
    // explicitly-declared schema field and is unaffected.
    await request(app).post("/schemas/baasix_UserRole/relationships").set(admin()).send({
        type: "M2O",
        target: "teams",
        name: "team",
        alias: "memberships",
    });

    // Item create responses are 201 with { data: { id } }
    const alpha = await request(app).post("/items/teams").set(admin()).send({ name: "Team Alpha" });
    teamAlphaId = alpha.body.data.id;
    const beta = await request(app).post("/items/teams").set(admin()).send({ name: "Team Beta" });
    teamBetaId = beta.body.data.id;

    // Assignment A = the user's existing (oldest) row, pointed at Team Alpha.
    // Register may or may not have created one — handle both.
    const existing = await request(app)
        .get("/items/baasix_UserRole")
        .query({ filter: JSON.stringify({ user_Id: { eq: testUserId } }) })
        .set(admin());
    if (existing.body.data?.length > 0) {
        assignmentA = existing.body.data[0].id;
        await request(app)
            .patch(`/items/baasix_UserRole/${assignmentA}`)
            .set(admin())
            .send({ team_id: teamAlphaId });
    } else {
        const created = await request(app).post("/items/baasix_UserRole").set(admin()).send({
            user_Id: testUserId,
            role_Id: roleId,
            team_id: teamAlphaId,
        });
        assignmentA = created.body.data.id;
    }

    // Assignment B = same user, SAME role, different team
    const createdB = await request(app).post("/items/baasix_UserRole").set(admin()).send({
        user_Id: testUserId,
        role_Id: roleId,
        team_id: teamBetaId,
    });
    assignmentB = createdB.body.data.id;

    // Tasks collection
    await request(app).post("/schemas").set(admin()).send({
        collectionName: "tasks",
        schema: {
            name: "Task",
            fields: {
                id: { type: "Integer", primaryKey: true, defaultValue: { type: "AUTOINCREMENT" } },
                title: { type: "String", allowNull: false },
                team_Id: { type: "UUID", allowNull: true },
                teamName: { type: "String", allowNull: true },
            },
        },
    });

    // Permissions on tasks for the test user's role:
    // create -> defaultValues stamp team from the ACTIVE ASSIGNMENT (flat + relational)
    await request(app).post("/permissions").set(admin()).send({
        role_Id: roleId,
        collection: "tasks",
        action: "create",
        fields: "*",
        defaultValues: {
            team_Id: "$CURRENT_USERROLE.team_id",
            teamName: "$CURRENT_USERROLE.team.name",
        },
    });
    // read -> team-scoped
    await request(app).post("/permissions").set(admin()).send({
        role_Id: roleId,
        collection: "tasks",
        action: "read",
        fields: "*",
        conditions: { team_Id: { eq: "$CURRENT_USERROLE.team_id" } },
    });

    const login = await request(app).post("/auth/login").send({
        email: "teamuser@test.com",
        password: "userpassword",
    });
    userToken = login.body.token;
});

describe("$CURRENT_USERROLE resolution (unpinned token -> oldest assignment)", () => {
    test("defaultValues stamps flat custom field team_Id from active assignment", async () => {
        const res = await request(app)
            .post("/items/tasks")
            .set("Authorization", `Bearer ${userToken}`)
            .send({ title: "Alpha task 1" });
        expect(res.status).toBe(201);

        const created = await request(app)
            .get(`/items/tasks/${res.body.data.id}`)
            .set(admin());
        expect(created.body.data.team_Id).toBe(teamAlphaId);
    });

    test("defaultValues resolves relational path team.name", async () => {
        const res = await request(app)
            .post("/items/tasks")
            .set("Authorization", `Bearer ${userToken}`)
            .send({ title: "Alpha task 2" });
        expect(res.status).toBe(201);

        const created = await request(app)
            .get(`/items/tasks/${res.body.data.id}`)
            .set(admin());
        expect(created.body.data.teamName).toBe("Team Alpha");
    });

    test("read condition team-scopes the list", async () => {
        // seed one task per team as admin (admin bypasses defaultValues stamping)
        await request(app).post("/items/tasks").set(admin()).send({ title: "admin alpha", team_Id: teamAlphaId });
        await request(app).post("/items/tasks").set(admin()).send({ title: "admin beta", team_Id: teamBetaId });

        const list = await request(app)
            .get("/items/tasks")
            .set("Authorization", `Bearer ${userToken}`);
        expect(list.status).toBe(200);
        const teamIds = [...new Set(list.body.data.map((t) => t.team_Id))];
        expect(teamIds).toEqual([teamAlphaId]);
    });
});
