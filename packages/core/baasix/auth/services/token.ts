/**
 * Token Service
 * Handles JWT token generation and verification
 */

import jwt from "jsonwebtoken";
import type { JWTPayload, User, Role, Tenant, Session } from "../types.js";

/** Pinned JWT algorithm — prevents algorithm-confusion / alg:none attacks. */
const JWT_ALGORITHM = "HS256" as const;

export interface TokenConfig {
  /**
   * Secret key for JWT signing
   */
  secret: string;
  /**
   * Token expiration time (e.g., "1h", "7d", or seconds)
   */
  expiresIn?: string | number;
}

export interface TokenService {
  /**
   * Generate a JWT token
   */
  generateToken(payload: Partial<JWTPayload>): string;
  
  /**
   * Verify and decode a JWT token
   */
  verifyToken(token: string): JWTPayload | null;
  
  /**
   * Decode a token without verification
   */
  decodeToken(token: string): JWTPayload | null;
  
  /**
   * Generate a token for a user session
   */
  generateUserToken(data: {
    user: User;
    role: Role;
    session: Session;
    tenant?: Tenant | null;
  }): string;
}

export function createTokenService(config: TokenConfig): TokenService {
  const expiresIn = config.expiresIn ?? "7d";

  // Fail closed only on a MISSING secret. Secret strength is a recommendation
  // surfaced once at startup (validateAuthSecretAtStartup) — we don't hard-fail a
  // short secret here, so an existing deployment keeps running and can rotate on
  // its own schedule.
  if (!config.secret) {
    throw new Error("SECRET_KEY is not configured for the auth token service.");
  }

  return {
    generateToken(payload) {
      return jwt.sign(payload, config.secret, { expiresIn, algorithm: JWT_ALGORITHM } as any);
    },

    verifyToken(token) {
      try {
        const decoded = jwt.verify(token, config.secret, { algorithms: [JWT_ALGORITHM] }) as JWTPayload;
        return decoded;
      } catch (error) {
        return null;
      }
    },

    decodeToken(token) {
      try {
        const decoded = jwt.decode(token) as JWTPayload;
        return decoded;
      } catch (error) {
        return null;
      }
    },

    generateUserToken({ user, role, session, tenant }) {
      const payload: Partial<JWTPayload> = {
        id: user.id,
        role_Id: role.id,
        sessionToken: session.token,
      };

      if (tenant) {
        payload.tenant_Id = tenant.id;
      }

      return this.generateToken(payload);
    },
  };
}

export default createTokenService;
