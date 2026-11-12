import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { test, expect, describe, beforeAll } from "@jest/globals";
import { db } from "../baasix/utils/db.js";
import { sql } from "drizzle-orm";

let app;

const liveWebSessions = async () =>
    (await db.execute(sql`SELECT count(*)::int AS c FROM "baasix_Sessions" WHERE type = 'web' AND "expiresAt" > now()`))[0].c;

describe("Refresh with a shared cookie", () => {
    beforeAll(async () => {
        await destroyAllTablesInDB();
        app = await startServerForTesting();
        await request(app)
            .post("/auth/register")
            .send({ firstName: "A", lastName: "B", email: "race@test.com", password: "password123" });
    });

    // Several tabs share one cookie and refresh at once. Rotating the session made
    // all but one fail (logout) and leaked orphan sessions that hit session limits.
    test("parallel refreshes all succeed and keep a single session", async () => {
        const login = await request(app)
            .post("/auth/login")
            .send({ email: "race@test.com", password: "password123", authMode: "cookie", authType: "web" });
        const cookie = login.headers["set-cookie"][0].split(";")[0];
        const before = await liveWebSessions();

        const refreshes = await Promise.all(
            [1, 2, 3].map(() => request(app).post("/auth/refresh").set("Cookie", cookie).send({ authMode: "cookie" }))
        );

        expect(refreshes.map((r) => r.status)).toEqual([200, 200, 200]);
        expect(await liveWebSessions()).toBe(before);

        // A request still in flight with the old cookie keeps working
        const me = await request(app).get("/auth/me").set("Cookie", cookie);
        expect(me.status).toBe(200);
    });

    test("logout still ends the session after a refresh", async () => {
        const login = await request(app)
            .post("/auth/login")
            .send({ email: "race@test.com", password: "password123", authMode: "cookie", authType: "web" });
        const cookie = login.headers["set-cookie"][0].split(";")[0];
        const refreshed = await request(app).post("/auth/refresh").set("Cookie", cookie).send({ authMode: "cookie" });
        const newCookie = refreshed.headers["set-cookie"][0].split(";")[0];

        await request(app).get("/auth/logout").set("Cookie", newCookie);
        expect((await request(app).get("/auth/me").set("Cookie", cookie)).status).toBe(401);
    });
});
