/**
 * Minimal AsyncLocalStorage context for request-scoped data.
 * Currently used only to propagate accountability into createAuditLog
 * so audit entries capture userId/IP even when ItemsService has no explicit accountability.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Accountability } from '../types/index.js';

export interface RequestStore {
  accountability?: Accountability;
}

/** Singleton ALS instance */
export const requestContext = new AsyncLocalStorage<RequestStore>();

/** Get the current request's accountability (or undefined outside a request) */
export function getContextAccountability(): Accountability | undefined {
  return requestContext.getStore()?.accountability;
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
