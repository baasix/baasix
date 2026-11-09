import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, test, expect, describe } from "@jest/globals";

let app;
let adminToken;
let roleId;
let permissionId;

const checkConditions = { status: { eq: "draft" } };

describe("Permissions export/import keeps checkConditions", () => {
    beforeAll(async () => {
        await destroyAllTablesInDB();
        app = await startServerForTesting();

        const login = await request(app).post("/auth/login").send({ email: "admin@baasix.com", password: "admin@123" });
        adminToken = login.body.token;

        await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                collectionName: "notes",
                schema: {
                    name: "Note",
                    fields: {
                        id: { type: "Integer", primaryKey: true, defaultValue: { type: "AUTOINCREMENT" } },
                        status: { type: "String" },
                    },
                },
            });

        const role = await request(app)
            .post("/items/baasix_Role")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ name: "editor-export-test", description: "test" });
        roleId = role.body.data.id;

        const perm = await request(app)
            .post("/permissions")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ role_Id: roleId, collection: "notes", action: "create", fields: "*", checkConditions });
        expect(perm.status).toBeLessThan(300);
        permissionId = perm.body.data?.id ?? perm.body.id;
    });

    const readPermission = async () =>
        (await request(app).get(`/permissions/${permissionId}`).set("Authorization", `Bearer ${adminToken}`)).body.data;

    test("export includes checkConditions and import restores it", async () => {
        const exported = await request(app).get("/permissions-export").set("Authorization", `Bearer ${adminToken}`);
        expect(exported.status).toBe(200);
        const exportData = exported.body;
        const exportedPerm = exportData.roles
            .find((r) => r.name === "editor-export-test")
            .permissions.find((p) => p.collection === "notes");
        expect(exportedPerm.checkConditions).toEqual(checkConditions);

        await request(app)
            .patch(`/permissions/${permissionId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ checkConditions: { status: { eq: "other" } } });

        const file = Buffer.from(JSON.stringify(exportData));
        const preview = await request(app)
            .post("/permissions-preview-import")
            .set("Authorization", `Bearer ${adminToken}`)
            .attach("rolesPermissions", file, { filename: "perms.json", contentType: "application/json" });
        expect(preview.status).toBe(200);
        expect(preview.body.changes.modified.map((m) => m.name)).toContain("editor-export-test");

        const imported = await request(app)
            .post("/permissions-import")
            .set("Authorization", `Bearer ${adminToken}`)
            .attach("rolesPermissions", file, { filename: "perms.json", contentType: "application/json" });
        expect(imported.status).toBe(200);

        expect((await readPermission()).checkConditions).toEqual(checkConditions);
    });
});
