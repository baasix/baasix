/**
 * Common utilities for routes
 * Contains reusable functions that are duplicated across multiple route files
 */

import { schemaManager } from "./schemaManager.js";
import { APIError } from "./errorHandler.js";
import { getCache } from "./cache.js";
import { getCacheService } from "./db.js";
import settingsService from "../services/SettingsService.js";
import env from "./env.js";

/**
 * Middleware to check if a model/collection exists
 * Used in: items.route.ts, reports.route.ts
 */
export const modelExistsMiddleware = (req: any, res: any, next: any) => {
  const modelName = req.params.collection;
  if (!schemaManager.modelExists(modelName)) {
    return next(new APIError(`Model ${modelName} not found`, 404));
  }
  next();
};

/**
 * Throws APIError if user is not authenticated
 * Used in: notification.route.ts (4 times)
 */
export function requireAuth(req: any): void {
  if (!req.accountability?.user?.id) {
    throw new APIError("Authentication required", 401);
  }
}

/**
 * Check if a collection has a tenant_Id field (supports tenant isolation)
 */
export function collectionHasTenantField(collection: string): boolean {
  try {
    const table = schemaManager.getTable(collection);
    // Check if table has tenant_Id column
    return 'tenant_Id' in table;
  } catch {
    return false;
  }
}

/**
 * Invalidate auth cache for a specific role or all roles
 * Used in: permission.route.ts
 */
export async function invalidateAuthCache(roleId?: string): Promise<void> {
  try {
    const cache = getCache();
    if (roleId) {
      const cacheKey = `auth:role:${roleId}:permissions`;
      await cache.delete(cacheKey);
    } else {
      await cache.invalidateModel("auth");
    }
  } catch (error) {
    console.error(`[Common] Failed to invalidate auth cache:`, error);
  }
}

/**
 * Invalidate cache for a collection
 * Used in: permission.route.ts
 */
export async function invalidateCollectionCache(collection: string): Promise<void> {
  try {
    const cache = getCacheService();
    if (cache) {
      await cache.onMutate({ tables: [collection] });
    }
  } catch (error) {
    console.error(`[Common] Failed to invalidate cache for ${collection}:`, error);
  }
}

/**
 * Invalidate settings cache for a tenant or global
 * Used in: items.route.ts
 * @param corsInvalidator - Function to invalidate CORS cache (from app.ts)
 */
export async function invalidateSettingsCache(
  item: any,
  corsInvalidator?: () => void
): Promise<void> {
  try {
    const tenantId = item?.tenant_Id;
    console.info(`Settings modified - invalidating cache for tenant: ${tenantId || "global"}`);

    if (tenantId) {
      await settingsService.invalidateTenantCache(tenantId);
    } else {
      await settingsService.loadGlobalSettings();
      await settingsService.invalidateAllCaches();
    }

    if (corsInvalidator) {
      corsInvalidator();
    }
  } catch (error: any) {
    console.error("Error invalidating settings cache:", error);
  }
}

/**
 * Invalidate settings cache after import (always invalidates all)
 * Used in: items.route.ts (import-csv and import-json)
 */
export async function invalidateSettingsCacheAfterImport(): Promise<void> {
  console.info(`Settings imported - invalidating all caches`);
  await settingsService.loadGlobalSettings();
  await settingsService.invalidateAllCaches();
}
