/**
 * Roblox OAuth Provider
 * Ported from better-auth packages/core/src/social-providers/roblox.ts
 */

import type { OAuthProvider, OAuth2Tokens, ProviderOptions } from "../types.js";
import { validateAuthorizationCode, refreshAccessToken, parseOAuth2Tokens } from "../oauth2/utils.js";

export interface RobloxProfile extends Record<string, any> {
  /** the user's id */
  sub: string;
  /** the user's username */
  preferred_username: string;
  /** the user's display name, will return the same value as the preferred_username if not set */
  nickname: string;
  /** the user's display name, again, will return the same value as the preferred_username if not set */
  name: string;
  /** the account creation date as a unix timestamp in seconds */
  created_at: number;
  /** the user's profile URL */
  profile: string;
  /** the user's avatar URL */
  picture: string;
}

export interface RobloxOptions extends ProviderOptions<RobloxProfile> {
  prompt?: "none" | "consent" | "login" | "select_account" | "select_account consent";
}

const ROBLOX_AUTH_URL = "https://apis.roblox.com/oauth/v1/authorize";
const ROBLOX_TOKEN_URL = "https://apis.roblox.com/oauth/v1/token";
const ROBLOX_USERINFO_URL = "https://apis.roblox.com/oauth/v1/userinfo";

export function roblox(options: RobloxOptions): OAuthProvider<RobloxProfile, RobloxOptions> {
  const defaultScopes = ["openid", "profile"];

  return {
    id: "roblox",
    name: "Roblox",
    options,

    async createAuthorizationURL({ state, scopes, redirectURI }) {
      const allScopes = options.disableDefaultScope
        ? [...(options.scope || []), ...(scopes || [])]
        : [...defaultScopes, ...(options.scope || []), ...(scopes || [])];

      // Roblox's authorize endpoint is built manually (source does the same)
      // rather than via the shared createAuthorizationURL helper: scopes are
      // joined with "+" (not "%20"/space) and there is no PKCE support.
      const uniqueScopes = [...new Set(allScopes)];
      const url = new URL(ROBLOX_AUTH_URL);
      url.search = [
        `scope=${uniqueScopes.join("+")}`,
        `response_type=code`,
        `client_id=${options.clientId}`,
        `redirect_uri=${encodeURIComponent(options.redirectURI || redirectURI)}`,
        `state=${state}`,
        `prompt=${options.prompt || "select_account consent"}`,
      ].join("&");
      return url;
    },

    async validateAuthorizationCode({ code, redirectURI }): Promise<OAuth2Tokens> {
      const result = await validateAuthorizationCode({
        tokenEndpoint: ROBLOX_TOKEN_URL,
        code,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        redirectURI: options.redirectURI || redirectURI,
      });
      return {
        ...parseOAuth2Tokens(result.raw),
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        idToken: result.idToken,
        tokenType: result.tokenType,
        raw: result.raw,
      };
    },

    async refreshAccessToken(refreshToken): Promise<OAuth2Tokens> {
      const result = await refreshAccessToken({
        tokenEndpoint: ROBLOX_TOKEN_URL,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        refreshToken,
      });
      return {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        tokenType: result.tokenType,
        accessTokenExpiresAt: result.expiresIn ? new Date(Date.now() + result.expiresIn * 1000) : undefined,
        raw: result.raw,
      };
    },

    async getUserInfo(tokens) {
      if (!tokens.accessToken) return null;
      const response = await fetch(ROBLOX_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (!response.ok) {
        console.error("Failed to fetch Roblox user info:", await response.text());
        return null;
      }
      const profile = (await response.json()) as RobloxProfile;

      const displayName = profile.nickname || profile.preferred_username || "";
      const mapped = options.mapProfileToUser ? await options.mapProfileToUser(profile) : {};
      return {
        user: {
          id: profile.sub,
          // Roblox does not provide an email or email_verified claim.
          email: profile.preferred_username || null,
          emailVerified: false,
          name: displayName,
          image: profile.picture,
          firstName: (mapped as any).firstName || displayName,
          lastName: (mapped as any).lastName,
          ...mapped,
        },
        data: profile,
      };
    },
  };
}

export default roblox;
