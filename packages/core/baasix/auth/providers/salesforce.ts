/**
 * Salesforce OAuth Provider
 * Ported from better-auth packages/core/src/social-providers/salesforce.ts
 */

import type { OAuthProvider, OAuth2Tokens, ProviderOptions } from "../types.js";
import {
  createAuthorizationURL,
  validateAuthorizationCode,
  refreshAccessToken,
  parseOAuth2Tokens,
} from "../oauth2/utils.js";

export interface SalesforceProfile extends Record<string, any> {
  sub: string;
  user_id: string;
  organization_id: string;
  preferred_username?: string;
  email: string;
  email_verified?: boolean;
  name: string;
  given_name?: string;
  family_name?: string;
  zoneinfo?: string;
  photos?: {
    picture?: string;
    thumbnail?: string;
  };
}

export interface SalesforceOptions extends ProviderOptions<SalesforceProfile> {
  environment?: "sandbox" | "production";
  /**
   * Custom My Domain login host (e.g. "mydomain.my.salesforce.com"),
   * without protocol. Overrides `environment` when set.
   */
  loginUrl?: string;
}

export function salesforce(options: SalesforceOptions): OAuthProvider<SalesforceProfile, SalesforceOptions> {
  const environment = options.environment ?? "production";
  const isSandbox = environment === "sandbox";

  const authorizationEndpoint = options.loginUrl
    ? `https://${options.loginUrl}/services/oauth2/authorize`
    : isSandbox
      ? "https://test.salesforce.com/services/oauth2/authorize"
      : "https://login.salesforce.com/services/oauth2/authorize";

  const tokenEndpoint = options.loginUrl
    ? `https://${options.loginUrl}/services/oauth2/token`
    : isSandbox
      ? "https://test.salesforce.com/services/oauth2/token"
      : "https://login.salesforce.com/services/oauth2/token";

  const userInfoEndpoint = options.loginUrl
    ? `https://${options.loginUrl}/services/oauth2/userinfo`
    : isSandbox
      ? "https://test.salesforce.com/services/oauth2/userinfo"
      : "https://login.salesforce.com/services/oauth2/userinfo";

  const defaultScopes = ["openid", "email", "profile"];

  return {
    id: "salesforce",
    name: "Salesforce",
    options,

    async createAuthorizationURL({ state, codeVerifier, scopes, redirectURI }) {
      if (!options.clientId || !options.clientSecret) {
        throw new Error(
          "Client Id and Client Secret are required for Salesforce. Make sure to provide them in the options.",
        );
      }
      if (!codeVerifier) {
        throw new Error("codeVerifier is required for Salesforce");
      }

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
      });
    },

    async validateAuthorizationCode({ code, redirectURI, codeVerifier }): Promise<OAuth2Tokens> {
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

    async refreshAccessToken(refreshToken): Promise<OAuth2Tokens> {
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
      if (!tokens.accessToken) return null;
      try {
        const response = await fetch(userInfoEndpoint, {
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
        });
        if (!response.ok) {
          console.error("Failed to fetch Salesforce user info:", await response.text());
          return null;
        }
        const profile = (await response.json()) as SalesforceProfile;

        const mapped = options.mapProfileToUser ? await options.mapProfileToUser(profile) : {};
        return {
          user: {
            id: profile.user_id,
            email: profile.email,
            emailVerified: profile.email_verified ?? false,
            name: profile.name,
            image: profile.photos?.picture || profile.photos?.thumbnail,
            firstName: (mapped as any).firstName || profile.given_name || profile.name,
            lastName: (mapped as any).lastName || profile.family_name,
            ...mapped,
          },
          data: profile,
        };
      } catch (error) {
        console.error("Failed to fetch Salesforce user info:", error);
        return null;
      }
    },
  };
}

export default salesforce;
