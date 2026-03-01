import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import path from "path";
import { fileURLToPath } from "url";
import { beforeAll, test, expect, describe, afterAll } from "@jest/globals";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);

/**
 * Test suite for SHARED_ASSET_ACCESS_MODE and SHARED_ASSET_TENANT_IDS
 * Verifies that assets from designated tenants are accessible cross-tenant
 */
describe("Shared Asset Access - Cross-Tenant Assets", () => {
    let app;
    let adminToken;
    let tenant1Id; // shared (source) tenant
    let tenant2Id; // non-shared tenant
    let tenant1UserToken;
    let tenant2UserToken;
    let sharedTenantFileId; // private file in shared tenant
    let nonSharedTenantFileId; // private file in non-shared tenant
    let tenantRoleId;
    let envModule;

    beforeAll(async () => {
        await destroyAllTablesInDB();
        app = await startServerForTesting({
            envOverrides: {
                MULTI_TENANT: "true",
                SHARED_ASSET_ACCESS_MODE: "public",
            },
        });

        // Import env module for runtime changes
        envModule = (await import("../baasix/utils/env.js")).default;

        // Admin login
        const adminLoginRes = await request(app)
            .post("/auth/login")
            .send({ email: "admin@baasix.com", password: "admin@123" });
        adminToken = adminLoginRes.body.token;

        // Create two tenants
        const t1Res = await request(app)
            .post("/items/baasix_Tenant")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ name: "Shared Tenant" });
        tenant1Id = t1Res.body.data.id;

        const t2Res = await request(app)
            .post("/items/baasix_Tenant")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ name: "Other Tenant" });
        tenant2Id = t2Res.body.data.id;

        // Create tenant role
        const roleRes = await request(app)
            .post("/items/baasix_Role")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                name: "tenant_user",
                description: "Tenant-specific user role",
                isTenantSpecific: true,
            });
        tenantRoleId = roleRes.body.data.id;

        // Permissions for tenant role on files
        for (const action of ["read", "create", "update"]) {
            await request(app)
                .post("/permissions")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    role_Id: tenantRoleId,
                    collection: "baasix_File",
                    action,
                    fields: "*",
                });
        }

        // Create users
        const u1Res = await request(app)
            .post("/items/baasix_User")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                email: "user1@shared.com",
                password: "password123",
                firstName: "Shared",
                lastName: "User",
            });
        const tenant1UserId = u1Res.body.data.id;

        const u2Res = await request(app)
            .post("/items/baasix_User")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                email: "user2@other.com",
                password: "password123",
                firstName: "Other",
                lastName: "User",
            });
        const tenant2UserId = u2Res.body.data.id;

        // Assign roles
        await request(app)
            .post("/items/baasix_UserRole")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ user_Id: tenant1UserId, role_Id: tenantRoleId, tenant_Id: tenant1Id });

        await request(app)
            .post("/items/baasix_UserRole")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ user_Id: tenant2UserId, role_Id: tenantRoleId, tenant_Id: tenant2Id });

        // Login tenant users
        const t1Login = await request(app)
            .post("/auth/login")
            .send({ email: "user1@shared.com", password: "password123", tenant_Id: tenant1Id });
        tenant1UserToken = t1Login.body.token;

        const t2Login = await request(app)
            .post("/auth/login")
            .send({ email: "user2@other.com", password: "password123", tenant_Id: tenant2Id });
        tenant2UserToken = t2Login.body.token;

        // Upload files
        const testFilePath = path.join(currentDirPath, "test-assets", "test-image.jpg");

        // Upload a file as admin then assign to shared tenant (private)
        const f1Res = await request(app)
            .post("/files")
            .set("Authorization", `Bearer ${adminToken}`)
            .field("storage", "LOCAL")
            .attach("file", testFilePath);
        sharedTenantFileId = f1Res.body.data;

        await request(app)
            .patch(`/files/${sharedTenantFileId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ isPublic: false, tenant_Id: tenant1Id });

        // Upload a file assigned to non-shared tenant (private)
        const f2Res = await request(app)
            .post("/files")
            .set("Authorization", `Bearer ${adminToken}`)
            .field("storage", "LOCAL")
            .attach("file", testFilePath);
        nonSharedTenantFileId = f2Res.body.data;

        await request(app)
            .patch(`/files/${nonSharedTenantFileId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ isPublic: false, tenant_Id: tenant2Id });

        // Set the shared asset tenant IDs env (after we know the ID)
        envModule.set("SHARED_ASSET_TENANT_IDS", String(tenant1Id));
    });

    afterAll(async () => {
        if (app?.server) {
            await new Promise((resolve) => app.server.close(resolve));
        }
    });

    describe("Public mode", () => {
        beforeAll(() => {
            envModule.set("SHARED_ASSET_ACCESS_MODE", "public");
        });

        test("tenant2 user SHOULD access shared tenant's private asset (public mode)", async () => {
            const res = await request(app)
                .get(`/assets/${sharedTenantFileId}`)
                .set("Authorization", `Bearer ${tenant2UserToken}`);

            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toMatch(/image/);
        });

        test("unauthenticated user SHOULD access shared tenant's asset (public mode)", async () => {
            const res = await request(app)
                .get(`/assets/${sharedTenantFileId}`);

            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toMatch(/image/);
        });

        test("tenant2 user should NOT access non-shared tenant's private asset", async () => {
            // tenant1 user trying to access tenant2's private file (tenant2 is NOT shared)
            const res = await request(app)
                .get(`/assets/${nonSharedTenantFileId}`)
                .set("Authorization", `Bearer ${tenant1UserToken}`);

            expect(res.status).toBe(403);
        });

        test("tenant1 user should still access their own tenant's assets", async () => {
            const res = await request(app)
                .get(`/assets/${sharedTenantFileId}`)
                .set("Authorization", `Bearer ${tenant1UserToken}`);

            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toMatch(/image/);
        });
    });

    describe("Authenticated mode", () => {
        beforeAll(() => {
            envModule.set("SHARED_ASSET_ACCESS_MODE", "authenticated");
        });

        test("authenticated tenant2 user SHOULD access shared tenant's asset (authenticated mode)", async () => {
            const res = await request(app)
                .get(`/assets/${sharedTenantFileId}`)
                .set("Authorization", `Bearer ${tenant2UserToken}`);

            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toMatch(/image/);
        });

        test("unauthenticated user should NOT access shared tenant's asset (authenticated mode)", async () => {
            const res = await request(app)
                .get(`/assets/${sharedTenantFileId}`);

            // Should fail - no auth token and mode is "authenticated"
            expect(res.status).not.toBe(200);
        });
    });

    describe("Disabled mode (no SHARED_ASSET_ACCESS_MODE)", () => {
        beforeAll(() => {
            envModule.set("SHARED_ASSET_ACCESS_MODE", "");
        });

        test("tenant2 user should NOT access shared tenant's asset when mode is disabled", async () => {
            const res = await request(app)
                .get(`/assets/${sharedTenantFileId}`)
                .set("Authorization", `Bearer ${tenant2UserToken}`);

            expect(res.status).toBe(403);
        });
    });
});
