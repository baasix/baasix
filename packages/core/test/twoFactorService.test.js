import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";
import * as OTPAuth from "otpauth";

let app, adapter, service, user;

beforeAll(async () => {
    app = await startServerForTesting();
    const { createBaasixAdapter } = await import("../baasix/auth/adapters/baasix-adapter.js");
    const { createTwoFactorService } = await import("../baasix/auth/plugins/two-factor/service.js");
    adapter = createBaasixAdapter();
    service = createTwoFactorService(adapter, { issuer: "BaasixTest" });
    user = await adapter.createUser({
        email: "twofa@example.com", emailVerified: true, firstName: "Two", status: "active",
    });
}, 60000);
afterAll(async () => { await destroyAllTablesInDB(); });

describe("two-factor service", () => {
    let setup;
    test("generateSetup returns secret, otpauth URL and 10 backup codes", async () => {
        setup = await service.generateSetup(user);
        expect(setup.otpauthUrl).toContain("otpauth://totp/");
        expect(setup.backupCodes).toHaveLength(10);
        expect(await service.isEnabled(user.id)).toBe(false);
    });

    test("activate with a valid TOTP enables 2FA", async () => {
        const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(setup.secret), digits: 6, period: 30 });
        expect(await service.activate(user.id, totp.generate())).toBe(true);
        expect(await service.isEnabled(user.id)).toBe(true);
    });

    test("verifyCode accepts TOTP and rejects garbage", async () => {
        const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(setup.secret), digits: 6, period: 30 });
        expect(await service.verifyCode(user.id, totp.generate())).toBe(true);
        expect(await service.verifyCode(user.id, "000000")).toBe(false);
    });

    test("backup code works exactly once", async () => {
        const code = setup.backupCodes[0];
        expect(await service.verifyCode(user.id, code)).toBe(true);
        expect(await service.verifyCode(user.id, code)).toBe(false);
    });

    test("disable removes 2FA", async () => {
        await service.disable(user.id);
        expect(await service.isEnabled(user.id)).toBe(false);
    });
});
