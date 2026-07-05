/**
 * GitLab OAuth Provider
 * Ported from better-auth packages/core/src/social-providers/gitlab.ts
 */

import type { OAuthProvider, ProviderOptions } from "../types.js";
import {
  createAuthorizationURL,
  validateAuthorizationCode,
  refreshAccessToken,
  parseOAuth2Tokens,
} from "../oauth2/utils.js";

export interface GitlabProfile extends Record<string, any> {
  id: number;
  username: string;
  email: string;
  name: string;
  state: string;
  avatar_url: string;
  web_url: string;
  locked?: boolean;
  email_verified?: boolean;
}

export interface GitlabOptions extends ProviderOptions<GitlabProfile> {
  /**
   * Self-hosted GitLab instance base URL, e.g. "https://gitlab.example.com".
   * Defaults to https://gitlab.com when not provided.
   */
  issuer?: string;
}

function cleanDoubleSlashes(input: string = ""): string {
  return input
    .split("://")
    .map((str) => str.replace(/\/{2,}/g, "/"))
    .join("://");
}

function issuerToEndpoints(issuer?: string) {
  const baseUrl = issuer || "https://gitlab.com";
  return {
    authorizationEndpoint: cleanDoubleSlashes(`${baseUrl}/oauth/authorize`),
    tokenEndpoint: cleanDoubleSlashes(`${baseUrl}/oauth/token`),
    userinfoEndpoint: cleanDoubleSlashes(`${baseUrl}/api/v4/user`),
  };
}

export function gitlab(options: GitlabOptions): OAuthProvider<GitlabProfile, GitlabOptions> {
  const defaultScopes = ["read_user"];
  const { authorizationEndpoint, tokenEndpoint, userinfoEndpoint } = issuerToEndpoints(options.issuer);

  return {
    id: "gitlab",
    name: "Gitlab",
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
      if (!tokens.accessToken) return null;
      const response = await fetch(userinfoEndpoint, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (!response.ok) {
        console.error("Failed to fetch GitLab user info:", await response.text());
        return null;
      }
      const profile = (await response.json()) as GitlabProfile;

      // Reject disabled/locked accounts, matching the source's active-state check.
      if (profile.state !== "active" || profile.locked) {
        return null;
      }

      const displayName = profile.name ?? profile.username ?? "";
      const mapped = options.mapProfileToUser ? await options.mapProfileToUser(profile) : {};
      return {
        user: {
          id: String(profile.id),
          email: profile.email,
          // GitLab may provide email_verified, but it's not guaranteed; default to false.
          emailVerified: profile.email_verified ?? false,
          name: displayName,
          image: profile.avatar_url,
          firstName: (mapped as any).firstName || displayName,
          lastName: (mapped as any).lastName,
          ...mapped,
        },
        data: profile,
      };
    },
  };
}

export default gitlab;
