/**
 * Microsoft Entra ID (Azure AD) OAuth Provider
 * Ported from better-auth packages/core/src/social-providers/microsoft-entra-id.ts
 *
 * Registry key / factory name: "microsoft" (file name mirrors better-auth's
 * microsoft-entra-id.ts).
 */

import type { OAuthProvider, ProviderOptions } from "../types.js";
import { createAuthorizationURL, validateAuthorizationCode, refreshAccessToken } from "../oauth2/utils.js";
import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify } from "jose";

/**
 * Microsoft's fixed tenant id for personal (consumer) Microsoft accounts. Every
 * personal-account token carries it as the `tid` claim, so it distinguishes the
 * consumer account class from work/school tenants.
 * @see https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference
 */
const MICROSOFT_CONSUMER_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad";

export interface MicrosoftEntraIDProfile extends Record<string, any> {
  /** Identifies the intended recipient of the token */
  aud: string;
  /** Identifies the issuer, or "authorization server" that constructs and returns the token */
  iss: string;
  /** Immutable identifier for the user account */
  oid: string;
  /** Subject identifier - unique to application ID */
  sub: string;
  /** Tenant ID the user is signing in to */
  tid: string;
  /** The primary username that represents the user */
  preferred_username?: string;
  /** User's email address */
  email?: string;
  /** Human-readable value that identifies the subject of the token */
  name: string;
  /** User's profile picture (populated from Graph after token exchange) */
  picture?: string;
  /** Whether the user's email is verified (optional claim, must be configured in app registration) */
  email_verified?: boolean;
  /** User's verified primary email addresses */
  verified_primary_email?: string[];
  /** User's verified secondary email addresses */
  verified_secondary_email?: string[];
  /** User's family name/surname */
  family_name?: string;
  /** User's given/first name */
  given_name?: string;
  /** Matches the parameter included in the original authorize request */
  nonce?: string;
}

export interface MicrosoftOptions extends ProviderOptions<MicrosoftEntraIDProfile> {
  /**
   * The tenant ID of the Microsoft account
   * @default "common"
   */
  tenantId?: string;
  /**
   * The authentication authority URL. Use the default
   * "https://login.microsoftonline.com" for standard Entra ID or
   * "https://<tenant-id>.ciamlogin.com" for CIAM scenarios.
   * @default "https://login.microsoftonline.com"
   */
  authority?: string;
  /**
   * The size of the profile photo
   * @default 48
   */
  profilePhotoSize?: 48 | 64 | 96 | 120 | 240 | 360 | 432 | 504 | 648;
  /**
   * Disable profile photo
   */
  disableProfilePhoto?: boolean;
}

async function getMicrosoftPublicKey(kid: string, tenant: string, authority: string) {
  const jwksUri = `${authority}/${tenant}/discovery/v2.0/keys`;
  const response = await fetch(jwksUri);
  if (!response.ok) {
    throw new Error(`Failed to fetch Microsoft JWKS: ${response.status} ${await response.text()}`);
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

export function microsoft(options: MicrosoftOptions): OAuthProvider<MicrosoftEntraIDProfile, MicrosoftOptions> {
  const tenant = options.tenantId || "common";
  // Trim any trailing slash so endpoint URLs and the issuer comparison below
  // never produce a double slash (e.g. a configured "https://host/" would make
  // the expected issuer "https://host//<tid>/v2.0" and reject every token).
  let authority = options.authority || "https://login.microsoftonline.com";
  while (authority.endsWith("/")) {
    authority = authority.slice(0, -1);
  }
  const authorizationEndpoint = `${authority}/${tenant}/oauth2/v2.0/authorize`;
  const tokenEndpoint = `${authority}/${tenant}/oauth2/v2.0/token`;
  const defaultScopes = ["openid", "profile", "email", "User.Read", "offline_access"];

  return {
    id: "microsoft",
    name: "Microsoft EntraID",
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
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        idToken: result.idToken,
        tokenType: result.tokenType,
        accessTokenExpiresAt: result.expiresIn ? new Date(Date.now() + result.expiresIn * 1000) : undefined,
        scopes: result.scope ? result.scope.split(" ") : undefined,
        raw: result.raw,
      };
    },

    async refreshAccessToken(refreshToken) {
      const scopes = options.disableDefaultScope ? [] : [...defaultScopes];
      if (options.scope) scopes.push(...options.scope);

      const body = new URLSearchParams({
        grant_type: "refresh_token",
        client_id: options.clientId,
        client_secret: options.clientSecret,
        refresh_token: refreshToken,
      });
      if (scopes.length > 0) {
        // Microsoft expects the (re-requested) scopes on refresh.
        body.set("scope", scopes.join(" "));
      }

      const response = await fetch(tokenEndpoint, {
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
        accessToken: raw.access_token,
        refreshToken: raw.refresh_token,
        tokenType: raw.token_type || "Bearer",
        accessTokenExpiresAt: raw.expires_in ? new Date(Date.now() + raw.expires_in * 1000) : undefined,
        raw,
      };
    },

    async verifyIdToken(token, nonce) {
      try {
        const { kid, alg } = decodeProtectedHeader(token);
        if (!kid || !alg) return false;

        const publicKey = await getMicrosoftPublicKey(kid, tenant, authority);
        const verifyOptions: { algorithms: string[]; audience: string; maxTokenAge: string; issuer?: string } = {
          algorithms: [alg],
          audience: options.clientId,
          maxTokenAge: "1h",
        };
        // Issuer varies per user's tenant for multi-tenant endpoints, so only
        // validate it directly for specific (single) tenants.
        // @see https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols#endpoints
        if (tenant !== "common" && tenant !== "organizations" && tenant !== "consumers") {
          verifyOptions.issuer = `${authority}/${tenant}/v2.0`;
        }

        const { payload } = await jwtVerify(token, publicKey, verifyOptions);

        if (nonce && payload.nonce !== nonce) {
          return false;
        }

        // The multi-tenant endpoints (common/organizations/consumers) skip the
        // issuer check above because the issuer varies per tenant, and the
        // organizations/consumers JWKS sets overlap. Enforce the tenant binding
        // explicitly so a token from a disallowed account class cannot pass.
        const tid = payload.tid;
        if (typeof tid !== "string" || payload.iss !== `${authority}/${tid}/v2.0`) {
          return false;
        }
        if (tenant === "organizations" && tid === MICROSOFT_CONSUMER_TENANT_ID) {
          return false;
        }
        if (tenant === "consumers" && tid !== MICROSOFT_CONSUMER_TENANT_ID) {
          return false;
        }

        return true;
      } catch (error) {
        console.error("Failed to verify Microsoft ID token:", error);
        return false;
      }
    },

    async getUserInfo(tokens) {
      if (!tokens.idToken) return null;
      const profile = decodeJwt(tokens.idToken) as MicrosoftEntraIDProfile;

      const profilePhotoSize = options.profilePhotoSize || 48;
      if (!options.disableProfilePhoto && tokens.accessToken) {
        try {
          const response = await fetch(
            `https://graph.microsoft.com/v1.0/me/photos/${profilePhotoSize}x${profilePhotoSize}/$value`,
            { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
          );
          if (response.ok) {
            const pictureBuffer = await response.arrayBuffer();
            profile.picture = `data:image/jpeg;base64, ${Buffer.from(pictureBuffer).toString("base64")}`;
          }
        } catch (error) {
          console.error("Failed to fetch Microsoft profile photo:", error);
        }
      }

      // Microsoft Entra ID does NOT include email_verified claim by default. It
      // must be configured as an optional claim in the app registration. We
      // default to false when not provided, falling back to checking the
      // verified_primary_email/verified_secondary_email arrays.
      const emailVerified =
        profile.email_verified !== undefined
          ? profile.email_verified
          : !!(
              profile.email &&
              (profile.verified_primary_email?.includes(profile.email) ||
                profile.verified_secondary_email?.includes(profile.email))
            );

      const mapped = options.mapProfileToUser ? await options.mapProfileToUser(profile) : {};
      return {
        user: {
          id: profile.sub,
          email: profile.email,
          emailVerified,
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

export default microsoft;
