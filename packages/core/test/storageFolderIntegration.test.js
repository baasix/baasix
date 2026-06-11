import request from "supertest";
import path from "path";
import { fileURLToPath } from "url";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";
import env from "../baasix/utils/env";

/**
 * End-to-end: STORAGE_FOLDER_STRUCTURE on.
 *  - a new upload gets a storage_folder and is still served correctly,
 *  - the migration endpoint moves a legacy flat file into a folder, sets
 *    storage_folder, is idempotent (resume marker), and supports dry-run.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testFilePath = path.join(__dirname, "test-assets", "test-image.jpg");

let app;
let adminToken;

beforeAll(async () => {
  await destroyAllTablesInDB();
  app = await startServerForTesting({ envOverrides: { STORAGE_FOLDER_STRUCTURE: "true" } });
  const login = await request(app)
    .post("/auth/login")
    .send({ email: "admin@baasix.com", password: "admin@123" });
  adminToken = login.body.token;
});

afterAll(async () => {
  env.set("STORAGE_FOLDER_STRUCTURE", "");
  if (app?.server) await new Promise((r) => app.server.close(r));
});

describe("foldered upload (feature on)", () => {
  let fileId;

  test("a new upload gets a storage_folder and a leaf filename", async () => {
    const up = await request(app)
      .post("/files")
      .set("Authorization", `Bearer ${adminToken}`)
      .attach("file", testFilePath);
    expect(up.status).toBe(200);
    fileId = up.body.data;

    const rec = await request(app)
      .get(`/files/${fileId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    const data = rec.body.data;
    // Admin upload (no tenant, has userCreated_Id) → users/{adminId}
    expect(data.storage_folder).toBeTruthy();
    expect(data.storage_folder.startsWith("users/")).toBe(true);
    // filename is the LEAF only (no slashes).
    expect(data.filename).not.toContain("/");
  });

  test("the foldered file is still served correctly via /assets", async () => {
    const res = await request(app)
      .get(`/assets/${fileId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/image/);
    expect(res.body.length).toBeGreaterThan(0);
  });
});

describe("migration endpoint", () => {
  test("dry-run reports planned moves without changing anything", async () => {
    const res = await request(app)
      .post("/files/migrate-storage-structure?dryRun=true")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("dryRun", true);
    expect(res.body.data).toHaveProperty("scanned");
    expect(res.body.data).toHaveProperty("planned");
  });

  test("is idempotent — re-running after everything is migrated moves nothing new", async () => {
    // All current files were uploaded WITH the feature on, so they already have a
    // storage_folder → the migration's resume filter (storage_folder IS NULL) skips
    // them entirely. scanned should be 0 and moved 0.
    const res = await request(app)
      .post("/files/migrate-storage-structure")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.moved).toBe(0);
    expect(res.body.data.scanned).toBe(0);
  });

  test("requires admin", async () => {
    const res = await request(app).post("/files/migrate-storage-structure");
    expect([401, 403]).toContain(res.status);
  });

  test("moves a legacy flat file into a folder and sets storage_folder", async () => {
    // Upload a file with the feature OFF → it lands flat (storage_folder null).
    env.set("STORAGE_FOLDER_STRUCTURE", "");
    const up = await request(app)
      .post("/files")
      .set("Authorization", `Bearer ${adminToken}`)
      .attach("file", testFilePath);
    const flatId = up.body.data;

    let rec = await request(app).get(`/files/${flatId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(rec.body.data.storage_folder == null).toBe(true); // flat
    const flatFilename = rec.body.data.filename;

    // Re-enable and migrate.
    env.set("STORAGE_FOLDER_STRUCTURE", "true");
    const mig = await request(app)
      .post("/files/migrate-storage-structure")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(mig.status).toBe(200);
    expect(mig.body.data.moved).toBeGreaterThanOrEqual(1);

    // The record now has a storage_folder; the leaf filename is unchanged.
    rec = await request(app).get(`/files/${flatId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(rec.body.data.storage_folder).toBeTruthy();
    expect(rec.body.data.filename).toBe(flatFilename);

    // And it's still served correctly from the new location.
    const served = await request(app).get(`/assets/${flatId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(served.status).toBe(200);
    expect(served.body.length).toBeGreaterThan(0);
  });
});
