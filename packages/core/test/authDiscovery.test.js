import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

let app;
beforeAll(async () => {
    // .env.test enables LOCAL + google/github/facebook/apple, but under the
    // *_AUTH_CLIENT_ID naming — the app reads *_CLIENT_ID (see
    // test/oauth.test.js and test/oauthBrowserFlow.test.js for the same
    // pattern). Set the names the route actually reads before the server
    // boots, so all four social providers are registered.
    process.env.AUTH_SERVICES_ENABLED = "LOCAL,GOOGLE,GITHUB,FACEBOOK,APPLE";
    process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
    process.env.GITHUB_CLIENT_ID = "test-github-client-id";
    process.env.GITHUB_CLIENT_SECRET = "test-github-client-secret";
    process.env.FACEBOOK_CLIENT_ID = "test-facebook-client-id";
    process.env.FACEBOOK_CLIENT_SECRET = "test-facebook-client-secret";
    process.env.APPLE_CLIENT_ID = "test-apple-client-id";
    process.env.APPLE_CLIENT_SECRET = "test-apple-client-secret";
    process.env.APPLE_TEAM_ID = "test-apple-team-id";
    process.env.APPLE_KEY_ID = "test-apple-key-id";

    app = await startServerForTesting();
}, 60000);
afterAll(async () => { await destroyAllTablesInDB(); });

describe("auth discovery on GET /", () => {
    test("project info includes the auth block", async () => {
        const res = await request(app).get("/");
        expect(res.status).toBe(200);
        const auth = res.body.project.auth;
        expect(auth).toBeDefined();
        expect(typeof auth.registration).toBe("boolean");
        expect(typeof auth.emailPassword).toBe("boolean");
        expect(Array.isArray(auth.socialProviders)).toBe(true);
        // .env.test enables LOCAL + google/github/facebook/apple with creds
        expect(auth.emailPassword).toBe(true);
        expect(auth.socialProviders).toContain("google");
        // never leak secrets
        expect(JSON.stringify(res.body)).not.toContain(process.env.GOOGLE_CLIENT_SECRET);
    });
});
