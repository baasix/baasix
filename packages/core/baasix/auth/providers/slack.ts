/**
 * Slack OAuth Provider
 * Ported from better-auth packages/core/src/social-providers/slack.ts
 */

import type { OAuthProvider, OAuth2Tokens, ProviderOptions } from "../types.js";
import { validateAuthorizationCode, refreshAccessToken, parseOAuth2Tokens } from "../oauth2/utils.js";

export interface SlackProfile extends Record<string, any> {
  ok: boolean;
  sub: string;
  "https://slack.com/user_id": string;
  "https://slack.com/team_id": string;
  email: string;
  email_verified: boolean;
  date_email_verified: number;
  name: string;
  picture: string;
  given_name: string;
  family_name: string;
  locale: string;
  "https://slack.com/team_name": string;
  "https://slack.com/team_domain": string;
  "https://slack.com/user_image_24": string;
  "https://slack.com/user_image_32": string;
  "https://slack.com/user_image_48": string;
  "https://slack.com/user_image_72": string;
  "https://slack.com/user_image_192": string;
  "https://slack.com/user_image_512": string;
  "https://slack.com/team_image_34": string;
  "https://slack.com/team_image_44": string;
  "https://slack.com/team_image_68": string;
  "https://slack.com/team_image_88": string;
  "https://slack.com/team_image_102": string;
  "https://slack.com/team_image_132": string;
  "https://slack.com/team_image_230": string;
  "https://slack.com/team_image_default": boolean;
}

export interface SlackOptions extends ProviderOptions<SlackProfile> {}

const SLACK_AUTH_URL = "https://slack.com/openid/connect/authorize";
const SLACK_TOKEN_URL = "https://slack.com/api/openid.connect.token";
const SLACK_USERINFO_URL = "https://slack.com/api/openid.connect.userInfo";

export function slack(options: SlackOptions): OAuthProvider<SlackProfile, SlackOptions> {
  const defaultScopes = ["openid", "profile", "email"];

  return {
    id: "slack",
    name: "Slack",
    options,

    async createAuthorizationURL({ state, scopes, redirectURI }) {
      const allScopes = options.disableDefaultScope
        ? [...(options.scope || []), ...(scopes || [])]
        : [...defaultScopes, ...(options.scope || []), ...(scopes || [])];

      // Slack's authorize URL is built manually (source does the same) —
      // it does not support PKCE.
      const url = new URL(SLACK_AUTH_URL);
      url.searchParams.set("scope", [...new Set(allScopes)].join(" "));
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", options.clientId);
      url.searchParams.set("redirect_uri", options.redirectURI || redirectURI);
      url.searchParams.set("state", state);
      return url;
    },

    async validateAuthorizationCode({ code, redirectURI }): Promise<OAuth2Tokens> {
      const result = await validateAuthorizationCode({
        tokenEndpoint: SLACK_TOKEN_URL,
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

    async refreshAccessToken(refreshToken): Promise<OAuth2Tokens> {
      const result = await refreshAccessToken({
        tokenEndpoint: SLACK_TOKEN_URL,
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
      const response = await fetch(SLACK_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (!response.ok) {
        console.error("Failed to fetch Slack user info:", await response.text());
        return null;
      }
      const profile = (await response.json()) as SlackProfile;

      const mapped = options.mapProfileToUser ? await options.mapProfileToUser(profile) : {};
      return {
        user: {
          id: profile["https://slack.com/user_id"],
          email: profile.email,
          emailVerified: profile.email_verified,
          name: profile.name || "",
          image: profile.picture || profile["https://slack.com/user_image_512"],
          firstName: (mapped as any).firstName || profile.given_name || profile.name || "",
          lastName: (mapped as any).lastName || profile.family_name,
          ...mapped,
        },
        data: profile,
      };
    },
  };
}

export default slack;
