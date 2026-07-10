import { test, expect, describe, beforeAll } from "@jest/globals";
import request from "supertest";
import { validateThemeTokens, validatePageThemeOption, THEME_TOKENS } from "../baasix/blocks/theme-tokens.js";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";

describe("validateThemeTokens", () => {
  test("valid token sets pass", () => {
    expect(() => validateThemeTokens({ light: { primary: "222.2 47.4% 11.2%", radius: "0.75rem" }, dark: { primary: "210 40% 98%" } })).not.toThrow();
    expect(() => validateThemeTokens({ light: {} })).not.toThrow();
  });
  test("unknown token key rejected", () => expect(() => validateThemeTokens({ light: { evil: "1 1% 1%" } })).toThrow(/evil/));
  test("unknown scheme key rejected", () => expect(() => validateThemeTokens({ sepia: {} })).toThrow(/sepia/));
  test("bad HSL value rejected (no CSS injection)", () => {
    expect(() => validateThemeTokens({ light: { primary: "red; } body { display:none" } })).toThrow(/primary/);
    expect(() => validateThemeTokens({ light: { primary: "url(x)" } })).toThrow(/primary/);
  });
  test("radius accepts lengths only", () => {
    expect(() => validateThemeTokens({ light: { radius: "0.5rem" } })).not.toThrow();
    expect(() => validateThemeTokens({ light: { radius: "12px" } })).not.toThrow();
    expect(() => validateThemeTokens({ light: { radius: "calc(1px)" } })).toThrow(/radius/);
  });
  test("non-object rejected", () => expect(() => validateThemeTokens("x")).toThrow(/tokens/));
});

describe("validatePageThemeOption", () => {
  test("themeId and/or overrides pass", () => {
    expect(() => validatePageThemeOption({ themeId: "3b2a4e04-0000-0000-0000-000000000000" })).not.toThrow();
    expect(() => validatePageThemeOption({ overrides: { dark: { accent: "160 60% 45%" } } })).not.toThrow();
    expect(() => validatePageThemeOption(undefined)).not.toThrow();
  });
  test("bad shapes rejected", () => {
    expect(() => validatePageThemeOption("blue")).toThrow(/theme/);
    expect(() => validatePageThemeOption({ themeId: 42 })).toThrow(/themeId/);
    expect(() => validatePageThemeOption({ overrides: { light: { evil: "1 1% 1%" } } })).toThrow(/evil/);
  });
});

describe("THEME_TOKENS", () => {
  test("has exactly the 25 documented entries", () => {
    expect(THEME_TOKENS).toEqual([
      "background", "foreground", "card", "card-foreground", "popover", "popover-foreground",
      "primary", "primary-foreground", "secondary", "secondary-foreground",
      "muted", "muted-foreground", "accent", "accent-foreground",
      "destructive", "destructive-foreground", "border", "input", "ring",
      "chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "radius",
    ]);
    expect(THEME_TOKENS.length).toBe(25);
  });
});

describe("baasix_Theme + GET /pages/themes", () => {
  let app; let adminToken;
  beforeAll(async () => {
    await destroyAllTablesInDB();
    app = await startServerForTesting();
    const login = await request(app).post("/auth/login").send({ email: "admin@baasix.com", password: "admin@123" });
    adminToken = login.body.token;
  });
  test("create theme validates tokens via hook", async () => {
    const bad = await request(app).post("/items/baasix_Theme").set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Bad", tokens: { light: { evil: "1 1% 1%" } } });
    expect(bad.status).toBe(400);
    const ok = await request(app).post("/items/baasix_Theme").set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Ocean", tokens: { light: { primary: "199 89% 48%" } }, isDefault: true });
    expect(ok.status).toBe(201);
  });
  test("theme name is required", async () => {
    const res = await request(app).post("/items/baasix_Theme").set("Authorization", `Bearer ${adminToken}`)
      .send({ tokens: { light: { primary: "199 89% 48%" } } });
    expect(res.status).toBe(400);
  });
  test("theme update re-validates tokens", async () => {
    const created = await request(app).post("/items/baasix_Theme").set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Forest", tokens: { light: { primary: "120 40% 40%" } } });
    expect(created.status).toBe(201);
    const themeId = created.body.data.id;
    const bad = await request(app).patch(`/items/baasix_Theme/${themeId}`).set("Authorization", `Bearer ${adminToken}`)
      .send({ tokens: { light: { evil: "1 1% 1%" } } });
    expect(bad.status).toBe(400);
    const ok = await request(app).patch(`/items/baasix_Theme/${themeId}`).set("Authorization", `Bearer ${adminToken}`)
      .send({ tokens: { light: { primary: "120 40% 45%" } } });
    expect(ok.status).toBe(200);
  });
  test("page options.theme validated via existing page hook", async () => {
    const bad = await request(app).post("/items/baasix_Page").set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "T", slug: "theme-test", options: { theme: { overrides: { light: { evil: "1 1% 1%" } } } } });
    expect(bad.status).toBe(400);
  });
  test("page options.theme validated on update", async () => {
    const page = await request(app).post("/items/baasix_Page").set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "T2", slug: "theme-test-update" });
    expect(page.status).toBe(201);
    const pageId = page.body.data.id;
    const bad = await request(app).patch(`/items/baasix_Page/${pageId}`).set("Authorization", `Bearer ${adminToken}`)
      .send({ options: { theme: { overrides: { light: { evil: "1 1% 1%" } } } } });
    expect(bad.status).toBe(400);
  });
  test("GET /pages/themes requires auth, returns tenant themes", async () => {
    // Anonymous requests carry req.accountability = { user: null, ... } (public role) —
    // the route's "must be authenticated" guard rejects with 401 (see file.route.ts's
    // equivalent !req.accountability?.user?.id check), distinct from adminOnly's 403.
    expect((await request(app).get("/pages/themes")).status).toBe(401);
    const res = await request(app).get("/pages/themes").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.themes.some((t) => t.name === "Ocean")).toBe(true);
  });
});
