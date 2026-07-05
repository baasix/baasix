import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { AuthModule } from "../auth";
import { MemoryStorageAdapter } from "../../storage/memoryStorage";
import { BaasixError } from "../../types";
import type { HttpClient } from "../../client";

const startRegistrationMock = vi.fn();
const startAuthenticationMock = vi.fn();

vi.mock("@simplewebauthn/browser", () => ({
  startRegistration: (...args: unknown[]) => startRegistrationMock(...args),
  startAuthentication: (...args: unknown[]) => startAuthenticationMock(...args),
}));

function makeAuth(
  clientOverrides: Partial<Record<"get" | "post" | "delete", any>> = {}
) {
  const get = clientOverrides.get ?? vi.fn();
  const post = clientOverrides.post ?? vi.fn();
  const del = clientOverrides.delete ?? vi.fn();
  const client = {
    get,
    post,
    delete: del,
    getBaseUrl: () => "http://api.test",
  } as unknown as HttpClient;
  const auth = new AuthModule({ client, storage: new MemoryStorageAdapter(), authMode: "jwt" });
  return { auth, get, post, del };
}

describe("auth.passkey (browser guard)", () => {
  it("throws BaasixError when window is not available", async () => {
    const { auth } = makeAuth();

    await expect(auth.passkey.register()).rejects.toThrow(BaasixError);
    await expect(auth.passkey.register()).rejects.toThrow(
      "Passkeys are only available in a browser"
    );
    await expect(auth.passkey.authenticate()).rejects.toThrow(BaasixError);
  });
});

describe("auth.passkey (browser environment)", () => {
  beforeEach(() => {
    (globalThis as any).window = { PublicKeyCredential: function () {} };
    startRegistrationMock.mockReset();
    startAuthenticationMock.mockReset();
  });

  afterEach(() => {
    delete (globalThis as any).window;
  });

  it("register() posts options, starts registration, and verifies the attestation", async () => {
    const creationOptions = { challenge: "chal-1", rp: { id: "test" } };
    const attestation = { id: "cred-1", rawId: "cred-1", response: {} };

    const post = vi
      .fn()
      .mockResolvedValueOnce(creationOptions) // /auth/passkey/register/options
      .mockResolvedValueOnce({ verified: true, passkey: { id: "cred-1", name: "My Key" } }); // /auth/passkey/register/verify

    startRegistrationMock.mockResolvedValue(attestation);

    const { auth } = makeAuth({ post });

    const result = await auth.passkey.register("My Key");

    expect(result).toEqual({ verified: true });
    expect(post).toHaveBeenNthCalledWith(1, "/auth/passkey/register/options", {});
    expect(startRegistrationMock).toHaveBeenCalledWith({ optionsJSON: creationOptions });
    expect(post).toHaveBeenNthCalledWith(2, "/auth/passkey/register/verify", {
      response: attestation,
      name: "My Key",
    });
  });

  it("register() defaults name to null when omitted", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({ challenge: "chal-1" })
      .mockResolvedValueOnce({ verified: true });

    startRegistrationMock.mockResolvedValue({ id: "cred-1" });

    const { auth } = makeAuth({ post });
    await auth.passkey.register();

    expect(post).toHaveBeenNthCalledWith(2, "/auth/passkey/register/verify", {
      response: { id: "cred-1" },
      name: null,
    });
  });

  it("authenticate() posts options, starts authentication, verifies, and stores tokens", async () => {
    const options = { challenge: "chal-2" };
    const challengeId = "challenge-id-1";
    const assertion = { id: "cred-1", response: {} };
    const authResponse = {
      token: "jwt-token-1",
      user: { id: "u1", email: "a@b.c" },
    };

    const post = vi
      .fn()
      .mockResolvedValueOnce({ options, challengeId }) // /auth/passkey/authenticate/options
      .mockResolvedValueOnce(authResponse); // /auth/passkey/authenticate/verify

    startAuthenticationMock.mockResolvedValue(assertion);

    const { auth } = makeAuth({ post });

    const result = await auth.passkey.authenticate();

    expect(result).toEqual(authResponse);
    expect(post).toHaveBeenNthCalledWith(
      1,
      "/auth/passkey/authenticate/options",
      {},
      { skipAuth: true }
    );
    expect(startAuthenticationMock).toHaveBeenCalledWith({ optionsJSON: options });
    expect(post).toHaveBeenNthCalledWith(
      2,
      "/auth/passkey/authenticate/verify",
      { challengeId, response: assertion, authMode: undefined },
      { skipAuth: true }
    );
    expect(await auth.getToken()).toBe("jwt-token-1");
  });

  it("authenticate() forwards authMode option", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({ options: {}, challengeId: "c1" })
      .mockResolvedValueOnce({ token: "jwt-2", user: { id: "u2", email: "x@y.z" } });

    startAuthenticationMock.mockResolvedValue({ id: "cred-2" });

    const { auth } = makeAuth({ post });
    await auth.passkey.authenticate({ authMode: "cookie" });

    expect(post).toHaveBeenNthCalledWith(
      2,
      "/auth/passkey/authenticate/verify",
      { challengeId: "c1", response: { id: "cred-2" }, authMode: "cookie" },
      { skipAuth: true }
    );
  });

  it("list() returns the passkeys array", async () => {
    const passkeys = [
      {
        id: "p1",
        name: "Laptop",
        deviceType: "singleDevice",
        backedUp: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        lastUsedAt: null,
      },
    ];
    const get = vi.fn().mockResolvedValue({ passkeys });
    const { auth } = makeAuth({ get });

    const result = await auth.passkey.list();

    expect(get).toHaveBeenCalledWith("/auth/passkey");
    expect(result).toEqual(passkeys);
  });

  it("remove() calls delete with the encoded passkey id", async () => {
    const del = vi.fn().mockResolvedValue(undefined);
    const { auth } = makeAuth({ delete: del });

    await auth.passkey.remove("p1 id");

    expect(del).toHaveBeenCalledWith("/auth/passkey/p1%20id");
  });
});
