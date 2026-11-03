// Read at route setup, so it must be set before the server starts
process.env.AUTH_CODE_REQUIRE_EMAIL = "true";
process.env.AUTH_APP_URL = "http://localhost:3000";

import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting, MailService } from "../baasix";
import { beforeAll, afterAll, test, expect, jest } from "@jest/globals";

/**
 * AUTH_CODE_REQUIRE_EMAIL=true: short emailed codes can only be redeemed through
 * the email-scoped routes (which have the per-email attempt limit); long link
 * tokens still work on the URL routes.
 */

let app;
let sendMailSpy;

beforeAll(async () => {
    await destroyAllTablesInDB();
    app = await startServerForTesting();
    sendMailSpy = jest.spyOn(MailService, "sendMail").mockResolvedValue(undefined);
    await request(app).post("/auth/register").send({ email: "req-email@test.com", password: "password123", firstName: "R" });
}, 60000);

afterAll(async () => {
    sendMailSpy.mockRestore();
    if (app?.server) await new Promise((r) => app.server.close(r));
    delete process.env.AUTH_CODE_REQUIRE_EMAIL;
    delete process.env.AUTH_APP_URL;
});

const lastContext = (templateName) =>
    sendMailSpy.mock.calls.filter(([o]) => o.templateName === templateName).pop()?.[0].context;

test("URL routes refuse short codes; email routes accept them", async () => {
    await request(app).post("/auth/magiclink").send({ email: "req-email@test.com", mode: "code" });
    const { code } = lastContext("magicLinkCode");

    const url = await request(app).get(`/auth/magiclink/${code}`);
    expect(url.status).toBe(400);
    expect(url.body.code).toBe("EMAIL_REQUIRED");

    const ok = await request(app).post("/auth/magiclink/verify").send({ email: "req-email@test.com", code });
    expect(ok.status).toBe(200);

    await request(app).post("/auth/password/reset").send({ email: "req-email@test.com", mode: "code" });
    const reset = lastContext("passwordResetCode").code;
    const resetUrl = await request(app).post(`/auth/password/reset/${reset}`).send({ password: "NewPass12345" });
    expect(resetUrl.body.code).toBe("EMAIL_REQUIRED");
});

test("long link tokens still work on the URL route", async () => {
    await request(app).post("/auth/magiclink").send({ email: "req-email@test.com", mode: "link", link: "http://localhost:3000" });
    const token = lastContext("magicLinkUrl").magicLinkUrl.split("/").pop();
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect((await request(app).get(`/auth/magiclink/${token}`)).status).toBe(200);
});
