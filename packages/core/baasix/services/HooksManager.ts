import fs from 'fs';
import path from 'path';
import { db, getDatabase } from '../utils/db.js';
import { sql } from 'drizzle-orm';
import { schemaManager } from '../utils/schemaManager.js';
import type { HookContext, HookFunction } from '../types/index.js';
import { getProjectPath, toFileURL } from '../utils/dirname.js';

// Re-export types for backward compatibility
export type { HookContext, HookFunction };

/**
 * Is the caller an administrator (allowed to erase tenant data)?
 *
 * Mirrors ItemsService.isAdministrator() so the tenant-delete hook's authorization
 * decision matches the permission check that follows it in deleteOneCore:
 *   - no accountability (or empty object) → trusted SYSTEM context (internal callers) → true
 *   - accountability with no role → false
 *   - user.isAdmin === true → true
 *   - role is the string 'administrator', or an object named 'administrator' → true
 *   - otherwise resolve the role id via PermissionService (hybrid cache)
 * Any failure resolving the role is treated as NOT an admin (fail closed).
 */
async function callerIsTenantAdmin(accountability: any): Promise<boolean> {
  try {
    if (!accountability) return true;
    if (Object.keys(accountability).length === 0) return true;
    if (!accountability.role) return false;

    if (accountability.user && accountability.user.isAdmin === true) return true;

    if (typeof accountability.role === 'string') {
      return accountability.role === 'administrator';
    }
    if (typeof accountability.role === 'object' && accountability.role.name) {
      return accountability.role.name === 'administrator';
    }
    const roleId = typeof accountability.role === 'object'
      ? accountability.role.id
      : accountability.role;
    if (roleId) {
      const { permissionService } = await import('./PermissionService.js');
      return await permissionService.isAdministratorRoleAsync(roleId);
    }
    return false;
  } catch (error: any) {
    console.error('[partitioning] Failed to resolve caller admin status; refusing partition drop:', error?.message);
    return false;
  }
}

/**
 * Hooks Manager - Executes lifecycle hooks for collections
 *
 * Matches Sequelize implementation 1:1
 */

export class HooksManager {
  private hooks: Record<string, HookFunction[]> = {};

  /**
   * Register a hook for a collection and event
   */
  registerHook(
    collection: string,
    event: string,
    hookFunction: HookFunction
  ): void {
    const key = `${collection}:${event}`;
    console.info(`Registering hook for ${key}`);
    
    if (!this.hooks[key]) {
      this.hooks[key] = [];
    }
    
    this.hooks[key].push(hookFunction);
  }

  /**
   * Get hooks for a collection and event
   * Returns both specific hooks and wildcard hooks (registered for all collections)
   */
  getHooks(collection: string, event: string): HookFunction[] {
    // Get hooks for specific collection
    const specificHooks = this.hooks[`${collection}:${event}`] || [];
    
    // Get wildcard hooks (registered for all collections with *)
    const wildcardHooks = this.hooks[`*:${event}`] || [];
    
    // Combine both - wildcard hooks execute first
    return [...wildcardHooks, ...specificHooks];
  }

  /**
   * Execute hooks for a collection and action.
   *
   * When `bypass` is true no hook runs and the context is returned untouched —
   * callers can treat the call as a no-op rather than branching around it. This
   * is how ItemsService implements the `bypassHooks` operation option, whose
   * main purpose is letting a hook write to its own collection without
   * re-triggering itself (infinite recursion).
   */
  async executeHooks(
    collection: string,
    event: string,
    accountability: any,
    context: HookContext,
    bypass: boolean = false
  ): Promise<HookContext> {
    // Return the context unchanged so callers reading back `hookData.data` /
    // `hookData.query` still get exactly what they passed in.
    if (bypass) {
      return { ...context };
    }

    const hooks = this.getHooks(collection, event);
    let modifiedData = { ...context };

    // Execute each hook in sequence
    for (const hook of hooks) {
      const result = await hook({
        collection,
        accountability,
        db,
        ...modifiedData,
      });
      
      // Update modifiedData with hook result if provided
      if (result) {
        modifiedData = result;
      }
    }

    return modifiedData;
  }

  /**
   * Load hooks from extensions directory
   */
  async loadHooksFromDirectory(context: any, directory?: string): Promise<void> {
    if (!directory) {
      directory = getProjectPath('extensions');
    }

    if (!fs.existsSync(directory)) {
      console.warn(`Hooks directory not found: ${directory}`);
      return;
    }

    const files = fs.readdirSync(directory);

    for (const file of files) {
      const filePath = path.join(directory, file);

      if (fs.statSync(filePath).isDirectory() && file.startsWith('baasix-hook-')) {
        const hookFile = path.join(filePath, 'index.js');

        if (fs.existsSync(hookFile)) {
          try {
            // Dynamic import for ES modules
            // Convert to file:// URL for Windows compatibility
            const hookModule = await import(toFileURL(hookFile));

            if (typeof hookModule.default === 'function') {
              await hookModule.default(this, context);
              console.info(`Loaded hook: ${file}`);
            }
          } catch (error) {
            console.error(`Failed to load hook ${file}:`, error);
          }
        }
      }
    }
  }

  /**
   * Load schedules from extensions directory
   */
  async loadSchedulesFromDirectory(context: any, schedule: any, directory?: string): Promise<void> {
    if (!directory) {
      directory = getProjectPath('extensions');
    }

    if (!fs.existsSync(directory)) {
      console.warn(`Schedules directory not found: ${directory}`);
      return;
    }

    const files = fs.readdirSync(directory);

    for (const file of files) {
      const filePath = path.join(directory, file);

      if (fs.statSync(filePath).isDirectory() && file.startsWith('baasix-schedule-')) {
        const scheduleFile = path.join(filePath, 'index.js');

        if (fs.existsSync(scheduleFile)) {
          try {
            // Dynamic import for ES modules
            // Convert to file:// URL for Windows compatibility
            const scheduleModule = await import(toFileURL(scheduleFile));

            if (typeof scheduleModule.default === 'function') {
              await scheduleModule.default(schedule, context);
              console.info(`Loaded schedule: ${file}`);
            }
          } catch (error) {
            console.error(`Failed to load schedule ${file}:`, error);
          }
        }
      }
    }
  }
}

// Export singleton instance
// Use globalThis to ensure singleton across different module loading paths
declare global {
  var __baasix_hooksManager: HooksManager | undefined;
  var __baasix_hooksManagerInitialized: boolean | undefined;
}

// Create singleton instance only if it doesn't exist
if (!globalThis.__baasix_hooksManager) {
  globalThis.__baasix_hooksManager = new HooksManager();
}

export const hooksManager = globalThis.__baasix_hooksManager;

// Register global beforeCreate hook for auto-sort functionality (only once)
if (!globalThis.__baasix_hooksManagerInitialized) {
  globalThis.__baasix_hooksManagerInitialized = true;
  hooksManager.registerHook('*', 'items.create', async (context: HookContext) => {
    const { data, collection } = context;

    if (!data) {
      return context;
    }

    try {
      // Get the Drizzle table schema (using statically imported schemaManager)
      const table = schemaManager.getTable(collection);

      // Check if table has a 'sort' column by trying to access it
      if (table && table.sort) {
        // If sort is not provided or is null/undefined, auto-increment it
        if (data.sort === undefined || data.sort === null) {
          const db = getDatabase();

          // Query for max sort value
          const result = await db.execute(sql`
            SELECT COALESCE(MAX("sort"), 0) as max_sort
            FROM "${sql.raw(collection)}"
          `);

          const maxSort = result[0]?.max_sort || 0;
          data.sort = Number(maxSort) + 1;
          console.log(`[HooksManager] Auto-assigned sort value ${data.sort} for ${collection}`);
        }
      }
    } catch (error: any) {
      // If query fails, silently ignore (sort field might not exist)
      console.warn(`Failed to auto-increment sort for ${collection}:`, error.message);
    }

    return context;
  });

  // ── Internal hook: Invalidate user-role auth cache on baasix_UserRole mutations ──
  // This catches ALL code paths: direct API, nested relational updates, bulk, imports.
  const invalidateUserRoleCacheFromHook = async (context: HookContext) => {
    try {
      const { invalidateUserRoleCache } = await import('../utils/common.js');

      const doc = context.document;
      const prev = context.previousDocument;

      // Invalidate current and previous user (in case user_Id itself changed)
      const userIds = new Set<string>();
      if (doc?.user_Id) userIds.add(doc.user_Id);
      if (prev?.user_Id) userIds.add(prev.user_Id);

      // Row id for the pinned-assignment cache key (auth:userrole:${userId}:ur:${rowId}).
      // Covers create/update (doc.id) and delete (only prev.id available).
      const rowId = doc?.id || prev?.id;

      for (const userId of userIds) {
        const tenantId = doc?.tenant_Id || prev?.tenant_Id;
        await invalidateUserRoleCache(userId, tenantId, rowId);
      }
    } catch (error: any) {
      console.error('[HooksManager] Failed to invalidate user role cache:', error.message);
    }
    return context;
  };

  hooksManager.registerHook('baasix_UserRole', 'items.create.after', invalidateUserRoleCacheFromHook);
  hooksManager.registerHook('baasix_UserRole', 'items.update.after', invalidateUserRoleCacheFromHook);
  hooksManager.registerHook('baasix_UserRole', 'items.delete.after', invalidateUserRoleCacheFromHook);

  // Evict session cache when a session record is deleted via ItemsService
  // This ensures auth/me returns 401 immediately instead of waiting for 30s TTL
  hooksManager.registerHook('baasix_Sessions', 'items.delete.after', async (context: HookContext) => {
    try {
      const token = context.document?.token;
      if (!token) return context;
      const { getCache } = await import('../utils/cache.js');
      const cache = getCache();
      await cache.delete(`auth:session:${token}`);
    } catch (error: any) {
      console.error('[HooksManager] Failed to invalidate session cache:', error.message);
    }
    return context;
  });

  // Partition lifecycle: create partitions when a tenant is created,
  // drop them (bulk data erase) right before the tenant row is deleted.
  hooksManager.registerHook('baasix_Tenant', 'items.create.after', async (context: HookContext) => {
    const tenantId = context.document?.id ?? context.id;
    if (!tenantId) return context;
    const { schemaManager } = await import('../utils/schemaManager.js');
    await schemaManager.createPartitionsForTenant(String(tenantId));
    return context;
  });

  hooksManager.registerHook('baasix_Tenant', 'items.delete', async (context: HookContext) => {
    const tenantId = context.id;
    if (!tenantId) return context;

    // ── AUTHORIZATION GUARD (defence in depth) ──────────────────────────────
    // 'items.delete' before-hooks fire in deleteOneCore BEFORE the caller's delete
    // permission is checked. Dropping a tenant's partitions is an irreversible
    // DROP TABLE … CASCADE, so it MUST NOT run for a caller who will be rejected
    // by the subsequent permission check. Only administrators may erase a tenant's
    // data. A legitimately-authorized non-admin (custom role with delete permission)
    // still deletes the tenant ROW; its partitions remain (empty after the ON DELETE
    // CASCADE clears the rows) and are healed/ignored by reconciliation.
    if (!(await callerIsTenantAdmin(context.accountability))) {
      console.warn(
        `[partitioning] Skipping partition drop for tenant ${String(tenantId)}: ` +
        `caller is not an administrator. The tenant row (if the delete is authorized) ` +
        `is removed via ON DELETE CASCADE; partitions are left in place (empty).`
      );
      return context;
    }

    const { schemaManager } = await import('../utils/schemaManager.js');
    // Thread the delete transaction so the DROPs are transactional WITH the delete:
    // if the delete later fails (permission/404/FK RESTRICT), PG rolls the DROPs back.
    await schemaManager.dropPartitionsForTenant(String(tenantId), context.transaction);
    return context;
  });
}

export default hooksManager;

