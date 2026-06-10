import { test, expect, describe, afterEach } from "@jest/globals";
import { isBlockedIp, assertSafeFetchUrl } from "../baasix/utils/ssrfGuard";
import env from "../baasix/utils/env";

/**
 * A9 — SSRF guard for upload-from-URL / workflow HTTP fetches.
 *
 * Blocks private, loopback, link-local, and cloud-metadata addresses; allows
 * public ones; rejects non-http(s) schemes. Pure logic — no network needed for
 * the IP-range and literal-IP cases.
 */

afterEach(() => {
  env.set("SSRF_ALLOW_PRIVATE_URL_FETCH", "false");
});

describe("isBlockedIp", () => {
  test("blocks loopback / private / link-local / metadata (IPv4)", () => {
    for (const ip of [
      "127.0.0.1",
      "169.254.169.254", // cloud metadata
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "0.0.0.0",
      "100.64.0.1", // CGNAT
    ]) {
      expect(isBlockedIp(ip)).toBe(true);
    }
  });

  test("blocks loopback / link-local / ULA (IPv6)", () => {
    for (const ip of ["::1", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1"]) {
      expect(isBlockedIp(ip)).toBe(true);
    }
  });

  test("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "192.169.0.1", "2606:4700:4700::1111"]) {
      expect(isBlockedIp(ip)).toBe(false);
    }
  });
});

describe("assertSafeFetchUrl", () => {
  test("rejects non-http(s) schemes", async () => {
    await expect(assertSafeFetchUrl("file:///etc/passwd")).rejects.toThrow(/scheme/i);
    await expect(assertSafeFetchUrl("ftp://example.com/x")).rejects.toThrow(/scheme/i);
    await expect(assertSafeFetchUrl("gopher://x")).rejects.toThrow(/scheme/i);
  });

  test("rejects the cloud-metadata IP literal", async () => {
    await expect(assertSafeFetchUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
      /private\/loopback\/metadata/i
    );
  });

  test("rejects loopback literal", async () => {
    await expect(assertSafeFetchUrl("http://127.0.0.1:8080/internal")).rejects.toThrow(
      /private\/loopback\/metadata/i
    );
    await expect(assertSafeFetchUrl("http://[::1]/internal")).rejects.toThrow(
      /private\/loopback\/metadata/i
    );
  });

  test("rejects an invalid URL", async () => {
    await expect(assertSafeFetchUrl("not a url")).rejects.toThrow(/Invalid URL/i);
  });

  test("SSRF_ALLOW_PRIVATE_URL_FETCH=true allows private literals (scheme still enforced)", async () => {
    env.set("SSRF_ALLOW_PRIVATE_URL_FETCH", "true");
    await expect(assertSafeFetchUrl("http://127.0.0.1:8080/internal")).resolves.toBeUndefined();
    // Scheme is still enforced even with the override.
    await expect(assertSafeFetchUrl("file:///etc/passwd")).rejects.toThrow(/scheme/i);
  });
});
