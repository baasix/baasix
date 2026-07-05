/**
 * LINE Login v2.1 OAuth Provider
 * Ported from better-auth packages/core/src/social-providers/line.ts
 */

import type { OAuthProvider, ProviderOptions } from "../types.js";
import {
  createAuthorizationURL,
  validateAuthorizationCode,
  refreshAccessToken,
  parseOAuth2Tokens,
} from "../oauth2/utils.js";
import { decodeJwt } from "jose";

export interface LineIdTokenPayload extends Record<string, any> {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  name?: string;
  picture?: string;
  email?: string;
  amr?: string[];
  nonce?: string;
}

export interface LineUserInfo extends Record<string, any> {
  sub: string;
  name?: string;
  picture?: string;
  email?: string;
}

export interface LineOptions extends ProviderOptions<LineUserInfo | LineIdTokenPayload> {}

const LINE_AUTH_URL = "https://access.line.me/oauth2/v2.1/authorize";
const LINE_TOKEN_URL = "https://api.line.me/oauth2/v2.1/token";
const LINE_USERINFO_URL = "https://api.line.me/oauth2/v2.1/userinfo";
const LINE_VERIFY_ID_TOKEN_URL = "https://api.line.me/oauth2/v2.1/verify";

export function line(options: LineOptions): OAuthProvider<LineUserInfo | LineIdTokenPayload, LineOptions> {
  const defaultScopes = ["openid", "profile", "email"];

  return {
    id: "line",
    name: "LINE",
    options,

    async createAuthorizationURL({ state, codeVerifier, scopes, redirectURI, loginHint }) {
      const allScopes = options.disableDefaultScope
        ? [...(options.scope || []), ...(scopes || [])]
        : [...defaultScopes, ...(options.scope || []), ...(scopes || [])];

      return createAuthorizationURL({
        authorizationEndpoint: LINE_AUTH_URL,
        clientId: options.clientId,
        redirectURI: options.redirectURI || redirectURI,
        state,
        scopes: [...new Set(allScopes)],
        codeVerifier,
        loginHint,
      });
    },

    async validateAuthorizationCode({ code, redirectURI, codeVerifier }) {
      const result = await validateAuthorizationCode({
        tokenEndpoint: LINE_TOKEN_URL,
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
        tokenEndpoint: LINE_TOKEN_URL,
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

    async verifyIdToken(token, nonce) {
      const body = new URLSearchParams();
      body.set("id_token", token);
      body.set("client_id", options.clientId);
      if (nonce) body.set("nonce", nonce);

      const response = await fetch(LINE_VERIFY_ID_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!response.ok) {
        console.error("Failed to verify LINE ID token:", await response.text());
        return false;
      }
      const data = (await response.json()) as LineIdTokenPayload;
      // aud must match clientId; nonce (if provided) must also match.
      if (data.aud !== options.clientId) return false;
      if (data.nonce && data.nonce !== nonce) return false;
      return true;
    },

    async getUserInfo(tokens) {
      let profile: LineUserInfo | LineIdTokenPayload | null = null;
      // Prefer the ID token (avoids an extra network round-trip) when present.
      if (tokens.idToken) {
        try {
          profile = decodeJwt(tokens.idToken) as LineIdTokenPayload;
        } catch (error) {
          console.error("Failed to decode LINE ID token:", error);
        }
      }
      // Fall back to the userinfo endpoint.
      if (!profile) {
        if (!tokens.accessToken) return null;
        const response = await fetch(LINE_USERINFO_URL, {
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
        });
        if (!response.ok) {
          console.error("Failed to fetch LINE user info:", await response.text());
          return null;
        }
        profile = (await response.json()) as LineUserInfo;
      }
      if (!profile) return null;

      const displayName = profile.name || "";
      const mapped = options.mapProfileToUser ? await options.mapProfileToUser(profile) : {};
      return {
        user: {
          id: profile.sub,
          email: profile.email,
          // LINE does not expose email verification status in the ID token or userinfo response.
          emailVerified: false,
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

export default line;
