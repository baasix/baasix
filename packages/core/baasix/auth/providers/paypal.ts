/**
 * PayPal OAuth Provider
 * Ported from better-auth packages/core/src/social-providers/paypal.ts
 *
 * PayPal's token endpoint authenticates the client via HTTP Basic auth
 * (base64 clientId:clientSecret) rather than form body params, so token
 * exchange and refresh are inlined here instead of using the shared
 * validateAuthorizationCode/refreshAccessToken helpers (same pattern as
 * figma.ts / notion.ts).
 */

import type { OAuthProvider, OAuth2Tokens, ProviderOptions } from "../types.js";
import { createAuthorizationURL } from "../oauth2/utils.js";
import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify } from "jose";

/**
 * ID token signing algorithms advertised by PayPal's OpenID configuration.
 * Anything outside this allowlist is rejected so each token is only ever
 * verified with the algorithm it was issued for.
 * @see https://www.paypal.com/.well-known/openid-configuration
 */
const PAYPAL_ID_TOKEN_ALGORITHMS = ["RS256", "HS256"] as const;

export interface PayPalProfile extends Record<string, any> {
  sub?: string;
  user_id: string;
  name: string;
  given_name: string;
  family_name: string;
  middle_name?: string;
  picture?: string;
  email: string;
  email_verified: boolean;
  gender?: string;
  birthdate?: string;
  zoneinfo?: string;
  locale?: string;
  phone_number?: string;
  address?: {
    street_address?: string;
    locality?: string;
    region?: string;
    postal_code?: string;
    country?: string;
  };
  verified_account?: boolean;
  account_type?: string;
  age_range?: string;
  payer_id?: string;
}

export interface PayPalOptions extends ProviderOptions<PayPalProfile> {
  /**
   * PayPal environment - 'sandbox' for testing, 'live' for production
   * @default 'sandbox'
   */
  environment?: "sandbox" | "live";
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

async function getPayPalPublicKey(kid: string, jwksUri: string) {
  const response = await fetch(jwksUri);
  if (!response.ok) {
    throw new Error(`Failed to fetch PayPal JWKS: ${response.status} ${await response.text()}`);
  }
  const data = (await response.json()) as {
    keys: Array<{ kid: string; alg: string; kty: string; use: string; n: string; e: string }>;
  };
  const jwk = data.keys?.find((key) => key.kid === kid);
  if (!jwk) {
    throw new Error(`JWK with kid ${kid} not found`);
  }
  return importJWK(jwk, jwk.alg);
}

export function paypal(options: PayPalOptions): OAuthProvider<PayPalProfile, PayPalOptions> {
  const environment = options.environment || "sandbox";
  const isSandbox = environment === "sandbox";

  const authorizationEndpoint = isSandbox
    ? "https://www.sandbox.paypal.com/signin/authorize"
    : "https://www.paypal.com/signin/authorize";
  const tokenEndpoint = isSandbox
    ? "https://api-m.sandbox.paypal.com/v1/oauth2/token"
    : "https://api-m.paypal.com/v1/oauth2/token";
  const userInfoEndpoint = isSandbox
    ? "https://api-m.sandbox.paypal.com/v1/identity/oauth2/userinfo"
    : "https://api-m.paypal.com/v1/identity/oauth2/userinfo";
  // Issuer and JWKS endpoints used to cryptographically verify ID tokens.
  // @see https://www.paypal.com/.well-known/openid-configuration
  const issuer = isSandbox ? "https://www.sandbox.paypal.com" : "https://www.paypal.com";
  const jwksEndpoint = isSandbox
    ? "https://api.sandbox.paypal.com/v1/oauth2/certs"
    : "https://api.paypal.com/v1/oauth2/certs";

  return {
    id: "paypal",
    name: "PayPal",
    options,

    async createAuthorizationURL({ state, codeVerifier, redirectURI }) {
      // Log in with PayPal doesn't use traditional OAuth2 scopes — permissions
      // are configured in the PayPal Developer Dashboard. We don't pass any
      // scopes to avoid "invalid scope" errors.
      return createAuthorizationURL({
        authorizationEndpoint,
        clientId: options.clientId,
        redirectURI: options.redirectURI || redirectURI,
        state,
        scopes: [],
        codeVerifier,
        prompt: options.prompt,
      });
    },

    async validateAuthorizationCode({ code, redirectURI }): Promise<OAuth2Tokens> {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: options.redirectURI || redirectURI,
      });

      const response = await fetch(tokenEndpoint, {
        method: "POST",
        headers: {
          Authorization: basicAuthHeader(options.clientId, options.clientSecret),
          Accept: "application/json",
          "Accept-Language": "en_US",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      if (!response.ok) {
        throw new Error(`Token exchange failed: ${response.status} ${await response.text()}`);
      }

      const raw = (await response.json()) as Record<string, any>;
      return {
        accessToken: raw.access_token,
        refreshToken: raw.refresh_token,
        idToken: raw.id_token,
        tokenType: raw.token_type || "Bearer",
        accessTokenExpiresAt: raw.expires_in ? new Date(Date.now() + raw.expires_in * 1000) : undefined,
        scopes: raw.scope ? raw.scope.split(" ") : undefined,
        raw,
      };
    },

    async refreshAccessToken(refreshToken): Promise<OAuth2Tokens> {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });

      const response = await fetch(tokenEndpoint, {
        method: "POST",
        headers: {
          Authorization: basicAuthHeader(options.clientId, options.clientSecret),
          Accept: "application/json",
          "Accept-Language": "en_US",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      if (!response.ok) {
        throw new Error(`Token refresh failed: ${response.status} ${await response.text()}`);
      }

      const raw = (await response.json()) as Record<string, any>;
      return {
        accessToken: raw.access_token,
        refreshToken: raw.refresh_token,
        tokenType: raw.token_type || "Bearer",
        accessTokenExpiresAt: raw.expires_in ? new Date(Date.now() + raw.expires_in * 1000) : undefined,
        raw,
      };
    },

    async verifyIdToken(token, nonce) {
      // Cryptographically verify the ID token. Decoding alone is not enough:
      // the signature, issuer, audience and expiration must all be checked
      // before the token's claims can be relied on as proof of identity.
      // See https://www.paypal.com/.well-known/openid-configuration
      try {
        const { kid, alg } = decodeProtectedHeader(token);
        if (!alg) return false;
        if (!PAYPAL_ID_TOKEN_ALGORITHMS.includes(alg as (typeof PAYPAL_ID_TOKEN_ALGORITHMS)[number])) {
          return false;
        }

        // PayPal can sign ID tokens either asymmetrically (RS256, verified
        // against the published JWKS) or symmetrically (HS256, verified with
        // the client secret). Selecting the key by algorithm keeps the two
        // paths separate so each algorithm is only verified with its
        // corresponding key type.
        const key = alg === "HS256" ? new TextEncoder().encode(options.clientSecret) : kid ? await getPayPalPublicKey(kid, jwksEndpoint) : undefined;
        if (!key) return false;

        const { payload } = await jwtVerify(token, key, {
          algorithms: [alg],
          issuer,
          audience: options.clientId,
          maxTokenAge: "1h",
        });

        if (nonce && payload.nonce !== nonce) {
          return false;
        }

        return true;
      } catch (error) {
        console.error("Failed to verify PayPal ID token:", error);
        return false;
      }
    },

    async getUserInfo(tokens) {
      if (!tokens.accessToken) return null;
      const response = await fetch(`${userInfoEndpoint}?schema=paypalv1.1`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          Accept: "application/json",
        },
      });
      if (!response.ok) {
        console.error("Failed to fetch PayPal user info:", await response.text());
        return null;
      }
      const profile = (await response.json()) as PayPalProfile;

      if (tokens.idToken) {
        // OIDC binds UserInfo to the ID Token via `sub`. Keep `user_id` as the
        // account id below for existing PayPal account mappings.
        let idTokenSubject: string | undefined;
        try {
          idTokenSubject = decodeJwt(tokens.idToken).sub;
        } catch (error) {
          console.error("Failed to decode PayPal ID token:", error);
          return null;
        }
        const userInfoSubject = profile.sub ?? profile.user_id;
        if (!idTokenSubject || userInfoSubject !== idTokenSubject) {
          console.error("PayPal user info subject does not match ID token subject");
          return null;
        }
      }

      const mapped = options.mapProfileToUser ? await options.mapProfileToUser(profile) : {};
      return {
        user: {
          id: profile.user_id,
          email: profile.email,
          emailVerified: profile.email_verified,
          name: profile.name,
          image: profile.picture,
          firstName: (mapped as any).firstName || profile.given_name || profile.name,
          lastName: (mapped as any).lastName || profile.family_name,
          ...mapped,
        },
        data: profile,
      };
    },
  };
}

export default paypal;
