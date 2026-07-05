/**
 * Reddit OAuth Provider
 * Ported from better-auth packages/core/src/social-providers/reddit.ts
 *
 * Reddit's token endpoint authenticates the client via HTTP Basic auth
 * (base64 clientId:clientSecret) and requires a `User-Agent` header on
 * every request (Reddit API policy) — both token exchange/refresh and the
 * userinfo call are inlined here instead of using the shared oauth2/utils
 * helpers (same Basic-auth pattern as figma.ts / notion.ts).
 */

import type { OAuthProvider, OAuth2Tokens, ProviderOptions } from "../types.js";
import { createAuthorizationURL, parseOAuth2Tokens } from "../oauth2/utils.js";

export interface RedditProfile extends Record<string, any> {
  id: string;
  name: string;
  icon_img: string | null;
  has_verified_email: boolean;
  oauth_client_id: string;
  verified: boolean;
}

export interface RedditOptions extends ProviderOptions<RedditProfile> {
  /**
   * Whether the returned access token grant is "temporary" (1 hour, no
   * refresh token) or "permanent" (includes a refresh token). Passed
   * through verbatim to Reddit's authorization URL as `duration`; Reddit
   * itself defaults to "temporary" when omitted.
   */
  duration?: string;
}

const REDDIT_AUTH_URL = "https://www.reddit.com/api/v1/authorize";
const REDDIT_TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const REDDIT_USERINFO_URL = "https://oauth.reddit.com/api/v1/me";
const REDDIT_USER_AGENT = "better-auth";

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

export function reddit(options: RedditOptions): OAuthProvider<RedditProfile, RedditOptions> {
  const defaultScopes = ["identity"];

  return {
    id: "reddit",
    name: "Reddit",
    options,

    async createAuthorizationURL({ state, scopes, redirectURI }) {
      const allScopes = options.disableDefaultScope
        ? [...(options.scope || []), ...(scopes || [])]
        : [...defaultScopes, ...(options.scope || []), ...(scopes || [])];

      return createAuthorizationURL({
        authorizationEndpoint: REDDIT_AUTH_URL,
        clientId: options.clientId,
        redirectURI: options.redirectURI || redirectURI,
        state,
        scopes: [...new Set(allScopes)],
        additionalParams: options.duration ? { duration: options.duration } : undefined,
      });
    },

    async validateAuthorizationCode({ code, redirectURI }): Promise<OAuth2Tokens> {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: options.redirectURI || redirectURI,
      });

      const response = await fetch(REDDIT_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "text/plain",
          "User-Agent": REDDIT_USER_AGENT,
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

      const response = await fetch(REDDIT_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "text/plain",
          "User-Agent": REDDIT_USER_AGENT,
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
      const response = await fetch(REDDIT_USERINFO_URL, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          "User-Agent": REDDIT_USER_AGENT,
        },
      });
      if (!response.ok) {
        console.error("Failed to fetch Reddit user info:", await response.text());
        return null;
      }
      const profile = (await response.json()) as RedditProfile;

      const mapped = options.mapProfileToUser ? await options.mapProfileToUser(profile) : {};
      // Reddit's identity scope does not return an email. Synthesize a stable,
      // non-routable placeholder (RFC 2606 `.invalid`) keyed to the user's
      // Reddit id rather than the routable `reddit.com`, which could collide
      // with a real address. Left unverified; mapProfileToUser can override.
      const email = (mapped as any).email || `${profile.id}@reddit.invalid`;
      const image = profile.icon_img ? profile.icon_img.split("?")[0] : undefined;
      return {
        user: {
          id: profile.id,
          name: profile.name,
          image,
          firstName: (mapped as any).firstName || profile.name,
          lastName: (mapped as any).lastName,
          ...mapped,
          email,
          emailVerified: (mapped as any).emailVerified ?? false,
        },
        data: profile,
      };
    },
  };
}

export default reddit;
