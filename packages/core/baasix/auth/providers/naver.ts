/**
 * Naver OAuth Provider
 * Ported from better-auth packages/core/src/social-providers/naver.ts
 */

import type { OAuthProvider, ProviderOptions } from "../types.js";
import {
  createAuthorizationURL,
  validateAuthorizationCode,
  refreshAccessToken,
  parseOAuth2Tokens,
} from "../oauth2/utils.js";

export interface NaverProfile extends Record<string, any> {
  /** API response result code */
  resultcode: string;
  /** API response message */
  message: string;
  response: {
    /** Unique Naver user identifier */
    id: string;
    /** User nickname */
    nickname?: string;
    /** User real name */
    name?: string;
    /** User email address */
    email?: string;
    /** Gender (F: female, M: male, U: unknown) */
    gender?: string;
    /** Age range */
    age?: string;
    /** Birthday (MM-DD format) */
    birthday?: string;
    /** Birth year */
    birthyear?: string;
    /** Profile image URL */
    profile_image?: string;
    /** Mobile phone number */
    mobile?: string;
  };
}

export interface NaverOptions extends ProviderOptions<NaverProfile> {}

const NAVER_AUTH_URL = "https://nid.naver.com/oauth2.0/authorize";
const NAVER_TOKEN_URL = "https://nid.naver.com/oauth2.0/token";
const NAVER_USER_URL = "https://openapi.naver.com/v1/nid/me";

export function naver(options: NaverOptions): OAuthProvider<NaverProfile, NaverOptions> {
  const defaultScopes = ["profile", "email"];

  return {
    id: "naver",
    name: "Naver",
    options,

    async createAuthorizationURL({ state, scopes, redirectURI }) {
      const allScopes = options.disableDefaultScope
        ? [...(options.scope || []), ...(scopes || [])]
        : [...defaultScopes, ...(options.scope || []), ...(scopes || [])];

      return createAuthorizationURL({
        authorizationEndpoint: NAVER_AUTH_URL,
        clientId: options.clientId,
        redirectURI: options.redirectURI || redirectURI,
        state,
        scopes: [...new Set(allScopes)],
      });
    },

    async validateAuthorizationCode({ code, redirectURI }) {
      const result = await validateAuthorizationCode({
        tokenEndpoint: NAVER_TOKEN_URL,
        code,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        redirectURI: options.redirectURI || redirectURI,
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
        tokenEndpoint: NAVER_TOKEN_URL,
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
      const response = await fetch(NAVER_USER_URL, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (!response.ok) {
        console.error("Failed to fetch Naver user info:", await response.text());
        return null;
      }
      const profile = (await response.json()) as NaverProfile;
      if (profile.resultcode !== "00") {
        return null;
      }

      // Naver nests the actual profile fields under the `response` key.
      const res = profile.response || ({} as NaverProfile["response"]);
      const displayName = res.name || res.nickname || "";
      const mapped = options.mapProfileToUser ? await options.mapProfileToUser(profile) : {};
      return {
        user: {
          id: res.id,
          email: res.email,
          emailVerified: false,
          name: displayName,
          image: res.profile_image,
          firstName: (mapped as any).firstName || displayName,
          lastName: (mapped as any).lastName,
          ...mapped,
        },
        data: profile,
      };
    },
  };
}

export default naver;
