/**
 * Query Builder Module for Drizzle ORM
 *
 * This module provides query building utilities that convert Sequelize-style
 * filter/where objects into Drizzle ORM where conditions.
 *
 * Features:
 * - Convert filter objects to Drizzle where conditions
 * - Support AND/OR logical operators
 * - Handle nested conditions and relations
 * - Column qualification for joins
 * - Type casting support
 * - Pagination helpers
 *
 * RELATION PATH FILTERING:
 * - Relation path filters (e.g., "userRoles.role.name") ARE NOW SUPPORTED
 *   1. Parses relation paths into segments
 *   2. Recursively resolves each segment by looking up relation metadata
 *   3. Builds LEFT JOIN clauses dynamically
 *   4. Returns the final column reference for the WHERE clause
 *
 *   Example usage:
 *     conditions: {
 *       "userRoles.role.name": { in: ["admin", "user"] },
 *       "author.company.name": { eq: "ACME" }
 *     }
 *
 *   The query builder will automatically generate the necessary JOINs:
 *     LEFT JOIN userRoles_... ON ...
 *     LEFT JOIN roles_... ON ...
 *     LEFT JOIN companies_... ON ...
 *
 *   Joins are accumulated in ctx.joins array and must be applied by the caller.
 *
 * NOTES:
 * - Currently supports BelongsTo, HasMany, and HasOne relations
 * - BelongsToMany (many-to-many) uses simplified join (needs junction table support)
 * - Coordination with the two-query approach for HasMany sorting is handled by the caller
 */

import { SQL, and, or, sql } from 'drizzle-orm';
import { PgColumn } from 'drizzle-orm/pg-core';
import {
  applyOperator,
  OperatorContext,
  FilterValue,
  OPERATOR_MAP,
  ARRAY_OPERATORS,
  getArrayElementType
} from './filterOperators.js';
import { APIError } from './errorHandler.js';
import {
  resolveRelationPath,
  isRelationPath,
  JoinDefinition as RelationJoinDefinition
} from './relationPathResolver.js';
import type { FilterObject, QueryContext, PaginationOptions, PaginationMetadata } from '../types/index.js';

// Re-export types for backward compatibility
export type { FilterObject, QueryContext, PaginationOptions, PaginationMetadata };
// Re-export JoinDefinition for use by consumers
export type { RelationJoinDefinition as JoinDefinition };

/**
 * Check if a key represents a column name
 * Supports both $column$ format and plain column format
 */
function isColumnKey(key: string): boolean {
  // Check for $column$ format
  if (key.startsWith('$') && key.endsWith('$')) {
    return true;
  }
  
  // Check if it's not a logical operator or special key
  const reservedKeys = ['AND', 'OR', 'cast'];
  if (reservedKeys.includes(key)) {
    return false;
  }
  
  // Check if key is an operator name
  if (key in OPERATOR_MAP) {
    return false;
  }
  
  return true;
}

/**
 * Extract column name from key (with or without $ delimiters)
 */
function extractColumnName(key: string): string {
  if (key.startsWith('$') && key.endsWith('$')) {
    return key.slice(1, -1); // Remove $ from start and end
  }
  return key;
}

/**
 * Get qualified field name for SQL
 * Handles both direct fields and relational paths
 */
function getQualifiedField(field: string, ctx: QueryContext): string {
  const rawField = extractColumnName(field);
  
  if (ctx.tableName && !rawField.includes('.')) {
    // Special handling for ID field
    if (rawField === 'id') {
      return `${ctx.tableName}.id`;
    }
    
    return `${ctx.tableName}.${rawField}`;
  }
  
  return rawField;
}

/**
 * Get column from schema
 *
 * NOTE: This function only works for direct columns on the main table.
 * For relation paths like "userRoles.role.name", it will return null
 * because the field doesn't exist in the main table's schema.
 * See KNOWN LIMITATIONS in the module header for details.
 */
function getColumn(fieldName: string, ctx: QueryContext): PgColumn | null {
  if (!ctx.schema) return null;

  const cleanField = extractColumnName(fieldName);
  const column = ctx.schema[cleanField];

  return column || null;
}

/**
 * Process a single condition (field with operators)
 */
function processFieldCondition(
  fieldName: string,
  value: any,
  ctx: QueryContext
): SQL | null {
  const cleanFieldName = extractColumnName(fieldName);

  // Check if this is a relation path (contains dots)
  if (isRelationPath(cleanFieldName) && ctx.table && ctx.tableName) {
    // Resolve the relation path to get joins and final column
    const resolved = resolveRelationPath(
      cleanFieldName,
      ctx.table,
      ctx.tableName
    );

    // Add the joins to the context
    if (ctx.joins && resolved.joins.length > 0) {
      ctx.joins.push(...resolved.joins);
    }

    // Fail closed on an unresolvable relation path. Skipping the condition
    // would drop it from the WHERE clause and widen the result set — in a
    // permission condition that silently grants access to every row.
    if (!resolved.column && !resolved.columnPath) {
      throw new APIError(
        `Could not resolve relation path "${cleanFieldName}" in filter.`,
        400,
        { field: cleanFieldName }
      );
    }

    // Use the resolved column from aliased table
    // use Drizzle column reference, not raw SQL

    // Simple equality if value is primitive
    if (typeof value !== 'object' || value === null || value instanceof Date || Array.isArray(value)) {
      return applyOperator('eq', {
        column: resolved.column,
        fieldName: resolved.columnPath,
        // Pass a dummy tableName to trigger raw SQL path for relation filters
        // This is needed to bypass Drizzle's type mappers for date values
        tableName: 'relation',
        schemaTable: resolved.finalTable
      }, value);
    }

    // Extract cast type if present
    const castType = value.cast;

    // Process each operator in the value object
    const conditions: SQL[] = [];

    for (const [operatorName, operatorValue] of Object.entries(value)) {
      if (operatorName === 'cast') continue; // Skip cast property

      const condition = applyOperator(operatorName, {
        column: resolved.column,
        fieldName: resolved.columnPath,
        // Pass a dummy tableName to trigger raw SQL path for relation filters
        // This is needed to bypass Drizzle's type mappers for date values
        tableName: 'relation',
        schemaTable: resolved.finalTable
      }, operatorValue as FilterValue, castType);

      if (condition) {
        conditions.push(condition);
      }
    }

    // Combine multiple operators on same field with AND
    if (conditions.length === 0) return null;
    if (conditions.length === 1) return conditions[0];

    return and(...conditions) || null;
  }

  // Not a relation path - handle as direct column
  const qualifiedField = getQualifiedField(fieldName, ctx);
  const column = getColumn(fieldName, ctx);

  if (!column) {
    // Fail closed when we have a schema to check against: a misspelled field
    // would otherwise drop the condition and widen the result set, which in a
    // permission condition silently grants access to every row.
    if (ctx.schema) {
      const availableColumns = Object.keys(ctx.schema).filter(k => !k.startsWith('_'));
      throw new APIError(
        `Column not found for field "${fieldName}" in filter.`,
        400,
        { field: fieldName, availableColumns: availableColumns.slice(0, 20) }
      );
    }
    // No schema to validate against — cannot distinguish a typo from a field
    // this context legitimately cannot see, so preserve the existing behaviour.
    console.warn(`Column not found for field: ${fieldName} (no schema provided)`);
    return null;
  }

  // Simple equality if value is primitive
  if (typeof value !== 'object' || value === null || value instanceof Date || Array.isArray(value)) {
    // Direct value - use equality
    const operatorCtx: OperatorContext = {
      column,
      fieldName: qualifiedField,
      tableName: ctx.tableName,
      schemaTable: ctx.table
    };

    return applyOperator('eq', operatorCtx, value);
  }
  
  // Extract cast type if present
  const castType = value.cast;
  
  // Process each operator in the value object
  const conditions: SQL[] = [];
  
  for (const [operatorName, operatorValue] of Object.entries(value)) {
    if (operatorName === 'cast') continue; // Skip cast property
    
    const operatorCtx: OperatorContext = {
      column,
      fieldName: qualifiedField,
      tableName: ctx.tableName,
      schemaTable: ctx.table
    };
    
    // Get element type for array operators if available. Derived from the
    // field's declared Array_* type — there is no separate `elementType`
    // property on field definitions, so reading one always yielded undefined
    // and silently cast every array comparison to text[].
    let elementType: string | undefined;
    if (ARRAY_OPERATORS.has(operatorName) && ctx.schemaDefinition) {
      const fieldDef = ctx.schemaDefinition?.fields?.[fieldName];
      elementType = getArrayElementType(fieldDef?.type);
    }
    
    const condition = applyOperator(operatorName, operatorCtx, operatorValue as FilterValue, castType, elementType);
    
    if (condition) {
      conditions.push(condition);
    }
  }
  
  // Combine multiple operators on same field with AND
  if (conditions.length === 0) return null;
  if (conditions.length === 1) return conditions[0];
  
  return and(...conditions) || null;
}

/**
 * Process a single condition object recursively
 */
function processCondition(condition: FilterObject, ctx: QueryContext): SQL | null {
  // Handle AND operator
  if (condition.AND) {
    const subConditions = condition.AND
      .map(c => processCondition(c, ctx))
      .filter((c): c is SQL => c !== null);
    
    if (subConditions.length === 0) return null;
    if (subConditions.length === 1) return subConditions[0];
    
    return and(...subConditions) || null;
  }
  
  // Handle OR operator
  if (condition.OR) {
    const subConditions = condition.OR
      .map(c => processCondition(c, ctx))
      .filter((c): c is SQL => c !== null);
    
    if (subConditions.length === 0) return null;
    if (subConditions.length === 1) return subConditions[0];
    
    return or(...subConditions) || null;
  }
  
  // Process field conditions
  const fieldConditions: SQL[] = [];

  for (const [key, value] of Object.entries(condition)) {
    if (isColumnKey(key)) {
      // It's a field condition
      const fieldCondition = processFieldCondition(key, value, ctx);
      if (fieldCondition) {
        fieldConditions.push(fieldCondition);
      }
    } else if (key === 'AND' || key === 'OR') {
      // Already handled above
      continue;
    } else {
      // Unknown key, log warning
      console.warn(`Unknown filter key: ${key}`);
    }
  }
  
  // Combine all field conditions with AND
  if (fieldConditions.length === 0) return null;
  if (fieldConditions.length === 1) return fieldConditions[0];
  
  return and(...fieldConditions) || null;
}

/**
 * Main function: Convert Sequelize-style filter to Drizzle where condition
 * 
 * @param filter - Filter object (Sequelize-style)
 * @param ctx - Query context with table schema information
 * @returns Drizzle SQL where condition
 * 
 * @example
 * ```typescript
 * const filter = {
 *   age: { gt: 18 },
 *   status: { in: ['active', 'pending'] }
 * };
 * 
 * const where = drizzleWhere(filter, {
 *   table: usersTable,
 *   tableName: 'users',
 *   schema: usersTable
 * });
 * 
 * // Use in query:
 * const results = await db.select().from(usersTable).where(where);
 * ```
 */
export function drizzleWhere(filter: FilterObject | null | undefined, ctx: QueryContext): SQL | undefined {
  if (!filter || Object.keys(filter).length === 0) {
    return undefined;
  }
  
  const condition = processCondition(filter, ctx);
  return condition || undefined;
}

/**
 * Extract field paths from relational conditions
 * Used to determine which relations need to be included/joined
 */
export function extractFieldPathsFromRelConditions(relConditions: any): string[] {
  const fieldPaths = new Set<string>();
  const joinPaths = new Set<string>();
  
  function processRecursive(conditions: any, prefix: string = ''): void {
    if (!conditions || typeof conditions !== 'object') return;
    
    for (const [key, value] of Object.entries(conditions)) {
      if (isColumnKey(key)) {
        // It's a field condition
        const fieldName = extractColumnName(key);
        const fieldPath = prefix ? `${prefix}.${fieldName}` : fieldName;
        fieldPaths.add(fieldPath);
        
        // Add parent path for joins
        if (prefix) {
          joinPaths.add(prefix);
        }
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // It's a nested relation or object with operators
        const nestedPrefix = prefix ? `${prefix}.${key}` : key;
        
        // Add this path to join paths
        if (nestedPrefix) {
          joinPaths.add(nestedPrefix);
        }
        
        // Check if this level contains field conditions
        const hasFieldConditions = Object.keys(value).some((k) => isColumnKey(k));
        
        if (hasFieldConditions) {
          for (const [innerKey] of Object.entries(value)) {
            if (isColumnKey(innerKey)) {
              const fieldName = extractColumnName(innerKey);
              const fieldPath = nestedPrefix ? `${nestedPrefix}.${fieldName}` : fieldName;
              fieldPaths.add(fieldPath);
            }
          }
        }
        
        // Continue processing nested relations
        processRecursive(value, nestedPrefix);
      } else if (Array.isArray(value)) {
        // Handle arrays of conditions (e.g., AND, OR)
        value.forEach((item) => processRecursive(item, prefix));
      }
    }
  }
  
  processRecursive(relConditions);
  
  return Array.from(fieldPaths);
}

/**
 * Combine multiple filters with AND logic
 * Returns empty object instead of undefined for better type safety
 */
export function combineFilters(...filters: (FilterObject | null | undefined)[]): FilterObject {
  const validFilters = filters.filter((f): f is FilterObject => 
    f !== null && f !== undefined && Object.keys(f).length > 0
  );
  
  if (validFilters.length === 0) return {};
  if (validFilters.length === 1) return validFilters[0];
  
  return { AND: validFilters };
}

/**
 * Apply pagination to query
 * Supports both limit/offset and page/pageSize styles
 * When page is provided with limit, uses limit as pageSize and calculates offset
 */
export function applyPagination(options: PaginationOptions): { limit?: number; offset?: number } {
  // If page is provided, calculate offset based on page number
  // Use limit or pageSize as the page size
  if (options.page !== undefined) {
    const page = Math.max(1, options.page);
    const pageSize = options.limit ?? options.pageSize ?? 10;
    
    return {
      limit: pageSize,
      offset: (page - 1) * pageSize
    };
  }
  
  // Direct limit/offset style (no page number)
  if (options.limit !== undefined || options.offset !== undefined) {
    return {
      limit: options.limit,
      offset: options.offset || 0
    };
  }
  
  return {};
}

/**
 * Calculate pagination metadata
 */
export function calculatePaginationMetadata(
  total: number,
  options: PaginationOptions
): PaginationMetadata {
  const page = options.page || 1;
  const pageSize = options.pageSize || options.limit || 10;
  const pageCount = Math.ceil(total / pageSize);
  
  return {
    total,
    page,
    pageSize,
    pageCount,
    hasNextPage: page < pageCount,
    hasPreviousPage: page > 1
  };
}

/**
 * Helper to build WHERE clause from multiple filter sources
 * Useful for combining base filters, user filters, tenant filters, etc.
 */
export function buildWhereClause(
  ctx: QueryContext,
  ...filters: (FilterObject | null | undefined)[]
): SQL | undefined {
  const combined = combineFilters(...filters);
  return drizzleWhere(combined, ctx);
}

/**
 * Extract all field names from a filter object
 * Useful for permission validation
 */
export function extractFieldNamesFromFilter(filter: FilterObject): string[] {
  const fields = new Set<string>();
  
  function extract(obj: any): void {
    if (!obj || typeof obj !== 'object') return;
    
    for (const [key, value] of Object.entries(obj)) {
      if (isColumnKey(key)) {
        fields.add(extractColumnName(key));
      } else if (key === 'AND' || key === 'OR') {
        if (Array.isArray(value)) {
          value.forEach(extract);
        }
      } else if (typeof value === 'object') {
        extract(value);
      }
    }
  }
  
  extract(filter);

  return Array.from(fields);
}

/**
 * Max characters of concatenated row text fed to to_tsvector. PostgreSQL caps
 * the BUILT tsvector at 1048575 bytes; with worst-case per-lexeme + position
 * overhead, 150k input chars stays comfortably below it.
 */
export const TSVECTOR_INPUT_CHAR_CAP = 150000;

/**
 * PostgreSQL's snowball english stopword list (english.stop). The 'english'
 * text-search config strips these from both the indexed text and the query,
 * so a stopword-only search ("the") parses to an EMPTY tsquery and matches
 * nothing. Mirrored here to detect that case client-side.
 */
const ENGLISH_STOPWORDS = new Set([
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your',
  'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she',
  'her', 'hers', 'herself', 'it', 'its', 'itself', 'they', 'them', 'their',
  'theirs', 'themselves', 'what', 'which', 'who', 'whom', 'this', 'that',
  'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'a', 'an',
  'the', 'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while', 'of',
  'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down',
  'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any',
  'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's',
  't', 'can', 'will', 'just', 'don', 'should', 'now',
]);

/**
 * Pick the text-search config for a search query: 'english' (stemming +
 * stopword stripping) normally, but 'simple' when EVERY word is an english
 * stopword — otherwise the query would be empty and match nothing. A single
 * real word keeps 'english' (the stopwords are dropped from the query anyway).
 */
export function pickSearchConfig(searchQuery: string): 'english' | 'simple' {
  const words = searchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length > 0 && words.every(w => ENGLISH_STOPWORDS.has(w))) {
    return 'simple';
  }
  return 'english';
}

/**
 * Apply PostgreSQL full-text search to a query
 * Matches Sequelize implementation for compatibility
 *
 * @param tableName - Name of the table being searched
 * @param tableColumns - Column definitions from the table schema
 * @param searchQuery - The search string
 * @param searchFields - Fields to search in (optional, defaults to string fields)
 * @param sortByRelevance - Whether to sort by relevance score
 * @returns SQL condition for full-text search and optional order clause
 */
export function applyFullTextSearch(
  tableName: string,
  tableColumns: Record<string, any>,
  searchQuery: string,
  searchFields?: string[],
  sortByRelevance: boolean = false
): { searchCondition: SQL; orderClause?: SQL } {
  let searchableFields = searchFields;

  if (!searchableFields || searchableFields.length === 0) {
    // Default: every real column EXCEPT JSON/JSONB. Numeric/uuid/date columns
    // are legitimately searchable as text (numeric ids), but JSON payloads
    // (e.g. baasix_AuditLog.changes) make "search" match invisible internals
    // and can blow past to_tsvector's 1MB limit on huge rows — they are
    // opt-in via an explicit searchFields.
    // (Drizzle columns report dataType 'string'|'number'|'json'|… — the old
    // varchar/text substring check never matched anything, so every search
    // silently fell back to ALL columns including JSON.)
    searchableFields = Object.keys(tableColumns).filter((field) => {
      const dataType = tableColumns[field]?.dataType;
      return typeof dataType === 'string' && dataType !== 'json';
    });

    // If no columns matched (unexpected table shape), default to all fields
    if (searchableFields.length === 0) {
      searchableFields = Object.keys(tableColumns);
    }
  }

  // Create concatenated string of all searchable fields with proper table qualification
  // Use sql template instead of sql.raw for COALESCE expressions
  const concatParts = searchableFields.map((field) =>
    sql`COALESCE(${sql.raw(`"${tableName}"."${field}"`)}::text, '')`
  );

  // Build the concatenation using sql.join()
  const concatExpr = sql.join(concatParts, sql` || ' ' || `);

  // Guard to_tsvector's hard 1048575-byte limit on the BUILT tsvector: cap the
  // input text so even explicitly-searched huge columns (JSON blobs, long text)
  // can never 500 the query. 150k chars leaves ample headroom for the vector's
  // per-lexeme/position overhead in the worst case.
  const cappedExpr = sql`LEFT(${concatExpr}, ${sql.raw(String(TSVECTOR_INPUT_CHAR_CAP))})`;

  // Prepare the full-text search query with proper escaping
  // Replace spaces with :* & to match partial words
  const tsQuery = searchQuery.trim().replace(/\s+/g, ':* & ') + ':*';

  // Escape single quotes to prevent SQL injection
  const escapedTsQuery = tsQuery.replace(/'/g, "''");

  // 'english' normally; 'simple' when the query is stopwords-only (see pickSearchConfig)
  const config = sql.raw(`'${pickSearchConfig(searchQuery)}'`);

  // Build the full-text search condition using parameterized values
  const searchCondition = sql`to_tsvector(${config}, ${cappedExpr}) @@ to_tsquery(${config}, ${escapedTsQuery})`;

  let orderClause: SQL | undefined;

  // Apply sorting by relevance using ts_rank if sortByRelevance is true
  if (sortByRelevance) {
    orderClause = sql`ts_rank(to_tsvector(${config}, ${cappedExpr}), to_tsquery(${config}, ${escapedTsQuery})) DESC`;
  }

  return { searchCondition, orderClause };
}
