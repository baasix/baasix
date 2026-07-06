import { db } from '../utils/db.js';
import { schemaManager } from '../utils/schemaManager.js';
import { FieldExpansionUtil } from '../utils/fieldExpansion.js';
import { resolveDynamicVariables } from '../utils/dynamicVariableResolver.js';
import { getCache } from '../utils/cache.js';
import { eq } from 'drizzle-orm';
import { mergeACLEntries } from '../utils/aclMerge.js';
import type { PermissionFilter, PermissionData } from '../types/index.js';

// Re-export types for backward compatibility
export type { PermissionFilter };

/**
 * Role interface for type safety
 */
export interface Role {
  id: string | number;
  name: string;
  description?: string;
  isTenantSpecific?: boolean;
  canInviteRoleIds?: string[];
}

/**
 * Permission Service - Handles role-based access control
 *
 * Uses hybrid L1(Memory)+L2(Redis) caching for both roles and permissions.
 * 
 * Cache Architecture:
 * - Roles use "auth:roles:*" keys (hybrid keys, auto-synced across instances)
 * - Permissions use "permissions:role:*" keys (hybrid keys)
 * - L1 reads are fast (in-memory), L2 (Redis) is source of truth
 * - Periodic sync (default 5s) keeps all instances in sync
 */

export class PermissionService {
  private rolesLoaded: boolean = false;

  constructor() {
    console.info("PermissionService instance created");
  }

  /**
   * Get cache instance
   */
  private getCache() {
    return getCache();
  }

  // ==================== Role Management ====================
  // Roles use hybrid cache keys: auth:roles:all, auth:roles:by-id:{id}, auth:roles:by-name:{name}
  // This ensures automatic L1/L2 sync across multiple instances

  /**
   * Load all roles from database into hybrid cache
   * Called once at startup alongside loadPermissions
   */
  async loadRoles(): Promise<void> {
    try {
      const cache = this.getCache();
      const RoleTable = schemaManager.getTable('baasix_Role');
      const roles = await db.select().from(RoleTable);

      // Store all roles
      const rolesById: Record<string, Role> = {};
      const rolesByName: Record<string, Role> = {};

      for (const role of roles) {
        const roleData: Role = {
          id: role.id,
          name: role.name,
          description: role.description,
          isTenantSpecific: role.isTenantSpecific,
          canInviteRoleIds: role.canInviteRoleIds,
        };
        rolesById[String(role.id)] = roleData;
        rolesByName[role.name] = roleData;
      }

      // Store in hybrid cache (auth:* keys are auto-synced)
      await cache.set('auth:roles:all', Object.values(rolesById), -1);
      await cache.set('auth:roles:by-id', rolesById, -1);
      await cache.set('auth:roles:by-name', rolesByName, -1);

      this.rolesLoaded = true;
      console.info(`[PermissionService] Loaded ${roles.length} roles into hybrid cache`);
    } catch (error) {
      console.error('[PermissionService] Error loading roles:', error);
      this.rolesLoaded = true;
    }
  }

  /**
   * Ensure roles are loaded into cache
   */
  private async ensureRolesLoaded(): Promise<void> {
    if (!this.rolesLoaded) {
      await this.loadRoles();
    }
    // Also check if cache is empty (could happen if another instance cleared it)
    const cache = this.getCache();
    const rolesById = await cache.get('auth:roles:by-id');
    if (!rolesById || Object.keys(rolesById).length === 0) {
      await this.loadRoles();
    }
  }

  /**
   * Get role by ID (async, from hybrid cache)
   */
  async getRoleByIdAsync(roleId: string | number): Promise<Role | null> {
    await this.ensureRolesLoaded();
    const cache = this.getCache();
    const rolesById = await cache.get('auth:roles:by-id');
    return rolesById?.[String(roleId)] || null;
  }

  /**
   * Get role by name (async, from hybrid cache)
   */
  async getRoleByNameAsync(name: string): Promise<Role | null> {
    await this.ensureRolesLoaded();
    const cache = this.getCache();
    const rolesByName = await cache.get('auth:roles:by-name');
    return rolesByName?.[name] || null;
  }

  /**
   * Get the public role (async, from hybrid cache)
   */
  async getPublicRoleAsync(): Promise<Role | null> {
    return this.getRoleByNameAsync('public');
  }

  /**
   * Get the administrator role (async, from hybrid cache)
   */
  async getAdministratorRoleAsync(): Promise<Role | null> {
    return this.getRoleByNameAsync('administrator');
  }

  /**
   * Check if a role ID is the administrator role (async)
   */
  async isAdministratorRoleAsync(roleId: string | number | null | undefined): Promise<boolean> {
    if (!roleId) return false;
    const role = await this.getRoleByIdAsync(roleId);
    return role?.name === 'administrator';
  }

  /**
   * Check if a role name is administrator
   */
  isAdministratorRoleName(roleName: string | null | undefined): boolean {
    return roleName === 'administrator';
  }

  /**
   * Get all roles (async, from hybrid cache)
   */
  async getAllRolesAsync(): Promise<Role[]> {
    const cache = this.getCache();
    return (await cache.get('auth:roles:all')) || [];
  }

  /**
   * Check if roles are loaded
   */
  areRolesLoaded(): boolean {
    return this.rolesLoaded;
  }

  /**
   * Invalidate role cache and reload
   * Call this when roles are created, updated, or deleted
   */
  async invalidateRoles(): Promise<void> {
    this.rolesLoaded = false;
    
    // Clear hybrid cache keys for roles
    const cache = this.getCache();
    await cache.delete('auth:roles:all');
    await cache.delete('auth:roles:by-id');
    await cache.delete('auth:roles:by-name');
    
    // Also invalidate legacy keys for backward compatibility
    await cache.invalidateModel("auth:role");
    await cache.delete("auth:public_role");
    
    // Reload roles into cache
    await this.loadRoles();
  }

  // ==================== Permission Management ====================

  /**
   * Load permissions from database
   * Also loads roles if not already loaded
   */
  async loadPermissions(role_Id?: string | number | null): Promise<void> {
    // Ensure roles are loaded first
    if (!this.rolesLoaded) {
      await this.loadRoles();
    }

    const cache = this.getCache();
    let permissions: any[];

    try {
      const PermissionTable = schemaManager.getTable('baasix_Permission');

      if (role_Id) {
        // Load permissions for specific role
        permissions = await db
          .select()
          .from(PermissionTable)
          .where(eq(PermissionTable.role_Id, role_Id));
      } else {
        // Load all permissions
        permissions = await db.select().from(PermissionTable);
      }

      if (!role_Id) {
        // Clear all permissions caches
        await cache.invalidateModel("permissions");
      }

      // Load all ACL entries once per reload; permissions referencing them are
      // expanded here so the cached shape stays identical for all consumers.
      let aclById = new Map<string, any>();
      try {
        const ACLTable = schemaManager.getTable('baasix_ACL');
        const aclRows = await db.select().from(ACLTable);
        aclById = new Map(aclRows.map((row: any) => [String(row.id), row]));
      } catch (aclError) {
        console.warn('[PermissionService] baasix_ACL table not available yet, skipping ACL expansion');
      }

      // Group permissions by role in memory first
      // This avoids N sequential Redis round-trips (one per permission record)
      const rolePermissionsMap = new Map<string | number, Record<string, any>>();

      for (const permission of permissions) {
        const roleId = permission.role_Id;
        if (!rolePermissionsMap.has(roleId)) {
          rolePermissionsMap.set(roleId, {});
        }
        const rolePermissions = rolePermissionsMap.get(roleId)!;
        const collectionName = permission.collection;

        rolePermissions[collectionName] = rolePermissions[collectionName] || {};

        const aclIds: string[] | null = Array.isArray(permission.acl_Ids) ? permission.acl_Ids : null;

        if (aclIds && aclIds.length > 0) {
          // Named ACL entries replace this row's inline values (additive OR merge)
          const entries = [];
          for (const aclId of aclIds) {
            const entry = aclById.get(String(aclId));
            if (entry) {
              entries.push(entry);
            } else {
              console.warn(
                `[PermissionService] Permission ${permission.id} (${permission.collection}/${permission.action}) references missing ACL ${aclId} — skipping that entry`
              );
            }
          }

          if (entries.length === 0) {
            // Fail closed: no resolvable ACL entries means no access for this action
            console.warn(
              `[PermissionService] Permission ${permission.id} (${permission.collection}/${permission.action}) has no resolvable ACL entries — denying access`
            );
            continue;
          }

          const merged = mergeACLEntries(entries);
          rolePermissions[collectionName][permission.action] = {
            fields: this.parseFields(merged.fields),
            conditions: merged.conditions,
            relConditions: merged.relConditions,
            defaultValues: merged.defaultValues,
          };
        } else {
          rolePermissions[collectionName][permission.action] = {
            fields: this.parseFields(permission.fields),
            conditions: permission.conditions || {},
            relConditions: permission.relConditions || {},
            defaultValues: permission.defaultValues || {},
          };
        }
      }

      // Batch write all role permissions in a single Redis pipeline round-trip
      // (N_roles writes instead of N_permissions, typically 6 vs hundreds)
      const entries = [...rolePermissionsMap].map(([roleId, perms]) => ({
        key: `permissions:role:${roleId}`,
        value: perms,
        expiresIn: -1,
      }));
      await cache.setBatch(entries);
    } catch (error) {
      console.error('Error loading permissions:', error);
      // Initialize empty cache if table doesn't exist yet
      if (!role_Id) {
        await cache.invalidateModel("permissions");
      }
    }
  }

  /**
   * Parse fields string to array
   */
  private parseFields(fieldsString: string | string[] | null): string[] | null {
    if (!fieldsString) return null;

    // If fieldsString is array, return it as is
    if (Array.isArray(fieldsString)) return fieldsString;

    return fieldsString.split(',').map((f) => f.trim());
  }

  /**
   * Get permissions for a role
   */
  async getPermissions(role_Id: string | number): Promise<Record<string, Record<string, PermissionData>>> {
    const cache = this.getCache();
    const cacheKey = `permissions:role:${role_Id}`;
    return (await cache.get(cacheKey)) || {};
  }

  /**
   * Check if role can access collection with operation
   */
  async canAccess(
    role_Id: string | number,
    collection: string,
    operation: 'create' | 'read' | 'update' | 'delete',
    fields: string[] | null = null
  ): Promise<boolean> {
    const permissions = await this.getPermissions(role_Id);
    const collectionPermissions = permissions[collection];

    if (!collectionPermissions || !collectionPermissions[operation]) {
      return false;
    }

    if (fields && collectionPermissions[operation].fields) {
      return this.checkFieldPermissions(fields, collectionPermissions[operation].fields);
    }

    if (fields) {
      const primaryKey = schemaManager.getPrimaryKey(collection);
      const requiredFields = Array.isArray(primaryKey) ? primaryKey : [primaryKey];
      const allFields = [...new Set([...fields, ...requiredFields])];
      return this.checkFieldPermissions(allFields, collectionPermissions[operation].fields);
    }

    return true;
  }

  /**
   * Check if requested fields are allowed
   */
  private checkFieldPermissions(requestedFields: string[], allowedFields: string[] | null): boolean {
    if (!allowedFields || allowedFields.includes('*')) return true;

    for (const field of requestedFields) {
      if (!this.isFieldAllowed(field, allowedFields)) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Check if a single field is allowed
   */
  private isFieldAllowed(field: string, allowedFields: string[]): boolean {
    const fieldParts = field.split('.');

    for (const allowedField of allowedFields) {
      const allowedParts = allowedField.split('.');
      if (this.matchFieldPattern(fieldParts, allowedParts)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Match field pattern with wildcards
   * Supports:
   * - * : matches exactly one level (e.g., "user.*" matches "user.name" but not "user.role.name")
   * - ** : matches any number of nested levels (e.g., "user.**" matches "user.name", "user.role.name", etc.)
   */
  private matchFieldPattern(fieldParts: string[], allowedParts: string[]): boolean {
    // Check for ** wildcard (matches any depth)
    const doubleStarIndex = allowedParts.indexOf('**');
    if (doubleStarIndex !== -1) {
      // ** can only be at the end of the pattern
      if (doubleStarIndex !== allowedParts.length - 1) {
        // Invalid pattern: ** must be the last part
        return false;
      }
      // Match all parts before **
      for (let i = 0; i < doubleStarIndex; i++) {
        if (allowedParts[i] === '*') continue;
        if (i >= fieldParts.length || allowedParts[i] !== fieldParts[i]) return false;
      }
      // ** matches any remaining parts (including none)
      return fieldParts.length >= doubleStarIndex;
    }

    // Original logic for single * wildcards
    if (allowedParts.length > fieldParts.length) return false;

    for (let i = 0; i < allowedParts.length; i++) {
      if (allowedParts[i] === '*') continue;
      if (allowedParts[i] !== fieldParts[i]) return false;
    }

    return (
      allowedParts[allowedParts.length - 1] === '*' ||
      allowedParts.length === fieldParts.length
    );
  }

  /**
   * Get filter conditions for a role and collection
   */
  async getFilter(
    role_Id: string | number,
    collection: string,
    operation: 'create' | 'read' | 'update' | 'delete',
    accountability: any
  ): Promise<PermissionFilter> {
    const permissions = await this.getPermissions(role_Id);
    const collectionPermissions = permissions[collection];

    if (collectionPermissions && collectionPermissions[operation]) {
      const conditions = collectionPermissions[operation]?.conditions || {};
      const relConditions = collectionPermissions[operation]?.relConditions || {};

      // Resolve dynamic variables in permission conditions
      const resolvedConditions = await resolveDynamicVariables(conditions, accountability);
      const resolvedRelConditions = await resolveDynamicVariables(relConditions, accountability);

      return {
        conditions: resolvedConditions,
        relConditions: resolvedRelConditions,
      };
    }

    return {
      conditions: {},
      relConditions: {},
    };
  }

  /**
   * Get default values from permissions
   */
  async getDefaultValues(
    role_Id: string | number,
    collection: string,
    operation: 'create' | 'update',
    accountability: any
  ): Promise<Record<string, any>> {
    if (!role_Id || !collection || !operation || !accountability) {
      return {};
    }

    const permissions = await this.getPermissions(role_Id);
    const collectionPermissions = permissions[collection];

    if (
      collectionPermissions &&
      collectionPermissions[operation] &&
      collectionPermissions[operation].defaultValues
    ) {
      return await resolveDynamicVariables(
        collectionPermissions[operation].defaultValues,
        accountability
      );
    }

    return {};
  }

  /**
   * Get allowed fields for a role and collection
   */
  async getAllowedFields(
    role_Id: string | number,
    collection: string,
    operation: 'create' | 'read' | 'update' | 'delete'
  ): Promise<string[] | null> {
    const permissions = await this.getPermissions(role_Id);
    const collectionPermissions = permissions[collection];

    if (collectionPermissions && collectionPermissions[operation]) {
      const fields = collectionPermissions[operation].fields;

      if (!fields) return null;

      return FieldExpansionUtil.expandFields(fields, collection);
    }

    return null;
  }

  /**
   * Combined permission lookup — single cache hit returns canAccess, filter, and allowedFields.
   * Use this instead of calling canAccess + getFilter + getAllowedFields separately.
   */
  async getFullPermissionData(
    role_Id: string | number,
    collection: string,
    operation: 'create' | 'read' | 'update' | 'delete',
    accountability: any
  ): Promise<{
    canAccess: boolean;
    filter: PermissionFilter;
    allowedFields: string[] | null;
    /**
     * The raw, UNEXPANDED permission fields (e.g. ["*", "role_Id"]). Used to
     * distinguish a field granted explicitly by name from one merely swept in by
     * a "*" wildcard — privilege fields are writable only when explicitly named.
     */
    rawFields: string[] | null;
  }> {
    const permissions = await this.getPermissions(role_Id);
    const collectionPermissions = permissions[collection];

    if (!collectionPermissions || !collectionPermissions[operation]) {
      return {
        canAccess: false,
        filter: { conditions: {}, relConditions: {} },
        allowedFields: null,
        rawFields: null,
      };
    }

    const permData = collectionPermissions[operation];

    // canAccess
    const canAccess = true;

    // filter
    const conditions = permData.conditions || {};
    const relConditions = permData.relConditions || {};
    const resolvedConditions = await resolveDynamicVariables(conditions, accountability);
    const resolvedRelConditions = await resolveDynamicVariables(relConditions, accountability);
    const filter: PermissionFilter = {
      conditions: resolvedConditions,
      relConditions: resolvedRelConditions,
    };

    // allowedFields (expanded) + rawFields (unexpanded, for explicit-grant checks)
    let allowedFields: string[] | null = null;
    const rawFields: string[] | null = permData.fields || null;
    if (permData.fields) {
      allowedFields = FieldExpansionUtil.expandFields(permData.fields, collection);
    }

    return { canAccess, filter, allowedFields, rawFields };
  }
}

// Use globalThis to ensure singleton across different module loading paths
declare global {
  var __baasix_permissionService: PermissionService | undefined;
}

// Create singleton instance only if it doesn't exist
if (!globalThis.__baasix_permissionService) {
  globalThis.__baasix_permissionService = new PermissionService();
}

const permissionService = globalThis.__baasix_permissionService;
export { permissionService };
export default permissionService;