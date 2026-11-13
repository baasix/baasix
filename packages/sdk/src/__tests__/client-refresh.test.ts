import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "../client";
import { MemoryStorageAdapter } from "../storage/memoryStorage";
import { STORAGE_KEYS } from "../storage/types";

function response(status: number, body: unknown): Response {
  return { ok: status < 400, status, statusText: "", json: async () => body } as unknown as Response;
}

describe("HttpClient JWT refresh", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // The server refreshes from the Bearer token; it never issues a refresh token,
  // so the old "requires stored refresh token" path made every 401 a logout.
  it("on 401, refreshes with the current access token as Bearer and retries", async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set(STORAGE_KEYS.ACCESS_TOKEN, "old-token");
    const client = new HttpClient({
      baseUrl: "http://api.test",
      authMode: "jwt",
      storage,
      timeout: 5000,
      autoRefresh: true,
      credentials: "omit",
      headers: {},
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(401, { error: { message: "Session expired or invalid" } }))
      .mockResolvedValueOnce(response(200, { token: "new-token", expiresIn: 3600 }))
      .mockResolvedValueOnce(response(200, { data: [] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await client.get<{ data: unknown[] }>("/items/posts");

    expect(result).toEqual({ data: [] });
    const [refreshUrl, refreshInit] = fetchMock.mock.calls[1];
    expect(refreshUrl).toContain("/auth/refresh");
    expect((refreshInit.headers as Record<string, string>).Authorization).toBe("Bearer old-token");
    const retryInit = fetchMock.mock.calls[2][1];
    expect((retryInit.headers as Record<string, string>).Authorization).toBe("Bearer new-token");
    expect(await storage.get(STORAGE_KEYS.ACCESS_TOKEN)).toBe("new-token");
  });
});
