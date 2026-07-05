// test/socialProvidersUnit.test.js
// Unit tests: every ported provider builds a correct authorization URL and
// exposes the right id. No network, no DB.
import { test, expect, describe } from "@jest/globals";
import { providerFactories } from "../baasix/auth/providers/index.js";

// Extend this array in every provider-port task.
// authHost: hostname the authorization URL must point at.
// extraParams: params that must appear in the URL beyond the standard set.
export const PROVIDER_URL_CASES = [
    {
        id: "discord",
        options: { clientId: "cid", clientSecret: "sec" },
        authHost: "discord.com",
        expectInUrl: ["client_id=cid", "state=st-1", "response_type=code"],
    },
];

describe.each(PROVIDER_URL_CASES)("provider $id", ({ id, options, authHost, expectInUrl }) => {
    test("factory is registered and builds an authorization URL", async () => {
        const factory = providerFactories[id];
        expect(factory).toBeDefined();
        const provider = factory(options);
        expect(provider.id).toBe(id);
        const url = await provider.createAuthorizationURL({
            state: "st-1",
            codeVerifier: "cv-123456789012345678901234567890123456789012345",
            redirectURI: "https://api.example.com/auth/callback/" + id,
        });
        const urlStr = url.toString();
        expect(new URL(urlStr).hostname).toContain(authHost);
        for (const fragment of expectInUrl) {
            expect(urlStr).toContain(fragment);
        }
    });
});
