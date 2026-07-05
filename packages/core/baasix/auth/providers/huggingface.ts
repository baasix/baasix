/**
 * Hugging Face OAuth Provider
 * Ported from better-auth packages/core/src/social-providers/huggingface.ts
 */

import type { OAuthProvider, ProviderOptions } from "../types.js";
import {
  createAuthorizationURL,
  validateAuthorizationCode,
  refreshAccessToken,
  parseOAuth2Tokens,
} from "../oauth2/utils.js";

export interface HuggingFaceProfile extends Record<string, any> {
  sub: string;
  name: string;
  preferred_username: string;
  profile: string;
  picture: string;
  website?: string;
  email?: string;
  email_verified?: boolean;
  isPro: boolean;
}

export interface HuggingFaceOptions extends ProviderOptions<HuggingFaceProfile> {}

const HUGGINGFACE_AUTH_URL = "https://huggingface.co/oauth/authorize";
const HUGGINGFACE_TOKEN_URL = "https://huggingface.co/oauth/token";
const HUGGINGFACE_USER_URL = "https://huggingface.co/oauth/userinfo";

export function huggingface(options: HuggingFaceOptions): OAuthProvider<HuggingFaceProfile, HuggingFaceOptions> {
  const defaultScopes = ["openid", "profile", "email"];

  return {
    id: "huggingface",
    name: "Hugging Face",
    options,

    async createAuthorizationURL({ state, codeVerifier, scopes, redirectURI }) {
      const allScopes = options.disableDefaultScope
        ? [...(options.scope || []), ...(scopes || [])]
        : [...defaultScopes, ...(options.scope || []), ...(scopes || [])];

      return createAuthorizationURL({
        authorizationEndpoint: HUGGINGFACE_AUTH_URL,
        clientId: options.clientId,
        redirectURI: options.redirectURI || redirectURI,
        state,
        scopes: [...new Set(allScopes)],
        codeVerifier,
        prompt: options.prompt,
      });
    },

    async validateAuthorizationCode({ code, redirectURI, codeVerifier }) {
      const result = await validateAuthorizationCode({
        tokenEndpoint: HUGGINGFACE_TOKEN_URL,
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
        idToken: result.idToken,
        tokenType: result.tokenType,
        raw: result.raw,
      };
    },

    async refreshAccessToken(refreshToken) {
      const result = await refreshAccessToken({
        tokenEndpoint: HUGGINGFACE_TOKEN_URL,
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
      const response = await fetch(HUGGINGFACE_USER_URL, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (!response.ok) {
        console.error("Failed to fetch Hugging Face user info:", await response.text());
        return null;
      }
      const profile = (await response.json()) as HuggingFaceProfile;

      const displayName = profile.name || profile.preferred_username || "";
      const mapped = options.mapProfileToUser ? await options.mapProfileToUser(profile) : {};
      return {
        user: {
          id: profile.sub,
          email: profile.email,
          emailVerified: profile.email_verified ?? false,
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

export default huggingface;
