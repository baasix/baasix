/**
 * Atlassian OAuth Provider
 * Ported from better-auth packages/core/src/social-providers/atlassian.ts
 */

import type { OAuthProvider, ProviderOptions } from "../types.js";
import {
  createAuthorizationURL,
  validateAuthorizationCode,
  refreshAccessToken,
  parseOAuth2Tokens,
} from "../oauth2/utils.js";

export interface AtlassianProfile extends Record<string, any> {
  account_type?: string;
  account_id: string;
  email?: string | null;
  name: string;
  picture?: string;
  nickname?: string;
  locale?: string;
  extended_profile?: {
    job_title?: string;
    organization?: string;
    department?: string;
    location?: string;
  };
}

export interface AtlassianOptions extends ProviderOptions<AtlassianProfile> {}

const ATLASSIAN_AUTH_URL = "https://auth.atlassian.com/authorize";
const ATLASSIAN_TOKEN_URL = "https://auth.atlassian.com/oauth/token";
const ATLASSIAN_USER_URL = "https://api.atlassian.com/me";

export function atlassian(options: AtlassianOptions): OAuthProvider<AtlassianProfile, AtlassianOptions> {
  const defaultScopes = ["read:jira-user", "offline_access"];

  return {
    id: "atlassian",
    name: "Atlassian",
    options,

    async createAuthorizationURL({ state, codeVerifier, scopes, redirectURI }) {
      const allScopes = options.disableDefaultScope
        ? [...(options.scope || []), ...(scopes || [])]
        : [...defaultScopes, ...(options.scope || []), ...(scopes || [])];

      return createAuthorizationURL({
        authorizationEndpoint: ATLASSIAN_AUTH_URL,
        clientId: options.clientId,
        redirectURI: options.redirectURI || redirectURI,
        state,
        scopes: [...new Set(allScopes)],
        codeVerifier,
        prompt: options.prompt,
        additionalParams: {
          audience: "api.atlassian.com",
        },
      });
    },

    async validateAuthorizationCode({ code, redirectURI, codeVerifier }) {
      const result = await validateAuthorizationCode({
        tokenEndpoint: ATLASSIAN_TOKEN_URL,
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

    async refreshAccessToken(refreshToken) {
      const result = await refreshAccessToken({
        tokenEndpoint: ATLASSIAN_TOKEN_URL,
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
      const response = await fetch(ATLASSIAN_USER_URL, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (!response.ok) {
        console.error("Failed to fetch Atlassian user info:", await response.text());
        return null;
      }
      const profile = (await response.json()) as AtlassianProfile;

      const mapped = options.mapProfileToUser ? await options.mapProfileToUser(profile) : {};
      return {
        user: {
          id: profile.account_id,
          email: profile.email,
          emailVerified: false,
          name: profile.name,
          image: profile.picture,
          firstName: (mapped as any).firstName || profile.name,
          lastName: (mapped as any).lastName,
          ...mapped,
        },
        data: profile,
      };
    },
  };
}

export default atlassian;
