import type { StorageAdapter } from "./storage/types";
import { STORAGE_KEYS } from "./storage/types";
import type { AuthMode, AuthTokens } from "./types";
import { BaasixError } from "./types";

export interface RequestOptions extends RequestInit {
  params?: Record<string, unknown>;
  timeout?: number;
  skipAuth?: boolean;
  rawResponse?: boolean;
}

export interface HttpClientConfig {
  baseUrl: string;
  authMode: AuthMode;
  storage: StorageAdapter;
  timeout: number;
  autoRefresh: boolean;
  credentials: RequestCredentials;
  headers: Record<string, string>;
  token?: string;
  tenantId?: string;
  onAuthError?: () => void;
  onTokenRefresh?: (tokens: AuthTokens) => void;
}

/**
 * Core HTTP client for making API requests.
 * Handles authentication, token refresh, and error handling.
 */
export class HttpClient {
  private config: HttpClientConfig;
  private refreshPromise: Promise<AuthTokens> | null = null;

  constructor(config: HttpClientConfig) {
    this.config = config;
  }

  /**
   * Update client configuration
   */
  updateConfig(config: Partial<HttpClientConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get the current base URL
   */
  getBaseUrl(): string {
    return this.config.baseUrl;
  }

  /**
   * Build the full URL with query parameters
   */
  private buildUrl(path: string, params?: Record<string, unknown>): string {
    const url = new URL(path, this.config.baseUrl);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          if (typeof value === "object") {
            url.searchParams.set(key, JSON.stringify(value));
          } else {
            url.searchParams.set(key, String(value));
          }
        }
      });
    }

    return url.toString();
  }

  /**
   * Get the current access token
   */
  private async getAccessToken(): Promise<string | null> {
    // Static token takes precedence
    if (this.config.token) {
      return this.config.token;
    }

    // Cookie mode doesn't need token header
    if (this.config.authMode === "cookie") {
      return null;
    }

    const token = await this.config.storage.get(STORAGE_KEYS.ACCESS_TOKEN);
    return token;
  }

  /**
   * Check if token is expired or about to expire (within 60 seconds)
   */
  private async isTokenExpired(): Promise<boolean> {
    const expiry = await this.config.storage.get(STORAGE_KEYS.TOKEN_EXPIRY);
    if (!expiry) return false;

    const expiryTime = parseInt(expiry, 10);
    const bufferTime = 60 * 1000; // 60 seconds buffer
    return Date.now() >= expiryTime - bufferTime;
  }

  /**
   * Refresh the access token
   */
  private async refreshToken(): Promise<AuthTokens> {
    // Prevent multiple simultaneous refresh requests
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        const refreshToken = await this.config.storage.get(
          STORAGE_KEYS.REFRESH_TOKEN
        );

        if (!refreshToken && this.config.authMode === "jwt") {
          throw new BaasixError("No refresh token available", 401, "NO_REFRESH_TOKEN");
        }

        const response = await fetch(
          this.buildUrl("/auth/refresh"),
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...this.config.headers,
            },
            body: this.config.authMode === "jwt" ? JSON.stringify({ refreshToken }) : undefined,
            credentials: this.config.credentials,
          }
        );

        if (!response.ok) {
          throw new BaasixError("Token refresh failed", response.status, "REFRESH_FAILED");
        }

        const data = await response.json();
        const tokens: AuthTokens = {
          accessToken: data.token,
          refreshToken: data.refreshToken,
          expiresIn: data.expiresIn,
          expiresAt: data.expiresIn
            ? Date.now() + data.expiresIn * 1000
            : undefined,
        };

        // Store new tokens
        await this.config.storage.set(STORAGE_KEYS.ACCESS_TOKEN, tokens.accessToken);
        if (tokens.refreshToken) {
          await this.config.storage.set(STORAGE_KEYS.REFRESH_TOKEN, tokens.refreshToken);
        }
        if (tokens.expiresAt) {
          await this.config.storage.set(
            STORAGE_KEYS.TOKEN_EXPIRY,
            tokens.expiresAt.toString()
          );
        }

        this.config.onTokenRefresh?.(tokens);
        return tokens;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  /**
   * Build request headers
   */
  private async buildHeaders(
    options: RequestOptions = {}
  ): Promise<HeadersInit> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.config.headers,
    };

    // Add tenant header if configured
    if (this.config.tenantId) {
      headers["X-Tenant-Id"] = this.config.tenantId;
    }

    // Skip auth for public endpoints
    if (options.skipAuth) {
      return headers;
    }

    // Add authorization header for JWT mode
    if (this.config.authMode === "jwt") {
      // Check if we need to refresh
      if (this.config.autoRefresh && (await this.isTokenExpired())) {
        try {
          await this.refreshToken();
        } catch {
          // Continue without refresh if it fails
        }
      }

      const token = await this.getAccessToken();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }

    return headers;
  }

  /**
   * Parse error response
   */
  private async parseError(response: Response): Promise<BaasixError> {
    let errorData: { message?: string; error?: { message?: string; code?: string }; details?: unknown[] } = {};

    try {
      errorData = await response.json();
    } catch {
      // Response might not be JSON
    }

    const message =
      errorData.error?.message ||
      errorData.message ||
      response.statusText ||
      "Request failed";

    const code = errorData.error?.code;
    const details = errorData.details as { code?: string; field?: string; message?: string }[] | undefined;

    return new BaasixError(message, response.status, code, details);
  }

  /**
   * Make an HTTP request
   */
  async request<T>(
    method: string,
    path: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const { params, timeout, skipAuth, rawResponse, ...fetchOptions } = options;

    const url = this.buildUrl(path, params);
    const headers = await this.buildHeaders({ skipAuth });
    const requestTimeout = timeout || this.config.timeout;

    // Setup abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), requestTimeout);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          ...headers,
          ...(fetchOptions.headers as Record<string, string>),
        },
        credentials: this.config.credentials,
        signal: controller.signal,
        ...fetchOptions,
      });

      // Handle 401 - try to refresh token and retry
      if (response.status === 401 && !skipAuth && this.config.autoRefresh) {
        try {
          await this.refreshToken();

          // Retry the request with new token
          const retryHeaders = await this.buildHeaders({ skipAuth: false });
          const retryResponse = await fetch(url, {
            method,
            headers: {
              ...retryHeaders,
              ...(fetchOptions.headers as Record<string, string>),
            },
            credentials: this.config.credentials,
            ...fetchOptions,
          });

          if (!retryResponse.ok) {
            throw await this.parseError(retryResponse);
          }

          if (rawResponse) {
            return retryResponse as unknown as T;
          }

          // Handle no-content responses
          if (retryResponse.status === 204) {
            return {} as T;
          }

          return await retryResponse.json();
        } catch (refreshError) {
          // Refresh failed, trigger auth error callback
          this.config.onAuthError?.();
          throw refreshError;
        }
      }

      if (!response.ok) {
        throw await this.parseError(response);
      }

      if (rawResponse) {
        return response as unknown as T;
      }

      // Handle no-content responses
      if (response.status === 204) {
        return {} as T;
      }

      return await response.json();
    } catch (error) {
      if (error instanceof BaasixError) {
        throw error;
      }

      if (error instanceof Error) {
        if (error.name === "AbortError") {
          throw new BaasixError("Request timeout", 408, "TIMEOUT");
        }
        throw new BaasixError(error.message, 0, "NETWORK_ERROR");
      }

      throw new BaasixError("Unknown error occurred", 500, "UNKNOWN");
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * GET request
   */
  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("GET", path, options);
  }

  /**
   * POST request
   */
  post<T>(path: string, data?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>("POST", path, {
      ...options,
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /**
   * PATCH request
   */
  patch<T>(path: string, data?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>("PATCH", path, {
      ...options,
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /**
   * PUT request
   */
  put<T>(path: string, data?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>("PUT", path, {
      ...options,
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /**
   * DELETE request
   */
  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("DELETE", path, options);
  }

  /**
   * Upload file with multipart/form-data
   */
  async upload<T>(
    path: string,
    formData: FormData,
    options?: Omit<RequestOptions, "body"> & {
      onProgress?: (progress: number) => void;
    }
  ): Promise<T> {
    const { params, timeout, skipAuth, onProgress } = options || {};

    const url = this.buildUrl(path, params);
    const headers = await this.buildHeaders({ skipAuth });
    const requestTimeout = timeout || this.config.timeout;

    // Remove Content-Type to let browser set it with boundary
    delete (headers as Record<string, string>)["Content-Type"];

    // Use XMLHttpRequest for progress support
    if (onProgress && typeof XMLHttpRequest !== "undefined") {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url);

        // Set headers
        Object.entries(headers as Record<string, string>).forEach(
          ([key, value]) => {
            xhr.setRequestHeader(key, value);
          }
        );

        xhr.withCredentials = this.config.credentials === "include";

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const progress = Math.round((event.loaded / event.total) * 100);
            onProgress(progress);
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch {
              resolve({} as T);
            }
          } else {
            reject(
              new BaasixError(
                xhr.statusText || "Upload failed",
                xhr.status,
                "UPLOAD_ERROR"
              )
            );
          }
        };

        xhr.onerror = () => {
          reject(new BaasixError("Network error during upload", 0, "NETWORK_ERROR"));
        };

        xhr.ontimeout = () => {
          reject(new BaasixError("Upload timeout", 408, "TIMEOUT"));
        };

        xhr.timeout = requestTimeout;
        xhr.send(formData);
      });
    }

    // Fallback to fetch without progress
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), requestTimeout);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: formData,
        credentials: this.config.credentials,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw await this.parseError(response);
      }

      return await response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
