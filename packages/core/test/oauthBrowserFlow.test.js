import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

let app;
beforeAll(async () => {
    // Match test/oauth.test.js: enable Google (and friends) for this run since
    // .env.test doesn't define GOOGLE_CLIENT_ID under the name the app reads.
    process.env.AUTH_SERVICES_ENABLED = "LOCAL,GOOGLE,GITHUB,FACEBOOK,APPLE";
    process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";

    app = await startServerForTesting();
}, 60000);
afterAll(async () => { await destroyAllTablesInDB(); });

describe("browser OAuth flow", () => {
    test("GET /auth/signin/:provider redirects to the provider", async () => {
        const res = await request(app)
            .get("/auth/signin/google")
            .query({ redirect_url: process.env.AUTH_APP_URL?.split(",")[0] || "http://localhost:3000" });
        expect(res.status).toBe(302);
        expect(res.headers.location).toContain("accounts.google.com");
        expect(res.headers.location).toContain("client_id=");
        expect(res.headers.location).toContain("state=");
    });

    test("GET /auth/signin rejects a redirect_url not in the allow-list", async () => {
        const res = await request(app)
            .get("/auth/signin/google")
            .query({ redirect_url: "https://evil.example.com/cb" });
        expect(res.status).toBe(400);
    });

    test("unknown provider yields 400", async () => {
        const res = await request(app)
            .get("/auth/signin/doesnotexist")
            .query({ redirect_url: process.env.AUTH_APP_URL?.split(",")[0] || "http://localhost:3000" });
        expect(res.status).toBe(400);
    });
});
