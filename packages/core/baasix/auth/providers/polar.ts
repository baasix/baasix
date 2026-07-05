/**
 * Polar OAuth Provider
 * Ported from better-auth packages/core/src/social-providers/polar.ts
 */

import type { OAuthProvider, OAuth2Tokens, ProviderOptions } from "../types.js";
import {
  createAuthorizationURL,
  validateAuthorizationCode,
  refreshAccessToken,
  parseOAuth2Tokens,
} from "../oauth2/utils.js";

export interface PolarProfile extends Record<string, any> {
  id: string;
  email: string;
  username: string;
  avatar_url: string;
  github_username?: string;
  account_id?: string;
  public_name?: string;
  email_verified?: boolean;
  profile_settings?: {
    profile_settings_enabled?: boolean;
    profile_settings_public_name?: string;
    profile_settings_public_avatar?: string;
    profile_settings_public_bio?: string;
    profile_settings_public_location?: string;
    profile_settings_public_website?: string;
    profile_settings_public_twitter?: string;
    profile_settings_public_github?: string;
    profile_settings_public_email?: string;
  };
}

export interface PolarOptions extends ProviderOptions<PolarProfile> {}

const POLAR_AUTH_URL = "https://polar.sh/oauth2/authorize";
const POLAR_TOKEN_URL = "https://api.polar.sh/v1/oauth2/token";
const POLAR_USERINFO_URL = "https://api.polar.sh/v1/oauth2/userinfo";

export function polar(options: PolarOptions): OAuthProvider<PolarProfile, PolarOptions> {
  const defaultScopes = ["openid", "profile", "email"];

  return {
    id: "polar",
    name: "Polar",
    options,

    async createAuthorizationURL({ state, codeVerifier, scopes, redirectURI }) {
      const allScopes = options.disableDefaultScope
        ? [...(options.scope || []), ...(scopes || [])]
        : [...defaultScopes, ...(options.scope || []), ...(scopes || [])];

      return createAuthorizationURL({
        authorizationEndpoint: POLAR_AUTH_URL,
        clientId: options.clientId,
        redirectURI: options.redirectURI || redirectURI,
        state,
        scopes: [...new Set(allScopes)],
        codeVerifier,
        prompt: options.prompt,
      });
    },

    async validateAuthorizationCode({ code, redirectURI, codeVerifier }): Promise<OAuth2Tokens> {
      const result = await validateAuthorizationCode({
        tokenEndpoint: POLAR_TOKEN_URL,
        code,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        redirectURI: options.redirectURI || redirectURI,
        codeVerifier,
      });
      return {
        ...parseOAuth2Tokens(result.raw),
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        tokenType: result.tokenType,
        raw: result.raw,
      };
    },

    async refreshAccessToken(refreshToken): Promise<OAuth2Tokens> {
      const result = await refreshAccessToken({
        tokenEndpoint: POLAR_TOKEN_URL,
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
      const response = await fetch(POLAR_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (!response.ok) {
        console.error("Failed to fetch Polar user info:", await response.text());
        return null;
      }
      const profile = (await response.json()) as PolarProfile;

      const displayName = profile.public_name || profile.username || "";
      const mapped = options.mapProfileToUser ? await options.mapProfileToUser(profile) : {};
      return {
        user: {
          id: profile.id,
          email: profile.email,
          // Polar may provide email_verified, but it's not guaranteed — default
          // to false for security consistency when absent.
          emailVerified: profile.email_verified ?? false,
          name: displayName,
          image: profile.avatar_url,
          firstName: (mapped as any).firstName || displayName,
          lastName: (mapped as any).lastName,
          ...mapped,
        },
        data: profile,
      };
    },
  };
}

export default polar;
