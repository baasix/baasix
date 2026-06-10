import { test, expect, describe, afterEach } from "@jest/globals";
import {
  evaluateSecurityPosture,
  assertRequiredSecuritySettings,
} from "../baasix/utils/securityPosture";
import env from "../baasix/utils/env";

/**
 * Startup security-posture check — surfaces every security/integrity setting
 * currently in a LESS-SAFE state (disabled by default or set so in the env), so a
 * new operator immediately sees what protections are off. These tests drive the
 * pure evaluator directly.
 */

// Keys we toggle, restored to a safe baseline after each test.
const TOGGLES = [
  "SECRET_KEY",
  "SCHEMAS_PUBLIC",
  "PROTECT_PRIVILEGE_FIELDS",
  "PROTECT_IS_PUBLIC_FIELD",
  "EXPOSE_ERROR_DETAILS",
  "STRICT_TENANT_ISOLATION",
  "MULTI_TENANT",
  "STORAGE_PATH_CONFINEMENT",
  "SSRF_ALLOW_PRIVATE_URL_FETCH",
  "ASSET_XSS_PROTECTION",
  "ASSET_NOSNIFF",
  "AUTH_RATE_LIMIT_DISABLED",
  "OAUTH_ALLOW_UNVERIFIED_LINK",
  "OAUTH_ALLOW_DIRECT_IDTOKEN",
  "NODE_ENV",
];

const SAFE_SECRET = "a-strong-test-secret-of-at-least-32-characters";

/** Put every toggle into its SAFE state. */
function setAllSafe() {
  env.set("SECRET_KEY", SAFE_SECRET);
  env.set("SCHEMAS_PUBLIC", "false");
  env.set("PROTECT_PRIVILEGE_FIELDS", "true");
  env.set("PROTECT_IS_PUBLIC_FIELD", "true");
  env.set("EXPOSE_ERROR_DETAILS", "false");
  env.set("MULTI_TENANT", "false");
  env.set("STRICT_TENANT_ISOLATION", "true");
  env.set("STORAGE_PATH_CONFINEMENT", "true");
  env.set("SSRF_ALLOW_PRIVATE_URL_FETCH", "false");
  env.set("ASSET_XSS_PROTECTION", "true");
  env.set("ASSET_NOSNIFF", "true");
  env.set("AUTH_RATE_LIMIT_DISABLED", "false");
  env.set("OAUTH_ALLOW_UNVERIFIED_LINK", "false");
  env.set("OAUTH_ALLOW_DIRECT_IDTOKEN", "false");
}

// Capture whatever SECRET_KEY the test env booted with, so we restore it (rather
// than clearing it) and never leave a missing secret for other suites.
const ORIGINAL_SECRET = env.get("SECRET_KEY") || "";

afterEach(() => {
  for (const k of TOGGLES) {
    if (k === "SECRET_KEY") env.set("SECRET_KEY", ORIGINAL_SECRET);
    else env.set(k, "");
  }
});

describe("security posture evaluator", () => {
  test("all-safe configuration triggers no warnings", () => {
    setAllSafe();
    expect(evaluateSecurityPosture()).toEqual([]);
  });

  test("each unsafe toggle is individually detected", () => {
    setAllSafe();
    env.set("SCHEMAS_PUBLIC", "true");
    expect(evaluateSecurityPosture()).toContain("SCHEMAS_PUBLIC");

    setAllSafe();
    env.set("PROTECT_PRIVILEGE_FIELDS", "false");
    expect(evaluateSecurityPosture()).toContain("PROTECT_PRIVILEGE_FIELDS");

    setAllSafe();
    env.set("SSRF_ALLOW_PRIVATE_URL_FETCH", "true");
    expect(evaluateSecurityPosture()).toContain("SSRF_ALLOW_PRIVATE_URL_FETCH");

    setAllSafe();
    env.set("AUTH_RATE_LIMIT_DISABLED", "true");
    expect(evaluateSecurityPosture()).toContain("AUTH_RATE_LIMIT_DISABLED");

    setAllSafe();
    env.set("OAUTH_ALLOW_UNVERIFIED_LINK", "true");
    expect(evaluateSecurityPosture()).toContain("OAUTH_ALLOW_UNVERIFIED_LINK");

    setAllSafe();
    env.set("STORAGE_PATH_CONFINEMENT", "false");
    expect(evaluateSecurityPosture()).toContain("STORAGE_PATH_CONFINEMENT");
  });

  test("strict tenant isolation only flagged when MULTI_TENANT is on", () => {
    setAllSafe();
    env.set("STRICT_TENANT_ISOLATION", "false");
    // MULTI_TENANT is false → not applicable, no warning.
    expect(evaluateSecurityPosture()).not.toContain("STRICT_TENANT_ISOLATION");

    env.set("MULTI_TENANT", "true");
    expect(evaluateSecurityPosture()).toContain("STRICT_TENANT_ISOLATION");
  });

  test("a short (but present) SECRET_KEY is flagged; a strong one is not", () => {
    setAllSafe();
    env.set("SECRET_KEY", "short");
    expect(evaluateSecurityPosture()).toContain("SECRET_KEY");

    env.set("SECRET_KEY", SAFE_SECRET);
    expect(evaluateSecurityPosture()).not.toContain("SECRET_KEY");
  });

  test("a MISSING SECRET_KEY is fatal (assertRequiredSecuritySettings throws)", () => {
    env.set("SECRET_KEY", "");
    expect(() => assertRequiredSecuritySettings()).toThrow(/SECRET_KEY/);
    // Restore so we don't leave a missing secret for other suites.
    env.set("SECRET_KEY", ORIGINAL_SECRET);
  });

  test("EXPOSE_ERROR_DETAILS: unset defaults to UNSAFE outside production, safe in production", () => {
    setAllSafe();
    env.set("EXPOSE_ERROR_DETAILS", ""); // unset
    env.set("NODE_ENV", "development");
    expect(evaluateSecurityPosture()).toContain("EXPOSE_ERROR_DETAILS");

    env.set("NODE_ENV", "production");
    expect(evaluateSecurityPosture()).not.toContain("EXPOSE_ERROR_DETAILS");
  });
});
