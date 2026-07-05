// test/providerRegistry.test.js
import { test, expect, describe } from "@jest/globals";
import { providerFactories, PROVIDER_IDS } from "../baasix/auth/providers/index.js";

describe("provider factory registry", () => {
    test("registry exposes the existing four providers", () => {
        for (const id of ["google", "facebook", "apple", "github"]) {
            expect(PROVIDER_IDS).toContain(id);
            expect(typeof providerFactories[id]).toBe("function");
        }
    });

    test("factories build providers with matching ids", () => {
        const p = providerFactories.github({ clientId: "id", clientSecret: "sec" });
        expect(p.id).toBe("github");
        expect(typeof p.createAuthorizationURL).toBe("function");
        expect(typeof p.validateAuthorizationCode).toBe("function");
        expect(typeof p.getUserInfo).toBe("function");
    });

    test("all 35 better-auth social providers are registered", () => {
        const expected = [
            "apple","atlassian","cognito","discord","facebook","figma","github","microsoft",
            "google","huggingface","slack","spotify","twitch","twitter","dropbox","kick",
            "linear","linkedin","gitlab","tiktok","reddit","roblox","salesforce","vk","zoom",
            "notion","kakao","naver","line","paybin","paypal","polar","railway","vercel","wechat",
        ];
        for (const id of expected) {
            expect(providerFactories[id]).toBeDefined();
        }
        expect(PROVIDER_IDS.length).toBeGreaterThanOrEqual(expected.length);
    });
});
