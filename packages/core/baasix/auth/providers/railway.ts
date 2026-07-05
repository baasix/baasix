/**
 * Railway OAuth Provider
 * Ported from better-auth packages/core/src/social-providers/railway.ts
 *
 * Railway's token endpoint authenticates the client via HTTP Basic auth
 * (base64 clientId:clientSecret) rather than form body params
 * (`authentication: "basic"` in the source), so token exchange and refresh
 * are inlined here instead of using the shared validateAuthorizationCode/
 * refreshAccessToken helpers (same pattern as figma.ts / notion.ts).
 */

import type { OAuthProvider, OAuth2Tokens, ProviderOptions } from "../types.js";
import { createAuthorizationURL, parseOAuth2Tokens } from "../oauth2/utils.js";

export interface RailwayProfile extends Record<string, any> {
  /** The user's unique ID (OAuth `sub` claim). */
  sub: string;
  /** The user's email address. */
  email: string;
  /** The user's display name. */
  name: string;
  /** URL of the user's profile picture. */
  picture: string;
}

export interface RailwayOptions extends ProviderOptions<RailwayProfile> {}

const RAILWAY_AUTH_URL = "https://backboard.railway.com/oauth/auth";
const RAILWAY_TOKEN_URL = "https://backboard.railway.com/oauth/token";
const RAILWAY_USERINFO_URL = "https://backboard.railway.com/oauth/me";

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

export function railway(options: RailwayOptions): OAuthProvider<RailwayProfile, RailwayOptions> {
  const defaultScopes = ["openid", "email", "profile"];

  return {
    id: "railway",
    name: "Railway",
    options,

    async createAuthorizationURL({ state, codeVerifier, scopes, redirectURI }) {
      const allScopes = options.disableDefaultScope
        ? [...(options.scope || []), ...(scopes || [])]
        : [...defaultScopes, ...(options.scope || []), ...(scopes || [])];

      return createAuthorizationURL({
        authorizationEndpoint: RAILWAY_AUTH_URL,
        clientId: options.clientId,
        redirectURI: options.redirectURI || redirectURI,
        state,
        scopes: [...new Set(allScopes)],
        codeVerifier,
      });
    },

    async validateAuthorizationCode({ code, redirectURI, codeVerifier }): Promise<OAuth2Tokens> {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: options.redirectURI || redirectURI,
      });
      if (codeVerifier) body.set("code_verifier", codeVerifier);

      const response = await fetch(RAILWAY_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          Authorization: basicAuthHeader(options.clientId, options.clientSecret),
        },
        body: body.toString(),
      });

      if (!response.ok) {
        throw new Error(`Token exchange failed: ${response.status} ${await response.text()}`);
      }

      const raw = (await response.json()) as Record<string, any>;
      return {
        ...parseOAuth2Tokens(raw),
        raw,
      };
    },

    async refreshAccessToken(refreshToken): Promise<OAuth2Tokens> {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });

      const response = await fetch(RAILWAY_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          Authorization: basicAuthHeader(options.clientId, options.clientSecret),
        },
        body: body.toString(),
      });

      if (!response.ok) {
        throw new Error(`Token refresh failed: ${response.status} ${await response.text()}`);
      }

      const raw = (await response.json()) as Record<string, any>;
      return {
        ...parseOAuth2Tokens(raw),
        raw,
      };
    },

    async getUserInfo(tokens) {
      if (!tokens.accessToken) return null;
      const response = await fetch(RAILWAY_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (!response.ok) {
        console.error("Failed to fetch Railway user info:", await response.text());
        return null;
      }
      const profile = (await response.json()) as RailwayProfile;

      const mapped = options.mapProfileToUser ? await options.mapProfileToUser(profile) : {};
      return {
        user: {
          id: profile.sub,
          email: profile.email,
          // Railway does not provide an email_verified claim — default to
          // false for security consistency.
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

export default railway;
