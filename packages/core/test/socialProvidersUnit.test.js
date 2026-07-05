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
    {
        id: "atlassian",
        options: { clientId: "cid", clientSecret: "sec" },
        authHost: "auth.atlassian.com",
        expectInUrl: ["client_id=cid", "state=st-1", "audience=api.atlassian.com"],
    },
    {
        id: "cognito",
        options: {
            clientId: "cid",
            clientSecret: "sec",
            domain: "test.auth.us-east-1.amazoncognito.com",
            region: "us-east-1",
        },
        authHost: "test.auth.us-east-1.amazoncognito.com",
        expectInUrl: ["client_id=cid", "state=st-1"],
    },
    {
        id: "dropbox",
        options: { clientId: "cid", clientSecret: "sec" },
        authHost: "www.dropbox.com",
        expectInUrl: ["client_id=cid", "state=st-1"],
    },
    {
        id: "figma",
        options: { clientId: "cid", clientSecret: "sec" },
        authHost: "www.figma.com",
        expectInUrl: ["client_id=cid", "state=st-1"],
    },
    {
        id: "gitlab",
        options: { clientId: "cid", clientSecret: "sec" },
        authHost: "gitlab.com",
        expectInUrl: ["client_id=cid", "state=st-1"],
    },
    {
        id: "huggingface",
        options: { clientId: "cid", clientSecret: "sec" },
        authHost: "huggingface.co",
        expectInUrl: ["client_id=cid", "state=st-1"],
    },
    {
        id: "kakao",
        options: { clientId: "cid", clientSecret: "sec" },
        authHost: "kauth.kakao.com",
        expectInUrl: ["client_id=cid", "state=st-1"],
    },
    {
        id: "kick",
        options: { clientId: "cid", clientSecret: "sec" },
        authHost: "id.kick.com",
        expectInUrl: ["client_id=cid", "state=st-1"],
    },
    {
        id: "line",
        options: { clientId: "cid", clientSecret: "sec" },
        authHost: "access.line.me",
        expectInUrl: ["client_id=cid", "state=st-1"],
    },
    {
        id: "linear",
        options: { clientId: "cid", clientSecret: "sec" },
        authHost: "linear.app",
        expectInUrl: ["client_id=cid", "state=st-1"],
    },
    {
        id: "linkedin",
        options: { clientId: "cid", clientSecret: "sec" },
        authHost: "www.linkedin.com",
        expectInUrl: ["client_id=cid", "state=st-1"],
    },
    {
        id: "microsoft",
        options: { clientId: "cid", clientSecret: "sec", tenantId: "common" },
        authHost: "login.microsoftonline.com",
        expectInUrl: ["client_id=cid", "state=st-1"],
    },
    {
        id: "naver",
        options: { clientId: "cid", clientSecret: "sec" },
        authHost: "nid.naver.com",
        expectInUrl: ["client_id=cid", "state=st-1"],
    },
    {
        id: "notion",
        options: { clientId: "cid", clientSecret: "sec" },
        authHost: "api.notion.com",
        expectInUrl: ["client_id=cid", "state=st-1"],
    },
    {
        id: "paybin",
        options: { clientId: "cid", clientSecret: "sec" },
        authHost: "idp.paybin.io",
        expectInUrl: ["client_id=cid", "state=st-1"],
    },
    {
        id: "paypal",
        options: { clientId: "cid", clientSecret: "sec" },
        authHost: "www.sandbox.paypal.com",
        expectInUrl: ["client_id=cid", "state=st-1"],
    },
    {
        id: "polar",
        options: { clientId: "cid", clientSecret: "sec" },
        authHost: "polar.sh",
        expectInUrl: ["client_id=cid", "state=st-1"],
    },
    {
        id: "railway",
        options: { clientId: "cid", clientSecret: "sec" },
        authHost: "backboard.railway.com",
        expectInUrl: ["client_id=cid", "state=st-1"],
    },
    {
        id: "reddit",
        options: { clientId: "cid", clientSecret: "sec" },
        authHost: "www.reddit.com",
        expectInUrl: ["client_id=cid", "state=st-1"],
    },
    {
        id: "roblox",
        options: { clientId: "cid", clientSecret: "sec" },
        authHost: "apis.roblox.com",
        expectInUrl: ["client_id=cid", "state=st-1"],
    },
    {
        id: "salesforce",
        options: { clientId: "cid", clientSecret: "sec" },
        authHost: "login.salesforce.com",
        expectInUrl: ["client_id=cid", "state=st-1"],
    },
    {
        id: "slack",
        options: { clientId: "cid", clientSecret: "sec" },
        authHost: "slack.com",
        expectInUrl: ["client_id=cid", "state=st-1"],
    },
    {
        id: "spotify",
        options: { clientId: "cid", clientSecret: "sec" },
        authHost: "accounts.spotify.com",
        expectInUrl: ["client_id=cid", "state=st-1"],
    },
    {
        id: "tiktok",
        options: { clientId: "cid", clientKey: "ckey", clientSecret: "sec" },
        authHost: "www.tiktok.com",
        expectInUrl: ["client_key=ckey", "state=st-1"],
    },
    {
        id: "twitch",
        options: { clientId: "cid", clientSecret: "sec" },
        authHost: "id.twitch.tv",
        expectInUrl: ["client_id=cid", "state=st-1", "response_type=code"],
    },
    {
        id: "twitter",
        options: { clientId: "cid", clientSecret: "sec" },
        authHost: "x.com",
        expectInUrl: ["client_id=cid", "state=st-1", "code_challenge"],
    },
    {
        id: "vercel",
        options: { clientId: "cid", clientSecret: "sec" },
        authHost: "vercel.com",
        expectInUrl: ["client_id=cid", "state=st-1", "code_challenge"],
    },
    {
        id: "vk",
        options: { clientId: "cid", clientSecret: "sec" },
        authHost: "id.vk.com",
        expectInUrl: ["client_id=cid", "state=st-1"],
    },
    {
        id: "wechat",
        options: { clientId: "appid", clientSecret: "sec" },
        authHost: "open.weixin.qq.com",
        expectInUrl: ["appid=appid", "state=st-1"],
    },
    {
        id: "zoom",
        options: { clientId: "cid", clientSecret: "sec" },
        authHost: "zoom.us",
        expectInUrl: ["client_id=cid", "state=st-1", "code_challenge"],
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
