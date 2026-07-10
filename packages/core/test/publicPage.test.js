import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, test, expect, describe } from "@jest/globals";

let app; let adminToken;
const auth = (r) => r.set("Authorization", `Bearer ${adminToken}`);

beforeAll(async () => {
  await destroyAllTablesInDB();
  app = await startServerForTesting();
  const login = await request(app).post("/auth/login").send({ email: "admin@baasix.com", password: "admin@123" });
  adminToken = login.body.token;
  const theme = await auth(request(app).post("/items/baasix_Theme")).send({ name: "Brand", tokens: { light: { primary: "199 89% 48%" } }, isDefault: true });
  const themeId = theme.body.data?.id ?? theme.body.id;
  const page = await auth(request(app).post("/items/baasix_Page")).send({ name: "Pub", slug: "pub-page", isPublic: true, options: { theme: { themeId } } });
  const pageId = page.body.data?.id ?? page.body.id;
  await auth(request(app).post("/items/baasix_Block")).send({ page_Id: pageId, type: "markdown", position: { row: 0, col: 0, span: 12 }, config: { content: "# hello" } });
  await auth(request(app).post("/items/baasix_Page")).send({ name: "Priv", slug: "priv-page", isPublic: false });
  await auth(request(app).post("/items/baasix_Page")).send({ name: "Off", slug: "off-page", isPublic: true, enabled: false });
  await auth(request(app).post("/items/baasix_Page")).send({ name: "Fallback", slug: "fallback-page", isPublic: true });
});

describe("GET /pages/public/:slug", () => {
  test("serves isPublic+enabled page with blocks and branding, no auth", async () => {
    const res = await request(app).get("/pages/public/pub-page");
    expect(res.status).toBe(200);
    expect(res.body.page.slug).toBe("pub-page");
    expect(res.body.page.blocks.length).toBe(1);
    expect(res.body.page.blocks[0].type).toBe("markdown");
    expect(res.body.branding.theme.name).toBe("Brand");
  });
  test("response omits internal fields (roles, usertrack, tenant_Id)", async () => {
    const res = await request(app).get("/pages/public/pub-page");
    expect(res.status).toBe(200);
    expect(res.body.page).not.toHaveProperty("roles");
    expect(res.body.page).not.toHaveProperty("userCreated_Id");
    expect(res.body.page).not.toHaveProperty("userUpdated_Id");
    expect(res.body.page).not.toHaveProperty("createdAt");
    expect(res.body.page).not.toHaveProperty("tenant_Id");
    expect(res.body.page.blocks[0]).not.toHaveProperty("userCreated_Id");
  });
  test("page without options.theme falls back to the tenant default theme", async () => {
    const res = await request(app).get("/pages/public/fallback-page");
    expect(res.status).toBe(200);
    expect(res.body.branding.theme.name).toBe("Brand");
  });
  test("uniform 404 for missing / private / disabled", async () => {
    for (const slug of ["nope", "priv-page", "off-page"]) {
      const res = await request(app).get(`/pages/public/${slug}`);
      expect(res.status).toBe(404);
    }
  });
});
