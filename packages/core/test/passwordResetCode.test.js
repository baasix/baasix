// NOTE: startServerForTesting reads env at startup — set AUTH_APP_URL before the
// import-time server start so link-mode validation has an allow-list to check.
process.env.AUTH_APP_URL = "http://localhost:3000";

import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting, MailService } from "../baasix";
import { beforeAll, afterAll, beforeEach, test, expect, describe, jest } from "@jest/globals";

const OTP_ALPHABET_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;

let app;
let sendMailSpy;

beforeAll(async () => {
    await destroyAllTablesInDB();
    app = await startServerForTesting();
    // The auth routes' options.mailService wrapper delegates to this singleton,
    // so spying here captures reset emails without SMTP config.
    sendMailSpy = jest.spyOn(MailService, "sendMail").mockResolvedValue(undefined);

    const res = await request(app).post("/auth/register").send({
        email: "resetcode@example.com",
        password: "original123",
        firstName: "Reset",
    });
    expect(res.status).toBe(200);
}, 60000);

afterAll(async () => {
    sendMailSpy.mockRestore();
    await destroyAllTablesInDB();
    delete process.env.AUTH_APP_URL;
});

beforeEach(() => {
    sendMailSpy.mockClear();
});

// Extracts the code from a captured passwordResetCode sendMail call
function capturedResetCode() {
    const call = sendMailSpy.mock.calls.find(
        ([opts]) => opts.templateName === "passwordResetCode"
    );
    return call ? call[0].context?.code || null : null;
}

describe("POST /auth/password/reset mode=code", () => {
    let resetCode;

    test("sends a passwordResetCode email without requiring a link", async () => {
        const res = await request(app).post("/auth/password/reset").send({
            email: "resetcode@example.com",
            mode: "code",
        });

        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/if an account exists/i);

        expect(sendMailSpy).toHaveBeenCalledTimes(1);
        const [mailOpts] = sendMailSpy.mock.calls[0];
        expect(mailOpts.to).toBe("resetcode@example.com");
        expect(mailOpts.templateName).toBe("passwordResetCode");
        expect(mailOpts.context.code).toMatch(OTP_ALPHABET_RE);
        expect(mailOpts.context.expiresAt).toBeTruthy();

        resetCode = capturedResetCode();
        expect(resetCode).toBeTruthy();
    });

    test("emailed code resets the password via POST /auth/password/reset/:token", async () => {
        const res = await request(app)
            .post(`/auth/password/reset/${resetCode}`)
            .send({ password: "changed456" });
        expect(res.status).toBe(200);

        const oldLogin = await request(app).post("/auth/login").send({
            email: "resetcode@example.com",
            password: "original123",
        });
        // Baasix login returns 400 "Incorrect password." for bad credentials
        expect(oldLogin.status).toBe(400);

        const newLogin = await request(app).post("/auth/login").send({
            email: "resetcode@example.com",
            password: "changed456",
        });
        expect(newLogin.status).toBe(200);
        expect(newLogin.body.token).toBeTruthy();
    });

    test("a code is single-use", async () => {
        const res = await request(app)
            .post(`/auth/password/reset/${resetCode}`)
            .send({ password: "again789x" });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/invalid or expired/i);
    });

    test("a wrong code is rejected", async () => {
        await request(app).post("/auth/password/reset").send({
            email: "resetcode@example.com",
            mode: "code",
        });

        const res = await request(app)
            .post("/auth/password/reset/WRONGCOD")
            .send({ password: "whatever123" });
        expect(res.status).toBe(400);
    });

    test("returns the same generic response for an unknown email without sending", async () => {
        const res = await request(app).post("/auth/password/reset").send({
            email: "ghost@example.com",
            mode: "code",
        });

        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/if an account exists/i);
        expect(sendMailSpy).not.toHaveBeenCalled();
    });

    test("requesting a new code invalidates the previous one", async () => {
        await request(app).post("/auth/password/reset").send({
            email: "resetcode@example.com",
            mode: "code",
        });
        const firstCode = capturedResetCode();
        sendMailSpy.mockClear();

        await request(app).post("/auth/password/reset").send({
            email: "resetcode@example.com",
            mode: "code",
        });
        const secondCode = capturedResetCode();
        expect(secondCode).toBeTruthy();
        expect(secondCode).not.toBe(firstCode);

        const oldCodeRes = await request(app)
            .post(`/auth/password/reset/${firstCode}`)
            .send({ password: "nope12345" });
        expect(oldCodeRes.status).toBe(400);

        const newCodeRes = await request(app)
            .post(`/auth/password/reset/${secondCode}`)
            .send({ password: "changed456" });
        expect(newCodeRes.status).toBe(200);
    });
});

describe("POST /auth/password/reset mode=link (regression)", () => {
    test("default mode still requires an allow-listed link", async () => {
        const res = await request(app).post("/auth/password/reset").send({
            email: "resetcode@example.com",
            link: "https://evil.example.com",
        });
        expect(res.status).toBe(400);
        expect(sendMailSpy).not.toHaveBeenCalled();
    });

    test("default mode still sends the passwordReset link template", async () => {
        const res = await request(app).post("/auth/password/reset").send({
            email: "resetcode@example.com",
            link: "http://localhost:3000",
        });

        expect(res.status).toBe(200);
        expect(sendMailSpy).toHaveBeenCalledTimes(1);
        const [mailOpts] = sendMailSpy.mock.calls[0];
        expect(mailOpts.templateName).toBe("passwordReset");
        expect(mailOpts.context.resetUrl).toMatch(
            /^http:\/\/localhost:3000\/auth\/reset-password\/.+/
        );
    });
});
