/**
 * Startup security-posture check.
 *
 * Surfaces every security/integrity-relevant setting that is currently in a
 * LESS-SAFE state — whether because the user set it that way, or because the
 * backward-compatible default is the less-strict option. The goal is a single,
 * loud, grouped banner at boot so a new operator who inherited an .env (or never
 * configured these) immediately sees what protections are off and how to enable
 * them. It only WARNS — it never changes behavior or refuses to start.
 *
 * To add a new check: append an entry to SECURITY_CHECKS. `isLessSafe` returns
 * true when the current value is the weaker posture; `message`/`fix` explain it.
 */

import env from "./env.js";

/** Recommended minimum length for the JWT signing secret. */
export const MIN_SECRET_LENGTH = 32;

interface SecurityCheck {
  /** Env var(s) this check reads (for display). */
  key: string;
  /** Short category for grouping. */
  category: string;
  /** True when the current configuration is the LESS-SAFE option. */
  isLessSafe: () => boolean;
  /** What the weaker state means (the risk). */
  message: string;
  /** How to harden it. */
  fix: string;
}

/** Helper: a tri/boolean env that is "off" unless explicitly the safe value. */
const get = (k: string): string | undefined => env.get(k);

const SECURITY_CHECKS: SecurityCheck[] = [
  // --- Authentication: JWT secret strength (missing secret is fatal, handled
  //     separately in validateSecurityPostureAtStartup before the banner) ---
  {
    key: "SECRET_KEY",
    category: "Authentication",
    isLessSafe: () => {
      const secret = get("SECRET_KEY");
      return !!secret && secret.length < MIN_SECRET_LENGTH;
    },
    message: `SECRET_KEY is shorter than the recommended ${MIN_SECRET_LENGTH} characters — a short JWT signing secret weakens token security.`,
    fix: `Rotate to a strong, random secret (>= ${MIN_SECRET_LENGTH} chars). Note: rotating SECRET_KEY invalidates all existing sessions/tokens — plan a maintenance window.`,
  },

  // --- Access control / data exposure ---
  {
    key: "SCHEMAS_PUBLIC",
    category: "Access control",
    isLessSafe: () => get("SCHEMAS_PUBLIC") !== "false",
    message: "GET /schemas is PUBLIC — the full schema of every collection (fields, types, relations) is readable without authentication.",
    fix: "Set SCHEMAS_PUBLIC=false to require permission.",
  },
  {
    key: "PROTECT_PRIVILEGE_FIELDS",
    category: "Access control",
    isLessSafe: () => (get("PROTECT_PRIVILEGE_FIELDS") || "true").toLowerCase() === "false",
    message: "Privilege-field protection is OFF — a broad fields:[\"*\"] grant can set role_Id/tenant_Id/emailVerified/password (mass-assignment / privilege escalation).",
    fix: "Set PROTECT_PRIVILEGE_FIELDS=true (or allow-password for delegated password resets).",
  },
  {
    key: "PROTECT_IS_PUBLIC_FIELD",
    category: "Access control",
    isLessSafe: () => get("PROTECT_IS_PUBLIC_FIELD") !== "true",
    message: "A user with a broad file-write grant can set isPublic on a file, making it world-readable cross-tenant without auth.",
    fix: "Set PROTECT_IS_PUBLIC_FIELD=true to require an explicit grant for isPublic.",
  },
  {
    key: "EXPOSE_ERROR_DETAILS",
    category: "Information disclosure",
    // Less-safe = details are exposed: explicit true, OR (unset AND not production).
    isLessSafe: () => {
      const v = get("EXPOSE_ERROR_DETAILS");
      if (v === "true") return true;
      if (v === "false") return false;
      return env.get("NODE_ENV") !== "production";
    },
    message: "Raw database/internal error text is returned to clients — leaks schema/table/column names and is a SQL-injection oracle.",
    fix: "Set EXPOSE_ERROR_DETAILS=false (and/or NODE_ENV=production) to return generic messages + a correlation id.",
  },

  // --- Tenant isolation ---
  {
    key: "STRICT_TENANT_ISOLATION",
    category: "Tenant isolation",
    isLessSafe: () => env.get("MULTI_TENANT") === "true" && get("STRICT_TENANT_ISOLATION") === "false",
    message: "Strict tenant isolation is OFF — ANY role marked isTenantSpecific:false bypasses tenant scoping (potential cross-tenant exposure from a misconfigured role).",
    fix: "Set STRICT_TENANT_ISOLATION=true to restrict the bypass to administrators.",
  },

  // --- File handling ---
  {
    key: "STORAGE_PATH_CONFINEMENT",
    category: "File handling",
    isLessSafe: () => get("STORAGE_PATH_CONFINEMENT") === "false",
    message: "Storage path confinement is OFF — crafted filenames may escape the storage root (path traversal).",
    fix: "Set STORAGE_PATH_CONFINEMENT=true (the default) to confine all local-disk access to the storage root.",
  },
  {
    key: "SSRF_ALLOW_PRIVATE_URL_FETCH",
    category: "File handling",
    isLessSafe: () => get("SSRF_ALLOW_PRIVATE_URL_FETCH") === "true",
    message: "Server-side URL fetches (upload-from-URL, workflow HTTP) may reach PRIVATE/loopback/cloud-metadata addresses (SSRF — can steal cloud credentials).",
    fix: "Unset SSRF_ALLOW_PRIVATE_URL_FETCH (or set it to false) to block private ranges.",
  },
  {
    key: "ASSET_XSS_PROTECTION / ASSET_NOSNIFF",
    category: "File handling",
    isLessSafe: () => get("ASSET_XSS_PROTECTION") === "false" || get("ASSET_NOSNIFF") === "false",
    message: "Asset XSS/nosniff protections are weakened — uploaded HTML/SVG/JS may execute in the browser (stored XSS).",
    fix: "Leave ASSET_XSS_PROTECTION and ASSET_NOSNIFF at their defaults (do not set them to false).",
  },

  // --- Authentication ---
  {
    key: "AUTH_RATE_LIMIT_DISABLED",
    category: "Authentication",
    isLessSafe: () => get("AUTH_RATE_LIMIT_DISABLED") === "true",
    message: "The auth brute-force limiter is DISABLED — login / magic-link / password-reset have no dedicated throttle.",
    fix: "Unset AUTH_RATE_LIMIT_DISABLED to re-enable the per-(IP+email) limiter.",
  },
  {
    key: "OAUTH_ALLOW_UNVERIFIED_LINK",
    category: "Authentication",
    isLessSafe: () => get("OAUTH_ALLOW_UNVERIFIED_LINK") === "true",
    message: "OAuth logins link to existing accounts even when the provider email is UNVERIFIED (account-takeover risk).",
    fix: "Unset OAUTH_ALLOW_UNVERIFIED_LINK so linking requires a verified email.",
  },
  {
    key: "OAUTH_ALLOW_DIRECT_IDTOKEN",
    category: "Authentication",
    isLessSafe: () => get("OAUTH_ALLOW_DIRECT_IDTOKEN") === "true",
    message: "The client-supplied direct ID-token sign-in path is ENABLED — only safe with a provider that verifies signatures (Google/Apple).",
    fix: "Unset OAUTH_ALLOW_DIRECT_IDTOKEN unless you specifically need it and your provider verifies idToken signatures.",
  },
];

/**
 * Evaluate the checks and return the keys currently in a less-safe state. Pure
 * (no output) so it can be unit-tested directly. Used by
 * validateSecurityPostureAtStartup for the banner.
 */
export function evaluateSecurityPosture(): string[] {
  return SECURITY_CHECKS.filter((c) => {
    try {
      return c.isLessSafe();
    } catch {
      return false;
    }
  }).map((c) => c.key);
}

/**
 * The one fatal startup check: a missing SECRET_KEY means nothing can authenticate
 * safely, so the server must NOT start. Throws. (Short-but-present secrets are an
 * advisory posture check, not fatal — see the SECRET_KEY entry above.) Always runs,
 * including under TEST_MODE, since a missing secret is fatal regardless.
 */
export function assertRequiredSecuritySettings(): void {
  if (!env.get("SECRET_KEY")) {
    throw new Error(
      "SECRET_KEY is not configured. Set a strong SECRET_KEY (>= 32 characters) before starting the server."
    );
  }
}

/**
 * Single startup security entry point:
 *  1. Hard-fail on missing required settings (SECRET_KEY) — fail fast.
 *  2. Print a grouped advisory banner for every setting in a less-safe state.
 * No banner when everything is safe; banner skipped under TEST_MODE (the fatal
 * check in step 1 still runs). Returns the list of triggered advisory keys.
 */
export function validateSecurityPostureAtStartup(): string[] {
  // Step 1: fatal checks run unconditionally.
  assertRequiredSecuritySettings();

  // Step 2: advisory banner — skipped under TEST_MODE to keep test logs clean.
  if (env.get("TEST_MODE") === "true") return [];

  const triggeredKeys = new Set(evaluateSecurityPosture());
  const triggered = SECURITY_CHECKS.filter((c) => triggeredKeys.has(c.key));

  if (triggered.length === 0) return [];

  const byCategory = new Map<string, SecurityCheck[]>();
  for (const c of triggered) {
    if (!byCategory.has(c.category)) byCategory.set(c.category, []);
    byCategory.get(c.category)!.push(c);
  }

  const lines: string[] = [];
  lines.push("");
  lines.push("════════════════════════════════════════════════════════════════════");
  lines.push(`⚠️  [SECURITY POSTURE] ${triggered.length} protection(s) are in a LESS-SAFE state.`);
  lines.push("   These are either disabled by default for backward compatibility or set");
  lines.push("   that way in your environment. Review each before running in production.");
  lines.push("════════════════════════════════════════════════════════════════════");
  for (const [category, checks] of byCategory) {
    lines.push("");
    lines.push(`  ▸ ${category}`);
    for (const c of checks) {
      lines.push(`    • ${c.key}`);
      lines.push(`        ${c.message}`);
      lines.push(`        → ${c.fix}`);
    }
  }
  lines.push("");
  lines.push("   (This is an advisory banner only — it does not change behavior.)");
  lines.push("════════════════════════════════════════════════════════════════════");
  lines.push("");

  console.warn(lines.join("\n"));
  return triggered.map((c) => c.key);
}
