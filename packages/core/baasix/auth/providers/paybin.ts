/**
 * Paybin OAuth Provider
 * Ported from better-auth packages/core/src/social-providers/paybin.ts
 */

import type { OAuthProvider, ProviderOptions } from "../types.js";
import {
  createAuthorizationURL,
  validateAuthorizationCode,
  refreshAccessToken,
  parseOAuth2Tokens,
} from "../oauth2/utils.js";
import { decodeJwt } from "jose";

export interface PaybinProfile extends Record<string, any> {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
}

export interface PaybinOptions extends ProviderOptions<PaybinProfile> {
  /**
   * The issuer URL of your Paybin OAuth server
   * @default "https://idp.paybin.io"
   */
  issuer?: string;
}

export function paybin(options: PaybinOptions): OAuthProvider<PaybinProfile, PaybinOptions> {
  const issuer = options.issuer || "https://idp.paybin.io";
  const authorizationEndpoint = `${issuer}/oauth2/authorize`;
  const tokenEndpoint = `${issuer}/oauth2/token`;
  const defaultScopes = ["openid", "email", "profile"];

  return {
    id: "paybin",
    name: "Paybin",
    options,

    async createAuthorizationURL({ state, codeVerifier, scopes, redirectURI, loginHint }) {
      const allScopes = options.disableDefaultScope
        ? [...(options.scope || []), ...(scopes || [])]
        : [...defaultScopes, ...(options.scope || []), ...(scopes || [])];

      return createAuthorizationURL({
        authorizationEndpoint,
        clientId: options.clientId,
        redirectURI: options.redirectURI || redirectURI,
        state,
        scopes: [...new Set(allScopes)],
        codeVerifier,
        prompt: options.prompt,
        loginHint,
      });
    },

    async validateAuthorizationCode({ code, redirectURI, codeVerifier }) {
      const result = await validateAuthorizationCode({
        tokenEndpoint,
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
        tokenEndpoint,
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
      if (!tokens.idToken) return null;
      const profile = decodeJwt(tokens.idToken) as PaybinProfile;
      const displayName = profile.name || profile.preferred_username || "";
      const mapped = options.mapProfileToUser ? await options.mapProfileToUser(profile) : {};
      return {
        user: {
          id: profile.sub,
          email: profile.email,
          emailVerified: profile.email_verified || false,
          name: displayName,
          image: profile.picture,
          firstName: (mapped as any).firstName || profile.given_name || displayName,
          lastName: (mapped as any).lastName || profile.family_name,
          ...mapped,
        },
        data: profile,
      };
    },
  };
}

export default paybin;
