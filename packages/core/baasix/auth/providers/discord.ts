/**
 * Discord OAuth Provider
 * Ported from better-auth packages/core/src/social-providers/discord.ts
 */

import type { OAuthProvider, ProviderOptions } from "../types.js";
import { validateAuthorizationCode, refreshAccessToken, parseOAuth2Tokens } from "../oauth2/utils.js";

export interface DiscordProfile extends Record<string, any> {
  id: string;
  username: string;
  discriminator: string;
  global_name: string | null;
  avatar: string | null;
  mfa_enabled: boolean;
  locale: string;
  verified: boolean;
  email?: string | null;
  image_url: string;
}

export interface DiscordOptions extends ProviderOptions<DiscordProfile> {
  prompt?: "none" | "consent";
  permissions?: number;
}

const DISCORD_AUTH_URL = "https://discord.com/api/oauth2/authorize";
const DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token";
const DISCORD_USER_URL = "https://discord.com/api/users/@me";

export function discord(options: DiscordOptions): OAuthProvider<DiscordProfile, DiscordOptions> {
  const defaultScopes = ["identify", "email"];

  return {
    id: "discord",
    name: "Discord",
    options,

    async createAuthorizationURL({ state, scopes, redirectURI }) {
      const allScopes = options.disableDefaultScope
        ? [...(options.scope || []), ...(scopes || [])]
        : [...defaultScopes, ...(options.scope || []), ...(scopes || [])];

      const url = new URL(DISCORD_AUTH_URL);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", options.clientId);
      url.searchParams.set("redirect_uri", options.redirectURI || redirectURI);
      url.searchParams.set("state", state);
      url.searchParams.set("scope", [...new Set(allScopes)].join(" "));
      url.searchParams.set("prompt", options.prompt || "none");
      if (allScopes.includes("bot") && options.permissions !== undefined) {
        url.searchParams.set("permissions", String(options.permissions));
      }
      return url;
    },

    async validateAuthorizationCode({ code, redirectURI }) {
      const result = await validateAuthorizationCode({
        tokenEndpoint: DISCORD_TOKEN_URL,
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
        tokenEndpoint: DISCORD_TOKEN_URL,
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
      const response = await fetch(DISCORD_USER_URL, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (!response.ok) {
        console.error("Failed to fetch Discord user info:", await response.text());
        return null;
      }
      const profile = (await response.json()) as DiscordProfile;

      if (profile.avatar === null) {
        const defaultAvatarNumber =
          profile.discriminator === "0"
            ? Number(BigInt(profile.id) >> BigInt(22)) % 6
            : parseInt(profile.discriminator) % 5;
        profile.image_url = `https://cdn.discordapp.com/embed/avatars/${defaultAvatarNumber}.png`;
      } else {
        const format = profile.avatar.startsWith("a_") ? "gif" : "png";
        profile.image_url = `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.${format}`;
      }

      const displayName = profile.global_name || profile.username || "";
      const mapped = options.mapProfileToUser ? await options.mapProfileToUser(profile) : {};
      return {
        user: {
          id: profile.id,
          email: profile.email,
          emailVerified: profile.verified,
          name: displayName,
          image: profile.image_url,
          firstName: (mapped as any).firstName || displayName,
          lastName: (mapped as any).lastName,
          ...mapped,
        },
        data: profile,
      };
    },
  };
}

export default discord;
