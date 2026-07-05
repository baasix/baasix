/**
 * Spotify OAuth Provider
 * Ported from better-auth packages/core/src/social-providers/spotify.ts
 */

import type { OAuthProvider, OAuth2Tokens, ProviderOptions } from "../types.js";
import {
  createAuthorizationURL,
  validateAuthorizationCode,
  refreshAccessToken,
  parseOAuth2Tokens,
} from "../oauth2/utils.js";

export interface SpotifyProfile extends Record<string, any> {
  id: string;
  display_name: string;
  email: string;
  images: { url: string }[];
}

export interface SpotifyOptions extends ProviderOptions<SpotifyProfile> {}

const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_USERINFO_URL = "https://api.spotify.com/v1/me";

export function spotify(options: SpotifyOptions): OAuthProvider<SpotifyProfile, SpotifyOptions> {
  const defaultScopes = ["user-read-email"];

  return {
    id: "spotify",
    name: "Spotify",
    options,

    async createAuthorizationURL({ state, codeVerifier, scopes, redirectURI }) {
      const allScopes = options.disableDefaultScope
        ? [...(options.scope || []), ...(scopes || [])]
        : [...defaultScopes, ...(options.scope || []), ...(scopes || [])];

      return createAuthorizationURL({
        authorizationEndpoint: SPOTIFY_AUTH_URL,
        clientId: options.clientId,
        redirectURI: options.redirectURI || redirectURI,
        state,
        scopes: [...new Set(allScopes)],
        codeVerifier,
      });
    },

    async validateAuthorizationCode({ code, redirectURI, codeVerifier }): Promise<OAuth2Tokens> {
      const result = await validateAuthorizationCode({
        tokenEndpoint: SPOTIFY_TOKEN_URL,
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
        tokenEndpoint: SPOTIFY_TOKEN_URL,
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
      const response = await fetch(SPOTIFY_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (!response.ok) {
        console.error("Failed to fetch Spotify user info:", await response.text());
        return null;
      }
      const profile = (await response.json()) as SpotifyProfile;

      const mapped = options.mapProfileToUser ? await options.mapProfileToUser(profile) : {};
      return {
        user: {
          id: profile.id,
          email: profile.email,
          // Spotify's /v1/me does not report email verification status.
          emailVerified: false,
          name: profile.display_name,
          image: profile.images?.[0]?.url,
          firstName: (mapped as any).firstName || profile.display_name,
          lastName: (mapped as any).lastName,
          ...mapped,
        },
        data: profile,
      };
    },
  };
}

export default spotify;
