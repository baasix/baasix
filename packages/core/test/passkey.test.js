process.env.AUTH_SERVICES_ENABLED = (process.env.AUTH_SERVICES_ENABLED || "LOCAL") + ",PASSKEY";
process.env.PASSKEY_RP_ID = "localhost";
process.env.PASSKEY_RP_NAME = "Baasix Test";
process.env.PASSKEY_ORIGIN = "http://localhost:3000";

import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

let app, token;
const email = "passkey@example.com";
const password = "password@123";

beforeAll(async () => {
    app = await startServerForTesting();
    await request(app).post("/auth/register").send({ email, password, firstName: "Pass" });
    token = (await request(app).post("/auth/login").send({ email, password })).body.token;
}, 60000);
afterAll(async () => { await destroyAllTablesInDB(); });

describe("passkey endpoints", () => {
    test("register options require auth", async () => {
        const res = await request(app).post("/auth/passkey/register/options").send({});
        expect(res.status).toBe(401);
    });

    test("register options return WebAuthn creation options", async () => {
        const res = await request(app).post("/auth/passkey/register/options")
            .set("Authorization", `Bearer ${token}`).send({});
        expect(res.status).toBe(200);
        expect(res.body.challenge).toBeTruthy();
        expect(res.body.rp.id).toBe("localhost");
        expect(res.body.user.name).toBe(email);
    });

    test("authenticate options are public and include a challengeId", async () => {
        const res = await request(app).post("/auth/passkey/authenticate/options").send({});
        expect(res.status).toBe(200);
        expect(res.body.options.challenge).toBeTruthy();
        expect(res.body.challengeId).toBeTruthy();
    });

    test("authenticate verify with a bogus response fails cleanly with a generic message", async () => {
        const opts = await request(app).post("/auth/passkey/authenticate/options").send({});
        const res = await request(app).post("/auth/passkey/authenticate/verify")
            .send({ challengeId: opts.body.challengeId, response: { id: "bogus", rawId: "bogus", type: "public-key", response: {} } });
        expect(res.status).toBe(401);
        expect(res.body.code).toBe("INVALID_PASSKEY_RESPONSE");
        expect(res.body.message).toBe("Passkey authentication failed");
    });

    test("authenticate verify with an unknown/expired challengeId yields the same generic 401 body (no credential-existence oracle)", async () => {
        const res = await request(app).post("/auth/passkey/authenticate/verify")
            .send({ challengeId: "does-not-exist", response: { id: "bogus", rawId: "bogus", type: "public-key", response: {} } });
        expect(res.status).toBe(401);
        expect(res.body).toEqual({ message: "Passkey authentication failed", code: "INVALID_PASSKEY_RESPONSE" });

        // Same body shape as the bogus-response-with-valid-challenge case above —
        // proves an attacker can't distinguish "bad challenge" from "unknown
        // credential" from the response alone.
        const opts = await request(app).post("/auth/passkey/authenticate/options").send({});
        const res2 = await request(app).post("/auth/passkey/authenticate/verify")
            .send({ challengeId: opts.body.challengeId, response: { id: "bogus", rawId: "bogus", type: "public-key", response: {} } });
        expect(res2.body).toEqual(res.body);
    });

    test("list is empty and delete of unknown id 404s", async () => {
        const list = await request(app).get("/auth/passkey").set("Authorization", `Bearer ${token}`);
        expect(list.status).toBe(200);
        expect(list.body.passkeys).toEqual([]);
        const del = await request(app).delete("/auth/passkey/00000000-0000-0000-0000-000000000000")
            .set("Authorization", `Bearer ${token}`);
        expect(del.status).toBe(404);
    });
});
