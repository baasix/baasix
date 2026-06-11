import { describe, expect, it, vi } from "vitest";
import { ServerModule } from "../server";
import type { HttpClient } from "../../client";

function makeClient() {
  const get = vi.fn().mockResolvedValue({ project: { name: "Test" } });
  return { client: { get } as unknown as HttpClient, get };
}

describe("ServerModule.info", () => {
  it("calls / without params when no tenantId given", async () => {
    const { client, get } = makeClient();
    const server = new ServerModule({ client });
    await server.info();
    expect(get.mock.calls[0][0]).toBe("/");
    expect(get.mock.calls[0][1]).toBeUndefined();
  });

  it("passes tenant_id as query param when tenantId given", async () => {
    const { client, get } = makeClient();
    const server = new ServerModule({ client });
    await server.info("tenant-123");
    expect(get).toHaveBeenCalledWith("/", { params: { tenant_id: "tenant-123" } });
  });
});
