import { describe, expect, it, vi } from "vitest";
import { ServerModule } from "../server";
import type { HttpClient } from "../../client";

function makeClient() {
  return { get: vi.fn().mockResolvedValue({ project: { name: "Test" } }) } as unknown as HttpClient;
}

describe("ServerModule.info", () => {
  it("calls / without params when no tenantId given", async () => {
    const client = makeClient();
    const server = new ServerModule({ client });
    await server.info();
    expect((client.get as any)).toHaveBeenCalledWith("/", undefined);
  });

  it("passes tenant_id as query param when tenantId given", async () => {
    const client = makeClient();
    const server = new ServerModule({ client });
    await server.info("tenant-123");
    expect((client.get as any)).toHaveBeenCalledWith("/", { params: { tenant_id: "tenant-123" } });
  });
});
