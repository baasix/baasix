// NOTE: startServerForTesting reads env at startup — set PUBLIC_REGISTRATION
// before the import-time server start.
process.env.PUBLIC_REGISTRATION = "false";

import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

let app;
beforeAll(async () => { app = await startServerForTesting(); }, 60000);
afterAll(async () => { await destroyAllTablesInDB(); delete process.env.PUBLIC_REGISTRATION; });

describe("PUBLIC_REGISTRATION=false", () => {
    test("register without invite is rejected with REGISTRATION_DISABLED", async () => {
        const res = await request(app).post("/auth/register").send({
            email: "blocked@example.com",
            password: "password123",
            firstName: "Blocked",
        });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("REGISTRATION_DISABLED");
    });
});
