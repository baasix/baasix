import { APIError } from "./errorHandler.js";
import { schemaManager } from "./schemaManager.js";
import env from "./env.js";

// List of system collections that are tenant-specific (Set for O(1) lookups)
const tenantSpecificSystemCollections = new Set([
  "baasix_Sessions",
  "baasix_File",
  "baasix_AuditLog",
  "baasix_User",
  "baasix_UserRole",
  "baasix_Tasks",
  "baasix_Workflow",
  "baasix_WorkflowExecution",
  "baasix_WorkflowExecutionLog",
]);

// Collections that support public access bypass (isPublic field)
const publicAccessCollections = new Set(["baasix_File"]);

/**
 * Determines whether tenant context should be enforced for the current operation
 * @param service - The service instance
 * @returns Whether tenant context should be enforced
 */
export async function shouldEnforceTenantContext(service: any): Promise<boolean> {
  // Skip tenant enforcement for system collections
  if (service.collection.startsWith("baasix_") && !tenantSpecificSystemCollections.has(service.collection)) {
    return false;
  }

  // Use per-collection schema metadata to determine tenant scoping.
  // tenantScoped: false explicitly disables tenant enforcement for the collection.
  const schemaDefinition = await schemaManager.getSchemaDefinition(service.collection);
  if (schemaDefinition?.tenantScoped === false) {
    return false;
  }

  // Always enforce if multi-tenancy is enabled and we have accountability
  if (!service.isMultiTenant || !service.accountability) {
    return false;
  }

  const role = service.accountability.role;
  const isGlobalRole = role?.isTenantSpecific === false;
  const isAdmin = role?.name === "administrator";

  // A non-tenant-specific role operates globally (cross-tenant). By default we
  // restrict that global bypass to the administrator role — a *non-admin* role
  // marked isTenantSpecific:false is almost always a misconfiguration that would
  // silently expose other tenants' data, so we still tenant-scope it when a tenant
  // context exists. Set STRICT_TENANT_ISOLATION=false to restore the old behavior
  // (any isTenantSpecific:false role bypasses tenant scoping).
  if (isGlobalRole) {
    const strict = env.get("STRICT_TENANT_ISOLATION") !== "false";
    if (!strict || isAdmin) {
      // Trusted global role (or strict mode disabled) → no tenant filter.
      return false;
    }
    // Strict mode + non-admin global role: scope to the tenant if one is present;
    // if there is genuinely no tenant context, fall through to the default below.
  }

  // Enforce tenant context if:
  // 1. The role is tenant-specific (isTenantSpecific: true)
  // 2. OR there's an explicit tenant context set (covers strict-mode non-admin
  //    global roles, and roles whose tenant-specificity is undefined)
  return role?.isTenantSpecific === true || !!service.tenant || !!service.accountability.tenant;
}

/**
 * Check if collection supports public access bypass
 * @param collection - The collection name
 * @returns Whether the collection supports isPublic field
 */
export function supportsPublicAccess(collection: string): boolean {
  return publicAccessCollections.has(collection);
}

/**
 * Builds a tenant filter that includes public access bypass for supported collections
 * @param collection - The collection name
 * @param tenantId - The tenant ID
 * @returns The tenant filter object
 */
export function buildTenantFilter(collection: string, tenantId: string | number): any {
  // For collections that support public access, add OR condition with isPublic: true
  if (supportsPublicAccess(collection)) {
    return {
      OR: [
        { tenant_Id: tenantId },
        { isPublic: true }
      ]
    };
  }

  // For baasix_User, use userRoles.tenant_Id
  if (collection === "baasix_User") {
    return { "userRoles.tenant_Id": tenantId };
  }

  // Default tenant filter
  return { tenant_Id: tenantId };
}

/**
 * Enforces tenant context in database queries
 * @param query - The query object
 * @param service - The service instance
 * @returns The modified query with tenant context
 */
export async function enforceTenantContext(query: any = {}, service: any): Promise<any> {
  if (!(await shouldEnforceTenantContext(service))) {
    return query;
  }

  if (!service.accountability.tenant) {
    throw new APIError("No tenant context available for tenant-specific operation", 403);
  }

  // Build tenant filter using helper (handles isPublic bypass for supported collections)
  const tenantFilter = buildTenantFilter(service.collection, service.accountability.tenant);

  query = query || {};

  query.filter = query.filter
    ? {
        AND: [query.filter, tenantFilter],
      }
    : tenantFilter;

  return query;
}

/**
 * Validates and enforces tenant context in data objects
 * @param data - The data object
 * @param service - The service instance
 * @returns The validated and potentially modified data object
 */
export async function validateTenantContext(data: any, service: any): Promise<any> {
  if (!(await shouldEnforceTenantContext(service))) {
    return data;
  }

  // For collection "baasix_User", tenant_Id is not set in the data object
  if (service.collection === "baasix_User") {
    return data;
  }

  if (!service.accountability.tenant) {
    throw new APIError("No tenant context available for tenant-specific operation", 403);
  }

  // Ensure tenant_Id matches the current tenant
  if (data.tenant_Id && data.tenant_Id !== service.accountability.tenant) {
    throw new APIError("Cannot operate on data from different tenant", 403);
  }

  // Set tenant_Id for create/update operations
  return {
    ...data,
    tenant_Id: service.accountability.tenant,
  };
}
