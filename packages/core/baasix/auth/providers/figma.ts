/**
 * Figma OAuth Provider
 * Ported from better-auth packages/core/src/social-providers/figma.ts
 *
 * Figma's token endpoint authenticates the client via HTTP Basic auth
 * (base64 clientId:clientSecret) rather than form body params, so token
 * exchange and refresh are inlined here instead of using the shared
 * validateAuthorizationCode/refreshAccessToken helpers.
 */

import type { OAuthProvider, OAuth2Tokens, ProviderOptions } from "../types.js";
import { createAuthorizationURL, parseOAuth2Tokens } from "../oauth2/utils.js";

export interface FigmaProfile extends Record<string, any> {
  id: string;
  email: string;
  handle: string;
  img_url: string;
}

export interface FigmaOptions extends ProviderOptions<FigmaProfile> {}

const FIGMA_AUTH_URL = "https://www.figma.com/oauth";
const FIGMA_TOKEN_URL = "https://api.figma.com/v1/oauth/token";
const FIGMA_USER_URL = "https://api.figma.com/v1/me";

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

export function figma(options: FigmaOptions): OAuthProvider<FigmaProfile, FigmaOptions> {
  const defaultScopes = ["current_user:read"];

  return {
    id: "figma",
    name: "Figma",
    options,

    async createAuthorizationURL({ state, codeVerifier, scopes, redirectURI }) {
      const allScopes = options.disableDefaultScope
        ? [...(options.scope || []), ...(scopes || [])]
        : [...defaultScopes, ...(options.scope || []), ...(scopes || [])];

      return createAuthorizationURL({
        authorizationEndpoint: FIGMA_AUTH_URL,
        clientId: options.clientId,
        redirectURI: options.redirectURI || redirectURI,
        state,
        scopes: [...new Set(allScopes)],
        codeVerifier,
        prompt: options.prompt,
      });
    },

    async validateAuthorizationCode({ code, redirectURI, codeVerifier }): Promise<OAuth2Tokens> {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: options.redirectURI || redirectURI,
      });
      if (codeVerifier) body.set("code_verifier", codeVerifier);

      const response = await fetch(FIGMA_TOKEN_URL, {
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

      const response = await fetch(FIGMA_TOKEN_URL, {
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
      const response = await fetch(FIGMA_USER_URL, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (!response.ok) {
        console.error("Failed to fetch Figma user info:", await response.text());
        return null;
      }
      const profile = (await response.json()) as FigmaProfile;

      const mapped = options.mapProfileToUser ? await options.mapProfileToUser(profile) : {};
      return {
        user: {
          id: profile.id,
          email: profile.email,
          emailVerified: false,
          name: profile.handle,
          image: profile.img_url,
          firstName: (mapped as any).firstName || profile.handle,
          lastName: (mapped as any).lastName,
          ...mapped,
        },
        data: profile,
      };
    },
  };
}

export default figma;
