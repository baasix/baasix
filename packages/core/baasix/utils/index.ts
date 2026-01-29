/**
 * Baasix Utilities - Core utility functions and managers
 *
 * This module exports all utility functions and managers used throughout
 * the Baasix application with Drizzle ORM.
 */

/**
 * Baasix Utilities Index
 *
 * Centralized exports for all utility modules
 */

// ============================================================================
// TYPE EXPORTS FROM CENTRALIZED TYPES FOLDER
// ============================================================================
// Note: Individual utility files re-export their types from ../types for backward compatibility
// For direct type imports, prefer importing from '@/types' or '../types'

// ============================================================================
// DATABASE UTILITIES (for extensions)
// ============================================================================
export {
  initializeDatabase,
  initializeDatabaseWithCache,
  getDatabase,
  getSqlClient,
  getReadSqlClient,
  testConnection,
  closeDatabase,
  createTransaction,
  getInstanceId,
  getPostgresVersion,
  isPgVersionAtLeast,
  db,
  sqlClient,
} from './db.js';
export type { TransactionClient, Transaction } from './db.js';

// Environment utilities
export { default as env } from './env.js';

// Type mapping utilities
export { mapJsonTypeToDrizzle } from './typeMapper.js';
export { default as typeMapper } from './typeMapper.js';

// Schema management utilities
export { schemaManager } from './schemaManager.js';

// Relation utilities
export { relationBuilder, RelationBuilder } from './relationUtils.js';

// System schemas
export { systemSchemas } from './systemschema.js';

// Query building utilities
export * from './filterOperators.js';
export * from './queryBuilder.js';
export * from './orderUtils.js';
// @ts-expect-error - applyFullTextSearch is exported from both queryBuilder and aggregationUtils with different signatures
export * from './aggregationUtils.js';
export * from './relationLoader.js';

// ============================================================================
// PATH & DIRECTORY UTILITIES (for extensions)
// ============================================================================
export {
  getBaasixRoot,
  getBaasixPath,
  getProjectDir,
  getProjectPath,
  toFileURL,
  isCommonJS,
} from './dirname.js';

// ============================================================================
// CACHE UTILITIES (for extensions)
// ============================================================================
export {
  initializeCache,
  getCache,
  closeCache,
} from './cache.js';
export type { CacheInterface } from './cache.js';

// ============================================================================
// TENANT UTILITIES (for multi-tenant extensions)
// ============================================================================
export {
  shouldEnforceTenantContext,
  supportsPublicAccess,
  buildTenantFilter,
  enforceTenantContext,
  validateTenantContext,
} from './tenantUtils.js';

// ============================================================================
// AUTH UTILITIES (for extensions needing auth context)
// ============================================================================
// Note: Some auth exports like validateSessionLimits and JWTPayload are in auth/index.js
// to avoid duplicate exports, we only export utils-specific auth functions here
export {
  verifyJWT,
  generateJWT,
  getRolesAndPermissions,
  getUserRolesPermissionsAndTenant,
  extractTokenFromHeader,
  getPublicRole,
  authMiddleware,
  isAdmin,
  adminOnly,
  createSession,
  validateSession,
  generateToken,
} from './auth.js';
export type { UserWithRolesAndPermissions } from './auth.js';

// ============================================================================
// NEW UTILITIES FOR 100% SEQUELIZE PARITY
// ============================================================================

// Spatial/Geospatial Utilities (HIGH PRIORITY - PostGIS support)
export { default as spatialUtils } from './spatialUtils.js';

// Field Utilities (HIGH PRIORITY - field operations & validation)
export { default as fieldUtils } from './fieldUtils.js';

// Import/Export Utilities (HIGH PRIORITY - CSV/JSON bulk operations)
export { default as importUtils } from './importUtils.js';

// Schema Validation (HIGH PRIORITY - comprehensive schema validation)
export { default as schemaValidator } from './schemaValidator.js';

// Value Validation (Runtime validation for field values)
export { default as valueValidator } from './valueValidator.js';

// Cache Service (Drizzle native caching with multiple adapters)
export {
  initializeCacheService,
  getCacheService,
  closeCacheService,
  invalidateCollection,
  invalidateEntireCache,
  BaasixDrizzleCache,
  InMemoryCacheAdapter,
  RedisCacheAdapter,
  UpstashCacheAdapter,
} from '../services/CacheService.js';

// Seeding Utilities (LOW PRIORITY - database seeding)
export { default as seedUtility } from './seed.js';
export {
  seedCollection,
  seedMultiple,
  generateTemplate,
  printSummary,
} from './seed.js';

// Workflow Utilities (HIGH PRIORITY - workflow role-based access control)
export {
  checkWorkflowRoleAccess,
  fetchWorkflowForExecution,
  validateWorkflowAccess,
  fetchAndValidateWorkflow,
  canSetWorkflowRoles,
} from './workflow.js';

// Sort Utilities
export {
  sortItems,
  reorderItems,
  getNextSortValue,
} from './sortUtils.js';
export type { SortOptions, SortResult } from './sortUtils.js';

// Error handling utilities
export { APIError, errorHandler } from './errorHandler.js';

// Log cleanup utilities
export { triggerLogCleanup, startLogCleanup } from './logCleanup.js';

// Logger utilities
export { initializeLogger, getLogger, getOriginalConsole } from './logger.js';
export type { BaasixLoggerOptions, Logger, LoggerOptions, DestinationStream } from './logger.js';

// Common utilities (shared across routes)
export {
  modelExistsMiddleware,
  requireAuth,
  getImportAccountability,
  collectionHasTenantField,
  invalidateAuthCache,
  invalidateCollectionCache,
  invalidateSettingsCache,
  invalidateSettingsCacheAfterImport,
} from './common.js';

// Dynamic Variable Resolver (for resolving variables in workflows/filters)
export { resolveDynamicVariables } from './dynamicVariableResolver.js';

/**
 * USAGE EXAMPLES FOR EXTENSIONS
 * ==============================
 * 
 * 1. DATABASE OPERATIONS:
 *    import { db, sqlClient, getDatabase, createTransaction } from 'baasix';
 *    
 *    // Raw SQL query
 *    const results = await sqlClient`SELECT * FROM users WHERE active = true`;
 *    
 *    // Using transaction
 *    const tx = await createTransaction();
 *    try {
 *      await tx.insert(table).values(data);
 *      await tx.commit();
 *    } catch (error) {
 *      await tx.rollback();
 *    }
 * 
 * 2. PATH UTILITIES:
 *    import { getBaasixPath, getProjectPath } from 'baasix';
 *    const templatePath = getBaasixPath('templates', 'email.liquid');
 *    const extensionPath = getProjectPath('extensions', 'my-plugin');
 * 
 * 3. CACHE OPERATIONS:
 *    import { getCache } from 'baasix';
 *    const cache = getCache();
 *    await cache.set('my-key', value, 3600); // 1 hour TTL
 *    const cached = await cache.get('my-key');
 * 
 * 4. TENANT UTILITIES (Multi-tenant mode):
 *    import { shouldEnforceTenantContext, buildTenantFilter } from 'baasix';
 *    if (await shouldEnforceTenantContext(service)) {
 *      const filter = buildTenantFilter('orders', tenantId);
 *    }
 * 
 * 5. AUTH UTILITIES:
 *    import { verifyJWT, getRolesAndPermissions } from 'baasix';
 *    const decoded = verifyJWT(token);
 *    const { role, permissions } = await getRolesAndPermissions(roleId);
 * 
 * 6. SPATIAL OPERATIONS:
 *    import { spatialUtils } from 'baasix';
 *    const point = spatialUtils.pointToGeometry(-122.4194, 37.7749);
 *    const nearby = spatialUtils.dwithin('location', point, 1000, true);
 * 
 * 7. FIELD UTILITIES:
 *    import { fieldUtils } from 'baasix';
 *    const fields = fieldUtils.getFlattenedFields('users');
 *    const validation = fieldUtils.validateRequiredFields('users', data);
 * 
 * 8. IMPORT/EXPORT:
 *    import { importUtils } from 'baasix';
 *    const data = importUtils.parseCSV(fileBuffer);
 *    const csv = importUtils.exportToCSV(users, ['id', 'email']);
 * 
 * 9. SCHEMA VALIDATION:
 *    import { schemaValidator } from 'baasix';
 *    const result = schemaValidator.validateSchemaBeforeCreate('users', schema);
 * 
 * 10. CACHED OPERATIONS:
 *     import { getCacheService } from 'baasix';
 *     const cacheService = getCacheService();
 * 
 * 11. DATABASE SEEDING:
 *     import { seedUtility } from 'baasix';
 *     await seedUtility.seedCollection({ collection: 'users', data: [...] });
 * 
 * 12. WORKFLOW ACCESS CONTROL:
 *     import { checkWorkflowRoleAccess, fetchWorkflowForExecution } from 'baasix';
 *     const workflow = await fetchWorkflowForExecution(workflowId, true);
 *     const hasAccess = checkWorkflowRoleAccess(workflow, req.accountability);
 * 
 * 13. ENVIRONMENT VARIABLES:
 *     import { env } from 'baasix';
 *     const dbUrl = env.get('DATABASE_URL');
 *     const isMultiTenant = env.get('MULTI_TENANT') === 'true';
 * 
 * 14. ERROR HANDLING:
 *     import { APIError } from 'baasix';
 *     throw new APIError('Not found', 404);
 */

