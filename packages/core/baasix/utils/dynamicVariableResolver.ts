/**
 * Dynamic Variable Resolver
 *
 * Resolves dynamic variables in filter objects:
 * - $CURRENT_USER.field -> actual user field value
 * - $CURRENT_ROLE.field -> actual role field value
 * - $CURRENT_USERROLE -> active baasix_UserRole assignment row id
 * - $CURRENT_USERROLE.field / $CURRENT_USERROLE.rel.field -> assignment fields (custom columns, relations)
 * - $CURRENT_TENANT -> current tenant ID
 * - $CURRENT_TENANT.field -> actual tenant field value
 * - $CURRENT_SETTINGS.field -> settings field (tenant-aware, merged with global)
 * - $NOW -> current timestamp
 * - $NOW+DAYS_7, $NOW-HOURS_2 -> relative date calculations
 */

/**
 * Resolve dynamic variables in filter objects
 * e.g., $CURRENT_USER -> actual user ID
 */
import ItemsService from "../services/ItemsService.js";
import { permissionService } from "../services/PermissionService.js";
import { getUserResolveCache } from "./requestContext.js";

import type { Accountability } from '../types/index.js';

// Re-export for backward compatibility
export type { Accountability };

/**
 * Helper function to resolve NOW variables with relative date calculations
 * Supports: $NOW, $NOW+DAYS_7, $NOW-HOURS_2, etc.
 */
function resolveNowVariable(variable: string): string {
  const now = new Date();

  // Handle basic $NOW
  if (variable === "NOW") {
    return now.toISOString();
  }

  // Parse relative date expressions like $NOW+DAYS_7, $NOW-HOURS_2, etc.
  const match = variable.match(/^NOW([+-])(YEARS?|MONTHS?|WEEKS?|DAYS?|HOURS?|MINUTES?|SECONDS?)_(\d+)$/);
  if (!match) {
    // If it doesn't match the pattern, return current timestamp
    return now.toISOString();
  }

  const [, operator, unit, amount] = match;
  const value = parseInt(amount, 10);
  const multiplier = operator === '+' ? 1 : -1;

  // Calculate the offset in milliseconds
  let offsetMs = 0;
  switch (unit.toLowerCase().replace(/s$/, '')) { // Remove plural 's'
    case 'year':
      offsetMs = value * 365 * 24 * 60 * 60 * 1000;
      break;
    case 'month':
      offsetMs = value * 30 * 24 * 60 * 60 * 1000; // Approximate month as 30 days
      break;
    case 'week':
      offsetMs = value * 7 * 24 * 60 * 60 * 1000;
      break;
    case 'day':
      offsetMs = value * 24 * 60 * 60 * 1000;
      break;
    case 'hour':
      offsetMs = value * 60 * 60 * 1000;
      break;
    case 'minute':
      offsetMs = value * 60 * 1000;
      break;
    case 'second':
      offsetMs = value * 1000;
      break;
    default:
      return now.toISOString();
  }

  // Apply the offset
  const resultDate = new Date(now.getTime() + (multiplier * offsetMs));
  return resultDate.toISOString();
}

/**
 * Collect all variables that need to be resolved from the object
 */
function collectVariables(obj: any, variablesToResolve: Record<string, Set<string>>): void {
  if (typeof obj === "string" && obj.startsWith("$")) {
    const [target, ...parts] = obj.slice(1).split(".");
    if (target === "CURRENT_USER" || target === "CURRENT_ROLE" || target === "CURRENT_USERROLE" || target === "CURRENT_TENANT" || target === "CURRENT_SETTINGS") {
      const field = parts.length > 0 ? parts.join(".") : "id";
      variablesToResolve[target].add(field);
    } else if (target === "NOW" || target.match(/^NOW([+-])(YEARS?|MONTHS?|WEEKS?|DAYS?|HOURS?|MINUTES?|SECONDS?)_(\d+)$/)) {
      if (!variablesToResolve[target]) {
        variablesToResolve[target] = new Set();
      }
      variablesToResolve[target].add("value");
    }
    return;
  }

  if (Array.isArray(obj)) {
    obj.forEach(item => {
      if (typeof item === "string" && item.startsWith("$")) {
        const [target, ...parts] = item.slice(1).split(".");
        if (target === "CURRENT_USER" || target === "CURRENT_ROLE" || target === "CURRENT_USERROLE" || target === "CURRENT_TENANT" || target === "CURRENT_SETTINGS") {
          const field = parts.length > 0 ? parts.join(".") : "id";
          variablesToResolve[target].add(field);
        } else if (target === "NOW" || target.match(/^NOW([+-])(YEARS?|MONTHS?|WEEKS?|DAYS?|HOURS?|MINUTES?|SECONDS?)_(\d+)$/)) {
          if (!variablesToResolve[target]) {
            variablesToResolve[target] = new Set();
          }
          variablesToResolve[target].add("value");
        }
      } else {
        collectVariables(item, variablesToResolve);
      }
    });
    return;
  }

  if (typeof obj === "object" && obj !== null) {
    for (const [key, value] of Object.entries(obj)) {
      // Check keys for variables
      if (key.startsWith("$")) {
        const [target, ...parts] = key.slice(1).split(".");
        if (target === "CURRENT_USER" || target === "CURRENT_ROLE" || target === "CURRENT_USERROLE" || target === "CURRENT_TENANT" || target === "CURRENT_SETTINGS") {
          const field = parts.length > 0 ? parts.join(".") : "id";
          variablesToResolve[target].add(field);
        } else if (target === "NOW" || target.match(/^NOW([+-])(YEARS?|MONTHS?|WEEKS?|DAYS?|HOURS?|MINUTES?|SECONDS?)_(\d+)$/)) {
          if (!variablesToResolve[target]) {
            variablesToResolve[target] = new Set();
          }
          variablesToResolve[target].add("value");
        }
      }

      // Check values recursively
      collectVariables(value, variablesToResolve);
    }
  }
}

/**
 * Resolve collected variables by fetching user/role data and calculating dates
 */
async function resolveCollectedVariables(
  variablesToResolve: Record<string, Set<string>>,
  accountability: Accountability
): Promise<Record<string, any>> {
  const resolved: Record<string, any> = {
    CURRENT_USER: {},
    CURRENT_ROLE: {},
    CURRENT_USERROLE: {},
    CURRENT_TENANT: {},
    CURRENT_SETTINGS: {},
    NOW: {},
  };

  // Resolve NOW variables first (including relative dates) - these don't require accountability
  for (const nowVariable of Object.keys(variablesToResolve)) {
    if (nowVariable.startsWith("NOW")) {
      resolved[nowVariable] = { value: resolveNowVariable(nowVariable) };
    }
  }

  // Resolve CURRENT_SETTINGS - uses SettingsService with tenant-aware merging
  // getTenantSettings already falls back to global settings when no tenantId is provided
  if (variablesToResolve.CURRENT_SETTINGS.size > 0) {
    try {
      // Lazy import to avoid circular dependencies (same pattern as auth.ts)
      const module = await import('../services/SettingsService.js');
      const settingsService = module.default;
      resolved.CURRENT_SETTINGS = await settingsService.getTenantSettings(accountability?.tenant);
    } catch (error: any) {
      console.error(`Error resolving settings data: ${error.message}`);
    }
  }

  // Resolve CURRENT_TENANT - uses accountability.tenant directly
  if (variablesToResolve.CURRENT_TENANT.size > 0 && accountability?.tenant) {
    const tenantFields = Array.from(variablesToResolve.CURRENT_TENANT);
    
    if (tenantFields.length === 1 && tenantFields[0] === 'id') {
      // Simple case: just need the tenant ID
      resolved.CURRENT_TENANT = { id: accountability.tenant };
    } else {
      // Need additional tenant fields - query the database
      try {
        const tenantItemsService = new ItemsService("baasix_Tenant", { accountability: undefined });
        resolved.CURRENT_TENANT = await tenantItemsService.readOne(accountability.tenant, {
          fields: tenantFields
        });
      } catch (error: any) {
        console.error(`Error resolving tenant data: ${error.message}`);
        // Fallback: at minimum provide the ID
        resolved.CURRENT_TENANT = { id: accountability.tenant };
      }
    }
  }

  // Early return if no accountability - CURRENT_USER and CURRENT_ROLE need user context
  if (!accountability?.user?.id) {
    return resolved;
  }

  if (variablesToResolve.CURRENT_USER.size > 0) {
    const fields = Array.from(variablesToResolve.CURRENT_USER);
    const accUser = accountability.user as Record<string, any> | undefined;

    // Fast path: the full (non-hidden) user row is already loaded onto
    // accountability.user by the auth middleware. Resolve FLAT fields from it
    // in-memory and only fall back to a DB query for fields that genuinely
    // need one — relational paths (contain '.') or flat fields not present on
    // the in-memory user (e.g. hidden columns stripped from accountability).
    const inMemory: Record<string, any> = {};
    const fieldsNeedingDb: string[] = [];

    for (const field of fields) {
      const isRelational = field.includes('.');
      if (!isRelational && accUser && field in accUser) {
        inMemory[field] = accUser[field];
      } else {
        fieldsNeedingDb.push(field);
      }
    }

    resolved.CURRENT_USER = inMemory;

    if (fieldsNeedingDb.length > 0) {
      const queryFields = fieldsNeedingDb.includes('id') ? fieldsNeedingDb : ['id', ...fieldsNeedingDb];

      // Request-scoped memo: the resolver runs several times per read (permission
      // conditions, relConditions, merged filter), so cache the DB result by
      // (userId, sorted field-set). The field-set is part of the key so a call
      // requesting a different set of user fields never gets a partial cached
      // object. Outside an HTTP request (workflows/tasks) the cache is absent and
      // we resolve directly.
      const userCache = getUserResolveCache();
      const cacheKey = `${accountability.user.id}|${[...queryFields].sort().join(',')}`;

      try {
        let dbUser: any;
        if (userCache && userCache.has(cacheKey)) {
          dbUser = userCache.get(cacheKey);
        } else {
          const userItemsService = new ItemsService("baasix_User", { accountability: undefined });
          dbUser = await userItemsService.readOne(accountability.user.id, { fields: queryFields });
          if (userCache) {
            userCache.set(cacheKey, dbUser);
          }
        }
        // Merge DB-resolved fields over the in-memory ones into a FRESH object so
        // the cached value is never shared/mutated by reference.
        resolved.CURRENT_USER = { ...inMemory, ...(dbUser || {}) };
      } catch (error: any) {
        console.error(`Error resolving user data: ${error.message}`);
      }
    }
  }

  if (variablesToResolve.CURRENT_ROLE.size > 0 && accountability.role) {
    const fields = Array.from(variablesToResolve.CURRENT_ROLE);
    try {
      const roleId = typeof accountability.role === 'object' ? accountability.role.id : accountability.role;
      
      // Check if any fields are relational (contain dots) - these need DB query with relations
      const hasRelationalFields = fields.some(field => field.includes('.'));
      
      if (!hasRelationalFields) {
        // Simple fields - try PermissionService hybrid cache first
        const cachedRole = await permissionService.getRoleByIdAsync(roleId);
        if (cachedRole) {
          // Filter to only requested fields
          resolved.CURRENT_ROLE = fields.reduce((obj: any, field) => {
            if (field in cachedRole) {
              obj[field] = (cachedRole as any)[field];
            }
            return obj;
          }, { id: cachedRole.id });
        } else {
          // Fallback to database query
          const roleItemsService = new ItemsService("baasix_Role", { accountability: undefined });
          resolved.CURRENT_ROLE = await roleItemsService.readOne(roleId, {
            fields: fields
          });
        }
      } else {
        // Relational fields require database query with proper field expansion
        const roleItemsService = new ItemsService("baasix_Role", { accountability: undefined });
        resolved.CURRENT_ROLE = await roleItemsService.readOne(roleId, {
          fields: ['id', ...fields]
        });
      }
    } catch (error: any) {
      console.error(`Error resolving role data: ${error.message}`);
    }
  }

  // Resolve CURRENT_USERROLE - the active baasix_UserRole assignment row
  // (accountability.userRole, loaded in full by the auth middleware).
  const accUserRole = (accountability as any)?.userRole;
  if (variablesToResolve.CURRENT_USERROLE.size > 0 && accUserRole?.id) {
    const fields = Array.from(variablesToResolve.CURRENT_USERROLE);

    // Flat fields come straight off the in-memory row; dotted paths need a
    // DB query with relational expansion (same pattern as CURRENT_ROLE).
    const inMemory: Record<string, any> = { id: accUserRole.id };
    const relationalFields: string[] = [];

    for (const field of fields) {
      if (field.includes('.')) {
        relationalFields.push(field);
      } else if (field in accUserRole) {
        inMemory[field] = accUserRole[field];
      }
    }

    resolved.CURRENT_USERROLE = inMemory;

    if (relationalFields.length > 0) {
      try {
        const userRoleItemsService = new ItemsService("baasix_UserRole", { accountability: undefined });
        const dbRow = await userRoleItemsService.readOne(accUserRole.id, {
          fields: ['id', ...relationalFields],
        });
        resolved.CURRENT_USERROLE = { ...inMemory, ...(dbRow || {}) };
      } catch (error: any) {
        console.error(`Error resolving userRole data: ${error.message}`);
      }
    }
  }

  return resolved;
}

/**
 * Get nested value from object using dot-notation path
 */
function getNestedValue(obj: any, path: string[]): any {
  if (!obj) return null;
  return path.reduce((current, part) => (current && current[part] !== undefined ? current[part] : null), obj);
}

/**
 * Replace variables in the object with resolved values
 */
function replaceVariables(obj: any, resolvedVariables: Record<string, any>): any {
  if (typeof obj === "string" && obj.startsWith("$")) {
    const [target, ...parts] = obj.slice(1).split(".");
    if (target === "CURRENT_USER" || target === "CURRENT_ROLE" || target === "CURRENT_USERROLE" || target === "CURRENT_TENANT" || target === "CURRENT_SETTINGS") {
      const field = parts.length > 0 ? parts.join(".") : "id";
      const value = getNestedValue(resolvedVariables[target], field.split("."));
      return value;
    } else if (target === "NOW" || target.match(/^NOW([+-])(YEARS?|MONTHS?|WEEKS?|DAYS?|HOURS?|MINUTES?|SECONDS?)_(\d+)$/)) {
      const value = resolvedVariables[target]?.value;
      return value;
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => replaceVariables(item, resolvedVariables));
  }

  if (typeof obj === "object" && obj !== null) {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      let newKey = key;
      if (key.startsWith("$")) {
        const [target, ...parts] = key.slice(1).split(".");
        if (target === "CURRENT_USER" || target === "CURRENT_ROLE" || target === "CURRENT_USERROLE" || target === "CURRENT_TENANT" || target === "CURRENT_SETTINGS") {
          // For key replacements, we typically want to keep the path structure
          newKey = parts.join(".");
        } else if (target === "NOW" || target.match(/^NOW([+-])(YEARS?|MONTHS?|WEEKS?|DAYS?|HOURS?|MINUTES?|SECONDS?)_(\d+)$/)) {
          // For NOW, we replace with the timestamp value directly
          newKey = resolvedVariables[target]?.value;
        }
      }
      result[newKey] = replaceVariables(value, resolvedVariables);
    }
    return result;
  }

  return obj;
}

/**
 * Main function to resolve dynamic variables in an object
 * Supports: $CURRENT_USER.field, $CURRENT_ROLE.field, $CURRENT_TENANT, $CURRENT_TENANT.field, $CURRENT_SETTINGS.field, $NOW, $NOW+DAYS_7, etc.
 */
export async function resolveDynamicVariables(
  obj: any,
  accountability: Accountability
): Promise<any> {
  const variablesToResolve: Record<string, Set<string>> = {
    CURRENT_USER: new Set(),
    CURRENT_ROLE: new Set(),
    CURRENT_USERROLE: new Set(),
    CURRENT_TENANT: new Set(),
    CURRENT_SETTINGS: new Set(),
    NOW: new Set(),
  };

  // First pass: collect all variables that need to be resolved
  collectVariables(obj, variablesToResolve);

  // Resolve all collected variables
  const resolvedVariables = await resolveCollectedVariables(variablesToResolve, accountability);

  // Second pass: replace variables with resolved values
  return replaceVariables(obj, resolvedVariables);
}
