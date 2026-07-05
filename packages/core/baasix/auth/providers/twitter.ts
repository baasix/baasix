/**
 * Twitter (X) OAuth Provider
 * Ported from better-auth packages/core/src/social-providers/twitter.ts
 *
 * Twitter's token endpoint authenticates the client via HTTP Basic auth
 * (base64 clientId:clientSecret) rather than form body params, so token
 * exchange and refresh are inlined here instead of using the shared
 * validateAuthorizationCode/refreshAccessToken helpers (same pattern as
 * notion.ts / reddit.ts). PKCE is required by Twitter's OAuth2 (source
 * always forwards codeVerifier).
 */

import type { OAuthProvider, OAuth2Tokens, ProviderOptions } from "../types.js";
import { createAuthorizationURL, parseOAuth2Tokens } from "../oauth2/utils.js";

export interface TwitterProfile extends Record<string, any> {
  data: {
    id: string;
    name: string;
    email?: string;
    username: string;
    verified?: boolean;
    profile_image_url?: string;
  };
}

export interface TwitterOption extends ProviderOptions<TwitterProfile> {}

const TWITTER_AUTH_URL = "https://x.com/i/oauth2/authorize";
const TWITTER_TOKEN_URL = "https://api.x.com/2/oauth2/token";

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

export function twitter(options: TwitterOption): OAuthProvider<TwitterProfile, TwitterOption> {
  const defaultScopes = ["users.read", "tweet.read", "offline.access", "users.email"];

  return {
    id: "twitter",
    name: "Twitter",
    options,

    async createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }) {
      const allScopes = options.disableDefaultScope
        ? [...(options.scope || []), ...(scopes || [])]
        : [...defaultScopes, ...(options.scope || []), ...(scopes || [])];

      return createAuthorizationURL({
        authorizationEndpoint: TWITTER_AUTH_URL,
        clientId: options.clientId,
        redirectURI: options.redirectURI || redirectURI,
        state,
        scopes: [...new Set(allScopes)],
        codeVerifier,
      });
    },

    async validateAuthorizationCode({ code, codeVerifier, redirectURI }): Promise<OAuth2Tokens> {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: options.redirectURI || redirectURI,
      });
      if (codeVerifier) body.set("code_verifier", codeVerifier);

      const response = await fetch(TWITTER_TOKEN_URL, {
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
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });

      const response = await fetch(TWITTER_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
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
      const response = await fetch("https://api.x.com/2/users/me?user.fields=profile_image_url", {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (!response.ok) {
        console.error("Failed to fetch Twitter user info:", await response.text());
        return null;
      }
      const profile = (await response.json()) as TwitterProfile;

      // Email is not included on the standard /users/me profile; a second
      // call with the confirmed_email field is needed, and its presence is
      // treated as verification (matches source behavior).
      let emailVerified = false;
      const emailResponse = await fetch("https://api.x.com/2/users/me?user.fields=confirmed_email", {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (emailResponse.ok) {
        const emailData = (await emailResponse.json()) as { data?: { confirmed_email?: string } };
        if (emailData?.data?.confirmed_email) {
          profile.data.email = emailData.data.confirmed_email;
          emailVerified = true;
        }
      }

      const mapped = options.mapProfileToUser ? await options.mapProfileToUser(profile) : {};
      return {
        user: {
          id: profile.data.id,
          name: profile.data.name,
          email: profile.data.email || profile.data.username || null,
          image: profile.data.profile_image_url,
          emailVerified,
          firstName: (mapped as any).firstName || profile.data.name,
          lastName: (mapped as any).lastName,
          ...mapped,
        },
        data: profile,
      };
    },
  };
}

export default twitter;
