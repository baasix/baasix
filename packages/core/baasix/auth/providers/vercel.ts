/**
 * Vercel OAuth Provider
 * Ported from better-auth packages/core/src/social-providers/vercel.ts
 *
 * Vercel requires PKCE — the source throws if codeVerifier is missing.
 * No default scopes: source only sends a `scope` param when the caller
 * explicitly configured `options.scope` or requested extra `scopes`.
 */

import type { OAuthProvider, ProviderOptions } from "../types.js";
import { createAuthorizationURL, validateAuthorizationCode, parseOAuth2Tokens } from "../oauth2/utils.js";

export interface VercelProfile extends Record<string, any> {
  sub: string;
  name?: string;
  preferred_username?: string;
  email?: string;
  email_verified?: boolean;
  picture?: string;
}

export interface VercelOptions extends ProviderOptions<VercelProfile> {}

const VERCEL_AUTH_URL = "https://vercel.com/oauth/authorize";
const VERCEL_TOKEN_URL = "https://api.vercel.com/login/oauth/token";
const VERCEL_USERINFO_URL = "https://api.vercel.com/login/oauth/userinfo";

export function vercel(options: VercelOptions): OAuthProvider<VercelProfile, VercelOptions> {
  return {
    id: "vercel",
    name: "Vercel",
    options,

    async createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }) {
      if (!codeVerifier) {
        throw new Error("codeVerifier is required for Vercel");
      }

      let allScopes: string[] | undefined;
      if (options.scope !== undefined || scopes !== undefined) {
        allScopes = [...(options.scope || []), ...(scopes || [])];
      }

      return createAuthorizationURL({
        authorizationEndpoint: VERCEL_AUTH_URL,
        clientId: options.clientId,
        redirectURI: options.redirectURI || redirectURI,
        state,
        scopes: allScopes,
        codeVerifier,
      });
    },

    async validateAuthorizationCode({ code, codeVerifier, redirectURI }) {
      const result = await validateAuthorizationCode({
        tokenEndpoint: VERCEL_TOKEN_URL,
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

    async getUserInfo(tokens) {
      if (!tokens.accessToken) return null;
      const response = await fetch(VERCEL_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (!response.ok) {
        console.error("Failed to fetch Vercel user info:", await response.text());
        return null;
      }
      const profile = (await response.json()) as VercelProfile;

      const displayName = profile.name ?? profile.preferred_username ?? "";
      const mapped = options.mapProfileToUser ? await options.mapProfileToUser(profile) : {};
      return {
        user: {
          id: profile.sub,
          name: displayName,
          email: profile.email,
          image: profile.picture,
          emailVerified: profile.email_verified ?? false,
          firstName: (mapped as any).firstName || displayName,
          lastName: (mapped as any).lastName,
          ...mapped,
        },
        data: profile,
      };
    },
  };
}

export default vercel;
