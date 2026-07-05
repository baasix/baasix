import { describe, expect, it, vi } from "vitest";
import { AuthModule, SOCIAL_PROVIDERS } from "../auth";
import { MemoryStorageAdapter } from "../../storage/memoryStorage";
import type { HttpClient } from "../../client";

function makeAuth(clientOverrides: Partial<Record<"get" | "post", any>> = {}) {
  const get = clientOverrides.get ?? vi.fn();
  const post = clientOverrides.post ?? vi.fn();
  const client = { get, post, getBaseUrl: () => "http://api.test" } as unknown as HttpClient;
  const auth = new AuthModule({ client, storage: new MemoryStorageAdapter(), authMode: "jwt" });
  return { auth, get, post };
}

describe("SOCIAL_PROVIDERS", () => {
  it("contains all 35 better-auth provider ids", () => {
    expect(SOCIAL_PROVIDERS.length).toBe(35);
    expect(SOCIAL_PROVIDERS).toContain("discord");
    expect(SOCIAL_PROVIDERS).toContain("wechat");
  });
});

describe("getAuthMethods", () => {
  it("reads project.auth from GET / and caches it", async () => {
    const payload = { project: { auth: { registration: true, emailPassword: true, magicLink: false, passkey: true, twoFactor: true, socialProviders: ["google"] } } };
    const { auth, get } = makeAuth({ get: vi.fn().mockResolvedValue(payload) });
    const first = await auth.getAuthMethods();
    expect(first.passkey).toBe(true);
    await auth.getAuthMethods();
    expect(get).toHaveBeenCalledTimes(1);
    await auth.getAuthMethods(true);
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe("login with 2FA", () => {
  it("returns the challenge without storing tokens", async () => {
    const { auth, post } = makeAuth({ post: vi.fn().mockResolvedValue({ twoFactorRequired: true, twoFactorToken: "tok-123" }) });
    const result = await auth.login({ email: "a@b.c", password: "x" });
    expect("twoFactorRequired" in result && result.twoFactorRequired).toBe(true);
    expect(await auth.getToken()).toBeNull();
  });

  it("twoFactor.verify stores tokens", async () => {
    const { auth, post } = makeAuth({ post: vi.fn().mockResolvedValue({ token: "jwt-1", user: { id: "u1", email: "a@b.c" } }) });
    const result = await auth.twoFactor.verify("tok-123", "000111");
    expect(result.token).toBe("jwt-1");
    expect(post).toHaveBeenCalledWith("/auth/2fa/verify", expect.objectContaining({ twoFactorToken: "tok-123", code: "000111" }), expect.anything());
    expect(await auth.getToken()).toBe("jwt-1");
  });
});
