/**
 * Linear OAuth Provider
 * Ported from better-auth packages/core/src/social-providers/linear.ts
 */

import type { OAuthProvider, ProviderOptions } from "../types.js";
import {
  createAuthorizationURL,
  validateAuthorizationCode,
  refreshAccessToken,
  parseOAuth2Tokens,
} from "../oauth2/utils.js";

export interface LinearUser extends Record<string, any> {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LinearOptions extends ProviderOptions<LinearUser> {}

const LINEAR_AUTH_URL = "https://linear.app/oauth/authorize";
const LINEAR_TOKEN_URL = "https://api.linear.app/oauth/token";
const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";

const LINEAR_VIEWER_QUERY = `
  query {
    viewer {
      id
      name
      email
      avatarUrl
      active
      createdAt
      updatedAt
    }
  }
`;

export function linear(options: LinearOptions): OAuthProvider<LinearUser, LinearOptions> {
  const defaultScopes = ["read"];

  return {
    id: "linear",
    name: "Linear",

    async createAuthorizationURL({ state, scopes, redirectURI, loginHint }) {
      const allScopes = options.disableDefaultScope
        ? [...(options.scope || []), ...(scopes || [])]
        : [...defaultScopes, ...(options.scope || []), ...(scopes || [])];

      return createAuthorizationURL({
        authorizationEndpoint: LINEAR_AUTH_URL,
        clientId: options.clientId,
        redirectURI: options.redirectURI || redirectURI,
        state,
        scopes: [...new Set(allScopes)],
        loginHint,
      });
    },

    async validateAuthorizationCode({ code, redirectURI }) {
      const result = await validateAuthorizationCode({
        tokenEndpoint: LINEAR_TOKEN_URL,
        code,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        redirectURI: options.redirectURI || redirectURI,
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
        tokenEndpoint: LINEAR_TOKEN_URL,
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
      // Linear's userinfo is a GraphQL query rather than a REST endpoint.
      const response = await fetch(LINEAR_GRAPHQL_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        body: JSON.stringify({ query: LINEAR_VIEWER_QUERY }),
      });
      if (!response.ok) {
        console.error("Failed to fetch Linear user info:", await response.text());
        return null;
      }
      const body = (await response.json()) as { data?: { viewer: LinearUser } };
      const profile = body.data?.viewer;
      if (!profile) return null;

      const mapped = options.mapProfileToUser ? await options.mapProfileToUser(profile) : {};
      return {
        user: {
          id: profile.id,
          email: profile.email,
          // Linear does not provide an email_verified claim; default to false.
          emailVerified: false,
          name: profile.name,
          image: profile.avatarUrl,
          firstName: (mapped as any).firstName || profile.name,
          lastName: (mapped as any).lastName,
          ...mapped,
        },
        data: profile,
      };
    },
  };
}

export default linear;
