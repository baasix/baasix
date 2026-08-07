import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

/**
 * A schema that declares a BelongsTo relation WITHOUT separately declaring the
 * FK column as a typed field ("Style B") used to get the FK column in DDL but
 * NOT on the runtime Drizzle table object — inserts silently dropped the FK
 * value and relation-path filters generated broken SQL. The definition is now
 * normalized (FK injected as an explicit SystemGenerated field) and the
 * Drizzle builder adds missing BelongsTo FK columns as a safety net.
 *
 * The dedicated relationships route (used by the app UI and MCP) always
 * declared FKs explicitly — the control test proves it keeps working with no
 * duplicate fields.
 */

let app;
let adminToken;
let projectId;

beforeAll(async () => {
    await destroyAllTablesInDB();
    app = await startServerForTesting();

    const login = await request(app)
        .post("/auth/login")
        .send({ email: "admin@baasix.com", password: "admin@123" });
    adminToken = login.body.token;

    await request(app).post("/schemas").set("Authorization", `Bearer ${adminToken}`).send({
        collectionName: "projects_fk",
        schema: {
            name: "ProjectFK",
            fields: {
                id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                name: { type: "String", allowNull: false },
            },
        },
    });

    // Style B: relation only, FK column NOT declared
    await request(app).post("/schemas").set("Authorization", `Bearer ${adminToken}`).send({
        collectionName: "tickets_fk",
        schema: {
            name: "TicketFK",
            fields: {
                id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                title: { type: "String", allowNull: false },
                project: {
                    relType: "BelongsTo",
                    target: "projects_fk",
                    foreignKey: "project_Id",
                    as: "project",
                },
            },
        },
    });

    const p = await request(app)
        .post("/items/projects_fk")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Apollo" });
    projectId = p.body.data.id;
});

afterAll(async () => {
    if (app?.server) await new Promise((r) => app.server.close(r));
});

describe("relation-only (Style B) definitions are normalized and functional", () => {
    test("stored definition gains the FK as an explicit typed field", async () => {
        const res = await request(app)
            .get("/schemas/tickets_fk")
            .set("Authorization", `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        const fields = res.body.data.schema.fields;
        expect(fields.project_Id).toBeDefined();
        expect(fields.project_Id.type).toBe("UUID");
    });

    test("insert persists the FK value (previously silently dropped)", async () => {
        const created = await request(app)
            .post("/items/tickets_fk")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ title: "FK survives", project_Id: projectId });
        expect(created.status).toBe(201);

        const read = await request(app)
            .get(`/items/tickets_fk/${created.body.data.id}`)
            .set("Authorization", `Bearer ${adminToken}`);
        expect(read.body.data.project_Id).toBe(projectId);
    });

    test("relation-path filter works (previously broken SQL)", async () => {
        const res = await request(app)
            .get("/items/tickets_fk")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ filter: JSON.stringify({ "$project.name$": { eq: "Apollo" } }) });

        expect(res.status).toBe(200);
        expect(res.body.data.length).toBe(1);
        expect(res.body.data[0].title).toBe("FK survives");
    });

    test("a fields:['*'] grant covers the injected FK column", async () => {
        const roleRes = await request(app)
            .post("/items/baasix_Role")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ name: "fkrole", description: "fk role" });
        const u = await request(app)
            .post("/items/baasix_User")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ firstName: "FK", lastName: "User", email: "fk@test.com", password: "password1" });
        await request(app)
            .post("/items/baasix_UserRole")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ user_Id: u.body.data.id, role_Id: roleRes.body.data.id });
        await request(app)
            .post("/permissions")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ role_Id: roleRes.body.data.id, collection: "tickets_fk", action: "create", fields: ["*"] });
        await request(app).post("/permissions/reload").set("Authorization", `Bearer ${adminToken}`);

        const loginU = await request(app)
            .post("/auth/login")
            .send({ email: "fk@test.com", password: "password1" });

        const res = await request(app)
            .post("/items/tickets_fk")
            .set("Authorization", `Bearer ${loginU.body.token}`)
            .send({ title: "via star grant", project_Id: projectId });

        expect(res.status).toBe(201);
    });
});

describe("control: relationships route (UI/MCP path) unchanged", () => {
    test("M2O created via the relationships route works and has no duplicate FK field", async () => {
        await request(app).post("/schemas").set("Authorization", `Bearer ${adminToken}`).send({
            collectionName: "rel_src_fk",
            schema: {
                name: "RelSrcFK",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    label: { type: "String" },
                },
            },
        });

        const rel = await request(app)
            .post("/schemas/rel_src_fk/relationships")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ type: "M2O", name: "project", target: "projects_fk", foreignKey: "project_Id" });
        expect(rel.status).toBe(201);

        const def = await request(app)
            .get("/schemas/rel_src_fk")
            .set("Authorization", `Bearer ${adminToken}`);
        const fields = def.body.data.schema.fields;
        expect(fields.project_Id).toBeDefined();
        expect(fields.project.relType).toBe("BelongsTo");
        // exactly one FK field, one relation field — no duplicates from normalization
        const fkKeys = Object.keys(fields).filter((k) => k === "project_Id");
        expect(fkKeys.length).toBe(1);

        const created = await request(app)
            .post("/items/rel_src_fk")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ label: "linked", project_Id: projectId });
        expect(created.status).toBe(201);

        const filtered = await request(app)
            .get("/items/rel_src_fk")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ filter: JSON.stringify({ "$project.name$": { eq: "Apollo" } }) });
        expect(filtered.status).toBe(200);
        expect(filtered.body.data.length).toBe(1);
    });
});
