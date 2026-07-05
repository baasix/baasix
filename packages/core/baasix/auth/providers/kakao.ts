/**
 * Kakao OAuth Provider
 * Ported from better-auth packages/core/src/social-providers/kakao.ts
 */

import type { OAuthProvider, ProviderOptions } from "../types.js";
import {
  createAuthorizationURL,
  validateAuthorizationCode,
  refreshAccessToken,
  parseOAuth2Tokens,
} from "../oauth2/utils.js";

interface KakaoProfileInfo {
  nickname?: string;
  thumbnail_image_url?: string;
  profile_image_url?: string;
  is_default_image?: boolean;
  is_default_nickname?: boolean;
}

interface KakaoAccount {
  profile?: KakaoProfileInfo;
  name?: string;
  is_email_valid?: boolean;
  is_email_verified?: boolean;
  email?: string;
}

export interface KakaoProfile extends Record<string, any> {
  id: number;
  has_signed_up?: boolean;
  connected_at?: string;
  synched_at?: string;
  properties?: Record<string, any>;
  kakao_account: KakaoAccount;
}

export interface KakaoOptions extends ProviderOptions<KakaoProfile> {}

const KAKAO_AUTH_URL = "https://kauth.kakao.com/oauth/authorize";
const KAKAO_TOKEN_URL = "https://kauth.kakao.com/oauth/token";
const KAKAO_USER_URL = "https://kapi.kakao.com/v2/user/me";

export function kakao(options: KakaoOptions): OAuthProvider<KakaoProfile, KakaoOptions> {
  const defaultScopes = ["account_email", "profile_image", "profile_nickname"];

  return {
    id: "kakao",
    name: "Kakao",
    options,

    async createAuthorizationURL({ state, scopes, redirectURI }) {
      const allScopes = options.disableDefaultScope
        ? [...(options.scope || []), ...(scopes || [])]
        : [...defaultScopes, ...(options.scope || []), ...(scopes || [])];

      return createAuthorizationURL({
        authorizationEndpoint: KAKAO_AUTH_URL,
        clientId: options.clientId,
        redirectURI: options.redirectURI || redirectURI,
        state,
        scopes: [...new Set(allScopes)],
        prompt: options.prompt,
      });
    },

    async validateAuthorizationCode({ code, redirectURI }) {
      const result = await validateAuthorizationCode({
        tokenEndpoint: KAKAO_TOKEN_URL,
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
        tokenEndpoint: KAKAO_TOKEN_URL,
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
      const response = await fetch(KAKAO_USER_URL, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (!response.ok) {
        console.error("Failed to fetch Kakao user info:", await response.text());
        return null;
      }
      const profile = (await response.json()) as KakaoProfile;

      const account = profile.kakao_account || ({} as KakaoAccount);
      const kakaoProfile = account.profile || ({} as KakaoProfileInfo);
      const displayName = kakaoProfile.nickname || account.name || "";
      const mapped = options.mapProfileToUser ? await options.mapProfileToUser(profile) : {};
      return {
        user: {
          id: String(profile.id),
          // Email lives under kakao_account.email; verification flag under
          // kakao_account.is_email_verified (both consent-gated by Kakao).
          email: account.email,
          emailVerified: !!account.is_email_valid && !!account.is_email_verified,
          name: displayName,
          image: kakaoProfile.profile_image_url || kakaoProfile.thumbnail_image_url,
          firstName: (mapped as any).firstName || displayName,
          lastName: (mapped as any).lastName,
          ...mapped,
        },
        data: profile,
      };
    },
  };
}

export default kakao;
