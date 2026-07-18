// NOTE: startServerForTesting reads env at startup — set REQUIRE_EMAIL_VERIFICATION
// and AUTH_APP_URL before the import-time server start.
process.env.REQUIRE_EMAIL_VERIFICATION = "true";
process.env.AUTH_APP_URL = "http://localhost:3000";

import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting, MailService } from "../baasix";
import { beforeAll, afterAll, beforeEach, test, expect, describe, jest } from "@jest/globals";

let app;
let sendMailSpy;

beforeAll(async () => {
    await destroyAllTablesInDB();
    app = await startServerForTesting();
    // The auth routes' options.mailService wrapper delegates to this singleton,
    // so spying here captures verification emails without SMTP config.
    sendMailSpy = jest.spyOn(MailService, "sendMail").mockResolvedValue(undefined);
}, 60000);

afterAll(async () => {
    sendMailSpy.mockRestore();
    await destroyAllTablesInDB();
    delete process.env.REQUIRE_EMAIL_VERIFICATION;
    delete process.env.AUTH_APP_URL;
});

beforeEach(() => {
    sendMailSpy.mockClear();
});

// Extracts the token from a captured emailVerification sendMail call
function capturedVerifyToken() {
    const call = sendMailSpy.mock.calls.find(
        ([opts]) => opts.templateName === "emailVerification"
    );
    if (!call) return null;
    const verifyUrl = call[0].context?.verifyUrl || "";
    const match = verifyUrl.match(/\/auth\/verify-email\/(.+)$/);
    return match ? match[1] : null;
}

describe("REQUIRE_EMAIL_VERIFICATION=true registration flow", () => {
    let verifyToken;

    test("register auto-sends verification email and returns no token", async () => {
        const res = await request(app).post("/auth/register").send({
            email: "verifyme@example.com",
            password: "password123",
            firstName: "Verify",
            link: "http://localhost:3000",
        });

        expect(res.status).toBe(200);
        expect(res.body.requiresEmailVerification).toBe(true);
        expect(res.body.token).toBeUndefined();

        expect(sendMailSpy).toHaveBeenCalledTimes(1);
        const [mailOpts] = sendMailSpy.mock.calls[0];
        expect(mailOpts.to).toBe("verifyme@example.com");
        expect(mailOpts.templateName).toBe("emailVerification");
        expect(mailOpts.context.verifyUrl).toMatch(
            /^http:\/\/localhost:3000\/auth\/verify-email\/.+/
        );

        verifyToken = capturedVerifyToken();
        expect(verifyToken).toBeTruthy();
    });

    test("login is blocked before verification", async () => {
        const res = await request(app).post("/auth/login").send({
            email: "verifyme@example.com",
            password: "password123",
        });
        expect(res.status).toBe(403);
        expect(res.body.requiresEmailVerification).toBe(true);
    });

    test("verify token then login succeeds", async () => {
        const verifyRes = await request(app).get(`/auth/email/verify/${verifyToken}`);
        expect(verifyRes.status).toBe(200);

        const loginRes = await request(app).post("/auth/login").send({
            email: "verifyme@example.com",
            password: "password123",
        });
        expect(loginRes.status).toBe(200);
        expect(loginRes.body.token).toBeTruthy();
    });

    test("register falls back to AUTH_APP_URL when no link provided", async () => {
        const res = await request(app).post("/auth/register").send({
            email: "nolink@example.com",
            password: "password123",
            firstName: "NoLink",
        });

        expect(res.status).toBe(200);
        expect(res.body.requiresEmailVerification).toBe(true);
        expect(sendMailSpy).toHaveBeenCalledTimes(1);
        const [mailOpts] = sendMailSpy.mock.calls[0];
        expect(mailOpts.context.verifyUrl).toMatch(
            /^http:\/\/localhost:3000\/auth\/verify-email\/.+/
        );
    });

    test("register still succeeds when sending the email fails", async () => {
        sendMailSpy.mockRejectedValueOnce(new Error("SMTP down"));
        const res = await request(app).post("/auth/register").send({
            email: "mailfail@example.com",
            password: "password123",
            firstName: "MailFail",
            link: "http://localhost:3000",
        });

        expect(res.status).toBe(200);
        expect(res.body.requiresEmailVerification).toBe(true);
    });
});

describe("POST /auth/email/verify/resend", () => {
    test("sends verification email for an unverified user", async () => {
        const res = await request(app).post("/auth/email/verify/resend").send({
            email: "mailfail@example.com",
            link: "http://localhost:3000",
        });

        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/if an account exists/i);
        expect(sendMailSpy).toHaveBeenCalledTimes(1);
        const [mailOpts] = sendMailSpy.mock.calls[0];
        expect(mailOpts.to).toBe("mailfail@example.com");
        expect(mailOpts.templateName).toBe("emailVerification");
    });

    test("returns the same generic response for an unknown email without sending", async () => {
        const res = await request(app).post("/auth/email/verify/resend").send({
            email: "ghost@example.com",
            link: "http://localhost:3000",
        });

        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/if an account exists/i);
        expect(sendMailSpy).not.toHaveBeenCalled();
    });

    test("does not resend for an already-verified user", async () => {
        const res = await request(app).post("/auth/email/verify/resend").send({
            email: "verifyme@example.com",
            link: "http://localhost:3000",
        });

        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/if an account exists/i);
        expect(sendMailSpy).not.toHaveBeenCalled();
    });

    test("rejects a link that is not allow-listed", async () => {
        const res = await request(app).post("/auth/email/verify/resend").send({
            email: "mailfail@example.com",
            link: "https://evil.example.com",
        });
        expect(res.status).toBe(400);
        expect(sendMailSpy).not.toHaveBeenCalled();
    });

    test("requires an email", async () => {
        const res = await request(app).post("/auth/email/verify/resend").send({
            link: "http://localhost:3000",
        });
        expect(res.status).toBe(400);
    });
});

describe("resend cooldown", () => {
    test("register's auto-send starts the cooldown — immediate resend does not send again", async () => {
        // nolink@example.com's register auto-send succeeded, so its cooldown is active
        const res = await request(app).post("/auth/email/verify/resend").send({
            email: "nolink@example.com",
            link: "http://localhost:3000",
        });
        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/if an account exists/i);
        expect(sendMailSpy).not.toHaveBeenCalled();
    });

    test("second resend within the cooldown does not send again", async () => {
        // mailfail@example.com's first resend (previous describe) sent and set the cooldown
        const res = await request(app).post("/auth/email/verify/resend").send({
            email: "mailfail@example.com",
            link: "http://localhost:3000",
        });
        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/if an account exists/i);
        expect(sendMailSpy).not.toHaveBeenCalled();
    });
});

describe("authenticated flows", () => {
    let adminToken;

    test("seeded admin can login when REQUIRE_EMAIL_VERIFICATION=true", async () => {
        const res = await request(app).post("/auth/login").send({
            email: "admin@baasix.com",
            password: "admin@123",
        });
        expect(res.status).toBe(200);
        expect(res.body.token).toBeTruthy();
        adminToken = res.body.token;
    });

    test("authenticated resend uses the session user and reports already-verified explicitly", async () => {
        const res = await request(app)
            .post("/auth/email/verify/resend")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ link: "http://localhost:3000" });
        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/already verified/i);
        expect(sendMailSpy).not.toHaveBeenCalled();
    });
});
