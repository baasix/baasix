import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, test, expect, describe } from "@jest/globals";

let app;
let adminToken;

const initialize = () =>
    request(app)
        .post("/mcp")
        .set("Authorization", `Bearer ${adminToken}`)
        .set("Accept", "application/json, text/event-stream")
        .send({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
        });

describe("MCP sessions", () => {
    beforeAll(async () => {
        process.env.MCP_ENABLED = "true";
        await destroyAllTablesInDB();
        app = await startServerForTesting();
        const login = await request(app).post("/auth/login").send({ email: "admin@baasix.com", password: "admin@123" });
        adminToken = login.body.token;
    });

    // Newer @modelcontextprotocol/sdk refuses to reuse one server across transports
    // ("Already connected to a transport"), so every session needs its own server.
    test("a second session initializes after the first", async () => {
        const first = await initialize();
        const second = await initialize();

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(second.headers["mcp-session-id"]).toBeTruthy();
        expect(second.headers["mcp-session-id"]).not.toBe(first.headers["mcp-session-id"]);
    });
});
