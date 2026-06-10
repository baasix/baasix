/**
 * SSRF guard for server-side outbound fetches of user-supplied URLs.
 *
 * Blocks requests to private, loopback, link-local, and cloud-metadata addresses
 * so an attacker cannot use a "fetch this URL" feature (e.g. upload-from-URL) to
 * reach internal services or steal cloud credentials.
 *
 * Defenses:
 *  - scheme allowlist (http/https only)
 *  - resolve the hostname to IPs and block dangerous ranges (checks the RESOLVED
 *    address, not just the hostname — defeats `evil.com → 127.0.0.1`)
 *  - validate every redirect hop (the caller follows redirects manually)
 *
 * Override: SSRF_ALLOW_PRIVATE_URL_FETCH=true disables the private-range block
 * (e.g. for a trusted internal-only deployment). Scheme validation still applies.
 */

import dns from "dns/promises";
import net from "net";
import env from "./env.js";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** True if the deployment has explicitly opted out of private-range blocking. */
function privateFetchAllowed(): boolean {
  return env.get("SSRF_ALLOW_PRIVATE_URL_FETCH") === "true";
}

/**
 * Decide whether an IP address is in a range we must never fetch from.
 * Covers loopback, private (RFC1918 / ULA), link-local (incl. cloud metadata
 * 169.254.169.254), and other non-public ranges, for both IPv4 and IPv6.
 */
export function isBlockedIp(ip: string): boolean {
  const type = net.isIP(ip);
  if (type === 0) return true; // not a valid IP — treat as blocked

  if (type === 4) {
    const octets = ip.split(".").map((n) => parseInt(n, 10));
    const [a, b] = octets;
    if (a === 0) return true;                       // 0.0.0.0/8
    if (a === 10) return true;                      // 10.0.0.0/8 (private)
    if (a === 127) return true;                     // 127.0.0.0/8 (loopback)
    if (a === 169 && b === 254) return true;        // 169.254.0.0/16 (link-local incl. metadata)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 (private)
    if (a === 192 && b === 168) return true;        // 192.168.0.0/16 (private)
    if (a === 192 && b === 0 && octets[2] === 0) return true; // 192.0.0.0/24
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
    if (a >= 224) return true;                      // 224.0.0.0/4 multicast + 240/4 reserved
    return false;
  }

  // IPv6
  const lower = ip.toLowerCase();
  if (lower === "::1") return true;                 // loopback
  if (lower === "::" ) return true;                 // unspecified
  if (lower.startsWith("fe80")) return true;        // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local (fc00::/7)
  if (lower.startsWith("ff")) return true;          // multicast
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — re-check the embedded IPv4.
  const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIp(mapped[1]);
  return false;
}

/**
 * Validate that a single URL is safe to fetch: allowed scheme, and (unless the
 * private-fetch override is set) every resolved IP is in a public range.
 * @throws Error describing why it was rejected.
 */
export async function assertSafeFetchUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new Error(`Blocked URL scheme: ${url.protocol} (only http/https allowed)`);
  }

  if (privateFetchAllowed()) return; // operator opted out of private-range blocking

  const hostname = url.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets

  // If the host is a literal IP, check it directly.
  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new Error("Blocked URL: resolves to a private/loopback/metadata address");
    }
    return;
  }

  // Otherwise resolve and check EVERY address (defeats split-horizon / multi-record DNS).
  let addresses: string[];
  try {
    const results = await dns.lookup(hostname, { all: true });
    addresses = results.map((r) => r.address);
  } catch {
    throw new Error("Blocked URL: hostname could not be resolved");
  }
  if (addresses.length === 0) {
    throw new Error("Blocked URL: hostname did not resolve to any address");
  }
  for (const addr of addresses) {
    if (isBlockedIp(addr)) {
      throw new Error("Blocked URL: resolves to a private/loopback/metadata address");
    }
  }
}
