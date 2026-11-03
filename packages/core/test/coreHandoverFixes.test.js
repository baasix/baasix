process.env.AUTH_APP_URL = "http://localhost:3000";

import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting, MailService } from "../baasix";
import { buildPrefixTsQuery } from "../baasix/utils/queryBuilder.js";
import { getCache } from "../baasix/utils/cache.js";
import socketService from "../baasix/services/SocketService.js";
import { beforeAll, afterAll, beforeEach, test, expect, describe, jest } from "@jest/globals";

/**
 * Fixes from the methodder_baasix core handover (items A–M).
 */

let app;
let adminToken;
let sendMailSpy;
let roleId;

const admin = (r) => r.set("Authorization", `Bearer ${adminToken}`);

async function makeUser(email, password = "password123") {
    const res = await admin(request(app).post("/items/baasix_User"))
        .send({ firstName: "T", lastName: "U", email, password });
    const id = res.body.data.id;
    await admin(request(app).post("/items/baasix_UserRole")).send({ user_Id: id, role_Id: roleId });
    return id;
}

const setStatus = (id, status) => admin(request(app).patch(`/items/baasix_User/${id}`)).send({ status });
const login = (email, password) => request(app).post("/auth/login").send({ email, password });

function capturedCode(templateName) {
    const call = sendMailSpy.mock.calls.find(([o]) => o.templateName === templateName);
    return call ? call[0].context : null;
}

beforeAll(async () => {
    await destroyAllTablesInDB();
    app = await startServerForTesting();
    sendMailSpy = jest.spyOn(MailService, "sendMail").mockResolvedValue(undefined);
    adminToken = (await login("admin@baasix.com", "admin@123")).body.token;
    const role = await admin(request(app).post("/items/baasix_Role")).send({ name: "handover", description: "t" });
    roleId = role.body.data.id;
}, 60000);

afterAll(async () => {
    sendMailSpy.mockRestore();
    if (app?.server) await new Promise((r) => app.server.close(r));
    delete process.env.AUTH_APP_URL;
});

beforeEach(() => sendMailSpy.mockClear());

describe("C — password sign-in does not reveal account status before the password", () => {
    let id;
    beforeAll(async () => {
        id = await makeUser("c-user@test.com");
        await setStatus(id, "suspended");
    });

    test("suspended + wrong password looks exactly like an unknown email", async () => {
        const wrong = await login("c-user@test.com", "nope-nope");
        const unknown = await login("nobody-here@test.com", "nope-nope");
        expect(wrong.status).toBe(400);
        expect(unknown.status).toBe(400);
        expect(wrong.body).toEqual(unknown.body);
    });

    test("suspended + right password gets 403 Account is suspended", async () => {
        const res = await login("c-user@test.com", "password123");
        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/Account is suspended/);
    });
});

describe("A/B — email-code sign-in checks status and session type", () => {
    let id;
    beforeAll(async () => {
        id = await makeUser("a-user@test.com");
    });

    async function requestCode() {
        const res = await request(app).post("/auth/magiclink").send({ email: "a-user@test.com", mode: "code" });
        expect(res.status).toBe(200);
        return capturedCode("magicLinkCode");
    }

    test("code mail carries a 15-minute expiry by default", async () => {
        const ctx = await requestCode();
        expect(ctx.code).toBeTruthy();
        expect(ctx.expiresInMinutes).toBe(15);
    });

    test("verify with authType=web creates a web session and returns role", async () => {
        const { code } = await requestCode();
        const res = await request(app).get(`/auth/magiclink/${code}`).query({ authType: "web" });
        expect(res.status).toBe(200);
        expect(res.body.token).toBeTruthy();
        expect(res.body.role?.name).toBe("handover");
        const sessions = await admin(request(app).get("/items/baasix_Sessions"))
            .query({ filter: JSON.stringify({ user_Id: { eq: id } }), sort: JSON.stringify({ createdAt: "desc" }), limit: 1 });
        expect(sessions.body.data[0].type).toBe("web");
    });

    test("a user suspended after the code was issued gets 403, not a session", async () => {
        const { code } = await requestCode();
        await setStatus(id, "suspended");
        const res = await request(app).get(`/auth/magiclink/${code}`);
        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/Account is suspended/);
        await setStatus(id, "active");
    });

    test("no code is created or mailed for a non-active account, same generic reply", async () => {
        await setStatus(id, "inactive");
        const res = await request(app).post("/auth/magiclink").send({ email: "a-user@test.com", mode: "code" });
        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/if an account exists/i);
        expect(sendMailSpy).not.toHaveBeenCalled();
        await setStatus(id, "active");
    });
});

describe("D/E — sessions of suspended users stop working; invalid tokens get 401", () => {
    test("suspending a user revokes their existing token", async () => {
        const id = await makeUser("d-user@test.com");
        const token = (await login("d-user@test.com", "password123")).body.token;
        expect((await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`)).status).toBe(200);

        await setStatus(id, "suspended");

        expect((await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`)).status).toBe(401);
        expect((await request(app).get("/items/baasix_Role").set("Authorization", `Bearer ${token}`)).status).toBe(401);
    });

    test("a revoked token on a non-public collection gives 401, no token gives 403", async () => {
        await makeUser("e-user@test.com");
        const token = (await login("e-user@test.com", "password123")).body.token;
        await request(app).get("/auth/logout").set("Authorization", `Bearer ${token}`);

        const stale = await request(app).get("/items/baasix_Role").set("Authorization", `Bearer ${token}`);
        expect(stale.status).toBe(401);
        expect(stale.body.error.code).toBe("INVALID_SESSION");

        const anon = await request(app).get("/items/baasix_Role");
        expect(anon.status).toBe(403);
    });

    test("an assignment pointing at a deleted role gives 401 (not 503) and self-heals", async () => {
        const id = await makeUser("orphan-user@test.com");
        const token = (await login("orphan-user@test.com", "password123")).body.token;
        const me = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);
        expect(me.status).toBe(200);

        // Simulate a stale userrole cache entry whose role no longer exists
        await getCache().set(`auth:userrole:${id}:global`, {
            ...me.body.userRole,
            role_Id: "00000000-0000-0000-0000-000000000000",
        });

        const res = await request(app).get("/items/baasix_Role").set("Authorization", `Bearer ${token}`);
        expect(res.status).toBe(401);

        // The stale entry was evicted, so the next request re-reads the real assignment
        expect((await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`)).status).toBe(200);
    });

    test("realtime socket handshake refuses a logged-out token", async () => {
        await makeUser("sock-user@test.com");
        const token = (await login("sock-user@test.com", "password123")).body.token;
        const handshake = (t) => new Promise((resolve) => {
            const socket = { handshake: { auth: { token: t }, query: {} } };
            socketService.authMiddleware(socket, (err) => resolve({ err, socket }));
        });

        const ok = await handshake(token);
        expect(ok.err).toBeUndefined();
        expect(ok.socket.userId).toBeTruthy();

        await request(app).get("/auth/logout").set("Authorization", `Bearer ${token}`);
        const stale = await handshake(token);
        expect(stale.err?.message).toMatch(/Session expired or invalid/);
    });

    test("parallel requests on an expired session get 401, never 503", async () => {
        const id = await makeUser("race-user@test.com");
        const token = (await login("race-user@test.com", "password123")).body.token;
        const sessions = await admin(request(app).get("/items/baasix_Sessions"))
            .query({ filter: JSON.stringify({ user_Id: { eq: id } }) });
        await admin(request(app).patch(`/items/baasix_Sessions/${sessions.body.data[0].id}`))
            .send({ expiresAt: new Date(Date.now() - 60000).toISOString() });

        const results = await Promise.all(Array.from({ length: 6 }, () =>
            request(app).get("/items/baasix_Role").set("Authorization", `Bearer ${token}`)));
        expect(results.map((r) => r.status)).toEqual(Array(6).fill(401));
    });

    test("a stale token still lets the user log in again", async () => {
        const res = await request(app).post("/auth/login")
            .set("Authorization", "Bearer garbage.token.value")
            .send({ email: "e-user@test.com", password: "password123" });
        expect(res.status).toBe(200);
    });
});

describe("F(c) — a too-short password does not burn the reset code", () => {
    test("retry with a valid password succeeds", async () => {
        await makeUser("f-user@test.com");
        await request(app).post("/auth/password/reset").send({ email: "f-user@test.com", mode: "code" });
        const { code } = capturedCode("passwordResetCode");

        const short = await request(app).post(`/auth/password/reset/${code}`).send({ password: "short" });
        expect(short.status).toBe(400);
        expect(short.body.message).toMatch(/at least/);

        const ok = await request(app).post(`/auth/password/reset/${code}`).send({ password: "LongEnough123" });
        expect(ok.status).toBe(200);
        expect((await login("f-user@test.com", "LongEnough123")).status).toBe(200);
    });
});

describe("H — audit log never stores password hashes or lastAccess-only updates", () => {
    test("user update audit rows have no password; sign-in writes no lastAccess-only row", async () => {
        const id = await makeUser("h-user@test.com");
        // Audit rows are inserted without read-cache invalidation, so vary the
        // query (limit) to avoid getting a cached earlier result back.
        let reads = 0;
        const auditRows = async () => (await admin(request(app).get("/items/baasix_AuditLog"))
            .query({ filter: JSON.stringify({ entity: { eq: "baasix_User" }, entityId: { eq: id }, action: { eq: "update" } }), limit: 1000 + reads++ }))
            .body.data;

        const before = (await auditRows()).length;
        await login("h-user@test.com", "password123");
        await new Promise((r) => setTimeout(r, 200)); // audit writes for updateMany are fire-and-forget
        expect((await auditRows()).length).toBe(before);

        await admin(request(app).patch(`/items/baasix_User/${id}`)).send({ firstName: "Changed" });
        await new Promise((r) => setTimeout(r, 200));
        const rows = await auditRows();
        expect(rows.length).toBe(before + 1);
        for (const row of rows) {
            expect(row.changes.before).not.toHaveProperty("password");
            expect(row.changes.after).not.toHaveProperty("password");
        }
        expect(rows.some((r) => r.changes.after.firstName === "Changed")).toBe(true);

        // A password change is still audited, with the value redacted
        await admin(request(app).patch(`/items/baasix_User/${id}`)).send({ password: "another-pass-1" });
        await new Promise((r) => setTimeout(r, 200));
        const afterPw = await auditRows();
        expect(afterPw.length).toBe(before + 2);
        const pwRow = afterPw.find((r) => r.changes.after.password !== undefined);
        expect(pwRow?.changes.after.password).toBe("[REDACTED]");
        expect(JSON.stringify(afterPw)).not.toMatch(/\$argon2/);
    });
});

describe("J — search text is never parsed as tsquery syntax", () => {
    test("buildPrefixTsQuery quotes every word", () => {
        expect(buildPrefixTsQuery("Anatomy & Physiology")).toBe("'Anatomy':* & '&':* & 'Physiology':*");
        expect(buildPrefixTsQuery("O'Brien")).toBe("'O''Brien':*");
        expect(buildPrefixTsQuery("a\\b")).toBe("'a\\\\b':*");
    });

    test.each(["Anatomy & Physiology", "(x", "a:b", "foo!", "a<b", "'abc", "x |", "x-ray 12/3"])(
        "search=%s returns 200",
        async (q) => {
            const res = await admin(request(app).get("/items/baasix_Role")).query({ search: q });
            expect(res.status).toBe(200);
        }
    );

    test("prefix matching still works", async () => {
        const res = await admin(request(app).get("/items/baasix_Role")).query({ search: "hando" });
        expect(res.status).toBe(200);
        expect(res.body.data.some((r) => r.name === "handover")).toBe(true);
    });
});

describe("I/L — relation sort on the filter-join path; usertrack onDelete kept", () => {
    beforeAll(async () => {
        await admin(request(app).post("/schemas")).send({
            collectionName: "ho_authors",
            schema: { name: "ho_authors", fields: {
                id: { type: "Integer", primaryKey: true, defaultValue: { type: "AUTOINCREMENT" } },
                name: { type: "String", allowNull: false },
                status: { type: "String", allowNull: true },
            } },
        });
        await admin(request(app).post("/schemas")).send({
            collectionName: "ho_posts",
            schema: { name: "ho_posts", usertrack: true, fields: {
                id: { type: "Integer", primaryKey: true, defaultValue: { type: "AUTOINCREMENT" } },
                title: { type: "String", allowNull: false },
                author_id: { type: "Integer", allowNull: true },
                author: { relType: "BelongsTo", target: "ho_authors", foreignKey: "author_id", as: "author" },
            } },
        });
        for (const [name, title] of [["Charlie", "p1"], ["Alice", "p2"], ["Bob", "p3"]]) {
            const a = await admin(request(app).post("/items/ho_authors")).send({ name, status: "active" });
            await admin(request(app).post("/items/ho_posts")).send({ title, author_id: a.body.data.id });
        }
    }, 60000);

    test("dotted sort is applied when a relation filter forces the join path", async () => {
        const read = (sort) => admin(request(app).get("/items/ho_posts")).query({
            filter: JSON.stringify({ "author.status": { eq: "active" } }),
            fields: JSON.stringify(["id", "title"]),
            sort: JSON.stringify(sort),
        });
        const asc = await read(["author.name"]);
        expect(asc.status).toBe(200);
        expect(asc.body.data.map((r) => r.title)).toEqual(["p2", "p3", "p1"]);
        const desc = await read(["-author.name"]);
        expect(desc.body.data.map((r) => r.title)).toEqual(["p1", "p3", "p2"]);
        expect(desc.body.totalCount).toBe(3);

        const paged = await admin(request(app).get("/items/ho_posts")).query({
            filter: JSON.stringify({ "author.status": { eq: "active" } }),
            sort: JSON.stringify(["author.name"]), limit: 1, page: 2,
        });
        expect(paged.body.data.map((r) => r.title)).toEqual(["p3"]);
    });

    test("update/delete under a relation-path permission: filter enforced, row flat (K)", async () => {
        const inactive = await admin(request(app).post("/items/ho_authors")).send({ name: "Zed", status: "inactive" });
        const blocked = await admin(request(app).post("/items/ho_posts")).send({ title: "blocked", author_id: inactive.body.data.id });
        const active = await admin(request(app).get("/items/ho_posts")).query({ filter: JSON.stringify({ title: { eq: "p1" } }) });
        const allowedId = active.body.data[0].id;

        const cond = { "author.status": { eq: "active" } };
        for (const action of ["read", "update", "delete"]) {
            await admin(request(app).post("/permissions")).send({ role_Id: roleId, collection: "ho_posts", action, fields: ["*"], conditions: cond });
        }
        await makeUser("k-user@test.com");
        const token = (await login("k-user@test.com", "password123")).body.token;
        const as = (r) => r.set("Authorization", `Bearer ${token}`);

        // Relation filter still decides which rows can be written
        expect((await as(request(app).patch(`/items/ho_posts/${blocked.body.data.id}`)).send({ title: "x" })).status).toBe(403);
        expect((await as(request(app).delete(`/items/ho_posts/${blocked.body.data.id}`))).status).toBe(403);
        expect((await as(request(app).patch(`/items/ho_posts/${allowedId}`)).send({ title: "p1-edited" })).status).toBe(200);
        expect((await as(request(app).delete(`/items/ho_posts/${allowedId}`))).status).toBe(200);

        // The deleted row reached the audit log flat, not nested by table
        await new Promise((r) => setTimeout(r, 200));
        const audit = await admin(request(app).get("/items/baasix_AuditLog")).query({
            filter: JSON.stringify({ entity: { eq: "ho_posts" }, entityId: { eq: String(allowedId) }, action: { eq: "delete" } }),
        });
        expect(audit.body.data[0].changes.before.title).toBe("p1-edited");
        expect(audit.body.data[0].changes.before).not.toHaveProperty("ho_posts");
    });

    test("an explicit usertrack onDelete survives a schema field edit", async () => {
        const schema = (await admin(request(app).get("/schemas/ho_posts"))).body.data.schema;
        schema.fields.userCreated.onDelete = "SET NULL";
        expect((await admin(request(app).patch("/schemas/ho_posts")).send({ schema })).status).toBe(200);
        await admin(request(app).patch("/schemas/ho_posts/fields/title")).send({ field: { description: "t" } });
        const after = (await admin(request(app).get("/schemas/ho_posts"))).body.data.schema;
        expect(after.fields.userCreated.onDelete).toBe("SET NULL");
        expect(after.fields.userUpdated.onDelete).toBeUndefined();
    });
});

describe("F(a) — email + code redeem with a per-email attempt limit", () => {
    const requestCode = async (email) => {
        sendMailSpy.mockClear();
        await request(app).post("/auth/magiclink").send({ email, mode: "code" });
        return capturedCode("magicLinkCode").code;
    };
    const verify = (email, code) => request(app).post("/auth/magiclink/verify").send({ email, code, authType: "web" });

    beforeAll(async () => {
        await makeUser("fa-one@test.com");
        await makeUser("fa-two@test.com");
    });

    test("the right code with its email signs in; lower-case input is accepted", async () => {
        const code = await requestCode("fa-one@test.com");
        const res = await verify("fa-one@test.com", code.toLowerCase());
        expect(res.status).toBe(200);
        expect(res.body.token).toBeTruthy();
        expect(res.body.role?.name).toBe("handover");
    });

    test("a code only works for its own email", async () => {
        const code = await requestCode("fa-one@test.com");
        expect((await verify("fa-two@test.com", code)).status).toBe(400);
        expect((await verify("fa-one@test.com", code)).status).toBe(200);
    });

    test("5 wrong codes burn the code; another user's code is unaffected", async () => {
        const one = await requestCode("fa-one@test.com");
        const two = await requestCode("fa-two@test.com");
        for (let i = 0; i < 5; i++) {
            expect((await verify("fa-one@test.com", "WRONG000")).status).toBe(400);
        }
        expect((await verify("fa-one@test.com", one)).status).toBe(400);
        expect((await verify("fa-two@test.com", two)).status).toBe(200);
    });

    test("fewer than 5 wrong codes leave the right one usable", async () => {
        const code = await requestCode("fa-one@test.com");
        for (let i = 0; i < 4; i++) await verify("fa-one@test.com", "WRONG000");
        expect((await verify("fa-one@test.com", code)).status).toBe(200);
    });

    test("password reset by email + code, with the same limit", async () => {
        sendMailSpy.mockClear();
        await request(app).post("/auth/password/reset").send({ email: "fa-two@test.com", mode: "code" });
        const { code } = capturedCode("passwordResetCode");
        const reset = (c, password = "NewPass12345") =>
            request(app).post("/auth/password/reset/verify").send({ email: "fa-two@test.com", code: c, password });

        expect((await reset(code, "short")).status).toBe(400); // validation doesn't burn it
        expect((await reset("WRONG000")).status).toBe(400);
        expect((await reset(code)).status).toBe(200);
        expect((await login("fa-two@test.com", "NewPass12345")).status).toBe(200);
    });

    test("the URL forms still work", async () => {
        const code = await requestCode("fa-one@test.com");
        expect((await request(app).get(`/auth/magiclink/${code}`)).status).toBe(200);
    });
});

describe("I — relevance and empty values on both read paths; L — blocked user delete message", () => {
    beforeAll(async () => {
        await admin(request(app).post("/schemas")).send({
            collectionName: "ho2_authors",
            schema: { name: "ho2_authors", fields: {
                id: { type: "Integer", primaryKey: true, defaultValue: { type: "AUTOINCREMENT" } },
                name: { type: "String", allowNull: true },
                status: { type: "String", allowNull: true },
            } },
        });
        await admin(request(app).post("/schemas")).send({
            collectionName: "ho2_posts",
            schema: { name: "ho2_posts", fields: {
                id: { type: "Integer", primaryKey: true, defaultValue: { type: "AUTOINCREMENT" } },
                title: { type: "String", allowNull: false },
                score: { type: "Integer", allowNull: true },
                author_id: { type: "Integer", allowNull: true },
                author: { relType: "BelongsTo", target: "ho2_authors", foreignKey: "author_id", as: "author" },
            } },
        });
        const named = await admin(request(app).post("/items/ho2_authors")).send({ name: "Beth", status: "active" });
        const unnamed = await admin(request(app).post("/items/ho2_authors")).send({ name: null, status: "active" });
        const rows = [
            ["alpha", 1, named], ["alpha alpha alpha", null, unnamed], ["alpha alpha", 3, named],
        ];
        for (const [title, score, a] of rows) {
            await admin(request(app).post("/items/ho2_posts")).send({ title, score, author_id: a.body.data.id });
        }
    }, 60000);

    const titles = (r) => r.body.data.map((x) => x.title);
    const activeFilter = JSON.stringify({ "author.status": { eq: "active" } });

    test("sortByRelevance gives the same order with and without a relation filter", async () => {
        const q = { search: "alpha", sortByRelevance: true, searchFields: "title" };
        const single = await admin(request(app).get("/items/ho2_posts")).query(q);
        const joined = await admin(request(app).get("/items/ho2_posts")).query({ ...q, filter: activeFilter });
        expect(single.status).toBe(200);
        expect(joined.status).toBe(200);
        expect(titles(single)).toEqual(["alpha alpha alpha", "alpha alpha", "alpha"]);
        expect(titles(joined)).toEqual(titles(single));
    });

    test("descending sorts put empty values last, on both paths", async () => {
        const direct = await admin(request(app).get("/items/ho2_posts")).query({ sort: JSON.stringify(["-score"]) });
        expect(titles(direct)).toEqual(["alpha alpha", "alpha", "alpha alpha alpha"]);
        const directJoined = await admin(request(app).get("/items/ho2_posts"))
            .query({ sort: JSON.stringify(["-score"]), filter: activeFilter });
        expect(titles(directJoined)).toEqual(titles(direct));

        const rel = await admin(request(app).get("/items/ho2_posts"))
            .query({ sort: JSON.stringify(["-author.name"]), filter: activeFilter });
        expect(titles(rel).slice(-1)).toEqual(["alpha alpha alpha"]); // author with no name
    });

    test("deleting a user blocked by a RESTRICT usertrack FK gets a clear 409", async () => {
        await admin(request(app).post("/schemas")).send({
            collectionName: "ho2_notes",
            schema: { name: "ho2_notes", usertrack: true, fields: {
                id: { type: "Integer", primaryKey: true, defaultValue: { type: "AUTOINCREMENT" } },
                body: { type: "String", allowNull: true },
                userCreated: { relType: "BelongsTo", target: "baasix_User", foreignKey: "userCreated_Id", as: "userCreated", onDelete: "RESTRICT" },
            } },
        });
        await admin(request(app).post("/permissions")).send({ role_Id: roleId, collection: "ho2_notes", action: "create", fields: ["*"] });
        const id = await makeUser("l-user@test.com");
        const token = (await login("l-user@test.com", "password123")).body.token;
        expect((await request(app).post("/items/ho2_notes").set("Authorization", `Bearer ${token}`).send({ body: "x" })).status).toBe(201);

        const res = await admin(request(app).delete(`/items/baasix_User/${id}`));
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe("USER_HAS_RECORDS");
        expect(res.body.error.message).toMatch(/inactive instead/);
    });
});
