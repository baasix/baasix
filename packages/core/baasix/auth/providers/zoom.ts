/**
 * Zoom OAuth Provider
 * Ported from better-auth packages/core/src/social-providers/zoom.ts
 *
 * PKCE is opt-out (defaults to true per source: `pkce: true, ...userOptions`).
 */

import type { OAuthProvider, ProviderOptions } from "../types.js";
import { validateAuthorizationCode, refreshAccessToken, parseOAuth2Tokens } from "../oauth2/utils.js";

export interface ZoomProfile extends Record<string, any> {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  display_name: string;
  pic_url: string;
  verified: number;
}

export interface ZoomOptions extends ProviderOptions<ZoomProfile> {
  pkce?: boolean;
}

const ZOOM_AUTH_URL = "https://zoom.us/oauth/authorize";
const ZOOM_TOKEN_URL = "https://zoom.us/oauth/token";
const ZOOM_USERINFO_URL = "https://api.zoom.us/v2/users/me";

export function zoom(userOptions: ZoomOptions): OAuthProvider<ZoomProfile, ZoomOptions> {
  const options: ZoomOptions = { pkce: true, ...userOptions };

  return {
    id: "zoom",
    name: "Zoom",
    options,

    async createAuthorizationURL({ state, redirectURI, codeVerifier }) {
      const params = new URLSearchParams({
        response_type: "code",
        redirect_uri: options.redirectURI || redirectURI,
        client_id: options.clientId,
        state,
      });

      if (options.pkce) {
        // Baasix's oauth2 helpers only expose generateCodeChallenge via
        // createAuthorizationURL, so replicate the S256 challenge inline to
        // match the source, which calls generateCodeChallenge directly.
        const encoder = new TextEncoder();
        const data = encoder.encode(codeVerifier);
        const digest = await crypto.subtle.digest("SHA-256", data);
        const codeChallenge = Buffer.from(digest).toString("base64url");
        params.set("code_challenge_method", "S256");
        params.set("code_challenge", codeChallenge);
      }

      const url = new URL(ZOOM_AUTH_URL);
      url.search = params.toString();
      return url;
    },

    async validateAuthorizationCode({ code, redirectURI, codeVerifier }) {
      const result = await validateAuthorizationCode({
        tokenEndpoint: ZOOM_TOKEN_URL,
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
        tokenEndpoint: ZOOM_TOKEN_URL,
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
      const response = await fetch(ZOOM_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (!response.ok) {
        console.error("Failed to fetch Zoom user info:", await response.text());
        return null;
      }
      const profile = (await response.json()) as ZoomProfile;

      const mapped = options.mapProfileToUser ? await options.mapProfileToUser(profile) : {};
      return {
        user: {
          id: profile.id,
          name: profile.display_name,
          email: profile.email,
          image: profile.pic_url,
          emailVerified: Boolean(profile.verified),
          firstName: (mapped as any).firstName || profile.first_name || profile.display_name,
          lastName: (mapped as any).lastName || profile.last_name,
          ...mapped,
        },
        data: profile,
      };
    },
  };
}

export default zoom;
