process.env.AUTH_SERVICES_ENABLED = (process.env.AUTH_SERVICES_ENABLED || "LOCAL") + ",TWOFACTOR";

import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting, getAuthInstance } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";
import * as OTPAuth from "otpauth";

let app, token, setup;
const email = "2fauser@example.com";
const password = "password@123";

beforeAll(async () => {
    app = await startServerForTesting();
    await request(app).post("/auth/register").send({ email, password, firstName: "TwoFA" });
    const login = await request(app).post("/auth/login").send({ email, password });
    token = login.body.token;
}, 60000);
afterAll(async () => { await destroyAllTablesInDB(); });

const totpFor = (secret) =>
    new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 });

describe("2FA end-to-end", () => {
    test("enable returns secret + backup codes", async () => {
        const res = await request(app).post("/auth/2fa/enable")
            .set("Authorization", `Bearer ${token}`).send({});
        expect(res.status).toBe(200);
        expect(res.body.otpauthUrl).toContain("otpauth://totp/");
        expect(res.body.backupCodes).toHaveLength(10);
        setup = res.body;
    });

    test("verify-setup activates with a valid code", async () => {
        const res = await request(app).post("/auth/2fa/verify-setup")
            .set("Authorization", `Bearer ${token}`)
            .send({ code: totpFor(setup.secret).generate() });
        expect(res.status).toBe(200);
        expect(res.body.enabled).toBe(true);
    });

    test("login now returns a 2FA challenge, not a token", async () => {
        const res = await request(app).post("/auth/login").send({ email, password });
        expect(res.status).toBe(200);
        expect(res.body.twoFactorRequired).toBe(true);
        expect(res.body.twoFactorToken).toBeTruthy();
        expect(res.body.token).toBeUndefined();
        setup.twoFactorToken = res.body.twoFactorToken;
    });

    test("verify with wrong code fails with INVALID_TWO_FACTOR_CODE", async () => {
        const res = await request(app).post("/auth/2fa/verify")
            .send({ twoFactorToken: setup.twoFactorToken, code: "000000" });
        expect(res.status).toBe(401);
        expect(res.body.code).toBe("INVALID_TWO_FACTOR_CODE");
    });

    test("verify with valid TOTP completes login and consumes the challenge", async () => {
        const res = await request(app).post("/auth/2fa/verify")
            .send({ twoFactorToken: setup.twoFactorToken, code: totpFor(setup.secret).generate() });
        expect(res.status).toBe(200);
        expect(res.body.token).toBeTruthy();
        expect(res.body.user.email).toBe(email);
        // challenge is single-use
        const replay = await request(app).post("/auth/2fa/verify")
            .send({ twoFactorToken: setup.twoFactorToken, code: totpFor(setup.secret).generate() });
        expect(replay.status).toBe(401);
    });

    test("verify rejects a suspended account the same way password login does", async () => {
        const auth = getAuthInstance();
        const suspendedEmail = "2fasuspended@example.com";
        const suspendedPassword = "password@123";
        await request(app).post("/auth/register").send({ email: suspendedEmail, password: suspendedPassword, firstName: "Suspended" });
        const login1 = await request(app).post("/auth/login").send({ email: suspendedEmail, password: suspendedPassword });
        const suspendedToken = login1.body.token;

        const enableRes = await request(app).post("/auth/2fa/enable")
            .set("Authorization", `Bearer ${suspendedToken}`).send({});
        const suspendedSecret = enableRes.body.secret;
        await request(app).post("/auth/2fa/verify-setup")
            .set("Authorization", `Bearer ${suspendedToken}`)
            .send({ code: totpFor(suspendedSecret).generate() });

        // Trigger the 2FA challenge for a fresh login, then suspend the
        // account before redeeming it — mirrors an admin suspending a user
        // mid-login.
        const login2 = await request(app).post("/auth/login").send({ email: suspendedEmail, password: suspendedPassword });
        expect(login2.body.twoFactorRequired).toBe(true);

        const suspendedUser = await auth.adapter.findUserByEmail(suspendedEmail);
        await auth.adapter.updateUser(suspendedUser.id, { status: "suspended" });

        // Sanity check: password login on the now-suspended account gives
        // a 403 "Account is suspended" — this is the shape 2FA must match.
        const passwordAttempt = await request(app).post("/auth/login").send({ email: suspendedEmail, password: suspendedPassword });
        expect(passwordAttempt.status).toBe(403);
        expect(passwordAttempt.body.message).toBe("Account is suspended");

        const res = await request(app).post("/auth/2fa/verify")
            .send({ twoFactorToken: login2.body.twoFactorToken, code: totpFor(suspendedSecret).generate() });
        expect(res.status).toBe(403);
        expect(res.body.message).toBe("Account is suspended");
        expect(res.body.token).toBeUndefined();
    });

    test("disable requires the password and restores plain login", async () => {
        const login2 = await request(app).post("/auth/2fa/verify") // still enabled — get a session first
            .send({ twoFactorToken: (await request(app).post("/auth/login").send({ email, password })).body.twoFactorToken,
                    code: totpFor(setup.secret).generate() });
        const freshToken = login2.body.token;
        const bad = await request(app).post("/auth/2fa/disable")
            .set("Authorization", `Bearer ${freshToken}`).send({ password: "wrong" });
        expect(bad.status).toBe(401);
        const ok = await request(app).post("/auth/2fa/disable")
            .set("Authorization", `Bearer ${freshToken}`).send({ password });
        expect(ok.status).toBe(200);
        const login3 = await request(app).post("/auth/login").send({ email, password });
        expect(login3.body.token).toBeTruthy();
    });

    test("enable is rejected for a user with no password credential account", async () => {
        const auth = getAuthInstance();
        const passwordlessUser = await auth.adapter.createUser({
            email: "oauthonly2fa@example.com",
            emailVerified: true,
            firstName: "OAuthOnly",
            status: "active",
        });
        // generateTokenForUser needs a role assigned (mirrors what /auth/register
        // does for password users) so createAuthResponse can resolve permissions.
        const defaultRole = await auth.adapter.findRoleByName(process.env.DEFAULT_ROLE_REGISTERED || "user");
        await auth.adapter.createUserRole({ user_Id: passwordlessUser.id, role_Id: defaultRole.id, tenant_Id: null });
        const { token: passwordlessToken } = await auth.generateTokenForUser(passwordlessUser);

        const res = await request(app).post("/auth/2fa/enable")
            .set("Authorization", `Bearer ${passwordlessToken}`).send({});
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("TWO_FACTOR_REQUIRES_PASSWORD");
    });
});
