/**
 * Twitch OAuth Provider
 * Ported from better-auth packages/core/src/social-providers/twitch.ts
 *
 * Twitch returns the user's email via the OIDC id_token when the `openid`
 * scope + a `claims` request parameter are present (Twitch does not expose
 * email through a separate userinfo endpoint the way plain OAuth2 does), so
 * getUserInfo decodes the id_token instead of calling an API.
 */

import type { OAuthProvider, ProviderOptions } from "../types.js";
import { createAuthorizationURL, validateAuthorizationCode, refreshAccessToken, parseOAuth2Tokens } from "../oauth2/utils.js";
import { decodeJwt } from "jose";

export interface TwitchProfile extends Record<string, any> {
  sub: string;
  preferred_username: string;
  email: string;
  email_verified: boolean;
  picture: string;
}

export interface TwitchOptions extends ProviderOptions<TwitchProfile> {
  claims?: string[];
}

const TWITCH_AUTH_URL = "https://id.twitch.tv/oauth2/authorize";
const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";

export function twitch(options: TwitchOptions): OAuthProvider<TwitchProfile, TwitchOptions> {
  const defaultScopes = ["user:read:email", "openid"];

  return {
    id: "twitch",
    name: "Twitch",
    options,

    async createAuthorizationURL({ state, scopes, redirectURI }) {
      const allScopes = options.disableDefaultScope
        ? [...(options.scope || []), ...(scopes || [])]
        : [...defaultScopes, ...(options.scope || []), ...(scopes || [])];

      // Twitch's OIDC id_token only includes the claims explicitly requested
      // via the `claims` query param (JSON-encoded per OIDC spec section 5.5).
      const claims = options.claims || ["email", "email_verified", "preferred_username", "picture"];
      const claimsObj = claims.reduce((acc, claim) => {
        acc[claim] = null;
        return acc;
      }, {} as Record<string, null>);

      return createAuthorizationURL({
        authorizationEndpoint: TWITCH_AUTH_URL,
        clientId: options.clientId,
        redirectURI: options.redirectURI || redirectURI,
        state,
        scopes: [...new Set(allScopes)],
        additionalParams: {
          claims: JSON.stringify({ id_token: { email: null, email_verified: null, ...claimsObj } }),
        },
      });
    },

    async validateAuthorizationCode({ code, redirectURI }) {
      const result = await validateAuthorizationCode({
        tokenEndpoint: TWITCH_TOKEN_URL,
        code,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        redirectURI: options.redirectURI || redirectURI,
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
        tokenEndpoint: TWITCH_TOKEN_URL,
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
      if (!tokens.idToken) {
        console.error("No idToken found in Twitch tokens");
        return null;
      }
      const profile = decodeJwt(tokens.idToken) as TwitchProfile;

      const mapped = options.mapProfileToUser ? await options.mapProfileToUser(profile) : {};
      return {
        user: {
          id: profile.sub,
          email: profile.email,
          emailVerified: profile.email_verified,
          name: profile.preferred_username,
          image: profile.picture,
          firstName: (mapped as any).firstName || profile.preferred_username,
          lastName: (mapped as any).lastName,
          ...mapped,
        },
        data: profile,
      };
    },
  };
}

export default twitch;
