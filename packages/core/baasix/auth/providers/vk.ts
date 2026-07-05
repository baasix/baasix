/**
 * VK (VK ID) OAuth Provider
 * Ported from better-auth packages/core/src/social-providers/vk.ts
 *
 * VK ID's userinfo endpoint is POST-only and expects the access token and
 * client_id as form body fields (not a Bearer header), so it is inlined
 * here rather than using a generic Bearer-header fetch. Per source, if
 * neither the profile nor mapProfileToUser produce an email, getUserInfo
 * returns null (VK's identity is considered incomplete without one).
 */

import type { OAuthProvider, ProviderOptions } from "../types.js";
import { createAuthorizationURL, validateAuthorizationCode, refreshAccessToken, parseOAuth2Tokens } from "../oauth2/utils.js";

export interface VkProfile extends Record<string, any> {
  user: {
    user_id: string;
    first_name: string;
    last_name: string;
    email?: string;
    phone?: number;
    avatar?: string;
    sex?: number;
    verified?: boolean;
    birthday: string;
  };
}

export interface VkOption extends ProviderOptions<VkProfile> {
  scheme?: "light" | "dark";
}

const VK_AUTH_URL = "https://id.vk.com/authorize";
const VK_TOKEN_URL = "https://id.vk.com/oauth2/auth";
const VK_USERINFO_URL = "https://id.vk.com/oauth2/user_info";

export function vk(options: VkOption): OAuthProvider<VkProfile, VkOption> {
  const defaultScopes = ["email", "phone"];

  return {
    id: "vk",
    name: "VK",
    options,

    async createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }) {
      const allScopes = options.disableDefaultScope
        ? [...(options.scope || []), ...(scopes || [])]
        : [...defaultScopes, ...(options.scope || []), ...(scopes || [])];

      return createAuthorizationURL({
        authorizationEndpoint: VK_AUTH_URL,
        clientId: options.clientId,
        redirectURI: options.redirectURI || redirectURI,
        state,
        scopes: [...new Set(allScopes)],
        codeVerifier,
      });
    },

    async validateAuthorizationCode({ code, codeVerifier, redirectURI }) {
      const result = await validateAuthorizationCode({
        tokenEndpoint: VK_TOKEN_URL,
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
        tokenEndpoint: VK_TOKEN_URL,
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

      const body = new URLSearchParams({
        access_token: tokens.accessToken,
        client_id: options.clientId,
      });

      const response = await fetch(VK_USERINFO_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!response.ok) {
        console.error("Failed to fetch VK user info:", await response.text());
        return null;
      }
      const profile = (await response.json()) as VkProfile;

      const mapped = options.mapProfileToUser ? await options.mapProfileToUser(profile) : {};
      if (!profile.user.email && !(mapped as any).email) {
        return null;
      }

      const displayName = `${profile.user.first_name} ${profile.user.last_name}`;
      return {
        user: {
          id: profile.user.user_id,
          name: displayName,
          email: profile.user.email,
          image: profile.user.avatar,
          emailVerified: false,
          firstName: (mapped as any).firstName || profile.user.first_name,
          lastName: (mapped as any).lastName || profile.user.last_name,
          ...mapped,
        },
        data: profile,
      };
    },
  };
}

export default vk;
