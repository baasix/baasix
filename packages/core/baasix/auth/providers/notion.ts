/**
 * Notion OAuth Provider
 * Ported from better-auth packages/core/src/social-providers/notion.ts
 *
 * Notion's token endpoint authenticates the client via HTTP Basic auth
 * (base64 clientId:clientSecret) rather than form body params, so token
 * exchange is inlined here instead of using the shared
 * validateAuthorizationCode helper (same pattern as figma.ts).
 */

import type { OAuthProvider, OAuth2Tokens, ProviderOptions } from "../types.js";
import { createAuthorizationURL, refreshAccessToken, parseOAuth2Tokens } from "../oauth2/utils.js";

export interface NotionProfile extends Record<string, any> {
  object: "user";
  id: string;
  type: "person" | "bot";
  name?: string;
  avatar_url?: string;
  person?: {
    email?: string;
  };
}

export interface NotionOptions extends ProviderOptions<NotionProfile> {}

const NOTION_AUTH_URL = "https://api.notion.com/v1/oauth/authorize";
const NOTION_TOKEN_URL = "https://api.notion.com/v1/oauth/token";
const NOTION_USER_URL = "https://api.notion.com/v1/users/me";

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

export function notion(options: NotionOptions): OAuthProvider<NotionProfile, NotionOptions> {
  return {
    id: "notion",
    name: "Notion",
    options,

    async createAuthorizationURL({ state, scopes, redirectURI, loginHint }) {
      // Notion does not use traditional OAuth2 scopes — access is granted
      // per-integration in the Notion UI during the consent step.
      const allScopes = options.disableDefaultScope ? [] : [];
      if (options.scope) allScopes.push(...options.scope);
      if (scopes) allScopes.push(...scopes);

      return createAuthorizationURL({
        authorizationEndpoint: NOTION_AUTH_URL,
        clientId: options.clientId,
        redirectURI: options.redirectURI || redirectURI,
        state,
        scopes: [...new Set(allScopes)],
        loginHint,
        additionalParams: {
          owner: "user",
        },
      });
    },

    async validateAuthorizationCode({ code, redirectURI }): Promise<OAuth2Tokens> {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: options.redirectURI || redirectURI,
      });

      const response = await fetch(NOTION_TOKEN_URL, {
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
      const result = await refreshAccessToken({
        tokenEndpoint: NOTION_TOKEN_URL,
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
      const response = await fetch(NOTION_USER_URL, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          "Notion-Version": "2022-06-28",
        },
      });
      if (!response.ok) {
        console.error("Failed to fetch Notion user info:", await response.text());
        return null;
      }
      const body = (await response.json()) as { bot?: { owner?: { user?: NotionProfile } } };
      // The bot integration's owning user lives under bot.owner.user.
      const profile = body.bot?.owner?.user;
      if (!profile) return null;

      const mapped = options.mapProfileToUser ? await options.mapProfileToUser(profile) : {};
      return {
        user: {
          id: profile.id,
          email: profile.person?.email || null,
          emailVerified: false,
          name: profile.name || "",
          image: profile.avatar_url,
          firstName: (mapped as any).firstName || profile.name || "",
          lastName: (mapped as any).lastName,
          ...mapped,
        },
        data: profile,
      };
    },
  };
}

export default notion;
