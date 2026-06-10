/**
 * Relation Path Resolver
 *
 * Resolves nested relation paths (e.g., "userRoles.role.name") into table joins
 * and column references for use in WHERE clauses.
 *
 */

import { SQL, sql, eq, aliasedTable } from 'drizzle-orm';
import { schemaManager } from './schemaManager.js';
import { relationBuilder } from './relationUtils.js';
import type { JoinDefinition, ResolvedPath } from '../types/index.js';

// Re-export types for backward compatibility
export type { JoinDefinition, ResolvedPath };

/**
 * A valid SQL identifier segment: starts with a letter/underscore, then
 * letters/digits/underscores only. This is the allowlist that prevents a crafted
 * path segment (containing `"`, spaces, parentheses, etc.) from breaking out of
 * identifier quoting when columnPath is later interpolated via sql.raw.
 */
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isSafeIdentifier(segment: string): boolean {
  return typeof segment === 'string' && SAFE_IDENTIFIER.test(segment);
}

/**
 * True when every dot-separated segment of a field path is a safe SQL identifier.
 * Use to validate field/group-by names before they reach any sql.raw interpolation.
 */
export function isSafeFieldPath(fieldPath: string): boolean {
  if (typeof fieldPath !== 'string' || fieldPath.length === 0) return false;
  return fieldPath.split('.').every(isSafeIdentifier);
}

/** A resolution result that the caller will skip (no column, no raw path). */
const UNRESOLVED: Omit<ResolvedPath, 'finalTable' | 'finalAlias'> = {
  column: null,
  columnPath: null as any,
  joins: [],
};

/**
 * Resolve a relation path into joins and column reference
 *
 * Example: "userRoles.role.name" becomes:
 * - JOIN userRoles table
 * - JOIN roles table through userRoles
 * - Return roles.name column
 *
 * SECURITY: every path segment is validated against SAFE_IDENTIFIER and the final
 * column must actually exist on the resolved table. An unsafe segment or an
 * unresolvable column yields a null column/columnPath so the caller skips the
 * condition — a crafted segment can never reach sql.raw.
 */
export function resolveRelationPath(
  basePath: string,
  baseTable: any,
  baseTableName: string,
  baseAlias?: string,
  forPermissionCheck?: boolean
): ResolvedPath {
  // Parse the path into segments
  const segments = basePath.split('.');

  // Reject any path with a non-identifier segment before it can reach sql.raw.
  if (segments.some(seg => !isSafeIdentifier(seg))) {
    console.warn(`[relationPathResolver] Rejected unsafe path segment in: ${basePath}`);
    return { ...UNRESOLVED, finalTable: baseTable, finalAlias: baseAlias || baseTableName };
  }

  // If no dots, it's a direct column — require the column to actually exist.
  if (segments.length === 1) {
    const columnName = segments[0];
    const column = baseTable[columnName];
    const alias = baseAlias || baseTableName;

    if (!column) {
      return { ...UNRESOLVED, finalTable: baseTable, finalAlias: alias };
    }

    return {
      column,
      columnPath: `${alias}.${columnName}`,
      joins: [],
      finalTable: baseTable,
      finalAlias: alias
    };
  }

  // Multi-segment path - need to resolve relations
  return resolveSegments(
    segments,
    baseTable,
    baseTableName,
    baseAlias || baseTableName,
    [],
    forPermissionCheck
  );
}

/**
 * Recursively resolve path segments
 */
function resolveSegments(
  segments: string[],
  currentTable: any,
  currentTableName: string,
  currentAlias: string,
  accumulatedJoins: JoinDefinition[],
  forPermissionCheck?: boolean
): ResolvedPath {
  // Base case: only one segment left — require the column to actually exist so a
  // crafted name can never be emitted as raw SQL.
  if (segments.length === 1) {
    const columnName = segments[0];
    const column = currentTable[columnName];

    if (!column) {
      return { ...UNRESOLVED, finalTable: currentTable, finalAlias: currentAlias };
    }

    return {
      column,
      columnPath: `"${currentAlias}"."${columnName}"`,
      joins: accumulatedJoins,
      finalTable: currentTable,
      finalAlias: currentAlias
    };
  }

  // Get the first segment (relation name)
  const relationName = segments[0];
  const remainingSegments = segments.slice(1);

  // Look up the relation metadata
  const associations = relationBuilder.getAssociations(currentTableName);
  if (!associations || !associations[relationName]) {
    console.warn(`[relationPathResolver] Relation '${relationName}' not found in '${currentTableName}'`);
    // Unknown relation — do NOT fall back to interpolating the raw dotted name as
    // a column (that was the injection vector). Skip the condition instead.
    return { ...UNRESOLVED, finalTable: currentTable, finalAlias: currentAlias };
  }

  const relation = associations[relationName];
  const relationType = relation.type;
  const targetTableName = relation.model;

  // Get the target table
  const targetTable = schemaManager.getTable(targetTableName);
  if (!targetTable) {
    console.warn(`[relationPathResolver] Target table '${targetTableName}' not found`);
    return { ...UNRESOLVED, finalTable: currentTable, finalAlias: currentAlias };
  }

  // Create a unique alias for the joined table
  const targetAlias = `${targetTableName}_${relationName}_${accumulatedJoins.length}`;

  // Create aliased table for Drizzle query builder
  const aliasedTargetTable = aliasedTable(targetTable, targetAlias);

  // Build the JOIN based on relation type
  let joinCondition: SQL;
  let conditionSQL: string;

  // Get current table reference
  // NOTE: currentTable is already aliased from previous iteration (if any)
  // Don't create a new alias - just use it directly
  const currentTableRef = currentTable;

  if (relationType === 'BelongsTo') {
    // BelongsTo: current table has foreign key pointing to target's primary key
    const foreignKey = relation.foreignKey || `${relationName}_Id`;
    const targetPK = schemaManager.getPrimaryKey(targetTableName) || 'id';

    // Build JOIN condition using Drizzle column references
    conditionSQL = `"${currentAlias}"."${foreignKey}" = "${targetAlias}"."${targetPK}"`;
    joinCondition = eq(currentTableRef[foreignKey], aliasedTargetTable[targetPK]);
  } else if (relationType === 'HasMany' || relationType === 'HasOne') {
    // HasMany/HasOne: target table has foreign key pointing to current's primary key
    const foreignKey = relation.foreignKey || `${currentTableName.toLowerCase()}_Id`;
    const currentPK = schemaManager.getPrimaryKey(currentTableName) || 'id';

    // Build JOIN condition using Drizzle column references
    conditionSQL = `"${targetAlias}"."${foreignKey}" = "${currentAlias}"."${currentPK}"`;
    joinCondition = eq(aliasedTargetTable[foreignKey], currentTableRef[currentPK]);
  } else if (relationType === 'BelongsToMany') {
    // BelongsToMany: through a junction table
    // For permission checks on M2M relations, we need to join through the junction table
    // Current limitation: This treats M2M like HasMany which may not work for all cases
    // Full M2M join would require: current -> junction -> target (two joins)
    const junctionTable = relation.through;
    if (junctionTable) {
      // If junction table is defined, we should join through it
      // For now, log a warning - full implementation would add two joins
      console.warn(`[relationPathResolver] BelongsToMany via junction ${junctionTable} - using simplified join`);
    }

    const foreignKey = relation.foreignKey || `${currentTableName.toLowerCase()}_Id`;
    const currentPK = schemaManager.getPrimaryKey(currentTableName) || 'id';

    conditionSQL = `"${targetAlias}"."${foreignKey}" = "${currentAlias}"."${currentPK}"`;
    joinCondition = eq(aliasedTargetTable[foreignKey], currentTableRef[currentPK]);
  } else {
    console.warn(`[relationPathResolver] Unsupported relation type: ${relationType}`);
    return { ...UNRESOLVED, finalTable: currentTable, finalAlias: currentAlias };
  }

  // Add the join to the accumulated joins
  const newJoin: JoinDefinition = {
    table: aliasedTargetTable, // Use aliased table for Drizzle query builder
    tableName: targetTableName,
    alias: targetAlias,
    condition: joinCondition,
    conditionSQL: conditionSQL,
    // Use INNER JOIN for permission checks to ensure related records exist
    // Use LEFT JOIN otherwise to allow optional relations
    type: forPermissionCheck ? 'inner' : 'left'
  };

  const newJoins = [...accumulatedJoins, newJoin];

  // Recursively resolve the remaining segments
  return resolveSegments(
    remainingSegments,
    aliasedTargetTable, // Pass the aliased table for proper column references
    targetTableName,
    targetAlias,
    newJoins,
    forPermissionCheck
  );
}

/**
 * Check if a field path contains relations (has dots)
 */
export function isRelationPath(fieldPath: string): boolean {
  return fieldPath.includes('.');
}

/**
 * Apply joins to a Drizzle query builder
 *
 * Note: Drizzle doesn't support aliasing in joins directly with the leftJoin() API,
 * so we need to use raw SQL for the joins when aliases are needed.
 */
export function applyJoins(baseQuery: any, joins: JoinDefinition[]): any {
  let query = baseQuery;

  // For now, we'll return the joins to be applied as raw SQL in the query builder
  // This is because Drizzle's leftJoin() doesn't support table aliases
  return { query, joins };
}
