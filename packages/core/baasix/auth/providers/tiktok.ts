/**
 * TikTok OAuth Provider
 * Ported from better-auth packages/core/src/social-providers/tiktok.ts
 *
 * TikTok authenticates using `client_key` (not `client_id`) in both the
 * authorization URL and the token exchange body. Baasix's ProviderOptions
 * base interface requires `clientId: string`, so it is kept on the options
 * type for interface compatibility but is not used in any request — only
 * `clientKey` is sent to TikTok, matching the source's behavior where
 * `clientId` is typed as `never`.
 */

import type { OAuthProvider, OAuth2Tokens, ProviderOptions } from "../types.js";
import { parseOAuth2Tokens } from "../oauth2/utils.js";

export interface TikTokProfile extends Record<string, any> {
  data: {
    user: {
      open_id: string;
      union_id?: string;
      avatar_url?: string;
      avatar_url_100?: string;
      avatar_large_url: string;
      display_name: string;
      username: string;
      /** @note Email is currently unsupported by TikTok */
      email?: string;
      bio_description?: string;
      profile_deep_link?: string;
      is_verified?: boolean;
      follower_count?: number;
      following_count?: number;
      likes_count?: number;
      video_count?: number;
    };
  };
  error?: {
    code?: string;
    message?: string;
    log_id?: string;
  };
}

export interface TikTokOptions extends ProviderOptions<TikTokProfile> {
  /** TikTok's client key. Sent as `client_key` instead of `client_id`. */
  clientKey: string;
}

const TIKTOK_AUTH_URL = "https://www.tiktok.com/v2/auth/authorize";
const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const TIKTOK_USERINFO_URL = "https://open.tiktokapis.com/v2/user/info/";

export function tiktok(options: TikTokOptions): OAuthProvider<TikTokProfile, TikTokOptions> {
  const defaultScopes = ["user.info.profile"];

  return {
    id: "tiktok",
    name: "TikTok",
    options,

    async createAuthorizationURL({ state, scopes, redirectURI }) {
      const allScopes = options.disableDefaultScope
        ? [...(options.scope || []), ...(scopes || [])]
        : [...defaultScopes, ...(options.scope || []), ...(scopes || [])];

      // TikTok's authorize endpoint is built manually (source does the same):
      // scopes are comma-joined and the client is identified via `client_key`.
      return new URL(
        `${TIKTOK_AUTH_URL}?scope=${[...new Set(allScopes)].join(
          ",",
        )}&response_type=code&client_key=${options.clientKey}&redirect_uri=${encodeURIComponent(
          options.redirectURI || redirectURI,
        )}&state=${state}`,
      );
    },

    async validateAuthorizationCode({ code, redirectURI }): Promise<OAuth2Tokens> {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_key: options.clientKey,
        client_secret: options.clientSecret,
        redirect_uri: options.redirectURI || redirectURI,
      });

      const response = await fetch(TIKTOK_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
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
      // TikTok's refresh identifies the client via `client_key` in the body
      // (not `client_id`), so this is inlined rather than using the shared
      // refreshAccessToken helper, which hardcodes the `client_id` field name.
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        client_key: options.clientKey,
        client_secret: options.clientSecret,
        refresh_token: refreshToken,
      });

      const response = await fetch(TIKTOK_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
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
      const fields = ["open_id", "avatar_large_url", "display_name", "username"];
      const response = await fetch(`${TIKTOK_USERINFO_URL}?fields=${fields.join(",")}`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (!response.ok) {
        console.error("Failed to fetch TikTok user info:", await response.text());
        return null;
      }
      const profile = (await response.json()) as TikTokProfile;
      const user = profile.data?.user;
      if (!user) return null;

      const displayName = user.display_name || user.username || "";
      const mapped = options.mapProfileToUser ? await options.mapProfileToUser(profile) : {};
      return {
        user: {
          id: user.open_id,
          // TikTok does not provide email; fall back to username like source does.
          email: user.email || user.username,
          emailVerified: false,
          name: displayName,
          image: user.avatar_large_url,
          firstName: (mapped as any).firstName || displayName,
          lastName: (mapped as any).lastName,
          ...mapped,
        },
        data: profile,
      };
    },
  };
}

export default tiktok;
