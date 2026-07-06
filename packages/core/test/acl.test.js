import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

let app;
let adminToken;

beforeAll(async () => {
    await destroyAllTablesInDB();
    app = await startServerForTesting();

    const adminLoginResponse = await request(app)
        .post("/auth/login")
        .send({ email: "admin@baasix.com", password: "admin@123" });
    adminToken = adminLoginResponse.body.token;
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

afterAll(async () => {
    if (app.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});
