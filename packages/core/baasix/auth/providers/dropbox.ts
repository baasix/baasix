/**
 * Dropbox OAuth Provider
 * Ported from better-auth packages/core/src/social-providers/dropbox.ts
 */

import type { OAuthProvider, ProviderOptions } from "../types.js";
import {
  createAuthorizationURL,
  validateAuthorizationCode,
  refreshAccessToken,
  parseOAuth2Tokens,
} from "../oauth2/utils.js";

export interface DropboxProfile extends Record<string, any> {
  account_id: string;
  name: {
    given_name: string;
    surname: string;
    familiar_name: string;
    display_name: string;
    abbreviated_name: string;
  };
  email: string;
  email_verified: boolean;
  profile_photo_url: string;
}

export interface DropboxOptions extends ProviderOptions<DropboxProfile> {
  accessType?: "offline" | "online" | "legacy";
}

const DROPBOX_AUTH_URL = "https://www.dropbox.com/oauth2/authorize";
const DROPBOX_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const DROPBOX_USER_URL = "https://api.dropboxapi.com/2/users/get_current_account";

export function dropbox(options: DropboxOptions): OAuthProvider<DropboxProfile, DropboxOptions> {
  const defaultScopes = ["account_info.read"];

  return {
    id: "dropbox",
    name: "Dropbox",
    options,

    async createAuthorizationURL({ state, codeVerifier, scopes, redirectURI }) {
      const allScopes = options.disableDefaultScope
        ? [...(options.scope || []), ...(scopes || [])]
        : [...defaultScopes, ...(options.scope || []), ...(scopes || [])];

      return createAuthorizationURL({
        authorizationEndpoint: DROPBOX_AUTH_URL,
        clientId: options.clientId,
        redirectURI: options.redirectURI || redirectURI,
        state,
        scopes: [...new Set(allScopes)],
        codeVerifier,
        prompt: options.prompt,
        additionalParams: {
          ...(options.accessType && { token_access_type: options.accessType }),
        },
      });
    },

    async validateAuthorizationCode({ code, redirectURI, codeVerifier }) {
      const result = await validateAuthorizationCode({
        tokenEndpoint: DROPBOX_TOKEN_URL,
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
        tokenEndpoint: DROPBOX_TOKEN_URL,
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
      const response = await fetch(DROPBOX_USER_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (!response.ok) {
        console.error("Failed to fetch Dropbox user info:", await response.text());
        return null;
      }
      const profile = (await response.json()) as DropboxProfile;

      const displayName = profile.name?.display_name || "";
      const mapped = options.mapProfileToUser ? await options.mapProfileToUser(profile) : {};
      return {
        user: {
          id: profile.account_id,
          email: profile.email,
          emailVerified: profile.email_verified || false,
          name: displayName,
          image: profile.profile_photo_url,
          firstName: (mapped as any).firstName || profile.name?.given_name || displayName,
          lastName: (mapped as any).lastName || profile.name?.surname,
          ...mapped,
        },
        data: profile,
      };
    },
  };
}

export default dropbox;
