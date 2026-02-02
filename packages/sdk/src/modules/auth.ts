import type { HttpClient } from "../client";
import type { StorageAdapter } from "../storage/types";
import { STORAGE_KEYS } from "../storage/types";
import type {
  AuthMode,
  AuthResponse,
  AuthState,
  AuthStateEvent,
  AuthTokens,
  LoginCredentials,
  MagicLinkOptions,
  PasswordResetOptions,
  RegisterData,
  Tenant,
  User,
} from "../types";
import { BaasixError } from "../types";

export type OAuthProvider = "google" | "facebook" | "apple" | "github";

export interface OAuthOptions {
  provider: OAuthProvider;
  redirectUrl: string;
  scopes?: string[];
  state?: string;
}

export interface InviteOptions {
  email: string;
  roleId: string;
  tenantId?: string;
  redirectUrl: string;
}

export interface VerifyInviteResult {
  valid: boolean;
  email?: string;
  tenantId?: string;
  roleId?: string;
}

export interface AuthModuleConfig {
  client: HttpClient;
  storage: StorageAdapter;
  authMode: AuthMode;
  onAuthStateChange?: (event: AuthStateEvent, user: User | null) => void;
}

/**
 * Authentication module for handling user authentication, sessions, and token management.
 *
 * @example
 * ```typescript
 * // Login
 * const { user, token } = await baasix.auth.login({
 *   email: 'user@example.com',
 *   password: 'password123'
 * });
 *
 * // Get current user
 * const user = await baasix.auth.getUser();
 *
 * // Logout
 * await baasix.auth.logout();
 * ```
 */
export class AuthModule {
  private client: HttpClient;
  private storage: StorageAdapter;
  private authMode: AuthMode;
  private onAuthStateChange?: (event: AuthStateEvent, user: User | null) => void;
  private currentUser: User | null = null;

  constructor(config: AuthModuleConfig) {
    this.client = config.client;
    this.storage = config.storage;
    this.authMode = config.authMode;
    this.onAuthStateChange = config.onAuthStateChange;
  }

  /**
   * Emit an authentication state change event
   */
  private emitAuthStateChange(event: AuthStateEvent, user: User | null): void {
    this.currentUser = user;
    this.onAuthStateChange?.(event, user);
  }

  /**
   * Store authentication tokens
   */
  private async storeTokens(response: AuthResponse): Promise<void> {
    if (this.authMode === "jwt") {
      await this.storage.set(STORAGE_KEYS.ACCESS_TOKEN, response.token);

      if (response.refreshToken) {
        await this.storage.set(STORAGE_KEYS.REFRESH_TOKEN, response.refreshToken);
      }

      if (response.expiresIn) {
        const expiresAt = Date.now() + response.expiresIn * 1000;
        await this.storage.set(STORAGE_KEYS.TOKEN_EXPIRY, expiresAt.toString());
      }
    }

    // Store user info
    if (response.user) {
      await this.storage.set(STORAGE_KEYS.USER, JSON.stringify(response.user));
    }
  }

  /**
   * Clear stored authentication data
   */
  private async clearAuth(): Promise<void> {
    await this.storage.remove(STORAGE_KEYS.ACCESS_TOKEN);
    await this.storage.remove(STORAGE_KEYS.REFRESH_TOKEN);
    await this.storage.remove(STORAGE_KEYS.TOKEN_EXPIRY);
    await this.storage.remove(STORAGE_KEYS.USER);
    await this.storage.remove(STORAGE_KEYS.TENANT);
    this.currentUser = null;
  }

  /**
   * Register a new user
   *
   * @example
   * ```typescript
   * const { user, token } = await baasix.auth.register({
   *   email: 'newuser@example.com',
   *   password: 'securepassword',
   *   firstName: 'John',
   *   lastName: 'Doe'
   * });
   * ```
   */
  async register(data: RegisterData): Promise<AuthResponse> {
    const response = await this.client.post<AuthResponse>("/auth/register", data, {
      skipAuth: true,
    });

    await this.storeTokens(response);
    this.emitAuthStateChange("SIGNED_IN", response.user);

    return response;
  }

  /**
   * Login with email and password
   *
   * @example
   * ```typescript
   * const { user, token } = await baasix.auth.login({
   *   email: 'user@example.com',
   *   password: 'password123'
   * });
   *
   * // Login with tenant (multi-tenant mode)
   * const result = await baasix.auth.login({
   *   email: 'user@example.com',
   *   password: 'password123',
   *   tenantId: 'tenant-uuid'
   * });
   *
   * // Login with authMode and authType
   * const result = await baasix.auth.login({
   *   email: 'user@example.com',
   *   password: 'password123',
   *   authMode: 'cookie', // or 'jwt' (default)
   *   authType: 'mobile'  // for session management
   * });
   * ```
   */
  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    const response = await this.client.post<AuthResponse>(
      "/auth/login",
      {
        email: credentials.email,
        password: credentials.password,
        tenant_Id: credentials.tenantId,
        authMode: credentials.authMode,
        authType: credentials.authType,
      },
      { skipAuth: true }
    );

    await this.storeTokens(response);
    this.emitAuthStateChange("SIGNED_IN", response.user);

    return response;
  }

  /**
   * Logout the current user
   *
   * @example
   * ```typescript
   * await baasix.auth.logout();
   * ```
   */
  async logout(): Promise<void> {
    try {
      await this.client.get("/auth/logout");
    } catch {
      // Ignore logout errors - we still want to clear local state
    }

    await this.clearAuth();
    this.emitAuthStateChange("SIGNED_OUT", null);
  }

  /**
   * Get the current authenticated user from the server
   *
   * @example
   * ```typescript
   * const user = await baasix.auth.getUser();
   * console.log(user?.email);
   * ```
   */
  async getUser(): Promise<User | null> {
    try {
      const response = await this.client.get<{ user: User }>("/auth/me");
      this.currentUser = response.user;
      await this.storage.set(STORAGE_KEYS.USER, JSON.stringify(response.user));
      return response.user;
    } catch (error) {
      if (error instanceof BaasixError && error.status === 401) {
        await this.clearAuth();
        return null;
      }
      throw error;
    }
  }

  /**
   * Alias for getUser() - Get the current authenticated user from the server
   * Calls the /auth/me endpoint
   *
   * @example
   * ```typescript
   * const user = await baasix.auth.me();
   * console.log(user?.email);
   * ```
   */
  async me(): Promise<User | null> {
    return this.getUser();
  }

  /**
   * Get the cached current user (does not make an API call)
   *
   * @example
   * ```typescript
   * const user = await baasix.auth.getCachedUser();
   * ```
   */
  async getCachedUser(): Promise<User | null> {
    if (this.currentUser) {
      return this.currentUser;
    }

    const userJson = await this.storage.get(STORAGE_KEYS.USER);
    if (userJson) {
      try {
        this.currentUser = JSON.parse(userJson);
        return this.currentUser;
      } catch {
        return null;
      }
    }

    return null;
  }

  /**
   * Check if user is authenticated (has valid token)
   *
   * @example
   * ```typescript
   * if (await baasix.auth.isAuthenticated()) {
   *   // User is logged in
   * }
   * ```
   */
  async isAuthenticated(): Promise<boolean> {
    if (this.authMode === "cookie") {
      // For cookie mode, try to get user
      const user = await this.getCachedUser();
      return user !== null;
    }

    const token = await this.storage.get(STORAGE_KEYS.ACCESS_TOKEN);
    if (!token) return false;

    // Check expiry
    const expiry = await this.storage.get(STORAGE_KEYS.TOKEN_EXPIRY);
    if (expiry && Date.now() >= parseInt(expiry, 10)) {
      // Token expired, check if we have refresh token
      const refreshToken = await this.storage.get(STORAGE_KEYS.REFRESH_TOKEN);
      return !!refreshToken;
    }

    return true;
  }

  /**
   * Get the current access token
   *
   * @example
   * ```typescript
   * const token = await baasix.auth.getToken();
   * ```
   */
  async getToken(): Promise<string | null> {
    if (this.authMode === "cookie") {
      return null;
    }
    return await this.storage.get(STORAGE_KEYS.ACCESS_TOKEN);
  }

  /**
   * Set a static token (useful for server-side or service accounts)
   *
   * @example
   * ```typescript
   * baasix.auth.setToken('your-api-token');
   * ```
   */
  async setToken(token: string): Promise<void> {
    await this.storage.set(STORAGE_KEYS.ACCESS_TOKEN, token);
  }

  /**
   * Refresh the current token
   *
   * @example
   * ```typescript
   * const tokens = await baasix.auth.refreshToken();
   * ```
   */
  async refreshToken(): Promise<AuthTokens> {
    const refreshToken = await this.storage.get(STORAGE_KEYS.REFRESH_TOKEN);

    const response = await this.client.post<AuthResponse>(
      "/auth/refresh",
      this.authMode === "jwt" ? { refreshToken } : undefined
    );

    await this.storeTokens(response);

    const tokens: AuthTokens = {
      accessToken: response.token,
      refreshToken: response.refreshToken,
      expiresIn: response.expiresIn,
      expiresAt: response.expiresIn
        ? Date.now() + response.expiresIn * 1000
        : undefined,
    };

    this.emitAuthStateChange("TOKEN_REFRESHED", response.user);

    return tokens;
  }

  /**
   * Request a magic link for passwordless login
   *
   * @example
   * ```typescript
   * await baasix.auth.sendMagicLink({
   *   email: 'user@example.com',
   *   redirectUrl: 'https://myapp.com/auth/callback'
   * });
   * ```
   */
  async sendMagicLink(options: MagicLinkOptions): Promise<void> {
    await this.client.post(
      "/auth/magiclink",
      {
        email: options.email,
        link: options.redirectUrl,
        mode: options.mode || "link",
      },
      { skipAuth: true }
    );
  }

  /**
   * Verify magic link/code and complete login
   *
   * @example
   * ```typescript
   * const { user, token } = await baasix.auth.verifyMagicLink('verification-token');
   * ```
   */
  async verifyMagicLink(token: string): Promise<AuthResponse> {
    const response = await this.client.get<AuthResponse>(
      `/auth/magiclink/${encodeURIComponent(token)}`,
      { skipAuth: true }
    );

    await this.storeTokens(response);
    this.emitAuthStateChange("SIGNED_IN", response.user);

    return response;
  }

  /**
   * Request a password reset
   *
   * @example
   * ```typescript
   * await baasix.auth.forgotPassword({
   *   email: 'user@example.com',
   *   redirectUrl: 'https://myapp.com/reset-password'
   * });
   * ```
   */
  async forgotPassword(options: PasswordResetOptions): Promise<void> {
    await this.client.post(
      "/auth/password/reset",
      {
        email: options.email,
        link: options.redirectUrl,
      },
      { skipAuth: true }
    );
  }

  /**
   * Reset password using a reset token
   *
   * @example
   * ```typescript
   * await baasix.auth.resetPassword('reset-token', 'newpassword123');
   * ```
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    await this.client.post(
      `/auth/password/reset/${encodeURIComponent(token)}`,
      { password: newPassword },
      { skipAuth: true }
    );
  }

  /**
   * Change the current user's password
   *
   * @example
   * ```typescript
   * await baasix.auth.changePassword('currentPassword', 'newPassword');
   * ```
   */
  async changePassword(
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    await this.client.post("/auth/password/change", {
      currentPassword,
      newPassword,
    });
  }

  /**
   * Get available tenants for the current user (multi-tenant mode)
   *
   * @example
   * ```typescript
   * const tenants = await baasix.auth.getTenants();
   * ```
   */
  async getTenants(): Promise<Tenant[]> {
    const response = await this.client.get<{ tenants: Tenant[] }>("/auth/tenants");
    return response.tenants;
  }

  /**
   * Switch to a different tenant (multi-tenant mode)
   *
   * @example
   * ```typescript
   * const { user, token } = await baasix.auth.switchTenant('tenant-uuid');
   * ```
   */
  async switchTenant(tenantId: string): Promise<AuthResponse> {
    const response = await this.client.post<AuthResponse>("/auth/switch-tenant", {
      tenant_Id: tenantId,
    });

    await this.storeTokens(response);
    await this.storage.set(STORAGE_KEYS.TENANT, tenantId);
    this.emitAuthStateChange("TENANT_SWITCHED", response.user);

    return response;
  }

  /**
   * Get the current authentication state
   *
   * @example
   * ```typescript
   * const state = await baasix.auth.getState();
   * console.log(state.isAuthenticated, state.user);
   * ```
   */
  async getState(): Promise<AuthState> {
    const isAuthenticated = await this.isAuthenticated();
    const user = await this.getCachedUser();

    return {
      user,
      isAuthenticated,
      isLoading: false,
      error: null,
    };
  }

  /**
   * Initialize authentication state from storage
   * Call this on app startup to restore previous session
   *
   * @example
   * ```typescript
   * await baasix.auth.initialize();
   * ```
   */
  async initialize(): Promise<AuthState> {
    const state = await this.getState();

    if (state.isAuthenticated && state.user) {
      this.emitAuthStateChange("SIGNED_IN", state.user);
    }

    return state;
  }

  // ===================
  // OAuth / Social Login
  // ===================

  /**
   * Get the OAuth authorization URL for a provider
   * Redirect the user to this URL to start the OAuth flow
   * 
   * @example
   * ```typescript
   * const url = baasix.auth.getOAuthUrl({
   *   provider: 'google',
   *   redirectUrl: 'https://myapp.com/auth/callback'
   * });
   * window.location.href = url;
   * ```
   */
  getOAuthUrl(options: OAuthOptions): string {
    const baseUrl = this.client.getBaseUrl();
    const params = new URLSearchParams({
      redirect_url: options.redirectUrl,
    });
    
    if (options.scopes?.length) {
      params.set("scopes", options.scopes.join(","));
    }
    if (options.state) {
      params.set("state", options.state);
    }

    return `${baseUrl}/auth/signin/${options.provider}?${params.toString()}`;
  }

  /**
   * Handle OAuth callback and complete login
   * Call this from your callback page with the token from URL
   * 
   * @example
   * ```typescript
   * // In your callback page
   * const params = new URLSearchParams(window.location.search);
   * const token = params.get('token');
   * 
   * if (token) {
   *   await baasix.auth.handleOAuthCallback(token);
   * }
   * ```
   */
  async handleOAuthCallback(token: string): Promise<AuthResponse> {
    // Store the token
    await this.storage.set(STORAGE_KEYS.ACCESS_TOKEN, token);
    
    // Get user info
    const user = await this.getUser();
    
    const response: AuthResponse = {
      token,
      user: user!,
    };
    
    this.emitAuthStateChange("SIGNED_IN", user);
    return response;
  }

  // ===================
  // Email Verification
  // ===================

  /**
   * Request email verification
   * Sends a verification email to the current user
   * 
   * @example
   * ```typescript
   * await baasix.auth.requestEmailVerification('https://myapp.com/verify-email');
   * ```
   */
  async requestEmailVerification(redirectUrl: string): Promise<void> {
    await this.client.post("/auth/email/verify", {
      link: redirectUrl,
    });
  }

  /**
   * Verify email with token
   * 
   * @example
   * ```typescript
   * const params = new URLSearchParams(window.location.search);
   * const token = params.get('token');
   * 
   * await baasix.auth.verifyEmail(token);
   * ```
   */
  async verifyEmail(token: string): Promise<void> {
    await this.client.get(`/auth/email/verify/${encodeURIComponent(token)}`, {
      skipAuth: true,
    });
  }

  /**
   * Check if current session/token is valid
   * 
   * @example
   * ```typescript
   * const isValid = await baasix.auth.checkSession();
   * ```
   */
  async checkSession(): Promise<boolean> {
    try {
      const response = await this.client.get<{ valid: boolean }>("/auth/check");
      return response.valid;
    } catch {
      return false;
    }
  }

  // ===================
  // Invitation System
  // ===================

  /**
   * Send an invitation to a user (multi-tenant mode)
   * 
   * @example
   * ```typescript
   * await baasix.auth.sendInvite({
   *   email: 'newuser@example.com',
   *   roleId: 'role-uuid',
   *   tenantId: 'tenant-uuid',
   *   redirectUrl: 'https://myapp.com/accept-invite'
   * });
   * ```
   */
  async sendInvite(options: InviteOptions): Promise<void> {
    await this.client.post("/auth/invite", {
      email: options.email,
      role_Id: options.roleId,
      tenant_Id: options.tenantId,
      link: options.redirectUrl,
    });
  }

  /**
   * Verify an invitation token
   * 
   * @example
   * ```typescript
   * const params = new URLSearchParams(window.location.search);
   * const token = params.get('token');
   * 
   * const result = await baasix.auth.verifyInvite(token);
   * if (result.valid) {
   *   // Show registration form with pre-filled email
   * }
   * ```
   */
  async verifyInvite(token: string, redirectUrl?: string): Promise<VerifyInviteResult> {
    const response = await this.client.get<VerifyInviteResult>(
      `/auth/verify-invite/${encodeURIComponent(token)}`,
      {
        params: {
          link: redirectUrl,
        },
        skipAuth: true,
      }
    );
    return response;
  }

  /**
   * Accept an invitation (for existing users)
   * 
   * @example
   * ```typescript
   * await baasix.auth.acceptInvite(token);
   * ```
   */
  async acceptInvite(token: string): Promise<AuthResponse> {
    const response = await this.client.post<AuthResponse>(
      "/auth/accept-invite",
      { inviteToken: token }
    );

    await this.storeTokens(response);
    this.emitAuthStateChange("SIGNED_IN", response.user);

    return response;
  }

  /**
   * Register with an invitation token
   * 
   * @example
   * ```typescript
   * const { user, token } = await baasix.auth.registerWithInvite({
   *   email: 'user@example.com',
   *   password: 'password',
   *   firstName: 'John',
   *   lastName: 'Doe',
   *   inviteToken: 'invite-token'
   * });
   * ```
   */
  async registerWithInvite(data: RegisterData & { inviteToken: string }): Promise<AuthResponse> {
    const response = await this.client.post<AuthResponse>(
      "/auth/register",
      {
        ...data,
        inviteToken: data.inviteToken,
      },
      { skipAuth: true }
    );

    await this.storeTokens(response);
    this.emitAuthStateChange("SIGNED_IN", response.user);

    return response;
  }
}

// Re-export types from types.ts
export type {
  AuthResponse,
  AuthState,
  AuthStateEvent,
  AuthTokens,
  LoginCredentials,
  MagicLinkOptions,
  PasswordResetOptions,
  RegisterData,
  Tenant,
  User,
};
