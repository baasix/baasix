import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "../client";
import { BaasixError } from "../types";
import { MemoryStorageAdapter } from "../storage/memoryStorage";

function makeClient() {
  return new HttpClient({
    baseUrl: "http://api.test",
    authMode: "cookie",
    storage: new MemoryStorageAdapter(),
    timeout: 5000,
    autoRefresh: false,
    credentials: "omit",
    headers: {},
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: false,
    status,
    statusText: "Error",
    json: async () => body,
  } as unknown as Response;
}

describe("HttpClient error parsing", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("parses nested error shape { error: { message, code } }", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse(403, { error: { message: "Registration is disabled", code: "REGISTRATION_DISABLED" } })
    );

    const client = makeClient();
    await expect(client.request("GET", "/auth/register")).rejects.toMatchObject({
      message: "Registration is disabled",
      code: "REGISTRATION_DISABLED",
      status: 403,
    });
  });

  it("parses top-level error shape { message, code }", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse(403, { message: "Registration is disabled", code: "REGISTRATION_DISABLED" })
    );

    const client = makeClient();
    let caught: unknown;
    try {
      await client.request("GET", "/auth/register");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BaasixError);
    expect((caught as BaasixError).message).toBe("Registration is disabled");
    expect((caught as BaasixError).code).toBe("REGISTRATION_DISABLED");
    expect((caught as BaasixError).status).toBe(403);
  });

  it("parses top-level 401 error shape for INVALID_TWO_FACTOR_CODE", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse(401, { message: "Invalid two-factor code", code: "INVALID_TWO_FACTOR_CODE" })
    );

    const client = makeClient();
    await expect(client.request("POST", "/auth/2fa/verify")).rejects.toMatchObject({
      message: "Invalid two-factor code",
      code: "INVALID_TWO_FACTOR_CODE",
      status: 401,
    });
  });

  it("prefers nested error.code/message over top-level fields when both exist", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse(400, {
        message: "top-level message",
        code: "TOP_LEVEL_CODE",
        error: { message: "nested message", code: "NESTED_CODE" },
      })
    );

    const client = makeClient();
    await expect(client.request("GET", "/whatever")).rejects.toMatchObject({
      message: "nested message",
      code: "NESTED_CODE",
      status: 400,
    });
  });

  const parse = async (status: number, body: unknown) => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(status, body));
    try {
      await makeClient().request("GET", "/x");
    } catch (error) {
      return error as BaasixError;
    }
    throw new Error("expected a rejection");
  };

  it("uses a plain-string error body as the message", async () => {
    const err = await parse(401, { error: "Authentication required" });
    expect(err.message).toBe("Authentication required");
    expect(err.details).toBeUndefined();
  });

  it("reads details from core's error.details: string, object and array", async () => {
    expect((await parse(400, { error: { message: "Invalid", details: "premake must be 0-12", statusCode: 400 } })).details)
      .toEqual([{ message: "premake must be 0-12" }]);

    const validation = { code: "VALIDATION_ERROR", errors: [{ field: "email", message: "required" }] };
    expect((await parse(400, { error: { message: "Validation failed", details: validation } })).details)
      .toEqual([validation]);

    const list = [{ field: "a", message: "bad" }];
    expect((await parse(400, { error: { message: "x", details: list } })).details).toEqual(list);
  });

  it("still reads top-level details and code", async () => {
    const err = await parse(409, { message: "Conflict", code: "C", details: [{ field: "slug" }] });
    expect(err.code).toBe("C");
    expect(err.details).toEqual([{ field: "slug" }]);
  });

  it("falls back to statusText for non-JSON and empty bodies", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 502, statusText: "Bad Gateway", json: async () => { throw new Error("not json"); },
    } as unknown as Response);
    await expect(makeClient().request("GET", "/x")).rejects.toMatchObject({ message: "Bad Gateway", status: 502 });

    const empty = await parse(500, {});
    expect(empty.message).toBe("Error");
    expect(empty.details).toBeUndefined();
  });
});
