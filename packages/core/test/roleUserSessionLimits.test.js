import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, beforeEach, afterAll, test, expect, describe } from "@jest/globals";
import settingsService from "../baasix/services/SettingsService";
import ItemsService from "../baasix/services/ItemsService";

let app;
let userRoleId;
let testUserId;

async function setSessionLimits(session_limits) {
    const settingsSvc = new ItemsService("baasix_Settings");
    const existing = await settingsSvc.readByQuery({ limit: -1 }, true);
    for (const s of existing.data) {
        await settingsSvc.deleteOne(s.id);
    }
    await settingsSvc.createOne({ tenant_Id: null, project_name: "Limits Test", session_limits });
    settingsService.invalidateAllCaches();
    await settingsService.loadGlobalSettings();
}

async function clearSessions() {
    const sessionSvc = new ItemsService("baasix_Sessions");
    const sessions = await sessionSvc.readByQuery({ limit: -1 }, true);
    for (const s of sessions.data) {
        await sessionSvc.deleteOne(s.id);
    }
}

function login(authType = "web") {
    return request(app).post("/auth/login").send({
        email: "limituser@example.com",
        password: "password123",
        authType,
    });
}

describe("Role-specific session limits with per-user overrides", () => {
    beforeAll(async () => {
        await destroyAllTablesInDB();
        app = await startServerForTesting();

        await request(app).post("/auth/register").send({
            email: "limituser@example.com",
            password: "password123",
            firstName: "Limit",
            lastName: "User",
        });

        const roleSvc = new ItemsService("baasix_Role");
        const roles = await roleSvc.readByQuery({ filter: { name: { eq: "user" } }, limit: 1 }, true);
        userRoleId = roles.data[0].id;

        const userSvc = new ItemsService("baasix_User");
        const users = await userSvc.readByQuery({ filter: { email: { eq: "limituser@example.com" } }, limit: 1 }, true);
        testUserId = users.data[0].id;
    });

    beforeEach(async () => {
        await clearSessions();
        const userSvc = new ItemsService("baasix_User");
        await userSvc.updateOne(testUserId, { session_limits: null });
    });

    afterAll(async () => {});

    test("role-specific limit is enforced for that role", async () => {
        await setSessionLimits({ roles: { [userRoleId]: { web: 1 } } });

        expect((await login()).status).toBe(200);
        const second = await login();
        expect(second.status).toBe(403);
        expect(second.body.message).toContain("Maximum web session limit (1)");
    });

    test("role limit overrides a looser default", async () => {
        await setSessionLimits({ default: { web: 5 }, roles: { [userRoleId]: { web: 1 } } });

        expect((await login()).status).toBe(200);
        expect((await login()).status).toBe(403);
    });

    test("default applies to roles without a specific entry", async () => {
        await setSessionLimits({ default: { web: 1 }, roles: { "00000000-0000-0000-0000-000000000001": { web: 9 } } });

        expect((await login()).status).toBe(200);
        expect((await login()).status).toBe(403);
    });

    test("per-user override loosens the role limit", async () => {
        await setSessionLimits({ roles: { [userRoleId]: { web: 1 } } });
        const userSvc = new ItemsService("baasix_User");
        await userSvc.updateOne(testUserId, { session_limits: { web: 3 } });

        expect((await login()).status).toBe(200);
        expect((await login()).status).toBe(200);
        expect((await login()).status).toBe(200);
        expect((await login()).status).toBe(403);
    });

    test("per-user override of -1 fully exempts the user", async () => {
        await setSessionLimits({ default: { web: 1 } });
        const userSvc = new ItemsService("baasix_User");
        await userSvc.updateOne(testUserId, { session_limits: { web: -1 } });

        expect((await login()).status).toBe(200);
        expect((await login()).status).toBe(200);
        expect((await login()).status).toBe(200);
    });

    test("per-user override can tighten to zero (type disabled)", async () => {
        await setSessionLimits({ default: { web: 5 } });
        const userSvc = new ItemsService("baasix_User");
        await userSvc.updateOne(testUserId, { session_limits: { web: 0 } });

        const res = await login();
        expect(res.status).toBe(403);
        expect(res.body.message).toContain("not allowed");
    });

    test("override for one type does not affect the other", async () => {
        await setSessionLimits({ default: { web: 1, mobile: 1 } });
        const userSvc = new ItemsService("baasix_User");
        await userSvc.updateOne(testUserId, { session_limits: { web: -1 } });

        expect((await login("web")).status).toBe(200);
        expect((await login("web")).status).toBe(200);
        expect((await login("mobile")).status).toBe(200);
        expect((await login("mobile")).status).toBe(403);
    });

    test("administrator bypasses all limits", async () => {
        await setSessionLimits({ default: { web: 0, mobile: 0 } });
        const adminLogin = () => request(app).post("/auth/login").send({
            email: "admin@baasix.com", password: "admin@123", authType: "web",
        });
        expect((await adminLogin()).status).toBe(200);
        expect((await adminLogin()).status).toBe(200);
    });

    test("malformed session_limits fails open", async () => {
        await setSessionLimits("garbage");
        expect((await login()).status).toBe(200);
        expect((await login()).status).toBe(200);
    });

    test("registration cannot mass-assign session_limits or other privileged fields", async () => {
        const email = `masstest-${Date.now()}@example.com`;
        const res = await request(app).post("/auth/register").send({
            email,
            password: "password123",
            firstName: "Mass",
            lastName: "Assign",
            session_limits: { web: -1 },
            emailVerified: true,
            status: "active",
        });
        expect(res.status).toBe(200);

        const userSvc = new ItemsService("baasix_User");
        const users = await userSvc.readByQuery({ filter: { email: { eq: email } }, limit: 1 }, true);
        const createdUser = users.data[0];

        expect(createdUser.session_limits).toBeFalsy();
        expect(createdUser.emailVerified).toBe(false);
    });
});
