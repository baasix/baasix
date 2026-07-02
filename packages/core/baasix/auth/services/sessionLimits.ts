import type { SessionLimits, SessionTypeLimits } from "@baasix/types";

const UNLIMITED = -1;

/** Ensures the "malformed session_limits" warning is logged at most once per process. */
let warnedMalformedSettings = false;

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
  if (limits == null) {
    // Not configured — a normal, expected state, so no warning.
    return UNLIMITED;
  }
  if (typeof limits !== "object" || Array.isArray(limits)) {
    // Present but the wrong shape — worth flagging, but only once per process
    // so a misconfigured setting doesn't flood logs on every login attempt.
    if (!warnedMalformedSettings) {
      console.warn("session_limits setting is malformed; ignoring it");
      warnedMalformedSettings = true;
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

// Lazy imports to avoid circular dependencies (mirrors the pattern the old
// implementations used in session.ts / utils/auth.ts).
let _SettingsService: any = null;
async function getSettingsService() {
  if (!_SettingsService) {
    const module = await import("../../services/SettingsService.js");
    _SettingsService = module.default;
  }
  return _SettingsService;
}

let _ItemsService: any = null;
async function getItemsService() {
  if (!_ItemsService) {
    const module = await import("../../services/ItemsService.js");
    _ItemsService = module.default || (module as any).ItemsService;
  }
  return _ItemsService;
}

export async function validateSessionLimits(
  user: { id: string; session_limits?: SessionTypeLimits | null } | null,
  sessionType: string,
  tenantId: string | null = null,
  role: { id: string | number; name: string } | null = null
): Promise<{ isValid: boolean; error?: string }> {
  if (sessionType === "default") {
    return { isValid: true };
  }

  if (!["mobile", "web"].includes(sessionType)) {
    return { isValid: false, error: "Invalid session type. Must be 'mobile' or 'web'" };
  }

  if (!user?.id) {
    return { isValid: true };
  }

  try {
    const settingsService = await getSettingsService();
    const isMultiTenantEnabled = process.env.MULTI_TENANT === "true";
    const settings = isMultiTenantEnabled && tenantId
      ? await settingsService.getTenantSettings(tenantId)
      : settingsService.getGlobalSettings();

    const limit = resolveSessionLimit(settings, user, role, sessionType);

    if (limit === -1) {
      return { isValid: true };
    }

    if (limit === 0) {
      return {
        isValid: false,
        error: `${sessionType.charAt(0).toUpperCase() + sessionType.slice(1)} sessions are not allowed`,
      };
    }

    const ItemsService = await getItemsService();
    const sessionsService = new ItemsService("baasix_Sessions", { accountability: undefined });

    const filter: any = {
      user_Id: { eq: user.id },
      type: { eq: sessionType },
      expiresAt: { gt: new Date().toISOString() },
    };
    if (isMultiTenantEnabled && tenantId) {
      filter.tenant_Id = { eq: tenantId };
    }

    const activeSessions = await sessionsService.readByQuery({ filter, limit: -1 }, true);
    const count = activeSessions.data?.length || 0;

    if (count >= limit) {
      return {
        isValid: false,
        error: `Maximum ${sessionType} session limit (${limit}) reached. Please logout from another device.`,
      };
    }

    return { isValid: true };
  } catch (error) {
    console.error("Error validating session limits:", error);
    return { isValid: true };
  }
}
