/**
 * WeChat OAuth Provider
 * Ported from better-auth packages/core/src/social-providers/wechat.ts
 *
 * WeChat uses non-standard OAuth2 parameters throughout: the authorization
 * URL uses `appid` instead of `client_id` and requires a `#wechat_redirect`
 * URL fragment; the token exchange and refresh endpoints are GET requests
 * that take `appid`/`secret` (not `client_id`/`client_secret`) as query
 * params; and the userinfo endpoint needs the `openid` returned alongside
 * the access token. None of the shared oauth2/utils helpers apply, so
 * every step is inlined, matching the source's approach.
 *
 * `.env.sample` documents WECHAT_CLIENT_ID = WeChat's appid and
 * WECHAT_CLIENT_SECRET = WeChat's secret (Baasix's ProviderOptions field
 * names are reused verbatim; no separate appid/secret fields are added).
 */

import type { OAuthProvider, OAuth2Tokens, ProviderOptions } from "../types.js";

export interface WeChatProfile extends Record<string, any> {
  openid: string;
  nickname: string;
  headimgurl: string;
  privilege: string[];
  unionid?: string;
  /** @note Email is currently unsupported by WeChat */
  email?: string;
}

export interface WeChatOptions extends ProviderOptions<WeChatProfile> {
  /**
   * UI language for the WeChat login page: "cn" for Simplified Chinese,
   * "en" for English. Defaults to "cn" when left undefined.
   */
  lang?: "cn" | "en";
}

const WECHAT_AUTH_URL = "https://open.weixin.qq.com/connect/qrconnect";
const WECHAT_TOKEN_URL = "https://api.weixin.qq.com/sns/oauth2/access_token";
const WECHAT_REFRESH_URL = "https://api.weixin.qq.com/sns/oauth2/refresh_token";
const WECHAT_USERINFO_URL = "https://api.weixin.qq.com/sns/userinfo";

export function wechat(options: WeChatOptions): OAuthProvider<WeChatProfile, WeChatOptions> {
  const defaultScopes = ["snsapi_login"];

  return {
    id: "wechat",
    name: "WeChat",
    options,

    async createAuthorizationURL({ state, scopes, redirectURI }) {
      const allScopes = options.disableDefaultScope
        ? [...(options.scope || []), ...(scopes || [])]
        : [...defaultScopes, ...(options.scope || []), ...(scopes || [])];

      const url = new URL(WECHAT_AUTH_URL);
      url.searchParams.set("scope", [...new Set(allScopes)].join(","));
      url.searchParams.set("response_type", "code");
      url.searchParams.set("appid", options.clientId);
      url.searchParams.set("redirect_uri", options.redirectURI || redirectURI);
      url.searchParams.set("state", state);
      url.searchParams.set("lang", options.lang || "cn");
      url.hash = "wechat_redirect";

      return url;
    },

    async validateAuthorizationCode({ code }): Promise<OAuth2Tokens & { openid?: string; unionid?: string }> {
      const params = new URLSearchParams({
        appid: options.clientId,
        secret: options.clientSecret,
        code,
        grant_type: "authorization_code",
      });

      const response = await fetch(`${WECHAT_TOKEN_URL}?${params.toString()}`, { method: "GET" });
      const tokenData = (await response.json()) as {
        access_token: string;
        expires_in: number;
        refresh_token: string;
        openid: string;
        scope: string;
        unionid?: string;
        errcode?: number;
        errmsg?: string;
      };

      if (!response.ok || tokenData.errcode) {
        throw new Error(`Failed to validate authorization code: ${tokenData?.errmsg || "Unknown error"}`);
      }

      return {
        tokenType: "Bearer",
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        accessTokenExpiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
        scopes: tokenData.scope.split(","),
        // WeChat requires openid for the userinfo endpoint, returned
        // alongside the access token.
        openid: tokenData.openid,
        unionid: tokenData.unionid,
      };
    },

    async refreshAccessToken(refreshToken): Promise<OAuth2Tokens> {
      const params = new URLSearchParams({
        appid: options.clientId,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });

      const response = await fetch(`${WECHAT_REFRESH_URL}?${params.toString()}`, { method: "GET" });
      const tokenData = (await response.json()) as {
        access_token: string;
        expires_in: number;
        refresh_token: string;
        openid: string;
        scope: string;
        errcode?: number;
        errmsg?: string;
      };

      if (!response.ok || tokenData.errcode) {
        throw new Error(`Failed to refresh access token: ${tokenData?.errmsg || "Unknown error"}`);
      }

      return {
        tokenType: "Bearer",
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        accessTokenExpiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
        scopes: tokenData.scope.split(","),
      };
    },

    async getUserInfo(tokens) {
      const openid = (tokens as OAuth2Tokens & { openid?: string }).openid;
      if (!openid) return null;

      const params = new URLSearchParams({
        access_token: tokens.accessToken || "",
        openid,
        lang: "zh_CN",
      });

      const response = await fetch(`${WECHAT_USERINFO_URL}?${params.toString()}`, { method: "GET" });
      const profile = (await response.json()) as WeChatProfile & { errcode?: number; errmsg?: string };
      if (!response.ok || profile.errcode) {
        console.error("Failed to fetch WeChat user info:", profile?.errmsg || "Unknown error");
        return null;
      }

      const mapped = options.mapProfileToUser ? await options.mapProfileToUser(profile) : {};
      const id = profile.unionid || profile.openid || openid;
      return {
        user: {
          id,
          name: profile.nickname,
          // WeChat does not return an email, and the OAuth callback rejects a
          // missing one, so the default sign-in would always fail. Synthesize a
          // stable, non-routable placeholder (RFC 2606 `.invalid`) keyed to the
          // user's WeChat id, left unverified. Applications that collect a real
          // email override it via `mapProfileToUser`.
          email: profile.email || `${id}@wechat.invalid`,
          image: profile.headimgurl,
          emailVerified: false,
          firstName: (mapped as any).firstName || profile.nickname,
          lastName: (mapped as any).lastName,
          ...mapped,
        },
        data: profile,
      };
    },
  };
}

export default wechat;
