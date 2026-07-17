/**
 * Authentication utilities for Baasix
 * New implementation using the adapter-based auth module
 * Provides backward compatibility with existing exports
 */

import jwt from "jsonwebtoken";
import crypto from "crypto";
import env from "./env.js";
import { APIError } from "./errorHandler.js";
import { getSqlClient } from "./db.js";
import { db } from "./db.js";
import { getCache } from "./cache.js";
import { eq, and, asc } from "drizzle-orm";
import { schemaManager } from "./schemaManager.js";
import { permissionService } from '../services/PermissionService.js';
import { validateSecurityPostureAtStartup } from './securityPosture.js';
import fieldUtils from "./fieldUtils.js";
import type { JWTPayload, UserWithRolesAndPermissions } from '../types/index.js';
import { setContextAccountability } from './requestContext.js';

// Re-export types for backward compatibility
export type { JWTPayload, UserWithRolesAndPermissions };

/**
 * The only JWT algorithm Baasix issues and accepts. Pinning this on every
 * jwt.verify() prevents algorithm-confusion attacks (e.g. `alg:none`, or forging
 * an HS256 token using a public key if the secret were ever asymmetric).
 */
export const JWT_ALGORITHM = 'HS256' as const;

/** Recommended minimum length for the JWT signing secret. */
export const MIN_SECRET_LENGTH = 32;

/**
 * Get the configured JWT secret.
 *
 * Hard requirement: the secret must be present. A missing/empty secret makes every
 * token trivially forgeable, so we always refuse to sign/verify without one.
 *
 * Secret *strength* (length) is NOT enforced here — that is only a recommendation
 * and is surfaced once at startup via validateAuthSecretAtStartup(). This keeps an
 * existing deployment that runs a shorter key working (rather than crashing on the
 * next restart), while still nudging operators to rotate to a stronger secret.
 */
export function getJwtSecret(): string {
  const secret = env.get('SECRET_KEY');
  if (!secret) {
    throw new Error('SECRET_KEY is not configured. Refusing to sign/verify JWTs without a secret.');
  }
  return secret;
}

/**
 * One-time startup validation of the JWT secret. Call this once during server
 * boot (NOT per request). Logs a prominent warning when the secret is shorter than
 * the recommended length so operators can plan a rotation, without breaking a
 * running production system.
 */
export function validateAuthSecretAtStartup(): void {
  // The SECRET_KEY checks (fatal if missing, advisory if short) are now part of the
  // consolidated startup security posture. Delegated here so existing callers/imports
  // keep working; new code can call validateSecurityPostureAtStartup directly.
  validateSecurityPostureAtStartup();
}

/**
 * Lazy getter for ItemsService to avoid circular dependency
 */
let _ItemsService: any = null;
async function getItemsService() {
  if (!_ItemsService) {
    const module = await import('../services/ItemsService.js');
    _ItemsService = module.default || module.ItemsService;
  }
  return _ItemsService;
}

/**
 * Helper function to get and cache roles and permissions
 * Uses PermissionService for role data (cached in memory) and Redis cache for permissions
 */
export async function getRolesAndPermissions(roleId: string | number): Promise<{
  id: string | number;
  name: string;
  description?: string;
  isTenantSpecific?: boolean;
  permissions: Record<string, { action: string; collection: string; fields?: any; conditions?: any }>;
}> {
  const cache = getCache();
  const cacheKey = `auth:role:${roleId}:permissions`;

  // Check cache first
  const cachedRole = await cache.get(cacheKey);
  if (cachedRole) {
    return cachedRole;
  }

  // Get role from PermissionService (hybrid cache), fall back to DB if not cached
  let role = await permissionService.getRoleByIdAsync(roleId);

  if (!role) {
    // Role not in hybrid cache (e.g., freshly created) — query DB directly
    const sqlClient = getSqlClient();
    const roles: any[] = await sqlClient`
      SELECT id, name, description, "isTenantSpecific", "app_access"
      FROM "baasix_Role"
      WHERE id = ${roleId}
      LIMIT 1
    `;
    role = roles[0] || null;
  }

  if (!role) {
    throw new Error(`Role with id ${roleId} not found`);
  }

  // Fetch permissions for the role from database
  const sql = getSqlClient();
  const permissions = await sql`
    SELECT id, collection, action, fields, conditions
    FROM "baasix_Permission"
    WHERE "role_Id" = ${roleId}
  `;

  // Transform permissions to object format
  const permissionsObj = permissions.reduce((acc: any, perm: any) => {
    const key = `${perm.collection}_${perm.action}`;
    acc[key] = {
      action: perm.action,
      collection: perm.collection,
      fields: perm.fields,
      conditions: perm.conditions,
    };
    return acc;
  }, {});

  const roleData = {
    id: role.id,
    name: role.name,
    description: role.description,
    isTenantSpecific: role.isTenantSpecific,
    app_access: (role as any).app_access,
    permissions: permissionsObj,
  };

  // Cache role and permissions with infinite TTL
  await cache.set(cacheKey, roleData, -1);
  return roleData;
}

/**
 * Verify JWT token and return decoded payload
 */
export function verifyJWT(token: string): any {
  const secret = getJwtSecret();

  try {
    return jwt.verify(token, secret, { algorithms: [JWT_ALGORITHM] });
  } catch (error: any) {
    throw new Error(`Invalid token: ${error.message}`);
  }
}

/**
 * Get user with roles, permissions, and tenant information
 */
export async function getUserRolesPermissionsAndTenant(
  userId: string | number,
  tenantId: string | number | null = null,
  userRoleId: string | number | null = null
): Promise<{
  role: {
    id: string | number;
    name: string;
    description?: string;
    isTenantSpecific?: boolean;
  };
  permissions: any;
  tenant?: any;
  userRole?: any;
}> {
  try {
    const sql = getSqlClient();

    // First, get the user's role assignment
    let userRoles: any[] = [];
    if (userRoleId) {
      userRoles = await sql`
        SELECT ur.*
        FROM "baasix_UserRole" ur
        WHERE ur.id = ${userRoleId} AND ur."user_Id" = ${userId}
        LIMIT 1
      `;
    }
    if (userRoles.length === 0) {
      if (tenantId) {
        userRoles = await sql`
          SELECT ur.*
          FROM "baasix_UserRole" ur
          WHERE ur."user_Id" = ${userId} AND ur."tenant_Id" = ${tenantId}
          ORDER BY ur."createdAt" ASC
          LIMIT 1
        `;
      } else {
        userRoles = await sql`
          SELECT ur.*
          FROM "baasix_UserRole" ur
          WHERE ur."user_Id" = ${userId}
          ORDER BY ur."createdAt" ASC
          LIMIT 1
        `;
      }
    }

    if (userRoles.length === 0) {
      throw new Error("User role not found");
    }

    const userRole = userRoles[0];

    // Get role from PermissionService hybrid cache
    let role = await permissionService.getRoleByIdAsync(userRole.role_Id);
    
    // Fallback to database if not in cache
    if (!role) {
      const roles = await sql`
        SELECT id, name, description, "isTenantSpecific"
        FROM "baasix_Role"
        WHERE id = ${userRole.role_Id}
        LIMIT 1
      `;
      if (roles.length > 0) {
        role = {
          id: roles[0].id,
          name: roles[0].name,
          description: roles[0].description,
          isTenantSpecific: roles[0].isTenantSpecific,
        };
      }
    }

    if (!role) {
      throw new Error(`Role with id ${userRole.role_Id} not found`);
    }

    // Fetch permissions for the role
    const permissions = await sql`
      SELECT
        id,
        collection,
        action,
        fields,
        conditions
      FROM "baasix_Permission"
      WHERE "role_Id" = ${userRole.role_Id}
    `;

    // Transform permissions to object format
    const permissionsObj = permissions.reduce((acc: any, perm: any) => {
      const key = `${perm.collection}_${perm.action}`;
      acc[key] = {
        action: perm.action,
        collection: perm.collection,
        fields: perm.fields,
        conditions: perm.conditions,
      };
      return acc;
    }, {});

    // Fetch tenant info if applicable
    let tenant = null;
    if (userRole.tenant_Id) {
      const tenants = await sql`
        SELECT * FROM "baasix_Tenant"
        WHERE id = ${userRole.tenant_Id}
        LIMIT 1
      `;
      tenant = tenants.length > 0 ? tenants[0] : null;
    }

    return {
      role: {
        id: role.id,
        name: role.name,
        description: role.description,
        isTenantSpecific: role.isTenantSpecific,
      },
      permissions: permissionsObj,
      tenant,
      userRole,
    };
  } catch (error: any) {
    throw new Error(`Error fetching user info: ${error.message}`);
  }
}

/**
 * Generate JWT token for user
 */
export function generateJWT(payload: Record<string, any>, expiresIn: string | number = "7d"): string {
  const secret = getJwtSecret();
  return jwt.sign(payload, secret, { expiresIn, algorithm: JWT_ALGORITHM } as any);
}

/**
 * Extract token from Authorization header
 */
export function extractTokenFromHeader(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(" ");
  if (parts.length === 2 && parts[0] === "Bearer") {
    return parts[1];
  }

  return null;
}

/**
 * Get the public role (from PermissionService hybrid cache)
 * Returns the public role with its ID, or a fallback if not found
 */
export async function getPublicRole(): Promise<{ id: string | number | null; name: string }> {
  // Get from PermissionService hybrid cache
  const publicRole = await permissionService.getPublicRoleAsync();
  
  if (publicRole) {
    return { id: publicRole.id, name: publicRole.name };
  }

  // Fallback if roles not loaded yet
  return { id: null, name: 'public' };
}

/**
 * Authentication middleware for Express
 * Verifies JWT token and sets req.accountability
 */
export const authMiddleware = async (req: any, res: any, next: any) => {
  try {
    // Extract token from Authorization header, cookie, query param or body
    let token = req.headers.authorization?.replace("Bearer ", "").trim();
    
    // Treat empty/whitespace-only tokens as no token
    if (!token || token === "") {
      token = undefined;
    }

    if (!token && req.cookies?.token) {
      token = req.cookies.token?.trim();
      if (!token || token === "") token = undefined;
    }

    // Also check accessToken cookie (used by some clients)
    if (!token && req.cookies?.accessToken) {
      token = req.cookies.accessToken?.trim();
      if (!token || token === "") token = undefined;
    }

    if (!token && req.query?.access_token) {
      token = req.query.access_token?.trim();
      if (!token || token === "") token = undefined;
    }

    if (!token && req.body?.access_token) {
      token = req.body.access_token?.trim();
      if (!token || token === "") token = undefined;
    }

    if (!token) {
      // No token provided - treat as public access
      const publicRole = await getPublicRole();
      req.accountability = {
        user: null,
        role: publicRole,
        tenant: null,
        permissions: [],
        ipaddress: req.ip || req.connection?.remoteAddress,
      };
      setContextAccountability(req.accountability);
      return next();
    }

    // Verify JWT token
    const payload = jwt.verify(token, getJwtSecret(), { algorithms: [JWT_ALGORITHM] }) as JWTPayload;

    // Validate session and get user in one query
    const sessionResult = await validateSession(payload.sessionToken, payload.tenant_Id?.toString() || null);
    if (!sessionResult) {
      // Session invalid/expired - fall back to public access instead of returning error
      // This allows public routes to work even with expired cookies
      const publicRole = await getPublicRole();
      req.accountability = {
        user: null,
        role: publicRole,
        tenant: null,
        permissions: [],
        ipaddress: req.ip || req.connection?.remoteAddress,
      };
      setContextAccountability(req.accountability);
      return next();
    }

    const { user } = sessionResult;

    // Get user's role assignment — cached, invalidated by baasix_UserRole hook
    const cache = getCache();
    const tenantKey = payload.tenant_Id ?? 'global';
    const pinnedUserRoleId = payload.userRole_Id ?? null;
    const userRoleCacheKey = pinnedUserRoleId
      ? `auth:userrole:${user.id}:ur:${pinnedUserRoleId}`
      : `auth:userrole:${user.id}:${tenantKey}`;
    let userRole = await cache.get(userRoleCacheKey);

    if (!userRole) {
      const userRoleTable = schemaManager.getTable("baasix_UserRole");
      let userRoles: any[] | undefined;

      // Pinned assignment (token carries userRole_Id) — must belong to this user
      if (pinnedUserRoleId) {
        userRoles = await db
          .select()
          .from(userRoleTable)
          .where(and(
            eq(userRoleTable.id, pinnedUserRoleId),
            eq(userRoleTable.user_Id, user.id)
          ))
          .limit(1);
      }

      // Legacy tokens, or pinned row deleted mid-session: oldest assignment wins
      if (!userRoles || userRoles.length === 0) {
        if (payload.tenant_Id !== undefined && payload.tenant_Id !== null) {
          userRoles = await db
            .select()
            .from(userRoleTable)
            .where(and(
              eq(userRoleTable.user_Id, user.id),
              eq(userRoleTable.tenant_Id, payload.tenant_Id)
            ))
            .orderBy(asc(userRoleTable.createdAt))
            .limit(1);
        } else {
          userRoles = await db
            .select()
            .from(userRoleTable)
            .where(eq(userRoleTable.user_Id, user.id))
            .orderBy(asc(userRoleTable.createdAt))
            .limit(1);
        }
      }
      userRole = userRoles?.[0] || null;
      if (userRole) {
        // Only cache under the pinned key if the row returned IS the pinned row.
        // If the pin was stale (row deleted) and the legacy fallback query
        // resolved a DIFFERENT row, caching that row under the pinned key would
        // orphan the entry: the baasix_UserRole mutation hook invalidates
        // `ur:<mutatedRowId>` by the id of whatever row actually changed, and
        // the dead pinned id never mutates again, so the entry would never be
        // invalidated by later changes to (or deletion of) the fallback row.
        // Cache it under the legacy key instead, which the hook does invalidate.
        const resolvedCacheKey =
          pinnedUserRoleId && String(userRole.id) === String(pinnedUserRoleId)
            ? userRoleCacheKey
            : `auth:userrole:${user.id}:${tenantKey}`;
        await cache.set(resolvedCacheKey, userRole); // Hybrid key: TTL ignored, invalidated by baasix_UserRole hook
      }
    }

    // Get role and permissions from cache or database
    let role: any = { id: null, name: "user", isTenantSpecific: false };
    let permissions: any[] = [];

    if (userRole?.role_Id) {
      const roleData = await getRolesAndPermissions(userRole.role_Id);
      role = {
        id: roleData.id,
        name: roleData.name,
        isTenantSpecific: roleData.isTenantSpecific,
        app_access: (roleData as any).app_access,
      };
      permissions = Object.values(roleData.permissions);
    }

    // Calculate isAdmin based on role name
    const isAdmin = role.name === 'administrator';

    // Strip hidden fields (like password) from user object
    const sanitizedUser = fieldUtils.stripHiddenFields('baasix_User', user);

    // For non-tenant-specific roles, don't set tenant context
    // (they operate globally without tenant constraints)
    const tenantContext = role.isTenantSpecific === false ? null : (userRole?.tenant_Id || null);

    // Set accountability object with all user fields
    req.accountability = {
      user: {
        ...sanitizedUser,
        isAdmin: isAdmin,
        role: role.name,
      } as any,
      role: role as any,
      tenant: tenantContext,
      userRole: userRole || undefined,
      permissions: permissions || [],
      ipaddress: req.ip || req.connection?.remoteAddress,
    };
    setContextAccountability(req.accountability);

    next();
  } catch (error: any) {
    // Only log unexpected errors, not common cases like malformed/empty tokens
    const isExpectedError = error.message === 'jwt malformed' || 
                            error.message === 'jwt must be provided' ||
                            error.message?.includes('invalid token');
    if (!isExpectedError) {
      console.error('Auth middleware error:', error.message);
    }
    // Fall back to public access on error
    const publicRole = await getPublicRole();
    req.accountability = {
      user: null,
      role: publicRole,
      tenant: null,
      permissions: [],
      ipaddress: req.ip || req.connection?.remoteAddress,
    };
    setContextAccountability(req.accountability);
    next();
  }
};

/**
 * Helper function to check if user is an administrator
 */
export const isAdmin = (req: any): boolean => {
  return req.accountability?.role?.name === "administrator" || req.accountability?.user?.isAdmin === true;
};

/**
 * Middleware to check for admin access
 */
export const adminOnly = (req: any, res: any, next: any) => {
  if (!isAdmin(req)) {
    return next(new APIError("Access denied. Administrators only.", 403));
  }
  next();
};

/**
 * Create a session in the database
 */
export async function createSession(
  user: any,
  expiresInSeconds: number,
  sessionType: string = "default",
  tenantId: string | null = null
): Promise<string> {
  const ItemsService = await getItemsService();
  const sessionService = new ItemsService('baasix_Sessions');

  const sessionToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

  await sessionService.createOne({
    token: sessionToken,
    user_Id: user.id,
    type: sessionType,
    expiresAt,
    tenant_Id: tenantId,
  });

  return sessionToken;
}

/**
 * Validate a session token
 */
export async function validateSession(
  token: string,
  expectedTenantId: string | null = null
): Promise<{ session: any; user: any } | null> {
  // Check short-TTL session cache to avoid DB query on every request
  const cache = getCache();
  const sessionCacheKey = `auth:session:${token}`;
  const cached = await cache.get(sessionCacheKey);
  if (cached) {
    // Re-check expiry even from cache
    if (new Date() > new Date(cached.session.expiresAt)) {
      await cache.delete(sessionCacheKey);
      const ItemsService = await getItemsService();
      const sessionService = new ItemsService('baasix_Sessions');
      await sessionService.deleteOne(cached.session.id);
      return null;
    }
    return cached;
  }

  const ItemsService = await getItemsService();
  const sessionService = new ItemsService('baasix_Sessions');

  // Fetch session with user relation to get all user fields in one query.
  // includeHidden: this is the trusted session-validation path — the session's
  // `token` field is hidden but needed here for cache/cleanup bookkeeping.
  const sessions = await sessionService.readByQuery({
    filter: { token: { eq: token } },
    fields: ['*', 'user.*'],
    limit: 1,
  }, false, undefined, { includeHidden: true });

  if (!sessions.data || sessions.data.length === 0) {
    return null;
  }

  const session = sessions.data[0];

  // Check if session has expired
  if (new Date() > new Date(session.expiresAt)) {
    await sessionService.deleteOne(session.id);
    return null;
  }

  // Optional tenant validation for enhanced security
  const isMultiTenant = env.get("MULTI_TENANT") === "true";
  if (isMultiTenant && expectedTenantId !== null && expectedTenantId !== undefined && session.tenant_Id !== expectedTenantId) {
    console.warn(`Session tenant mismatch: expected ${expectedTenantId}, got ${session.tenant_Id}`);
  }

  // Get user - either from populated relation or fetch separately
  let user = session.user;
  if (!user || typeof user === 'string') {
    const userService = new ItemsService('baasix_User');
    user = await userService.readOne(session.user_Id);
  }

  if (!user) {
    return null;
  }

  const result = { session, user };

  // Cache for 30 seconds — balances performance with session revocation latency
  await cache.set(sessionCacheKey, result, 30000);

  return result;
}

/**
 * Generate token with session creation
 */
export async function generateToken(
  user: any,
  role: any,
  tenant: any = null,
  ip: string | null = null,
  sessionType: string = "default"
): Promise<string> {
  const expiresIn = parseInt(env.get("ACCESS_TOKEN_EXPIRES_IN") || "3600");
  const sessionToken = await createSession(user, expiresIn, sessionType, tenant?.id);

  const payload: any = {
    id: user.id,
    role_Id: role.id,
    sessionToken,
  };

  if (tenant) {
    payload.tenant_Id = tenant.id;
  }

  // Add audit log for login
  try {
    const ItemsService = await getItemsService();
    const auditService = new ItemsService('baasix_AuditLog');
    await auditService.createOne({
      type: "auth",
      action: "login",
      entity: "baasix_User",
      entityId: user.id,
      userId: user.id,
      ipaddress: ip,
      tenant_Id: tenant?.id,
    });
  } catch (error) {
    console.error("Error creating audit log:", error);
  }

  return generateJWT(payload, `${expiresIn}s`);
}

export { validateSessionLimits } from "../auth/services/sessionLimits.js";

export default authMiddleware;
