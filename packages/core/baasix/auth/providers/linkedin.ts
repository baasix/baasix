/**
 * LinkedIn OAuth Provider
 * Ported from better-auth packages/core/src/social-providers/linkedin.ts
 */

import type { OAuthProvider, ProviderOptions } from "../types.js";
import {
  createAuthorizationURL,
  validateAuthorizationCode,
  refreshAccessToken,
  parseOAuth2Tokens,
} from "../oauth2/utils.js";

export interface LinkedInProfile extends Record<string, any> {
  sub: string;
  name: string;
  given_name: string;
  family_name: string;
  picture: string;
  locale?: {
    country: string;
    language: string;
  };
  email?: string;
  email_verified?: boolean;
}

export interface LinkedInOptions extends ProviderOptions<LinkedInProfile> {}

const LINKEDIN_AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const LINKEDIN_USERINFO_URL = "https://api.linkedin.com/v2/userinfo";

export function linkedin(options: LinkedInOptions): OAuthProvider<LinkedInProfile, LinkedInOptions> {
  const defaultScopes = ["openid", "profile", "email"];

  return {
    id: "linkedin",
    name: "Linkedin",

    async createAuthorizationURL({ state, scopes, redirectURI, loginHint }) {
      const allScopes = options.disableDefaultScope
        ? [...(options.scope || []), ...(scopes || [])]
        : [...defaultScopes, ...(options.scope || []), ...(scopes || [])];

      return createAuthorizationURL({
        authorizationEndpoint: LINKEDIN_AUTH_URL,
        clientId: options.clientId,
        redirectURI: options.redirectURI || redirectURI,
        state,
        scopes: [...new Set(allScopes)],
        loginHint,
      });
    },

    async validateAuthorizationCode({ code, redirectURI }) {
      const result = await validateAuthorizationCode({
        tokenEndpoint: LINKEDIN_TOKEN_URL,
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

    async refreshAccessToken(refreshToken) {
      const result = await refreshAccessToken({
        tokenEndpoint: LINKEDIN_TOKEN_URL,
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
      const response = await fetch(LINKEDIN_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (!response.ok) {
        console.error("Failed to fetch LinkedIn user info:", await response.text());
        return null;
      }
      const profile = (await response.json()) as LinkedInProfile;

      const mapped = options.mapProfileToUser ? await options.mapProfileToUser(profile) : {};
      return {
        user: {
          id: profile.sub,
          email: profile.email,
          emailVerified: profile.email_verified ?? false,
          name: profile.name,
          image: profile.picture,
          firstName: (mapped as any).firstName || profile.given_name || profile.name,
          lastName: (mapped as any).lastName || profile.family_name,
          ...mapped,
        },
        data: profile,
      };
    },
  };
}

export default linkedin;
