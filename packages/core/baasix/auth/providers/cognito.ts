/**
 * Amazon Cognito OAuth Provider
 * Ported from better-auth packages/core/src/social-providers/cognito.ts
 */

import type { OAuthProvider, ProviderOptions } from "../types.js";
import {
  createAuthorizationURL,
  validateAuthorizationCode,
  refreshAccessToken,
  parseOAuth2Tokens,
} from "../oauth2/utils.js";
import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify } from "jose";

export interface CognitoProfile extends Record<string, any> {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  username?: string;
}

export interface CognitoOptions extends ProviderOptions<CognitoProfile> {
  /**
   * The Cognito domain (e.g. "your-app.auth.us-east-1.amazoncognito.com").
   */
  domain: string;
  /**
   * AWS region where the User Pool is hosted (e.g. "us-east-1").
   */
  region: string;
  /**
   * Required for verifyIdToken's JWKS lookup (Cognito's JWKS is scoped per user pool).
   */
  userPoolId?: string;
  requireClientSecret?: boolean;
}

async function getCognitoPublicKey(kid: string, region: string, userPoolId: string) {
  const jwksUri = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`;
  const response = await fetch(jwksUri);
  if (!response.ok) {
    throw new Error(`Failed to fetch Cognito JWKS: ${response.status} ${await response.text()}`);
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

export function cognito(options: CognitoOptions): OAuthProvider<CognitoProfile, CognitoOptions> {
  if (!options.domain || !options.region) {
    throw new Error("domain and region are required for Cognito. Provide them in the provider options.");
  }

  const defaultScopes = ["openid", "profile", "email"];
  const cleanDomain = options.domain.replace(/^https?:\/\//, "");
  const authorizationEndpoint = `https://${cleanDomain}/oauth2/authorize`;
  const tokenEndpoint = `https://${cleanDomain}/oauth2/token`;
  const userInfoEndpoint = `https://${cleanDomain}/oauth2/userinfo`;

  return {
    id: "cognito",
    name: "Cognito",
    options,

    async createAuthorizationURL({ state, codeVerifier, scopes, redirectURI }) {
      if (options.requireClientSecret && !options.clientSecret) {
        throw new Error("clientSecret is required when requireClientSecret is true.");
      }

      const allScopes = options.disableDefaultScope
        ? [...(options.scope || []), ...(scopes || [])]
        : [...defaultScopes, ...(options.scope || []), ...(scopes || [])];

      const url = await createAuthorizationURL({
        authorizationEndpoint,
        clientId: options.clientId,
        redirectURI: options.redirectURI || redirectURI,
        state,
        scopes: [...new Set(allScopes)],
        codeVerifier,
        prompt: options.prompt,
      });

      // AWS Cognito requires scopes to be percent-encoded with %20 instead of
      // the "+" that URLSearchParams uses for spaces.
      const scopeValue = url.searchParams.get("scope");
      if (scopeValue) {
        url.searchParams.delete("scope");
        const urlString = url.toString();
        const separator = urlString.includes("?") ? "&" : "?";
        return new URL(`${urlString}${separator}scope=${encodeURIComponent(scopeValue)}`);
      }
      return url;
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
        idToken: result.idToken,
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

    async verifyIdToken(token, nonce) {
      if (!options.userPoolId) return false;
      try {
        const { kid, alg } = decodeProtectedHeader(token);
        if (!kid || !alg) return false;

        const publicKey = await getCognitoPublicKey(kid, options.region, options.userPoolId);
        const expectedIssuer = `https://cognito-idp.${options.region}.amazonaws.com/${options.userPoolId}`;

        const { payload } = await jwtVerify(token, publicKey, {
          algorithms: [alg],
          issuer: expectedIssuer,
          audience: options.clientId,
          maxTokenAge: "1h",
        });

        if (nonce && payload.nonce !== nonce) {
          return false;
        }
        return true;
      } catch (error) {
        console.error("Failed to verify Cognito ID token:", error);
        return false;
      }
    },

    async getUserInfo(tokens) {
      if (tokens.idToken) {
        try {
          const profile = decodeJwt(tokens.idToken) as CognitoProfile;
          if (profile) {
            const displayName = profile.name || profile.given_name || profile.username || "";
            const mapped = options.mapProfileToUser ? await options.mapProfileToUser(profile) : {};
            return {
              user: {
                id: profile.sub,
                email: profile.email,
                emailVerified: profile.email_verified,
                name: displayName,
                image: profile.picture,
                firstName: (mapped as any).firstName || profile.given_name || displayName,
                lastName: (mapped as any).lastName || profile.family_name,
                ...mapped,
              },
              data: profile,
            };
          }
        } catch (error) {
          console.error("Failed to decode Cognito ID token:", error);
        }
      }

      if (tokens.accessToken) {
        const response = await fetch(userInfoEndpoint, {
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
        });
        if (!response.ok) {
          console.error("Failed to fetch Cognito user info:", await response.text());
          return null;
        }
        const profile = (await response.json()) as CognitoProfile;
        const displayName = profile.name || profile.given_name || profile.username || "";
        const mapped = options.mapProfileToUser ? await options.mapProfileToUser(profile) : {};
        return {
          user: {
            id: profile.sub,
            email: profile.email,
            emailVerified: profile.email_verified,
            name: displayName,
            image: profile.picture,
            firstName: (mapped as any).firstName || profile.given_name || displayName,
            lastName: (mapped as any).lastName || profile.family_name,
            ...mapped,
          },
          data: profile,
        };
      }

      return null;
    },
  };
}

export default cognito;
