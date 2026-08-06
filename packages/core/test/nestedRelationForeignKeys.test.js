import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

/**
 * Regression: requesting a nested relation (userRoles.role.*) together with an
 * explicit direct attribute of the junction (userRoles.sort) silently dropped
 * the nested relation. The separate HasMany load respected include.attributes
 * but only auto-added `id` and the grouping FK (user_Id) — NOT the foreign
 * keys the nested BelongsTo includes need (role_Id) — so the nested loader
 * found no FK values to match and returned role: null.
 * Worked only when "userRoles.*" happened to be requested too (all columns).
 */

let app;
let adminToken;

describe("Nested relation FKs survive explicit junction attribute selection", () => {
    beforeAll(async () => {
        await destroyAllTablesInDB();
        app = await startServerForTesting();

        const login = await request(app)
            .post("/auth/login")
            .send({ email: "admin@baasix.com", password: "admin@123" });
        adminToken = login.body.token;
    });

    afterAll(async () => {
        if (app?.server) await new Promise((r) => app.server.close(r));
    });

    test("userRoles.role.* + explicit junction attribute still returns role", async () => {
        const res = await request(app)
            .get("/items/baasix_User")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ fields: ["id", "userRoles.sort", "userRoles.role.*"] });

        expect(res.status).toBe(200);
        const withRoles = res.body.data.find((u) => u.userRoles && u.userRoles.length > 0);
        expect(withRoles).toBeDefined();
        expect(withRoles.userRoles[0].role).toBeTruthy();
        expect(withRoles.userRoles[0].role.name).toBeDefined();
    });

    test("multiple nested relations under one junction all resolve", async () => {
        // role and user are both BelongsTo on baasix_UserRole — requesting a
        // named field from one plus .* from the other must resolve both.
        const res = await request(app)
            .get("/items/baasix_User")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ fields: ["id", "userRoles.sort", "userRoles.role.*", "userRoles.user.email"] });

        expect(res.status).toBe(200);
        const withRoles = res.body.data.find((u) => u.userRoles && u.userRoles.length > 0);
        expect(withRoles.userRoles[0].role?.name).toBeDefined();
        expect(withRoles.userRoles[0].user?.email).toBeDefined();
    });

    test("control: userRoles.* + userRoles.role.* still works", async () => {
        const res = await request(app)
            .get("/items/baasix_User")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ fields: ["id", "userRoles.*", "userRoles.role.*"] });

        expect(res.status).toBe(200);
        const withRoles = res.body.data.find((u) => u.userRoles && u.userRoles.length > 0);
        expect(withRoles.userRoles[0].role?.name).toBeDefined();
    });
});
