import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

let app;
beforeAll(async () => {
    app = await startServerForTesting();
}, 60000);
afterAll(async () => { await destroyAllTablesInDB(); });

const adminLogin = () =>
    request(app).post("/auth/login").send({ email: "admin@baasix.com", password: "admin@123" });

describe("Role app_access", () => {
    test("administrator role is healed to app_access=true at startup", async () => {
        const login = await adminLogin();
        expect(login.status).toBe(200);
        expect(login.body.role).toBeDefined();
        expect(login.body.role.app_access).toBe(true);
    });

    test("newly created roles default to app_access=false", async () => {
        const login = await adminLogin();
        const token = login.body.token;
        const created = await request(app)
            .post("/items/baasix_Role")
            .set("Authorization", `Bearer ${token}`)
            .send({ name: "app-access-test-role", description: "t", isTenantSpecific: false });
        expect(created.status).toBe(201);
        const id = created.body.data?.id ?? created.body.data;
        const fetched = await request(app)
            .get(`/items/baasix_Role/${id}`)
            .set("Authorization", `Bearer ${token}`);
        expect(fetched.status).toBe(200);
        expect(fetched.body.data.app_access).toBe(false);
    });
});
