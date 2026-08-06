import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, test, expect, describe, afterAll } from "@jest/globals";

let app;
let adminToken;
let userToken;
let testUserId;

describe("Full-Text Search API Tests", () => {
    beforeAll(async () => {
        await destroyAllTablesInDB();

        app = await startServerForTesting();

        // Login as admin
        const adminLoginResponse = await request(app)
            .post("/auth/login")
            .send({ email: "admin@baasix.com", password: "admin@123" });
        adminToken = adminLoginResponse.body.token;

        // Create a test user
        const registerResponse = await request(app)
            .post("/auth/register")
            .send({ firstName: "Test", lastName: "User", email: "testuser@test.com", password: "testpassword" });
        testUserId = registerResponse.body.user.id;

        console.log("Test user ID:", registerResponse.body);

        // Login as test user
        const userLoginResponse = await request(app)
            .post("/auth/login")
            .send({ email: "testuser@test.com", password: "testpassword" });
        userToken = userLoginResponse.body.token;

        // Create posts schema
        await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                collectionName: "posts",
                schema: {
                    name: "Post",
                    fields: {
                        id: { type: "Integer", primaryKey: true, defaultValue: { type: "AUTOINCREMENT" } },
                        title: { type: "String", allowNull: false },
                        content: { type: "String", allowNull: false },
                        authorId: { type: "String", allowNull: false },
                    },
                },
            });

        // Create test posts
        const posts = [
            {
                title: "First post about databases",
                content: "This is a post about SQL databases.",
                authorId: testUserId,
            },
            {
                title: "Second post about programming",
                content: "This is a post about JavaScript programming.",
                authorId: testUserId,
            },
            {
                title: "Third post about web development",
                content: "This post covers HTML, CSS, and JavaScript.",
                authorId: testUserId,
            },
            {
                title: "Fourth post about databases",
                content: "This post is about NoSQL databases.",
                authorId: testUserId,
            },
        ];

        for (const post of posts) {
            await request(app).post("/items/posts").set("Authorization", `Bearer ${adminToken}`).send(post);
        }

        //Create permissions for the test user to access the posts schema
        await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: userLoginResponse.body.role.id,
            collection: "posts",
            action: "read",
            fields: "*",
        });
    });

    test("Basic search functionality", async () => {
        const response = await request(app)
            .get("/items/posts")
            .set("Authorization", `Bearer ${userToken}`)
            .query({ search: "databases", searchFields: ["title", "content"] });

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(2);
        expect(response.body.data.some((post) => post.title.includes("First post"))).toBeTruthy();
        expect(response.body.data.some((post) => post.title.includes("Fourth post"))).toBeTruthy();
    });

    test("Search with relevance sorting", async () => {
        const response = await request(app)
            .get("/items/posts?search=databases&sortByRelevance=true")
            .set("Authorization", `Bearer ${userToken}`);

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(2);
        expect(response.body.data[0].title).toContain("First post");
    });

    test("Search with regular sorting", async () => {
        const response = await request(app)
            .get('/items/posts?search=databases&sort={"title":"desc"}')
            .set("Authorization", `Bearer ${userToken}`);

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(2);
        expect(response.body.data[0].title).toContain("Fourth post");
    });

    test("Search with pagination", async () => {
        const response = await request(app)
            .get("/items/posts?search=post&limit=2&page=1")
            .set("Authorization", `Bearer ${userToken}`);

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(2);
        expect(response.body.totalCount).toBe(4);
    });

    test("Search with field filtering", async () => {
        const response = await request(app)
            .get("/items/posts")
            .query({ fields: ["title", "content"], search: "JavaScript" })
            .set("Authorization", `Bearer ${userToken}`);

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(2);
        expect(response.body.data.every((post) => "title" in post && "content" in post)).toBeTruthy();
        expect(response.body.data.every((post) => !("authorId" in post))).toBeTruthy();
    });

    test("Search with additional filters", async () => {
        const response = await request(app)
            .get("/items/posts")
            .set("Authorization", `Bearer ${userToken}`)
            .query({ search: "databases", filter: JSON.stringify({ "title": { iLike: "First" } }) });

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(1);
        expect(response.body.data[0].title).toContain("First post");
    });

    test("Search with no results", async () => {
        const response = await request(app)
            .get("/items/posts?search=nonexistent")
            .set("Authorization", `Bearer ${userToken}`);

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(0);
    });

    test("Search with partial word match", async () => {
        const response = await request(app)
            .get("/items/posts?search=program")
            .set("Authorization", `Bearer ${userToken}`);

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(1);
        expect(response.body.data[0].title).toContain("Second post");
    });

    test("Case-insensitive search", async () => {
        const response = await request(app)
            .get("/items/posts?search=DATABASE")
            .set("Authorization", `Bearer ${userToken}`);

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(2);
    });
});

describe("Search with JSON columns and oversized rows", () => {
    // Regression for the audit-log 500: "string is too long for tsvector
    // (… bytes, max 1048575 bytes)". Default search must skip JSON/JSONB
    // columns (opt-in via searchFields) and must never exceed the 1MB
    // to_tsvector input limit, even when a JSON column is explicitly searched.
    beforeAll(async () => {
        await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                collectionName: "docs",
                schema: {
                    name: "Doc",
                    fields: {
                        id: { type: "Integer", primaryKey: true, defaultValue: { type: "AUTOINCREMENT" } },
                        title: { type: "String", allowNull: false },
                        views: { type: "Integer" },
                        meta: { type: "JSON" },
                    },
                },
            });

        await request(app)
            .post("/items/docs")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ title: "alpha doc", views: 42, meta: { note: "jsonneedle here" } });

        // A row whose JSON produces >1MB of DISTINCT lexemes — to_tsvector's
        // 1048575-byte limit is on the built tsvector, so the tokens must be
        // unique (repeating one word would collapse to a single lexeme).
        const blob = Array.from({ length: 160000 }, (_, i) => `tok${i}xyz`).join(" ");
        const bigRes = await request(app)
            .post("/items/docs")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ title: "big doc", views: 7, meta: { blob } });
        if (bigRes.status >= 300) {
            throw new Error(`big doc create failed: ${bigRes.status} ${JSON.stringify(bigRes.body).slice(0, 300)}`);
        }
    });

    test("default search succeeds despite an oversized JSON row (JSON columns skipped)", async () => {
        const response = await request(app)
            .get("/items/docs?search=alpha")
            .set("Authorization", `Bearer ${adminToken}`);

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(1);
        expect(response.body.data[0].title).toBe("alpha doc");
    });

    test("default search does not match JSON column content", async () => {
        const response = await request(app)
            .get("/items/docs?search=jsonneedle")
            .set("Authorization", `Bearer ${adminToken}`);

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(0);
    });

    test("numeric columns are searchable by default", async () => {
        const response = await request(app)
            .get("/items/docs?search=42")
            .set("Authorization", `Bearer ${adminToken}`);

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(1);
        expect(response.body.data[0].views).toBe(42);
    });

    test("JSON column is searchable when explicitly named, without 1MB overflow", async () => {
        const response = await request(app)
            .get("/items/docs")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ search: "jsonneedle", searchFields: ["meta"] });

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(1);
        expect(response.body.data[0].title).toBe("alpha doc");
    });
});

describe("Stopword-only search falls back to the simple config", () => {
    // 'english' full-text config strips stopwords from BOTH the indexed text
    // and the query, so search=the parsed to an EMPTY tsquery and matched
    // nothing. Stopword-only queries now use the 'simple' config (no stopword
    // stripping); queries containing at least one real word keep 'english'
    // (stemming preserved).
    let adminTokenLocal;

    beforeAll(async () => {
        const login = await request(app)
            .post("/auth/login")
            .send({ email: "admin@baasix.com", password: "admin@123" });
        adminTokenLocal = login.body.token;

        await request(app)
            .post("/items/posts")
            .set("Authorization", `Bearer ${adminTokenLocal}`)
            .send({ title: "The ultimate guide", content: "the search test", authorId: testUserId });
    });

    test("search with only a stopword ('the') returns matching rows", async () => {
        const response = await request(app)
            .get("/items/posts?search=the")
            .set("Authorization", `Bearer ${adminTokenLocal}`);

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBeGreaterThanOrEqual(1);
        expect(response.body.data.some((p) => p.title === "The ultimate guide")).toBe(true);
    });

    test("mixed stopword + real word keeps english behavior", async () => {
        // 'the' is dropped, 'databases' matches via the english config as before
        const response = await request(app)
            .get("/items/posts?search=the%20databases")
            .set("Authorization", `Bearer ${adminTokenLocal}`);

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(2);
        expect(response.body.data.every((p) => p.title.includes("databases"))).toBe(true);
    });
});

afterAll(async () => {
    // Clean up: delete the posts schema
    //await request(app).delete("/schemas/posts").set("Authorization", `Bearer ${adminToken}`);
    // Close the server
    if (app.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});
