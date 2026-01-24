/**
 * Authentication & Authorization Types
 * Shared across core, sdk, cli, and app packages
 */

// ============================================================================
// User Types
// ============================================================================

/**
 * Base user interface
 */
export interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  avatar?: string;
  role?: Role;
  role_Id?: string;
  tenant_Id?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/**
 * User with password (internal use only)
 */
export interface UserWithPassword extends User {
  password?: string;
}

/**
 * User with expanded roles and permissions
 */
export interface UserWithRolesAndPermissions {
  id: string | number;
  email?: string;
  roles: string[];
  permissions: string[];
  tenantId?: string | number;
  [key: string]: unknown;
}

// ============================================================================
// Role & Permission Types
// ============================================================================

/**
 * Role interface
 */
export interface Role {
  id: string;
  name: string;
  description?: string;
  isTenantSpecific?: boolean;
  [key: string]: unknown;
}

/**
 * Permission action types
 */
export type PermissionAction = "create" | "read" | "update" | "delete";

/**
 * Permission interface
 */
export interface Permission {
  id: string;
  role_Id: string;
  collection: string;
  action: PermissionAction;
  fields?: string[] | null;
  conditions?: Record<string, unknown>;
  defaultValues?: Record<string, unknown>;
  relConditions?: Record<string, unknown>;
}

/**
 * Permission data structure (internal to PermissionService)
 */
export interface PermissionData {
  fields: string[] | null;
  conditions: Record<string, unknown>;
  relConditions: Record<string, unknown>;
  defaultValues: Record<string, unknown>;
}

/**
 * Data for creating a new permission
 */
export interface CreatePermissionData {
  role_Id: string;
  collection: string;
  action: PermissionAction;
  fields?: string[];
  conditions?: Record<string, unknown>;
  defaultValues?: Record<string, unknown>;
  relConditions?: Record<string, unknown>;
}

// ============================================================================
// Tenant Types
// ============================================================================

/**
 * Tenant interface
 */
export interface Tenant {
  id: string;
  name: string;
  [key: string]: unknown;
}

// ============================================================================
// Session & Token Types
// ============================================================================

/**
 * Session interface
 */
export interface Session {
  id: string;
  token: string;
  user_Id: string;
  expiresAt: Date | string;
  ipAddress?: string;
  userAgent?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Auth tokens
 */
export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  expiresIn?: number;
}

/**
 * JWT payload interface
 */
export interface JWTPayload {
  id: string;
  email: string;
  role: string;
  sessionToken: string;
  tenant_Id?: string | number | null;
}

// ============================================================================
// Accountability Types
// ============================================================================

/**
 * Accountability object interface - used for permission checking
 */
export interface Accountability {
  user?: { id: string | number; email?: string; isAdmin?: boolean; [key: string]: any };
  role?: { id: string | number; name?: string; isTenantSpecific?: boolean } | string | number;
  permissions?: any[];
  tenant?: string | number;
  ipaddress?: string;
}

// ============================================================================
// Auth Request/Response Types
// ============================================================================

/**
 * Login credentials
 */
export interface LoginCredentials {
  email: string;
  password: string;
  tenantId?: string;
}

/**
 * Registration data
 */
export interface RegisterData {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  [key: string]: unknown;
}

/**
 * Auth response
 */
export interface AuthResponse {
  token: string;
  refreshToken?: string;
  user: User;
  role?: Role;
  expiresIn?: number;
}

/**
 * Auth state events
 */
export type AuthStateEvent =
  | "SIGNED_IN"
  | "SIGNED_OUT"
  | "TOKEN_REFRESHED"
  | "USER_UPDATED"
  | "TENANT_SWITCHED";

/**
 * Auth state
 */
export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Magic link options
 */
export interface MagicLinkOptions {
  email: string;
  redirectUrl?: string;
  mode?: "link" | "code";
}

/**
 * Password reset options
 */
export interface PasswordResetOptions {
  email: string;
  redirectUrl?: string;
}

// ============================================================================
// Auth Mode Types
// ============================================================================

/**
 * Authentication mode for the SDK/app
 * - 'jwt': Use JWT tokens stored in the configured storage adapter (default)
 * - 'cookie': Use HTTP-only cookies (server handles token storage)
 */
export type AuthMode = "jwt" | "cookie";

// ============================================================================
// OAuth Types
// ============================================================================

/**
 * OAuth2 tokens
 */
export interface OAuth2Tokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt?: Date;
  tokenType?: string;
  scope?: string;
}

/**
 * OAuth2 user info
 */
export interface OAuth2UserInfo {
  id: string;
  email: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  picture?: string;
  [key: string]: unknown;
}
