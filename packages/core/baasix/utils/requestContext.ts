/**
 * Minimal AsyncLocalStorage context for request-scoped data.
 * Currently used only to propagate accountability into createAuditLog
 * so audit entries capture userId/IP even when ItemsService has no explicit accountability.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Accountability } from '../types/index.js';

export interface RequestStore {
  accountability?: Accountability;
  /**
   * Request-scoped memo for resolved $CURRENT_USER lookups, so the DB read for
   * relational/hidden user fields runs at most once per (user, field-set) within
   * a single request — even though the dynamic-variable resolver runs several
   * times per read (permission conditions, relConditions, and the merged filter).
   * Keyed by `${userId}|${sortedFields.join(',')}`. Absent outside an HTTP request.
   */
  userResolveCache?: Map<string, any>;
}

/** Singleton ALS instance */
export const requestContext = new AsyncLocalStorage<RequestStore>();

/** Get the current request's accountability (or undefined outside a request) */
export function getContextAccountability(): Accountability | undefined {
  return requestContext.getStore()?.accountability;
}

/**
 * Get the request-scoped $CURRENT_USER resolution cache, creating it lazily.
 * Returns undefined when there is no active request store (e.g. workflows, tasks,
 * scheduled hooks) — callers should resolve directly in that case.
 */
export function getUserResolveCache(): Map<string, any> | undefined {
  const store = requestContext.getStore();
  if (!store) return undefined;
  if (!store.userResolveCache) {
    store.userResolveCache = new Map();
  }
  return store.userResolveCache;
}

/** Set accountability on the current request store */
export function setContextAccountability(accountability: Accountability): void {
  const store = requestContext.getStore();
  if (store) {
    store.accountability = accountability;
  }
}

/**
 * Express middleware — wraps the rest of the request in an ALS context.
 * Must be mounted BEFORE authMiddleware so the store exists when auth writes to it.
 */
export function requestContextMiddleware(req: any, _res: any, next: any): void {
  requestContext.run({}, () => next());
}
