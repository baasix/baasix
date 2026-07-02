import type { SessionLimits, SessionTypeLimits } from "@baasix/types";

const UNLIMITED = -1;

/** Extract an integer limit for `sessionType` from a {web, mobile} object; undefined if absent/malformed. */
function limitFrom(source: unknown, sessionType: string): number | undefined {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return undefined;
  }
  const value = (source as Record<string, unknown>)[sessionType];
  return typeof value === "number" && Number.isInteger(value) && value >= -1 ? value : undefined;
}

/**
 * Resolve the effective session limit for a login attempt.
 * Precedence: administrator bypass → user override → role limit → default → unlimited.
 * Returns -1 for unlimited, 0 for disabled, positive n for a concrete cap.
 * Malformed configuration at any level is skipped (fail-open).
 */
export function resolveSessionLimit(
  settings: { session_limits?: SessionLimits | null } | null | undefined,
  user: { session_limits?: SessionTypeLimits | null } | null | undefined,
  role: { id: string | number; name: string } | null | undefined,
  sessionType: string
): number {
  if (role?.name === "administrator") {
    return UNLIMITED;
  }

  const userLimit = limitFrom(user?.session_limits, sessionType);
  if (userLimit !== undefined) {
    return userLimit;
  }

  const limits = settings?.session_limits;
  if (!limits || typeof limits !== "object" || Array.isArray(limits)) {
    if (limits && (typeof limits !== "object" || Array.isArray(limits))) {
      console.warn("session_limits setting is malformed; ignoring it");
    }
    return UNLIMITED;
  }

  if (role?.id !== undefined && role?.id !== null) {
    const roleLimit = limitFrom((limits.roles as any)?.[String(role.id)], sessionType);
    if (roleLimit !== undefined) {
      return roleLimit;
    }
  }

  const defaultLimit = limitFrom(limits.default, sessionType);
  return defaultLimit !== undefined ? defaultLimit : UNLIMITED;
}
