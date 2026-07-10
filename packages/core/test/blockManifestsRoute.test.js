import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, test, expect, describe } from "@jest/globals";

let app;
let adminToken;

beforeAll(async () => {
  await destroyAllTablesInDB();
  app = await startServerForTesting();
  const login = await request(app).post("/auth/login").send({ email: "admin@baasix.com", password: "admin@123" });
  adminToken = login.body.token;
});

describe("GET /pages/block-manifests", () => {
  test("requires admin", async () => {
    const res = await request(app).get("/pages/block-manifests");
    expect(res.status).toBe(403);
  });
  test("returns all manifests with palette metadata", async () => {
    const res = await request(app)
      .get("/pages/block-manifests")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.manifests)).toBe(true);
    expect(res.body.manifests.length).toBeGreaterThanOrEqual(27);
    const divider = res.body.manifests.find((m) => m.type === "divider");
    expect(divider.settingsMode).toBe("manifest");
    expect(divider.settings[0].fields[0].key).toBe("label");
    expect(divider.settings.some((g) => g.key === "appearance")).toBe(true);
    const table = res.body.manifests.find((m) => m.type === "table");
    expect(table.category).toBe("data");
  });
  test("manifest-mode block create/update is validated end-to-end", async () => {
    const page = await request(app)
      .post("/items/baasix_Page")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Manifest Test", slug: "manifest-test" });
    expect(page.status).toBe(201);
    const pageId = page.body.data.id;

    const badBlock = await request(app)
      .post("/items/baasix_Block")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ page_Id: pageId, type: "iframe", position: { row: 0, col: 0, span: 12 }, config: { url: "ftp://nope" } });
    expect(badBlock.status).toBe(400);

    const goodBlock = await request(app)
      .post("/items/baasix_Block")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ page_Id: pageId, type: "iframe", position: { row: 0, col: 0, span: 12 }, config: { url: "https://example.com" } });
    expect(goodBlock.status).toBe(201);
  });
});
