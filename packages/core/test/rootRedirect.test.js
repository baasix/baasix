import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

let app;
beforeAll(async () => {
    app = await startServerForTesting();
}, 60000);
afterAll(async () => { await destroyAllTablesInDB(); });

// Real Chrome navigation Accept header — html q=1, json only via */*;q=0.8
const BROWSER_ACCEPT =
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

describe("GET / content negotiation", () => {
    test("browser visit (Accept prefers html) redirects to /admin", async () => {
        const res = await request(app).get("/").set("Accept", BROWSER_ACCEPT);
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe("/admin");
    });

    test("JSON client still gets project info", async () => {
        const res = await request(app).get("/").set("Accept", "application/json");
        expect(res.status).toBe(200);
        expect(res.body.project).toBeDefined();
    });

    test("wildcard Accept (curl default) still gets project info", async () => {
        const res = await request(app).get("/").set("Accept", "*/*");
        expect(res.status).toBe(200);
        expect(res.body.project).toBeDefined();
    });

    test("POST / is unaffected by browser Accept header", async () => {
        const res = await request(app).post("/").set("Accept", BROWSER_ACCEPT);
        expect(res.status).toBe(200);
        expect(res.body.project).toBeDefined();
    });
});
