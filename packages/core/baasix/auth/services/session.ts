/**
 * Session Service
 * Handles session management for the auth module
 */

import crypto from "crypto";
import type { AuthAdapter, Session, SessionWithUser, User, Role, Permission, Tenant } from "../types.js";

export interface SessionConfig {
  /**
   * Session expiration time in seconds
   * @default 604800 (7 days)
   */
  expiresIn?: number;
  /**
   * How often to update session (in seconds)
   * @default 86400 (1 day)
   */
  updateAge?: number;
  /**
   * Whether to refresh the session cookie
   * @default true
   */
  cookieRefresh?: boolean;
}

export interface SessionService {
  /**
   * Generate a session token
   */
  generateToken(): string;
  
  /**
   * Create a new session for a user
   */
  createSession(data: {
    user: User;
    tenantId?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    type?: string;
  }): Promise<Session>;
  
  /**
   * Validate a session token
   */
  validateSession(token: string): Promise<SessionWithUser | null>;
  
  /**
   * Invalidate a session
   */
  invalidateSession(token: string): Promise<void>;
  
  /**
   * Invalidate all sessions for a user
   */
  invalidateAllSessions(userId: string): Promise<void>;
  
  /**
   * List all sessions for a user
   */
  listSessions(userId: string): Promise<Session[]>;
  
  /**
   * Update session (extend expiration)
   */
  updateSession(sessionId: string): Promise<Session | null>;
  
  /**
   * Clean up expired sessions
   */
  cleanupExpiredSessions(userId: string): Promise<void>;
  
  /**
   * Count active sessions by type
   */
  countSessionsByType(userId: string, type: string, tenantId?: string | null): Promise<number>;
}

export function createSessionService(adapter: AuthAdapter, config: SessionConfig = {}): SessionService {
  const expiresIn = config.expiresIn ?? 604800; // 7 days default
  const updateAge = config.updateAge ?? 86400; // 1 day default

  return {
    generateToken() {
      return crypto.randomBytes(32).toString("hex");
    },

    async createSession({ user, tenantId, ipAddress, userAgent, type = "default" }) {
      const token = this.generateToken();
      const expiresAt = new Date(Date.now() + expiresIn * 1000);

      const session = await adapter.createSession({
        token,
        user_Id: user.id,
        tenant_Id: tenantId || null,
        expiresAt,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        type,
      });

      return session;
    },

    async validateSession(token) {
      const result = await adapter.findSessionByToken(token);
      
      if (!result) {
        return null;
      }

      const { session, user } = result;

      // Check if session has expired
      if (new Date() > new Date(session.expiresAt)) {
        await adapter.deleteSessionByToken(token);
        return null;
      }

      // Check if session needs to be updated (extend expiration)
      const sessionAge = Date.now() - new Date(session.updatedAt || session.createdAt).getTime();
      if (sessionAge > updateAge * 1000) {
        const newExpiresAt = new Date(Date.now() + expiresIn * 1000);
        await adapter.updateSession(session.id, { expiresAt: newExpiresAt });
        session.expiresAt = newExpiresAt;
      }

      return { session, user };
    },

    async invalidateSession(token) {
      await adapter.deleteSessionByToken(token);
      // Clear session cache so revocation takes effect immediately
      try {
        const { getCache } = await import('../../utils/cache.js');
        const cache = getCache();
        await cache.delete(`auth:session:${token}`);
      } catch {}
    },

    async invalidateAllSessions(userId) {
      // Capture active tokens first so we can evict session cache entries after delete.
      const sessions = await adapter.findSessionsByUserId(userId);
      await adapter.deleteSessionsByUserId(userId);

      try {
        const { getCache } = await import('../../utils/cache.js');
        const cache = getCache();
        await Promise.all(sessions.map((session) => cache.delete(`auth:session:${session.token}`)));
      } catch {}
    },

    async listSessions(userId) {
      const sessions = await adapter.findSessionsByUserId(userId);
      
      // Filter out expired sessions
      const now = new Date();
      return sessions.filter((s) => new Date(s.expiresAt) > now);
    },

    async updateSession(sessionId) {
      const newExpiresAt = new Date(Date.now() + expiresIn * 1000);
      return adapter.updateSession(sessionId, { expiresAt: newExpiresAt });
    },

    async cleanupExpiredSessions(userId) {
      const sessions = await adapter.findSessionsByUserId(userId);
      const now = new Date();
      
      for (const session of sessions) {
        if (new Date(session.expiresAt) <= now) {
          await adapter.deleteSession(session.id);
          // Best-effort cache cleanup for expired session entries.
          try {
            const { getCache } = await import('../../utils/cache.js');
            const cache = getCache();
            await cache.delete(`auth:session:${session.token}`);
          } catch {}
        }
      }
    },

    async countSessionsByType(userId, type, tenantId = null) {
      const sessions = await adapter.findSessionsByUserId(userId);
      const now = new Date();
      
      return sessions.filter((s) => {
        if (new Date(s.expiresAt) <= now) return false;
        if (s.type !== type) return false;
        if (tenantId !== null && s.tenant_Id !== tenantId) return false;
        return true;
      }).length;
    },
  };
}

export default createSessionService;

export { validateSessionLimits, resolveSessionLimit } from "./sessionLimits.js";
