import { pgTable, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { eq, inArray, sql as drizzleSql } from 'drizzle-orm';
import argon2 from 'argon2';
import { getDatabase, getSqlClient, isPgVersionAtLeast } from './db.js';
import { mapJsonTypeToDrizzle, isRelationField } from './typeMapper.js';
import { relationBuilder, createForeignKeySQL } from './relationUtils.js';
import systemSchemaModule from './systemschema.js';
import env from './env.js';
import { validatePartitioning, normalizePartitioning, getPartitionKeyColumns, partitionName, tenantPartitionName, timeSuffixForStart, periodsToEnsure, parsePgTimestamp, PartitioningConfig } from './partitionUtils.js';
import { APIError } from './errorHandler.js';
import type { SchemaDefinition, IndexDefinition, AssociationDefinition } from '@baasix/types';
import type { PluginSchemaDefinition } from '../types/plugin.js';

const systemSchemas = systemSchemaModule.schemas;

/**
 * Internal association with additional properties used during schema processing.
 */
interface InternalAssociation extends Omit<AssociationDefinition, 'target'> {
  model: string;  // alias for target
  target?: string;
  otherKey?: string;
  polymorphic?: boolean;
}

/**
 * Extended schema definition for internal runtime use.
 * Adds optional properties that may be created/mutated during schema processing.
 */
interface InternalSchemaDefinition extends SchemaDefinition {
  /** Runtime-added options for multi-tenant index handling */
  options?: {
    paranoid?: boolean;
    timestamps?: boolean;
    indexes?: IndexDefinition[];
  };
  /** Runtime-extracted associations from fields */
  associations?: Record<string, InternalAssociation>;
}

// Use globalThis to ensure singleton across different module loading paths
declare global {
  var __baasix_schemaManager: SchemaManager | undefined;
}

/**
 * baasix_SchemaDefinition table schema
 * Note: This is duplicated from schema.ts to avoid circular dependency
 */
const baasixSchemaDefinition = pgTable('baasix_SchemaDefinition', {
  collectionName: text('collectionName').primaryKey().notNull(),
  schema: jsonb('schema').notNull(),
  createdAt: timestamp('createdAt', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).defaultNow(),
});

/**
 * Manages dynamic schema generation from JSON definitions
 */
export class SchemaManager {
  private static instance: SchemaManager;
  private schemas: Map<string, any> = new Map(); // Stores Drizzle table schemas
  private schemaDefinitions: Map<string, any> = new Map(); // Stores JSON schema definitions
  private relations: Map<string, any> = new Map();
  private initialized = false;
  private pluginSchemas: PluginSchemaDefinition[] = []; // Stores plugin schemas

  private constructor() {}

  /**
   * Register plugin schemas before initialization
   * This should be called before initialize() to ensure plugin schemas are created with system schemas
   */
  registerPluginSchemas(schemas: PluginSchemaDefinition[]): void {
    if (this.initialized) {
      console.warn('SchemaManager already initialized. Plugin schemas should be registered before initialize().');
    }
    this.pluginSchemas = schemas;
    console.log(`Registered ${schemas.length} plugin schema(s)`);
  }

  /**
   * Get all registered plugin schemas
   */
  getPluginSchemas(): PluginSchemaDefinition[] {
    return this.pluginSchemas;
  }

  /**
   * Get singleton instance
   */
  static getInstance(): SchemaManager {
    // Use globalThis to ensure singleton across different module loading paths
    if (!globalThis.__baasix_schemaManager) {
      globalThis.__baasix_schemaManager = new SchemaManager();
    }
    return globalThis.__baasix_schemaManager;
  }

  /**
   * Initialize schema manager by loading all schemas from database
   * Flow matches Sequelize implementation:
   * 1. Ensure SchemaDefinition table exists
   * 2. Ensure system schemas are in SchemaDefinition table
   * 3. Create tables for schemas that need syncing
   * 4. Load all schemas
   * 5. Seed database if empty
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      console.log('SchemaManager already initialized.');
      return;
    }

    console.log('Initializing Schema Manager...');

    try {
      // Step 0: Enable required PostgreSQL extensions
      await this.enablePostgresExtensions();
      
      // Step 1: Ensure baasix_SchemaDefinition table exists
      await this.ensureSchemaDefinitionTable();

      // Step 1.5: Heal non-canonical enum type casing ("Enum"/"enum") in stored definitions
      await this.normalizeEnumTypeCasing();

      // Step 2: Ensure system schemas are in the table
      const needSyncing = await this.ensureSystemSchemas();
      
      // Step 3: Create/sync tables for schemas that need it
      if (needSyncing.length > 0) {
        console.info('Need to sync the following schemas:', needSyncing);
        await this.loadAndCreateAllSchemas(needSyncing);
      } else {
        console.info('No system schemas need syncing.');
      }
      
      // Step 4: Load all schemas into memory (pass needSyncing to skip unnecessary sync for unchanged schemas)
      await this.loadAllSchemas(needSyncing);

      // Step 5: Reconcile partitions (heal drift, pre-create time periods)
      await this.reconcilePartitions();

      this.initialized = true;
      console.log('Schema Manager initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Schema Manager:', error);
      throw error;
    }
  }

  /**
   * Enable required PostgreSQL extensions
   */
  private async enablePostgresExtensions(): Promise<void> {
    const sql = getSqlClient();
    
    try {
      // Enable pgcrypto for gen_random_uuid()
      await sql.unsafe('CREATE EXTENSION IF NOT EXISTS pgcrypto');
      console.log('PostgreSQL extension pgcrypto enabled');

      // Create baasix_generate_suid() function for Short Unique IDs
      // Generates a 21-character URL-safe string (like nanoid) using base64url alphabet
      await sql.unsafe(`
        CREATE OR REPLACE FUNCTION baasix_generate_suid(size int = 21)
        RETURNS text AS $$
        DECLARE
          id text := '';
          i int := 0;
          urlsafe_chars text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
          bytes bytea;
        BEGIN
          bytes := gen_random_bytes(size);
          WHILE i < size LOOP
            id := id || substr(urlsafe_chars, (get_byte(bytes, i) & 63) + 1, 1);
            i := i + 1;
          END LOOP;
          RETURN id;
        END;
        $$ LANGUAGE plpgsql VOLATILE;
      `);
      console.log('PostgreSQL function baasix_generate_suid created');

      // Enable PostGIS if configured
      if (env.get('DATABASE_POSTGIS') === 'true') {
        await sql.unsafe('CREATE EXTENSION IF NOT EXISTS postgis');
        console.log('PostgreSQL extension postgis enabled');
      }

      // Enable pgvector if configured
      if (env.get('DATABASE_VECTOR') === 'true') {
        await sql.unsafe('CREATE EXTENSION IF NOT EXISTS vector');
        console.log('PostgreSQL extension vector (pgvector) enabled');
      }
    } catch (error) {
      console.error('Failed to enable PostgreSQL extensions:', error);
      throw error;
    }
  }

  /**
   * Ensure baasix_SchemaDefinition table exists
   */
  private async ensureSchemaDefinitionTable(): Promise<void> {
    const sql = getSqlClient();
    
    // Check if table exists
    const result = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'baasix_SchemaDefinition'
      )
    `;

    if (!result[0].exists) {
      console.log('Creating baasix_SchemaDefinition table...');
      
      await sql`
        CREATE TABLE "baasix_SchemaDefinition" (
          "collectionName" TEXT PRIMARY KEY NOT NULL,
          schema JSONB NOT NULL,
          "createdAt" TIMESTAMPTZ DEFAULT NOW(),
          "updatedAt" TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      console.log('SchemaDefinition table created.');
    }
  }

  /**
   * Ensure system schemas and plugin schemas are in the baasix_SchemaDefinition table
   * Returns list of schemas that need syncing
   */
  private async ensureSystemSchemas(): Promise<string[]> {
    const db = getDatabase();
    const needUpdate: string[] = [];

    // Combine system schemas with plugin schemas
    const allSchemas = [
      ...systemSchemas,
      ...this.pluginSchemas.map(ps => ({
        collectionName: ps.collectionName,
        schema: ps.schema
      }))
    ];

    for (const schemaData of allSchemas) {
      // Prepare schema with timestamp fields added if timestamps: true
      // Shallow clone: only spread top-level and fields (the only mutated property)
      const schemaToStore: any = { ...schemaData.schema, fields: { ...(schemaData.schema as any).fields } };
      if (schemaToStore.timestamps !== false) {
        // Add createdAt and updatedAt fields to schema definition if not already present
        if (!schemaToStore.fields.createdAt) {
          schemaToStore.fields.createdAt = { 
            type: "DateTime", 
            allowNull: true, 
            SystemGenerated: "true",
            defaultValue: { type: "NOW" }
          };
        }
        if (!schemaToStore.fields.updatedAt) {
          schemaToStore.fields.updatedAt = { 
            type: "DateTime", 
            allowNull: true, 
            SystemGenerated: "true",
            defaultValue: { type: "NOW" }
          };
        }
      }
      // Add deletedAt if paranoid mode
      if (schemaToStore.paranoid && !schemaToStore.fields.deletedAt) {
        schemaToStore.fields.deletedAt = { 
          type: "DateTime", 
          allowNull: true, 
          SystemGenerated: "true"
        };
      }

      // Check if schema already exists
      const existing = await db
        .select()
        .from(baasixSchemaDefinition)
        .where(eq(baasixSchemaDefinition.collectionName, schemaData.collectionName))
        .limit(1);

      if (existing.length === 0) {
        // Insert new schema
        await db.insert(baasixSchemaDefinition).values({
          collectionName: schemaData.collectionName,
          schema: schemaToStore as any,
        });
        console.log(`Added system schema: ${schemaData.collectionName}`);
        needUpdate.push(schemaData.collectionName);
      } else {
        // Compare and update if needed (add new fields, check modified fields, and sync schema-level properties)
        const existingSchema = existing[0].schema as any;
        let hasChanges = false;

        // Ensure existingSchema.fields exists
        if (!existingSchema.fields) {
          existingSchema.fields = {};
        }

        // Helper function to normalize schema for comparison
        // Removes SystemGenerated field which can differ between code ("true") and db (true)
        const normalizeForComparison = (obj: any): any => {
          if (obj === null || typeof obj !== 'object') return obj;
          if (Array.isArray(obj)) {
            return obj.map(normalizeForComparison);
          }
          const result: any = {};
          for (const [key, value] of Object.entries(obj)) {
            if (key === 'SystemGenerated') continue; // Skip this field for comparison
            result[key] = normalizeForComparison(value);
          }
          return result;
        };

        // Helper function for deep equality comparison (ignores property order)
        const deepEqual = (a: any, b: any): boolean => {
          if (a === b) return true;
          if (a == null || b == null) return a === b;
          if (typeof a !== typeof b) return false;
          if (typeof a !== 'object') return a === b;
          
          if (Array.isArray(a) !== Array.isArray(b)) return false;
          
          if (Array.isArray(a)) {
            if (a.length !== b.length) return false;
            // For arrays, compare each element
            // Sort arrays of objects by 'name' field for stable comparison
            const sortKey = (item: any) => item?.name || JSON.stringify(item);
            const sortedA = [...a].sort((x, y) => String(sortKey(x)).localeCompare(String(sortKey(y))));
            const sortedB = [...b].sort((x, y) => String(sortKey(x)).localeCompare(String(sortKey(y))));
            return sortedA.every((item, i) => deepEqual(item, sortedB[i]));
          }
          
          // For objects, compare all keys regardless of order
          const keysA = Object.keys(a);
          const keysB = Object.keys(b);
          if (keysA.length !== keysB.length) return false;
          return keysA.every(key => deepEqual(a[key], b[key]));
        };

        // Check for new fields (fields in system schema but not in DB)
        const newFields = Object.keys(schemaToStore.fields || {}).filter(
          (field) => !existingSchema.fields[field]
        );

        if (newFields.length > 0) {
          for (const field of newFields) {
            existingSchema.fields[field] = schemaToStore.fields[field];
          }
          hasChanges = true;
          console.log(`[SCHEMA DIFF] ${schemaData.collectionName} new fields:`, newFields);
        }

        // Check for modified fields (existing fields with changed definitions)
        const modifiedFields: string[] = [];
        for (const fieldName of Object.keys(schemaToStore.fields || {})) {
          if (existingSchema.fields[fieldName]) {
            // Field exists in both - check if definition changed (normalize to ignore SystemGenerated differences)
            const normalizedExisting = normalizeForComparison(existingSchema.fields[fieldName]);
            const normalizedNew = normalizeForComparison(schemaToStore.fields[fieldName]);
            if (!deepEqual(normalizedExisting, normalizedNew)) {
              existingSchema.fields[fieldName] = schemaToStore.fields[fieldName];
              modifiedFields.push(fieldName);
              hasChanges = true;
            }
          }
        }

        if (modifiedFields.length > 0) {
          console.log(`[SCHEMA DIFF] ${schemaData.collectionName} modified fields:`, modifiedFields);
        }

        // Note: We intentionally do NOT remove fields that exist in DB but not in system schema
        // This preserves user data and allows for gradual migrations

        // Sync structural schema-level properties (indexes, name) from system schema
        // These are enforced from code and should not be user-modified
        const structuralProps = ['indexes', 'name'];
        for (const prop of structuralProps) {
          // Normalize both values before comparison to ignore SystemGenerated differences
          const normalizedExisting = normalizeForComparison(existingSchema[prop]);
          const normalizedNew = normalizeForComparison(schemaToStore[prop]);
          if (schemaToStore[prop] !== undefined && !deepEqual(normalizedExisting, normalizedNew)) {
            console.log(`[SCHEMA DIFF] ${schemaData.collectionName} property '${prop}' differs:`, {
              existing: existingSchema[prop],
              new: schemaToStore[prop]
            });
            existingSchema[prop] = schemaToStore[prop];
            hasChanges = true;
          }
        }

        // User-configurable properties (timestamps, paranoid, usertrack, sortEnabled)
        // Only set these if they don't exist in the DB yet - preserve user changes
        const userConfigurableProps = ['timestamps', 'paranoid', 'usertrack', 'sortEnabled'];
        for (const prop of userConfigurableProps) {
          // Only set if the property doesn't exist in the existing schema (initial setup)
          if (existingSchema[prop] === undefined && schemaToStore[prop] !== undefined) {
            existingSchema[prop] = schemaToStore[prop];
            hasChanges = true;
            console.log(`Set initial ${prop} for ${schemaData.collectionName}`);
          }
        }

        if (hasChanges) {
          await db
            .update(baasixSchemaDefinition)
            .set({
              schema: existingSchema,
              updatedAt: new Date()
            } as any)
            .where(eq(baasixSchemaDefinition.collectionName, schemaData.collectionName));

          console.log(`Updated system schema: ${schemaData.collectionName}`);
          needUpdate.push(schemaData.collectionName);
        }
      }
    }

    console.log('System schemas ensured in SchemaDefinition table.');
    return needUpdate;
  }

  /**
   * Sort schemas by dependency order (topological sort)
   */
  private sortSchemasByDependencies(schemas: any[]): any[] {
    // Build dependency graph
    const dependencies = new Map<string, Set<string>>();
    const schemaMap = new Map<string, any>();

    for (const schemaDef of schemas) {
      const collectionName = schemaDef.collectionName;
      schemaMap.set(collectionName, schemaDef);
      dependencies.set(collectionName, new Set());

      // Find all BelongsTo relations (foreign key dependencies)
      const schema = schemaDef.schema as any;
      if (schema.fields) {
        for (const [fieldName, fieldSchema] of Object.entries(schema.fields)) {
          const fs = fieldSchema as any;
          if (fs.relType === 'BelongsTo' && fs.target && fs.target !== collectionName) {
            dependencies.get(collectionName)!.add(fs.target);
          }
        }
      }
    }

    // Topological sort using Kahn's algorithm
    const sorted: any[] = [];
    const inDegree = new Map<string, number>();
    const queue: string[] = [];

    // Calculate in-degrees (number of dependencies for each table)
    for (const [node, deps] of dependencies) {
      inDegree.set(node, deps.size);
    }

    // Debug: Log dependencies
    console.log('Dependencies map:');
    for (const [node, deps] of dependencies) {
      if (deps.size > 0) {
        console.log(`  ${node} depends on: [${Array.from(deps).join(', ')}]`);
      }
    }

    // Find nodes with no dependencies (in-degree = 0)
    for (const [node, degree] of inDegree) {
      if (degree === 0) {
        queue.push(node);
      }
    }

    console.log('Starting with tables that have no dependencies:', queue.join(', '));

    // Process queue
    while (queue.length > 0) {
      const node = queue.shift()!;
      const schemaDef = schemaMap.get(node);
      if (schemaDef) {
        sorted.push(schemaDef);
      }

      // Reduce in-degree for nodes that depend on this one
      for (const [otherNode, deps] of dependencies) {
        if (deps.has(node)) {
          const newDegree = (inDegree.get(otherNode) || 0) - 1;
          inDegree.set(otherNode, newDegree);
          if (newDegree === 0) {
            queue.push(otherNode);
          }
        }
      }
    }

    // If sorted length != schemas length, there's a circular dependency
    // In that case, just return original order and let FK constraints be added later
    if (sorted.length !== schemas.length) {
      console.info('Circular dependency detected in schemas, using original order');
      return schemas;
    }

    return sorted;
  }

  /**
   * Load and create tables for specific schemas
   */
  private async loadAndCreateAllSchemas(needSyncing: string[]): Promise<void> {
    const db = getDatabase();

    const schemas = await db
      .select()
      .from(baasixSchemaDefinition)
      .where(inArray(baasixSchemaDefinition.collectionName, needSyncing));

    // Sort schemas by dependency order to ensure referenced tables exist first
    const sortedSchemas = this.sortSchemasByDependencies(schemas);
    console.log('Schema creation order:', sortedSchemas.map(s => s.collectionName).join(', '));

    // First pass: Create all tables and models without FK constraints
    for (const schemaDef of sortedSchemas) {
      await this.createOrUpdateModel(
        schemaDef.collectionName,
        schemaDef.schema as any
      );

      // Create table using raw SQL (FK constraints will be added in second pass)
      await this.createTableFromSchema(schemaDef.collectionName, schemaDef.schema as any, true);
    }

    // Second pass: Add foreign key constraints
    console.log('Adding foreign key constraints...');
    for (const schemaDef of sortedSchemas) {
      await this.ensureForeignKeyConstraints(schemaDef.collectionName, schemaDef.schema as any);
    }

    console.log('All schemas loaded, models created/updated.');
  }

  /**
   * Normalize legacy Sequelize schemas - add default values for timestamp fields
   * and update DB column defaults if missing
   */
  /**
   * One-shot idempotent repair for enum fields written by older SDK typings
   * and MCP clients: rewrites type "Enum"/"enum" to the canonical "ENUM" and
   * unwraps values stored as { values: [...] } to a plain array. Case-sensitive
   * consumers (OpenAPI generation, admin app field/inline editors, filter
   * builders) only recognize the canonical shape.
   */
  private async normalizeEnumTypeCasing(): Promise<void> {
    const sql = getSqlClient();
    try {
      const result = await sql`
        UPDATE "baasix_SchemaDefinition" s
        SET schema = jsonb_set(s.schema, '{fields}', (
          SELECT jsonb_object_agg(
            f.key,
            CASE
              WHEN lower(f.value->>'type') = 'enum' AND jsonb_typeof(f.value->'values'->'values') = 'array'
                THEN jsonb_set(jsonb_set(f.value, '{type}', '"ENUM"'), '{values}', f.value->'values'->'values')
              WHEN lower(f.value->>'type') = 'enum' AND f.value->>'type' <> 'ENUM'
                THEN jsonb_set(f.value, '{type}', '"ENUM"')
              ELSE f.value
            END
          )
          FROM jsonb_each(s.schema->'fields') f
        ))
        WHERE jsonb_typeof(s.schema->'fields') = 'object'
          AND EXISTS (
            SELECT 1 FROM jsonb_each(s.schema->'fields') f
            WHERE lower(f.value->>'type') = 'enum'
              AND (f.value->>'type' <> 'ENUM' OR jsonb_typeof(f.value->'values'->'values') = 'array')
          )
      `;
      if (result.count > 0) {
        console.log(`Normalized enum field definitions in ${result.count} schema definition(s)`);
      }
    } catch (error: any) {
      console.warn('Enum field normalization skipped:', error.message);
    }
  }

  private async normalizeLegacySchema(collectionName: string, schema: any): Promise<any> {
    const sql = getSqlClient();
    const db = getDatabase();
    let schemaUpdated = false;
    const normalizedSchema = { ...schema, fields: { ...schema.fields } };

    // Check timestamp fields if timestamps are enabled (default: true)
    if (schema.timestamps !== false) {
      // Normalize createdAt field
      if (normalizedSchema.fields.createdAt && !normalizedSchema.fields.createdAt.defaultValue) {
        normalizedSchema.fields.createdAt = {
          ...normalizedSchema.fields.createdAt,
          defaultValue: { type: "NOW" }
        };
        schemaUpdated = true;
        
        // Also update DB column default
        try {
          await sql.unsafe(`ALTER TABLE "${collectionName}" ALTER COLUMN "createdAt" SET DEFAULT NOW()`);
          console.log(`Updated createdAt default value for ${collectionName}`);
        } catch (error) {
          // Column might not exist yet or already have default, ignore
        }
      }

      // Normalize updatedAt field
      if (normalizedSchema.fields.updatedAt && !normalizedSchema.fields.updatedAt.defaultValue) {
        normalizedSchema.fields.updatedAt = {
          ...normalizedSchema.fields.updatedAt,
          defaultValue: { type: "NOW" }
        };
        schemaUpdated = true;
        
        // Also update DB column default
        try {
          await sql.unsafe(`ALTER TABLE "${collectionName}" ALTER COLUMN "updatedAt" SET DEFAULT NOW()`);
          console.log(`Updated updatedAt default value for ${collectionName}`);
        } catch (error) {
          // Column might not exist yet or already have default, ignore
        }
      }
    }

    // Update schema definition in database if changed
    if (schemaUpdated) {
      await db
        .update(baasixSchemaDefinition)
        .set({ schema: normalizedSchema as any })
        .where(eq(baasixSchemaDefinition.collectionName, collectionName));
      console.log(`Normalized legacy schema definition for ${collectionName}`);
    }

    return normalizedSchema;
  }

  /**
   * Load all schemas from database into memory
   * @param schemasNeedingSync - List of schema names that need table sync (from ensureSystemSchemas)
   *                             If empty, skip expensive sync operations for faster startup
   */
  private async loadAllSchemas(schemasNeedingSync: string[] = []): Promise<void> {
    const db = getDatabase();
    const sql = getSqlClient();
    const needsSyncSet = new Set(schemasNeedingSync);
    const skipSync = schemasNeedingSync.length === 0;

    const schemaDefinitions = await db
      .select()
      .from(baasixSchemaDefinition);

    console.log(`Found ${schemaDefinitions.length} schema definitions`);
    
    // Get list of existing tables in one query (for fast lookup)
    const existingTables = await sql`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public'
    `;
    const existingTableSet = new Set(existingTables.map((t: any) => t.table_name));
    
    if (skipSync) {
      console.log('No schema changes detected, using fast startup path');
    }

    // Sort schemas by dependency order
    const sortedSchemas = this.sortSchemasByDependencies(schemaDefinitions);

    // Schemas that need FK constraint sync (only those that were synced)
    const schemasForFKSync: typeof sortedSchemas = [];

    // First pass: Create all tables and models without FK constraints
    for (const schemaDef of sortedSchemas) {
      const tableExists = existingTableSet.has(schemaDef.collectionName);
      
      // Determine if this schema needs table sync:
      // 1. If it was explicitly marked as needing sync
      // 2. If the table doesn't exist yet (new schema)
      // 3. If skipSync is false (there were schema changes, so sync all)
      const needsSync = needsSyncSet.has(schemaDef.collectionName) || 
                        !tableExists || 
                        !skipSync;
      
      let normalizedSchema = schemaDef.schema as any;
      
      // Only run legacy normalization if sync is needed (skips DB queries on fast path)
      if (needsSync) {
        normalizedSchema = await this.normalizeLegacySchema(
          schemaDef.collectionName,
          schemaDef.schema as any
        );
        // Update the schemaDef with normalized schema for subsequent operations
        schemaDef.schema = normalizedSchema;
      }
      
      // Store JSON schema definition for later use (e.g., in getPrimaryKey)
      this.schemaDefinitions.set(schemaDef.collectionName, schemaDef);

      await this.createOrUpdateModel(
        schemaDef.collectionName,
        normalizedSchema
      );

      if (needsSync) {
        // Create table if it doesn't exist (FK constraints will be added in second pass)
        await this.createTableFromSchema(
          schemaDef.collectionName,
          normalizedSchema,
          true
        );
        schemasForFKSync.push(schemaDef);
      }
    }

    // Second pass: Add foreign key constraints only for schemas that were synced
    if (schemasForFKSync.length > 0) {
      console.log(`Adding foreign key constraints for ${schemasForFKSync.length} schemas...`);
      for (const schemaDef of schemasForFKSync) {
        await this.ensureForeignKeyConstraints(schemaDef.collectionName, schemaDef.schema as any);
      }
    } else {
      console.log('Skipping foreign key constraint check (no schemas need sync)');
    }

    // Check if we need to seed the database
    await this.checkAndSeedDatabase();
  }

  /**
   * Sync table columns with schema definition (add missing columns)
   */
  private async syncTableColumns(collectionName: string, schema: any): Promise<void> {
    const sql = getSqlClient();

    // Get existing columns in the table (include is_nullable and column_default for constraint syncing)
    const existingColumns = await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = ${collectionName}
    `;

    const existingColumnNames = existingColumns.map((col: any) => col.column_name);
    const existingColumnMap = new Map(existingColumns.map((col: any) => [col.column_name, col]));

    // Check each field in schema
    for (const [fieldName, fieldSchema] of Object.entries(schema.fields)) {
      const fs = fieldSchema as any;

      // Skip relation fields that don't have an explicit type,
      // or whose type is a relation type indicator (M2O, O2O, etc.) rather than a real column type
      const RELATION_TYPE_INDICATORS = ["M2O", "O2O", "O2M", "M2M"];
      if (fs.relType && (!fs.type || RELATION_TYPE_INDICATORS.includes(fs.type))) {
        // For BelongsTo relations, check if the foreign key column needs to be added
        if (fs.relType === 'BelongsTo') {
          const foreignKey = fs.foreignKey || `${fieldName}_Id`;
          if (!existingColumnNames.includes(foreignKey)) {
            // Column doesn't exist, add it via ensureForeignKeyConstraints
            continue;
          }
        }
        continue;
      }

      // Check if column exists
      if (!existingColumnNames.includes(fieldName)) {
        // Column is missing, add it
        const columnDef = this.buildColumnDefinition(fieldName, fs);
        if (columnDef) {
          // Extract just the type and constraints from columnDef (remove field name)
          const columnDefParts = columnDef.split(' ').slice(1).join(' '); // Remove first part which is field name
          try {
            // Use IF NOT EXISTS for safety in case of race conditions or schema query issues
            await sql.unsafe(`ALTER TABLE "${collectionName}" ADD COLUMN IF NOT EXISTS ${columnDef}`);
            console.log(`Added missing column ${fieldName} to ${collectionName}`);
            // Auto-create HNSW index for vector columns
            if (fs.type === 'Vector' || fs.type === 'HalfVec' || fs.type === 'SparseVec') {
              await this.createVectorIndex(collectionName, fieldName, fs.type);
            }
          } catch (error) {
            console.error(`Failed to add column ${fieldName} to ${collectionName}:`, error);
          }
        }
      } else {
        // Column exists — sync NOT NULL constraint if it changed
        const existingCol = existingColumnMap.get(fieldName);
        if (existingCol) {
          // --- Sync NOT NULL constraint ---
          const dbIsNullable = existingCol.is_nullable === 'YES';
          const schemaAllowNull = fs.allowNull !== false; // default is nullable (allowNull: true)

          if (dbIsNullable && !schemaAllowNull) {
            // Schema says NOT NULL but DB allows NULL → SET NOT NULL
            try {
              await sql.unsafe(`ALTER TABLE "${collectionName}" ALTER COLUMN "${fieldName}" SET NOT NULL`);
              console.log(`Set NOT NULL on column ${fieldName} in ${collectionName}`);
            } catch (error) {
              console.error(`Failed to set NOT NULL on column ${fieldName} in ${collectionName}:`, error);
            }
          } else if (!dbIsNullable && schemaAllowNull && !fs.primaryKey) {
            // Schema says nullable but DB has NOT NULL → DROP NOT NULL (skip primary keys)
            try {
              await sql.unsafe(`ALTER TABLE "${collectionName}" ALTER COLUMN "${fieldName}" DROP NOT NULL`);
              console.log(`Dropped NOT NULL on column ${fieldName} in ${collectionName}`);
            } catch (error) {
              console.error(`Failed to drop NOT NULL on column ${fieldName} in ${collectionName}:`, error);
            }
          }

          // --- Sync DEFAULT value ---
          const schemaDefault = this.getDefaultExpression(fs);
          const dbDefault = existingCol.column_default;

          // Skip SERIAL/auto-increment columns (their defaults are managed by sequences)
          const isSerialDefault = dbDefault && dbDefault.startsWith('nextval(');
          if (!isSerialDefault) {
            if (schemaDefault === null && dbDefault !== null) {
              // Schema has no default but DB has one → DROP DEFAULT
              try {
                await sql.unsafe(`ALTER TABLE "${collectionName}" ALTER COLUMN "${fieldName}" DROP DEFAULT`);
                console.log(`Dropped DEFAULT on column ${fieldName} in ${collectionName}`);
              } catch (error) {
                console.error(`Failed to drop DEFAULT on column ${fieldName} in ${collectionName}:`, error);
              }
            } else if (schemaDefault !== null) {
              // Compare: normalize DB default for comparison
              const normalizedDbDefault = dbDefault ? this.normalizeDefaultForComparison(dbDefault) : null;
              const normalizedSchemaDefault = this.normalizeDefaultForComparison(schemaDefault);

              if (normalizedDbDefault !== normalizedSchemaDefault) {
                // Default changed or was added → SET DEFAULT
                try {
                  await sql.unsafe(`ALTER TABLE "${collectionName}" ALTER COLUMN "${fieldName}" SET DEFAULT ${schemaDefault}`);
                  console.log(`Set DEFAULT ${schemaDefault} on column ${fieldName} in ${collectionName}`);
                } catch (error) {
                  console.error(`Failed to set DEFAULT on column ${fieldName} in ${collectionName}:`, error);
                }
              }
            }
          }
        }
      }
    }

    // Add timestamp columns if needed
    if (schema.timestamps !== false) {
      if (!existingColumnNames.includes('createdAt')) {
        try {
          await sql.unsafe(`ALTER TABLE "${collectionName}" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ DEFAULT NOW()`);
          console.log(`Added createdAt column to ${collectionName}`);
        } catch (error) {
          // Column might already exist due to race condition, ignore
        }
      }
      if (!existingColumnNames.includes('updatedAt')) {
        try {
          await sql.unsafe(`ALTER TABLE "${collectionName}" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ DEFAULT NOW()`);
          console.log(`Added updatedAt column to ${collectionName}`);
        } catch (error) {
          // Column might already exist due to race condition, ignore
        }
      }
    }

    // Add deletedAt column if paranoid mode is enabled
    if (schema.paranoid && !existingColumnNames.includes('deletedAt')) {
      try {
        await sql.unsafe(`ALTER TABLE "${collectionName}" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ`);
        console.log(`Added deletedAt column to ${collectionName}`);
      } catch (error) {
        // Column might already exist due to race condition, ignore
      }
    }
  }

  /**
   * Build the full CREATE TABLE statement for a schema, partition-aware via `schema.partitioning`.
   * Behavior-preserving for non-partitioned schemas: emits byte-identical SQL to the pre-partitioning
   * inline column-building loop.
   */
  private buildCreateTableSQL(tableName: string, schema: any): string | null {
    const partitionConfig = normalizePartitioning(schema.partitioning);
    const partitionKeys = partitionConfig ? getPartitionKeyColumns(partitionConfig) : [];
    const columns: string[] = [];
    let pkField: string | null = null;
    const inlineUniqueFields: string[] = [];

    for (const [fieldName, fieldSchema] of Object.entries(schema.fields)) {
      let fs = fieldSchema as any;

      if (fs.relType === 'BelongsTo') {
        const foreignKey = fs.foreignKey || `${fieldName}_Id`;
        const foreignKeyExists = foreignKey !== fieldName && Object.keys(schema.fields).includes(foreignKey);
        if (!foreignKeyExists && foreignKey !== fieldName) {
          const RELATION_TYPES_CT = ["M2O", "O2O", "O2M", "M2M"];
          const fkType = (fs.type && !RELATION_TYPES_CT.includes(fs.type)) ? fs.type : 'UUID';
          // PARTITION-AWARE: partition key columns must be NOT NULL; inline UNIQUE moves to composite
          const fkAllowNull = partitionKeys.includes(foreignKey) ? false : fs.allowNull;
          const fkUnique = partitionConfig ? false : fs.unique;
          if (partitionConfig && fs.unique) inlineUniqueFields.push(foreignKey);
          const columnDef = this.buildColumnDefinition(foreignKey, {
            type: fkType, allowNull: fkAllowNull, unique: fkUnique
          });
          if (columnDef) columns.push(columnDef);
        }
        const RELATION_INDICATORS_CT = ["M2O", "O2O", "O2M", "M2M"];
        if (!(foreignKey === fieldName && fs.type && !RELATION_INDICATORS_CT.includes(fs.type))) {
          continue;
        }
      }

      const RELATION_TYPE_IND = ["M2O", "O2O", "O2M", "M2M"];
      if (fs.relType && (!fs.type || RELATION_TYPE_IND.includes(fs.type))) continue;

      // PARTITION-AWARE: strip inline PRIMARY KEY / UNIQUE, force NOT NULL on partition keys
      if (partitionConfig) {
        if (fs.primaryKey) { pkField = fieldName; fs = { ...fs, primaryKey: false }; }
        if (fs.unique) { inlineUniqueFields.push(fieldName); fs = { ...fs, unique: false }; }
        if (partitionKeys.includes(fieldName) && fs.allowNull !== false) {
          fs = { ...fs, allowNull: false };
        }
      }

      const columnDef = this.buildColumnDefinition(fieldName, fs);
      if (columnDef) columns.push(columnDef);
    }

    if (schema.timestamps !== false) {
      if (!schema.fields.createdAt) {
        // PARTITION-AWARE: createdAt must be NOT NULL when it is the partition key
        columns.push(partitionKeys.includes('createdAt')
          ? '"createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()'
          : '"createdAt" TIMESTAMPTZ DEFAULT NOW()');
      }
      if (!schema.fields.updatedAt) {
        columns.push('"updatedAt" TIMESTAMPTZ DEFAULT NOW()');
      }
    }
    if (schema.paranoid && !schema.fields.deletedAt) {
      columns.push('"deletedAt" TIMESTAMPTZ');
    }
    if (columns.length === 0) return null;

    // PARTITION-AWARE: composite PK / UNIQUE constraints and PARTITION BY clause
    let partitionByClause = '';
    if (partitionConfig) {
      const quotedKeys = partitionKeys.map((k) => `"${k}"`).join(', ');
      if (pkField) {
        const pkCols = [pkField, ...partitionKeys.filter((k) => k !== pkField)].map((k) => `"${k}"`);
        columns.push(`PRIMARY KEY (${pkCols.join(', ')})`);
      }
      for (const uf of inlineUniqueFields) {
        columns.push(`UNIQUE ("${uf}", ${quotedKeys})`);
      }
      partitionByClause = partitionConfig.strategy === 'time'
        ? ` PARTITION BY RANGE ("${partitionConfig.timeField}")`
        : ` PARTITION BY LIST ("tenant_Id")`;
    }
    return `CREATE TABLE "${tableName}" (${columns.join(', ')})${partitionByClause}`;
  }

  /**
   * Create table from schema definition using raw SQL
   */
  private async createTableFromSchema(collectionName: string, schema: any, skipFKConstraints: boolean = false): Promise<void> {
    const sql = getSqlClient();

    // Check if table already exists
    const exists = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = ${collectionName}
      )
    `;

    if (exists[0].exists) {
      console.log(`Table ${collectionName} already exists, syncing schema changes`);
      // Sync missing columns with existing table
      await this.syncTableColumns(collectionName, schema);

      // Check/add foreign key constraints
      if (!skipFKConstraints) {
        await this.ensureForeignKeyConstraints(collectionName, schema);
      }

      // Sync indexes for existing tables
      if (schema.indexes && Array.isArray(schema.indexes)) {
        for (const index of schema.indexes) {
          await this.createIndex(collectionName, index);
        }
      }
      // Only ensure partitions when the table is PHYSICALLY partitioned. A stored schema
      // can claim partitioning over a plain table (mid-conversion crash, hand-edit) — calling
      // ensurePartitions there throws "X is not partitioned" and, on the startup path
      // (loadAllSchemas has no per-schema catch), would take initialize() down in a crash
      // loop and make the server unbootable. Guard + try/catch: warn and continue instead.
      try {
        // wantsPartitioning may itself throw on a corrupted stored config — treat as non-partitioned.
        let wantsPartitioning = false;
        try { wantsPartitioning = !!normalizePartitioning(schema?.partitioning); } catch { wantsPartitioning = false; }
        const physicallyPartitioned = await this.isTablePartitioned(collectionName);
        if (physicallyPartitioned === true) {
          await this.ensurePartitions(collectionName, schema);
        } else if (wantsPartitioning && physicallyPartitioned === false) {
          console.warn(`[partitioning] "${collectionName}" has a partitioning config but its table is ` +
            `not partitioned — skipping partition sync. PATCH /schemas/${collectionName} to convert it.`);
        }
      } catch (error) {
        console.warn(`[partitioning] ensurePartitions failed for existing table "${collectionName}" ` +
          `(config/physical drift?) — continuing:`, error);
      }
      return;
    }

    // Build the CREATE TABLE SQL. buildCreateTableSQL → normalizePartitioning THROWS on a
    // corrupted stored partitioning config; on the STARTUP path (loadAllSchemas has no
    // per-schema catch) that would propagate to initialize() and make the server unbootable.
    // Guard it so a bad config degrades to a non-partitioned create (logged) instead of a crash.
    // The API path is unaffected: updateModel runs validatePartitioning (which throws the
    // APIError to the caller) BEFORE reaching here, so any config that gets this far is valid.
    let createTableSQL: string | null;
    try {
      createTableSQL = this.buildCreateTableSQL(collectionName, schema);
    } catch (error) {
      console.error(`[partitioning] Invalid stored partitioning config for "${collectionName}"; ` +
        `creating it as a non-partitioned table:`, error);
      createTableSQL = this.buildCreateTableSQL(collectionName, { ...schema, partitioning: undefined });
    }
    if (!createTableSQL) {
      console.warn(`No columns to create for table ${collectionName}`);
      return;
    }
    const foreignKeyAssociations: Array<{fieldName: string, assoc: any}> = [];
    for (const [fieldName, fieldSchema] of Object.entries(schema.fields)) {
      const fs = fieldSchema as any;
      if (fs.relType === 'BelongsTo') foreignKeyAssociations.push({fieldName, assoc: fs});
    }

    try {
      await sql.unsafe(createTableSQL);
      console.log(`Created table: ${collectionName}`);

      await this.ensurePartitions(collectionName, schema);

      // Create foreign key constraints for BelongsTo relations (unless skipped)
      if (!skipFKConstraints && foreignKeyAssociations.length > 0) {
        await this.ensureForeignKeyConstraints(collectionName, schema);
      }

      // Create indexes if defined in schema
      if (schema.indexes && Array.isArray(schema.indexes)) {
        for (const index of schema.indexes) {
          await this.createIndex(collectionName, index);
        }
      }

      // Auto-create HNSW indexes for vector columns
      for (const [fieldName, fieldDef] of Object.entries(schema.fields || {})) {
        const fd = fieldDef as any;
        if (fd.type === 'Vector' || fd.type === 'HalfVec' || fd.type === 'SparseVec') {
          await this.createVectorIndex(collectionName, fieldName, fd.type);
        }
      }
    } catch (error) {
      console.error(`Failed to create table ${collectionName}:`, error);
    }
  }

  /** Idempotently create default/tenant/time partitions for a partitioned collection. */
  async ensurePartitions(
    collectionName: string,
    schema: any,
    opts: { tableName?: string; sqlClient?: any } = {}
  ): Promise<void> {
    const config = normalizePartitioning(schema.partitioning);
    if (!config) return;
    const sql = opts.sqlClient || getSqlClient();
    const table = opts.tableName || collectionName;

    await sql.unsafe(
      `CREATE TABLE IF NOT EXISTS "${partitionName(table, ['default'])}" PARTITION OF "${table}" DEFAULT`);

    if (config.strategy === 'time') {
      for (const p of periodsToEnsure(new Date(), config.interval, config.premake)) {
        await sql.unsafe(
          `CREATE TABLE IF NOT EXISTS "${partitionName(table, [p.suffix])}" PARTITION OF "${table}" ` +
          `FOR VALUES FROM ('${p.start}') TO ('${p.end}')`);
      }
      return;
    }

    const tenants = await sql`SELECT id FROM "baasix_Tenant"`;
    for (const t of tenants) {
      await this.ensureTenantPartition(table, config, String(t.id), sql);
    }
  }

  private async ensureTenantPartition(
    parentTable: string, config: PartitioningConfig, tenantId: string, sqlClient?: any
  ): Promise<void> {
    const sql = sqlClient || getSqlClient();
    const tName = tenantPartitionName(parentTable, tenantId); // validates UUID (DDL injection guard)
    if (config.strategy === 'tenant') {
      await sql.unsafe(
        `CREATE TABLE IF NOT EXISTS "${tName}" PARTITION OF "${parentTable}" FOR VALUES IN ('${tenantId}')`);
      return;
    }
    // tenant+time: the tenant partition is itself RANGE-partitioned by the time field
    await sql.unsafe(
      `CREATE TABLE IF NOT EXISTS "${tName}" PARTITION OF "${parentTable}" FOR VALUES IN ('${tenantId}') ` +
      `PARTITION BY RANGE ("${config.timeField}")`);
    await sql.unsafe(
      `CREATE TABLE IF NOT EXISTS "${partitionName(tName, ['default'])}" PARTITION OF "${tName}" DEFAULT`);
    for (const p of periodsToEnsure(new Date(), config.interval, config.premake)) {
      await sql.unsafe(
        `CREATE TABLE IF NOT EXISTS "${partitionName(tName, [p.suffix])}" PARTITION OF "${tName}" ` +
        `FOR VALUES FROM ('${p.start}') TO ('${p.end}')`);
    }
  }

  /** Create partitions for a new tenant across all tenant-partitioned collections. */
  async createPartitionsForTenant(tenantId: string): Promise<void> {
    for (const [name, defEntry] of this.schemaDefinitions) {
      const schema = (defEntry as any)?.schema ?? defEntry;
      let config: PartitioningConfig | null = null;
      try { config = normalizePartitioning(schema?.partitioning); } catch { continue; }
      if (!config || config.strategy === 'time') continue;
      // Config-vs-physical drift guard: a collection can have a partitioning config while its
      // table is still a plain (unpartitioned) relation — e.g. the DDL conversion hasn't run yet,
      // or the table was altered out-of-band. Partitions can't be created on a plain table; warn
      // and skip rather than throwing, so this drift doesn't fail unrelated tenant creation.
      // reconcilePartitions already warns about the same drift at startup.
      const partitioned = await this.isTablePartitioned(name);
      if (partitioned !== true) {
        console.warn(`[partitioning] "${name}" has a partitioning config but its table is ` +
          `${partitioned === null ? 'missing' : 'not partitioned'} — skipping partition creation ` +
          `for tenant ${tenantId}.`);
        continue;
      }
      try {
        await this.ensureTenantPartition(name, config, tenantId);
      } catch (error) {
        console.error(`[partitioning] Failed to create partition of "${name}" for tenant ${tenantId}:`, error);
        throw error; // fail the tenant creation — partitions must exist
      }
    }
  }

  /**
   * Drop a deleted tenant's partitions (irreversible bulk erase, per design).
   *
   * When a Drizzle delete `transaction` is provided, the DROP DDL runs THROUGH that
   * transaction (PG DDL is transactional), so a delete that later fails — 403/404, an
   * ON DELETE RESTRICT FK, etc. — rolls the drops back and the partitions survive.
   * Without a transaction it falls back to the pooled porsager client (auto-commit),
   * which is only used by non-transactional callers.
   */
  async dropPartitionsForTenant(tenantId: string, transaction?: any): Promise<void> {
    const sql = getSqlClient();
    // Drizzle tx exposes .execute(sql`…`); porsager pool exposes .unsafe(`…`).
    const runDDL = transaction
      ? (ddl: string) => transaction.execute(drizzleSql.raw(ddl))
      : (ddl: string) => sql.unsafe(ddl);
    for (const [name, defEntry] of this.schemaDefinitions) {
      const schema = (defEntry as any)?.schema ?? defEntry;
      let config: PartitioningConfig | null = null;
      try { config = normalizePartitioning(schema?.partitioning); } catch { continue; }
      if (!config || config.strategy === 'time') continue;
      const tName = tenantPartitionName(name, tenantId); // validates UUID
      await runDDL(`DROP TABLE IF EXISTS "${tName}" CASCADE`);
      console.log(`[partitioning] Dropped partition "${tName}" for deleted tenant ${tenantId}`);
    }
  }

  /** relkind check: null = table missing, true = partitioned parent, false = plain table. */
  async isTablePartitioned(tableName: string): Promise<boolean | null> {
    const sql = getSqlClient();
    const rows = await sql`
      SELECT relkind FROM pg_class
      WHERE relname = ${tableName} AND relnamespace = 'public'::regnamespace`;
    if (rows.length === 0) return null;
    return rows[0].relkind === 'p';
  }

  /** Ensure the full expected partition set exists for every partitioned collection. */
  async reconcilePartitions(): Promise<void> {
    for (const [name, defEntry] of this.schemaDefinitions) {
      const schema = (defEntry as any)?.schema ?? defEntry;
      let config: PartitioningConfig | null = null;
      try { config = normalizePartitioning(schema?.partitioning); } catch { continue; }
      if (!config) continue;
      try {
        const partitioned = await this.isTablePartitioned(name);
        if (partitioned === null) continue;
        if (partitioned === false) {
          console.warn(`[partitioning] "${name}" has a partitioning config but the table is not partitioned. ` +
            `Update the collection via PATCH /schemas/${name} to convert it.`);
          continue;
        }
        await this.ensurePartitions(name, schema);
        // Non-empty DEFAULT partitions signal rows that missed their partition.
        // Identify them by partition bound (not by name substring) — a collection
        // legitimately named e.g. "orders__default" would otherwise LIKE-match a
        // real tenant partition and trigger a false warning.
        const sql = getSqlClient();
        const defaults = await sql`
          SELECT relid::regclass::text AS part
          FROM pg_partition_tree(${'"' + name + '"'}::regclass) t
          JOIN pg_class c ON c.oid = t.relid
          WHERE t.isleaf AND pg_get_expr(c.relpartbound, c.oid) = 'DEFAULT'`;
        for (const d of defaults) {
          const [{ count }] = await sql.unsafe(`SELECT COUNT(*)::int AS count FROM ${d.part}`);
          if (count > 0) {
            console.warn(`[partitioning] Default partition ${d.part} holds ${count} rows — ` +
              `these rows missed their tenant/time partition.`);
          }
        }
      } catch (error) {
        console.error(`[partitioning] Reconciliation failed for "${name}":`, error);
      }
    }
  }

  /**
   * Ensure foreign key constraints exist for BelongsTo relations
   */
  private async ensureForeignKeyConstraints(collectionName: string, schema: any): Promise<void> {
    const sql = getSqlClient();

    // Extract BelongsTo relations from schema fields
    const belongsToRelations: Array<{fieldName: string, assoc: any}> = [];
    for (const [fieldName, fieldSchema] of Object.entries(schema.fields)) {
      const fs = fieldSchema as any;
      if (fs.relType === 'BelongsTo') {
        belongsToRelations.push({fieldName, assoc: fs});
      }
    }

    if (belongsToRelations.length === 0) {
      return; // No BelongsTo relations
    }

    // Track if any columns were added
    let columnsAdded = false;

    // Process each BelongsTo relation
    for (const {fieldName, assoc} of belongsToRelations) {
      // Skip if constraints are explicitly disabled (for polymorphic relations)
      if (assoc.constraints === false) {
        console.log(`Skipping FK constraint for ${fieldName} (constraints: false)`);
        continue;
      }

      const foreignKey = assoc.foreignKey || `${fieldName}_Id`;
      const targetTable = assoc.target;
      const targetKey = assoc.targetKey || 'id';
      const onDelete = (assoc.onDelete || 'CASCADE').toUpperCase();
      const onUpdate = (assoc.onUpdate || 'CASCADE').toUpperCase();
      const constraintName = `fk_${collectionName}_${foreignKey}`;

      try {
        // First, check if the foreign key column exists
        const columnExists = await sql`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_name = ${collectionName}
            AND column_name = ${foreignKey}
        `;

        if (columnExists.length === 0) {
          // Column doesn't exist, add it
          console.log(`Adding foreign key column ${foreignKey} to ${collectionName}`);
          // Get the type from the foreign key field definition, not the relation definition
          const columnType = schema.fields[foreignKey]?.type || assoc.type || 'UUID';
          const pgType = columnType === 'UUID' ? 'UUID' :
                        columnType === 'Integer' ? 'INTEGER' :
                        columnType === 'String' ? 'TEXT' : 'UUID';

          // Use IF NOT EXISTS for safety
          await sql.unsafe(`ALTER TABLE "${collectionName}" ADD COLUMN IF NOT EXISTS "${foreignKey}" ${pgType}`);
          console.log(`Added column ${foreignKey} to ${collectionName}`);
          columnsAdded = true;

          // Update schema definition to include the new field
          if (!schema.fields[foreignKey]) {
            schema.fields[foreignKey] = {
              type: columnType,
              allowNull: true,
              SystemGenerated: true
            };
          }
        }

        // Check if constraint already exists
        const existingConstraint = await sql`
          SELECT
            tc.constraint_name,
            rc.delete_rule,
            rc.update_rule
          FROM information_schema.table_constraints tc
          JOIN information_schema.referential_constraints rc
            ON tc.constraint_name = rc.constraint_name
          WHERE tc.table_name = ${collectionName}
            AND tc.constraint_type = 'FOREIGN KEY'
            AND tc.constraint_name = ${constraintName}
        `;

        // If constraint exists, check if onDelete/onUpdate actions match
        if (existingConstraint.length > 0) {
          const existing = existingConstraint[0];
          const existingOnDelete = existing.delete_rule.replace(' ', '_').toUpperCase();
          const existingOnUpdate = existing.update_rule.replace(' ', '_').toUpperCase();

          if (existingOnDelete === onDelete && existingOnUpdate === onUpdate) {
            console.log(`Foreign key constraint ${constraintName} already exists with correct actions`);
            continue; // Constraint is correct, skip
          }

          // Drop the old constraint if actions don't match
          console.log(`Dropping foreign key constraint ${constraintName} to update actions`);
          await sql.unsafe(`ALTER TABLE "${collectionName}" DROP CONSTRAINT "${constraintName}"`);
        }

        // Partitioned targets need the partition key in the FK (or no FK at all)
        const targetDefEntry: any = this.schemaDefinitions.get(assoc.target);
        const targetSchema = targetDefEntry?.schema ?? targetDefEntry;
        let targetPartitioning: PartitioningConfig | null = null;
        try { targetPartitioning = normalizePartitioning(targetSchema?.partitioning); } catch { targetPartitioning = null; }

        let fkSQL: string;
        if (targetPartitioning) {
          if (targetPartitioning.strategy !== 'tenant') {
            console.warn(`[partitioning] Skipping FK ${constraintName}: target "${assoc.target}" is time-partitioned (children cannot reference (id, ${targetPartitioning.timeField}))`);
            continue;
          }
          if (!schema.fields?.tenant_Id) {
            console.warn(`[partitioning] Skipping FK ${constraintName}: "${collectionName}" has no tenant_Id column to reference partitioned "${assoc.target}"`);
            continue;
          }
          fkSQL = `ALTER TABLE "${collectionName}" ADD CONSTRAINT "${constraintName}" ` +
            `FOREIGN KEY ("${foreignKey}", "tenant_Id") REFERENCES "${assoc.target}"("id", "tenant_Id") ` +
            `ON DELETE ${onDelete} ON UPDATE ${onUpdate}`;
        } else {
          fkSQL = createForeignKeySQL(
            collectionName,
            foreignKey,
            targetTable,
            targetKey,
            onDelete,
            onUpdate
          );
        }

        await sql.unsafe(fkSQL);
        console.log(`Created foreign key constraint: ${constraintName}`);
      } catch (error) {
        console.error(`Failed to create foreign key constraint ${constraintName}:`, error);
        // Don't throw - allow table creation to continue even if FK constraint fails
      }
    }

    // If columns were added, regenerate the Drizzle schema to include them
    if (columnsAdded) {
      console.log(`Regenerating Drizzle schema for ${collectionName} to include new foreign key columns`);
      console.log(`Fields in schema:`, Object.keys(schema.fields));

      // Update schemaDefinitions Map with the modified schema
      const schemaDef = this.schemaDefinitions.get(collectionName);
      if (schemaDef) {
        schemaDef.schema = schema;
        this.schemaDefinitions.set(collectionName, schemaDef);
      }

      // Update the schema in the database table
      const db = getDatabase();
      await db
        .update(baasixSchemaDefinition)
        .set({ schema: schema })
        .where(eq(baasixSchemaDefinition.collectionName, collectionName));
      console.log(`Updated schema definition in database for ${collectionName}`);

      // Regenerate the Drizzle table schema
      await this.createOrUpdateModel(collectionName, schema);
      const updatedSchema = this.schemas.get(collectionName);
      console.log(`After regeneration, ${collectionName} table has columns:`, Object.keys(updatedSchema || {}).filter(k => !k.startsWith('_')));
      console.log(`Drizzle schema for ${collectionName} regenerated successfully`);
    }
  }

  /**
   * Copy-and-swap a table between plain and partitioned layouts.
   * Runs in one transaction; the pre-conversion table is kept as a backup.
   */
  private async convertTableLayout(
    collectionName: string, schema: any, config: PartitioningConfig | null
  ): Promise<void> {
    const sql = getSqlClient();
    const keys = config ? getPartitionKeyColumns(config) : [];
    const tempName = partitionName(collectionName, ['part_new']);
    const backupName = config
      ? partitionName(collectionName, ['preparted'])
      : partitionName(collectionName, ['prepart_rollback']);

    // Backup-name collision check is DDL-free and safe outside the txn.
    const backupExists = await sql`SELECT 1 FROM pg_class WHERE relname = ${backupName}`;
    if (backupExists.length > 0) {
      throw new APIError(`Backup table "${backupName}" already exists`, 400,
        `A previous conversion left "${backupName}" behind. Drop or rename it, then retry.`);
    }

    await sql.begin(async (tx: any) => {
      await tx.unsafe(`LOCK TABLE "${collectionName}" IN ACCESS EXCLUSIVE MODE`);

      // NULL partition-key pre-check runs INSIDE the txn, after the LOCK, so the friendly
      // APIError(400) is race-free (no row can gain/lose a NULL key between check and copy).
      // An APIError thrown here rolls back the txn and propagates (porsager rethrows).
      for (const key of keys) {
        const nullRows = await tx.unsafe(
          `SELECT COUNT(*)::int AS count FROM "${collectionName}" WHERE "${key}" IS NULL`);
        if (nullRows[0].count > 0) {
          throw new APIError(`Cannot partition "${collectionName}"`, 400,
            `${nullRows[0].count} rows have NULL "${key}". Assign values to these rows before enabling partitioning.`);
        }
      }

      // 1. Drop inbound FKs; they are recreated against the new table afterwards
      const inbound = await tx.unsafe(
        `SELECT conname, conrelid::regclass::text AS child_table
         FROM pg_constraint WHERE contype = 'f' AND confrelid = '"${collectionName}"'::regclass`);
      for (const fk of inbound) {
        await tx.unsafe(`ALTER TABLE ${fk.child_table} DROP CONSTRAINT "${fk.conname}"`);
      }

      // 2. New layout under a temp name (schema object carries the DESIRED partitioning already)
      const createSQL = this.buildCreateTableSQL(tempName, schema);
      if (!createSQL) throw new Error(`No columns for "${collectionName}" conversion`);
      await tx.unsafe(createSQL);
      if (config) {
        await this.ensurePartitions(collectionName, schema, { tableName: tempName, sqlClient: tx });
      }

      // 2b. Copy list = INTERSECTION of the OLD and NEW (temp) tables' real columns.
      // The txn sees its own DDL, so both live in information_schema now. Using the
      // intersection means a field dropped from the schema in the SAME patch (still
      // physically present on the old table) is skipped instead of exploding the INSERT;
      // its data survives in the __preparted backup. Order follows the old table.
      const oldCols = await tx.unsafe(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = '${collectionName}' AND table_schema = 'public' AND is_generated = 'NEVER'
         ORDER BY ordinal_position`);
      const newColSet = new Set(
        (await tx.unsafe(
          `SELECT column_name FROM information_schema.columns
           WHERE table_name = '${tempName}' AND table_schema = 'public' AND is_generated = 'NEVER'`))
          .map((c: any) => c.column_name));
      const colList = oldCols
        .filter((c: any) => newColSet.has(c.column_name))
        .map((c: any) => `"${c.column_name}"`).join(', ');
      if (!colList) throw new Error(`No shared columns for "${collectionName}" conversion`);

      // 3. Copy all rows (table is exclusively locked, so this is a consistent snapshot)
      await tx.unsafe(`INSERT INTO "${tempName}" (${colList}) SELECT ${colList} FROM "${collectionName}"`);

      // 4. Move the old table aside and free up its index names
      await tx.unsafe(`ALTER TABLE "${collectionName}" RENAME TO "${backupName}"`);
      const oldIndexes = await tx.unsafe(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = '${backupName}'`);
      for (const idx of oldIndexes) {
        await tx.unsafe(
          `ALTER INDEX "${idx.indexname}" RENAME TO "${partitionName(idx.indexname, ['bak'])}"`);
      }
      // 4b. If the old table was partitioned (reverse conversion), rename ITS partitions
      // out of the way too — their canonical names must be free for any future conversion.
      const oldParts = await tx.unsafe(
        `SELECT relid::regclass::text AS name FROM pg_partition_tree('"${backupName}"'::regclass)
         WHERE relid <> '"${backupName}"'::regclass`);
      for (const p of oldParts) {
        const raw = p.name.replace(/^"|"$/g, '');
        await tx.unsafe(`ALTER TABLE ${p.name} RENAME TO "${partitionName(raw, ['bak'])}"`);
      }

      // 5. Promote the new table
      await tx.unsafe(`ALTER TABLE "${tempName}" RENAME TO "${collectionName}"`);

      // 5b. Rename promoted partitions to their CANONICAL names, derived from each
      // partition's stored BOUND (not from the temp-name prefix). Prefix-stripping breaks
      // when partitionName() hash-truncates a long identifier: the temp partition's name no
      // longer starts with tempName, so a bound-based rename is the only correct approach.
      if (config) {
        await this.renamePartitionsToCanonical(collectionName, config, tx);
      }
    });

    // 6. Rebuild indexes and FKs with their canonical names (outside the txn, same helpers as create path)
    if (schema.indexes && Array.isArray(schema.indexes)) {
      for (const index of schema.indexes) await this.createIndex(collectionName, index);
    }
    for (const [fieldName, fieldDef] of Object.entries(schema.fields || {})) {
      const fd = fieldDef as any;
      if (fd.type === 'Vector' || fd.type === 'HalfVec' || fd.type === 'SparseVec') {
        await this.createVectorIndex(collectionName, fieldName, fd.type);
      }
    }
    await this.ensureForeignKeyConstraints(collectionName, schema);

    // 7. Recreate inbound FKs from children (composite or skipped per partition rules)
    for (const [childName, childEntry] of this.schemaDefinitions) {
      if (childName === collectionName) continue;
      const childSchema = (childEntry as any)?.schema ?? childEntry;
      const references = Object.values(childSchema?.fields || {}).some(
        (f: any) => f?.relType === 'BelongsTo' && f?.target === collectionName);
      if (references) await this.ensureForeignKeyConstraints(childName, childSchema);
    }

    console.log(`[partitioning] Converted "${collectionName}" ` +
      `(${config ? 'partitioned' : 'plain'} layout). Backup kept as "${backupName}".`);
  }

  /**
   * After promoting a copy-and-swap table, rename its partitions to the names the
   * create/reconcile paths expect. The temp-name-prefix approach is unreliable because
   * partitionName() hash-truncates long identifiers, so we derive each canonical name from
   * the partition's stored bound instead.
   *
   * Levels are processed top-down: a tenant partition is renamed before its time
   * sub-partitions, and each child's canonical name is derived from the ALREADY-canonical
   * parent name. Anything whose bound we can't parse is skipped-with-warn (never aborts the txn).
   */
  private async renamePartitionsToCanonical(
    parentTable: string, config: PartitioningConfig, tx: any
  ): Promise<void> {
    // Direct children of `parentTable`, with their stored bound expression.
    const children = await tx.unsafe(
      `SELECT c.oid::regclass::text AS name, pg_get_expr(c.relpartbound, c.oid) AS bound
       FROM pg_inherits i
       JOIN pg_class c ON c.oid = i.inhrelid
       WHERE i.inhparent = '"${parentTable}"'::regclass`);

    for (const child of children) {
      const currentRaw = child.name.replace(/^"|"$/g, '');
      const bound: string = child.bound;
      let canonical: string | null = null;
      let recurse = false;

      // Canonical name is derived from the bound SHAPE, not the strategy, so this works
      // identically at the first level (tenant list / time range) and, on recursion, at the
      // tenant+time second level (time range under a tenant partition).
      const listMatch = bound.match(/FOR VALUES IN \('([0-9a-fA-F-]{36})'\)/);
      const rangeStart = this.parseRangeStart(bound);
      if (bound === 'DEFAULT') {
        canonical = partitionName(parentTable, ['default']);
      } else if (listMatch) {
        canonical = tenantPartitionName(parentTable, listMatch[1]);
        recurse = config.strategy === 'tenant+time'; // its time sub-partitions need renaming too
      } else if (rangeStart) {
        canonical = partitionName(parentTable, [timeSuffixForStart(config.interval, rangeStart)]);
      }

      if (canonical === null) {
        console.warn(`[partitioning] Could not derive canonical name for partition ${child.name} ` +
          `(bound: ${bound}) — leaving as-is.`);
        continue;
      }

      if (currentRaw !== canonical) {
        await tx.unsafe(`ALTER TABLE ${child.name} RENAME TO "${canonical}"`);
      }
      // Recurse into a tenant partition's time sub-partitions, deriving their names from the
      // now-canonical tenant partition name.
      if (recurse) {
        await this.renamePartitionsToCanonical(canonical, config, tx);
      }
    }
  }

  /**
   * Extract the FROM ('<start>') timestamp of a RANGE partition bound, or null if unparseable.
   * Delegates offset-shape normalization to parsePgTimestamp — Postgres renders the bound text
   * per SESSION timezone (bare ±HH, ±HH:MM, or no offset at all for DateTime_NO_TZ columns).
   */
  private parseRangeStart(bound: string): Date | null {
    const m = bound.match(/FOR VALUES FROM \('([^']+)'\) TO \(/);
    if (!m) return null;
    return parsePgTimestamp(m[1]);
  }

  /**
   * Create an index on a table
   */
  /**
   * Auto-create an HNSW index for a pgvector column.
   * Uses cosine distance (vector_cosine_ops) by default — best for normalized embeddings.
   * halfvec and sparsevec use their respective operator classes.
   */
  private async createVectorIndex(
    tableName: string,
    fieldName: string,
    fieldType: 'Vector' | 'HalfVec' | 'SparseVec'
  ): Promise<void> {
    const sqlClient = getSqlClient();
    const opClass =
      fieldType === 'HalfVec' ? 'halfvec_cosine_ops' :
      fieldType === 'SparseVec' ? 'sparsevec_cosine_ops' :
      'vector_cosine_ops';
    const indexName = `${tableName}_${fieldName}_hnsw_idx`;
    try {
      await sqlClient.unsafe(
        `CREATE INDEX IF NOT EXISTS "${indexName}" ON "${tableName}" USING hnsw ("${fieldName}" ${opClass})`
      );
      console.log(`Created HNSW index: ${indexName} on ${tableName}`);
    } catch (error) {
      console.warn(`Failed to create HNSW index ${indexName} on ${tableName}:`, error);
    }
  }

  private async createIndex(tableName: string, indexDef: any): Promise<void> {
    const sql = getSqlClient();
    
    try {
      const fields = indexDef.fields.map((f: string) => `"${f}"`).join(', ');
      const indexName = indexDef.name || `${tableName}_${indexDef.fields.join('_')}_idx`;
      const unique = indexDef.unique ? 'UNIQUE' : '';
      // Support NULLS NOT DISTINCT for unique indexes (PostgreSQL 15+)
      let nullsNotDistinct = '';
      if (indexDef.unique && indexDef.nullsNotDistinct) {
        const supportsNullsNotDistinct = await isPgVersionAtLeast(15);
        if (supportsNullsNotDistinct) {
          nullsNotDistinct = ' NULLS NOT DISTINCT';
        } else {
          console.warn(`Index ${indexName}: NULLS NOT DISTINCT requires PostgreSQL 15+, ignoring option`);
        }
      }
      
      const createIndexSQL = `CREATE ${unique} INDEX IF NOT EXISTS "${indexName}" ON "${tableName}" (${fields})${nullsNotDistinct}`;
      
      await sql.unsafe(createIndexSQL);
      console.log(`Created index: ${indexName} on ${tableName}`);
    } catch (error) {
      console.error(`Failed to create index on ${tableName}:`, error);
    }
  }

  /**
   * Build column definition for CREATE TABLE
   */
  private buildColumnDefinition(fieldName: string, fieldSchema: any): string | null {
    const parts: string[] = [`"${fieldName}"`];
    
    // Handle VIRTUAL (computed) fields - these are GENERATED columns
    if (fieldSchema.type === 'VIRTUAL') {
      if (fieldSchema.calculated) {
        // VIRTUAL fields are GENERATED ALWAYS AS ... STORED
        parts.push('TEXT'); // Default to TEXT for computed fields
        parts.push(`GENERATED ALWAYS AS (${fieldSchema.calculated}) STORED`);
        return parts.join(' ');
      } else {
        console.warn(`VIRTUAL field "${fieldName}" has no calculated expression. Skipping.`);
        return null;
      }
    }
    
    // Check for AUTOINCREMENT first
    const hasAutoIncrement = fieldSchema.defaultValue?.type === 'AUTOINCREMENT';
    
    // Map type
    let pgType = 'TEXT';
    switch (fieldSchema.type) {
      case 'UUID':
        pgType = 'UUID';
        break;
      case 'SUID':
        pgType = 'VARCHAR(21)';
        break;
      case 'String':
        pgType = fieldSchema.values?.stringLength ? `VARCHAR(${fieldSchema.values.stringLength})` : 'TEXT';
        break;
      case 'Text':
        pgType = 'TEXT';
        break;
      case 'HTML':
        // HTML content - stored as TEXT in database
        pgType = 'TEXT';
        break;
      case 'Integer':
        // Use SERIAL for auto-increment integers
        pgType = hasAutoIncrement ? 'SERIAL' : 'INTEGER';
        break;
      case 'BigInt':
        // Use BIGSERIAL for auto-increment bigints
        pgType = hasAutoIncrement ? 'BIGSERIAL' : 'BIGINT';
        break;
      case 'Boolean':
        pgType = 'BOOLEAN';
        break;
      case 'DateTime':
        pgType = 'TIMESTAMPTZ';
        break;
      case 'DateTime_NO_TZ':
        pgType = 'TIMESTAMP';
        break;
      case 'Date':
        pgType = 'DATE';
        break;
      case 'Time':
        pgType = 'TIMETZ';
        break;
      case 'Time_NO_TZ':
        pgType = 'TIME';
        break;
      case 'JSON':
      case 'JSONB':
        pgType = 'JSONB';
        break;
      case 'Decimal':
      case 'Real':
      case 'Double':
        pgType = 'NUMERIC';
        break;
      
      // PostGIS Geometry types
      case 'Point':
        pgType = `geometry(Point, ${fieldSchema.values?.srid || 4326})`;
        break;
      case 'LineString':
        pgType = `geometry(LineString, ${fieldSchema.values?.srid || 4326})`;
        break;
      case 'Polygon':
        pgType = `geometry(Polygon, ${fieldSchema.values?.srid || 4326})`;
        break;
      case 'MultiPoint':
        pgType = `geometry(MultiPoint, ${fieldSchema.values?.srid || 4326})`;
        break;
      case 'MultiLineString':
        pgType = `geometry(MultiLineString, ${fieldSchema.values?.srid || 4326})`;
        break;
      case 'MultiPolygon':
        pgType = `geometry(MultiPolygon, ${fieldSchema.values?.srid || 4326})`;
        break;
      case 'GeometryCollection':
        pgType = `geometry(GeometryCollection, ${fieldSchema.values?.srid || 4326})`;
        break;
      case 'Geography':
        pgType = `geography(Point, ${fieldSchema.values?.srid || 4326})`;
        break;

      // pgvector types
      case 'Vector':
        pgType = `vector(${fieldSchema.values?.dimensions || 1536})`;
        break;
      case 'HalfVec':
        pgType = `halfvec(${fieldSchema.values?.dimensions || 1536})`;
        break;
      case 'SparseVec':
        pgType = `sparsevec(${fieldSchema.values?.dimensions || 1536})`;
        break;
    }
    
    parts.push(pgType);
    
    // Primary key
    if (fieldSchema.primaryKey) {
      parts.push('PRIMARY KEY');
    }
    
    // Not null
    if (fieldSchema.allowNull === false) {
      parts.push('NOT NULL');
    }
    
    // Unique
    if (fieldSchema.unique) {
      parts.push('UNIQUE');
    }
    
    // Default value (skip if AUTOINCREMENT as SERIAL handles it)
    if (fieldSchema.defaultValue !== undefined && !hasAutoIncrement) {
      if (typeof fieldSchema.defaultValue === 'object' && fieldSchema.defaultValue.type) {
        switch (fieldSchema.defaultValue.type) {
          case 'UUIDV4':
            parts.push('DEFAULT gen_random_uuid()');
            break;
          case 'SUID':
            // Short unique ID - 21 char URL-safe string (like nanoid)
            parts.push('DEFAULT baasix_generate_suid()');
            break;
          case 'NOW':
            parts.push('DEFAULT NOW()');
            break;
          case 'SQL':
            // Raw SQL default expression
            if (fieldSchema.defaultValue.value) {
              parts.push(`DEFAULT ${fieldSchema.defaultValue.value}`);
            }
            break;
        }
      } else if (typeof fieldSchema.defaultValue === 'string') {
        parts.push(`DEFAULT '${fieldSchema.defaultValue}'`);
      } else if (typeof fieldSchema.defaultValue === 'number') {
        parts.push(`DEFAULT ${fieldSchema.defaultValue}`);
      } else if (typeof fieldSchema.defaultValue === 'boolean') {
        parts.push(`DEFAULT ${fieldSchema.defaultValue}`);
      }
    }
    
    return parts.join(' ');
  }

  /**
   * Convert a schema field's defaultValue into a raw SQL DEFAULT expression (without the "DEFAULT" keyword).
   * Returns null if no default is defined.
   */
  private getDefaultExpression(fieldSchema: any): string | null {
    if (fieldSchema.defaultValue === undefined || fieldSchema.defaultValue === null) {
      return null;
    }

    // Skip auto-increment types
    if (fieldSchema.autoIncrement || fieldSchema.type === 'AutoIncrement') {
      return null;
    }

    if (typeof fieldSchema.defaultValue === 'object' && fieldSchema.defaultValue.type) {
      switch (fieldSchema.defaultValue.type) {
        case 'UUIDV4':
          return 'gen_random_uuid()';
        case 'SUID':
          return 'baasix_generate_suid()';
        case 'NOW':
          return 'NOW()';
        case 'SQL':
          return fieldSchema.defaultValue.value || null;
      }
      return null;
    } else if (typeof fieldSchema.defaultValue === 'string') {
      return `'${fieldSchema.defaultValue}'`;
    } else if (typeof fieldSchema.defaultValue === 'number') {
      return `${fieldSchema.defaultValue}`;
    } else if (typeof fieldSchema.defaultValue === 'boolean') {
      return `${fieldSchema.defaultValue}`;
    }
    return null;
  }

  /**
   * Normalize a default expression for comparison.
   * PostgreSQL stores defaults with type casts (e.g. 'hello'::text, now(), gen_random_uuid())
   * so we strip casts and lowercase for a fair comparison.
   */
  private normalizeDefaultForComparison(expr: string): string {
    let normalized = expr.toLowerCase().trim();
    // Remove trailing ::type casts (e.g., 'hello'::character varying, 'hello'::text)
    normalized = normalized.replace(/::[a-z\d [\]()]+$/g, '');
    // Normalize whitespace
    normalized = normalized.replace(/\s+/g, ' ').trim();
    // Normalize now() variants
    normalized = normalized.replace(/^now\(\)$/, 'now()');
    normalized = normalized.replace(/^current_timestamp$/, 'now()');
    return normalized;
  }

  /**
   * Check if database is empty and seed if needed
   */
  private async checkAndSeedDatabase(): Promise<void> {
    // Check if we have the necessary tables
    const userSchema = this.schemas.get('baasix_User');
    const roleSchema = this.schemas.get('baasix_Role');
    
    if (!userSchema || !roleSchema) {
      return;
    }

    const sql = getSqlClient();
    
    // Count users and roles
    const userCount = await sql`SELECT COUNT(*) FROM "baasix_User"`;
    const roleCount = await sql`SELECT COUNT(*) FROM "baasix_Role"`;
    
    if (parseInt(userCount[0].count) === 0 && parseInt(roleCount[0].count) === 0) {
      console.log('Database is empty, seeding...');
      await this.seedDatabase();
    }

    // Seed built-in ACL entries on every startup (idempotent)
    await this.seedSystemACLs();

    // administrator always has admin-app access; the client gate checks the
    // role NAME, so this only keeps the Roles Management UI truthful.
    await sql`
      UPDATE "baasix_Role" SET "app_access" = true
      WHERE name = 'administrator' AND "app_access" IS DISTINCT FROM true
    `;
  }

  /**
   * Seed the database with initial data
   */
  private async seedDatabase(): Promise<void> {
    const sql = getSqlClient();
    
    try {
      console.log('Starting seeding...');

      // Create default roles
      await sql`
        INSERT INTO "baasix_Role" (id, name, description, "isTenantSpecific")
        VALUES 
          (gen_random_uuid(), 'administrator', 'Full system access', false),
          (gen_random_uuid(), 'user', 'Standard user access', true),
          (gen_random_uuid(), 'public', 'Public access (unauthenticated)', false)
        ON CONFLICT (name) DO NOTHING
      `;

      console.log('Default roles created');

      // Get admin role ID
      const adminRole = await sql`
        SELECT id FROM "baasix_Role" WHERE name = 'administrator' LIMIT 1
      `;

      if (adminRole.length > 0) {
        const adminRoleId = adminRole[0].id;

        // Hash the admin password
        const hashedPassword = await argon2.hash('admin@123');

        // Create default admin user
        const adminUserId = await sql`
          INSERT INTO "baasix_User" (id, email, "firstName", "lastName", password)
          VALUES (gen_random_uuid(), 'admin@baasix.com', 'Baasix', 'Admin', ${hashedPassword})
          ON CONFLICT (email) DO NOTHING
          RETURNING id
        `;

        if (adminUserId.length > 0) {
          // Assign admin role to admin user
          await sql`
            INSERT INTO "baasix_UserRole" (id, "user_Id", "role_Id", "tenant_Id")
            VALUES (gen_random_uuid(), ${adminUserId[0].id}, ${adminRoleId}, NULL)
            ON CONFLICT DO NOTHING
          `;
        }

        console.log('Default admin user created');
      }

      // Seed default email templates
      await this.seedDefaultTemplates();

      console.log('Seeding complete');
    } catch (error) {
      console.error('Error seeding database:', error);
    }
  }

  /**
   * Seed built-in system ACL entries (idempotent — ON CONFLICT DO NOTHING).
   * Runs on every startup so existing installs get them without migrations.
   */
  private async seedSystemACLs(): Promise<void> {
    const sql = getSqlClient();

    const tableExists = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'baasix_ACL'
      )
    `;
    if (!tableExists[0].exists) {
      console.log('baasix_ACL table does not exist yet, skipping ACL seeding');
      return;
    }

    const ownerCondition = { userCreated_Id: { eq: '$CURRENT_USER' } };
    const systemACLs = [
      { name: 'Read_All', description: 'Read all rows, all fields', conditions: {}, fields: ['*'] },
      { name: 'Read_Own', description: 'Read rows created by the current user (requires usertrack)', conditions: ownerCondition, fields: ['*'] },
      { name: 'Update_Own', description: 'Update rows created by the current user (requires usertrack)', conditions: ownerCondition, fields: ['*'] },
      { name: 'Delete_Own', description: 'Delete rows created by the current user (requires usertrack)', conditions: ownerCondition, fields: null },
      { name: 'Own_Tenant', description: "Rows belonging to the current user's tenant", conditions: { tenant_Id: { eq: '$CURRENT_TENANT' } }, fields: ['*'] },
    ];

    for (const acl of systemACLs) {
      await sql`
        INSERT INTO "baasix_ACL" (id, name, description, conditions, fields, system)
        VALUES (
          gen_random_uuid(),
          ${acl.name},
          ${acl.description},
          ${JSON.stringify(acl.conditions)}::jsonb,
          ${acl.fields ? JSON.stringify(acl.fields) : null}::jsonb,
          true
        )
        ON CONFLICT (name) DO NOTHING
      `;
    }

    console.log('System ACL entries verified/seeded');
  }

  /**
   * Seed default email templates into baasix_Template table
   */
  private async seedDefaultTemplates(): Promise<void> {
    const sql = getSqlClient();

    // Check if templates table exists
    const templateTableExists = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'baasix_Template'
      )
    `;

    if (!templateTableExists[0].exists) {
      console.log('baasix_Template table does not exist yet, skipping template seeding');
      return;
    }

    const defaultTemplates = [
      {
        type: 'inviteNewUser',
        subject: "You've been invited to join {{ tenant }}",
        body: `<h2>Welcome!</h2>
<p>Hi,</p>
<p>You've been invited by <strong>{{ inviterName }}</strong> to join <strong>{{ tenant }}</strong>.</p>
<p>Click the button below to accept your invitation and create your account:</p>
<p style="text-align: center; margin: 30px 0;">
  <a href="{{ inviteLink }}" style="background-color: #0066cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Accept Invitation</a>
</p>
<p><strong>Note:</strong> This invitation will expire on {{ expirationDate }}.</p>
<p>If you didn't expect this invitation, you can safely ignore this email.</p>`,
        description: 'Template for inviting new users who do not have an account yet'
      },
      {
        type: 'inviteExistingUser',
        subject: "You've been invited to join {{ tenant }}",
        body: `<h2>New Invitation</h2>
<p>Hi,</p>
<p>You've been invited by <strong>{{ inviterName }}</strong> to join <strong>{{ tenant }}</strong>.</p>
<p>Since you already have an account, click the button below to accept the invitation:</p>
<p style="text-align: center; margin: 30px 0;">
  <a href="{{ inviteLink }}" style="background-color: #0066cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Accept Invitation</a>
</p>
<p><strong>Note:</strong> This invitation will expire on {{ expirationDate }}.</p>
<p>If you didn't expect this invitation, you can safely ignore this email.</p>`,
        description: 'Template for inviting existing users to a new tenant'
      },
      {
        type: 'magicLinkUrl',
        subject: 'Sign in to {{ project_name }}',
        body: `<h2>Sign In Request</h2>
<p>Hi {{ name }},</p>
<p>Click the button below to sign in to your account:</p>
<p style="text-align: center; margin: 30px 0;">
  <a href="{{ magicLinkUrl }}" style="background-color: #0066cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Sign In</a>
</p>
<p>This link will expire in 15 minutes for security purposes.</p>
<p>If you didn't request this sign-in link, you can safely ignore this email.</p>`,
        description: 'Template for magic link URL authentication'
      },
      {
        type: 'magicLinkCode',
        subject: 'Your sign in code for {{ project_name }}',
        body: `<h2>Sign In Code</h2>
<p>Hi {{ name }},</p>
<p>Use the following code to sign in to your account:</p>
<p style="text-align: center; margin: 30px 0;">
  <span style="background-color: #f5f5f5; padding: 16px 32px; font-size: 24px; font-family: monospace; letter-spacing: 4px; border-radius: 4px; display: inline-block;">{{ code }}</span>
</p>
<p>This code will expire in 15 minutes for security purposes.</p>
<p>If you didn't request this code, you can safely ignore this email.</p>`,
        description: 'Template for magic link code authentication'
      },
      {
        type: 'passwordReset',
        subject: 'Reset your password for {{ project_name }}',
        body: `<h2>Password Reset</h2>
<p>Hi {{ name }},</p>
<p>We received a request to reset your password. Click the button below to choose a new password:</p>
<p style="text-align: center; margin: 30px 0;">
  <a href="{{ resetUrl }}" style="background-color: #0066cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Reset Password</a>
</p>
<p>This link will expire in 1 hour for security purposes.</p>
<p>If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>`,
        description: 'Template for password reset emails'
      },
      {
        type: 'emailVerification',
        subject: 'Verify your email for {{ project_name }}',
        body: `<h2>Email Verification</h2>
<p>Hi {{ name }},</p>
<p>Please verify your email address by clicking the button below:</p>
<p style="text-align: center; margin: 30px 0;">
  <a href="{{ verifyUrl }}" style="background-color: #0066cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Verify Email</a>
</p>
<p>This link will expire in 24 hours.</p>
<p>If you didn't create an account, you can safely ignore this email.</p>`,
        description: 'Template for email verification'
      },
      {
        type: 'welcome',
        subject: 'Welcome to {{ project_name }}!',
        body: `<h2>Welcome!</h2>
<p>Hi {{ name }},</p>
<p>Thank you for joining {{ project_name }}! We're excited to have you on board.</p>
<p>Your account has been successfully created and you're ready to get started.</p>
<p style="text-align: center; margin: 30px 0;">
  <a href="{{ loginUrl }}" style="background-color: #0066cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Get Started</a>
</p>
<p>If you have any questions, feel free to reach out to our support team.</p>`,
        description: 'Template for welcome emails to new users'
      },
      {
        type: 'notification',
        subject: '{{ notification_title }}',
        body: `<h2>{{ notification_title }}</h2>
<p>Hi {{ name }},</p>
<div>{{ notification_message }}</div>
{% if action_url %}
<p style="text-align: center; margin: 30px 0;">
  <a href="{{ action_url }}" style="background-color: #0066cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">{{ action_text | default: 'View Details' }}</a>
</p>
{% endif %}`,
        description: 'Generic notification template'
      }
    ];

    try {
      for (const template of defaultTemplates) {
        await sql`
          INSERT INTO "baasix_Template" (id, type, subject, body, "tenant_Id", "isActive", description)
          VALUES (gen_random_uuid(), ${template.type}, ${template.subject}, ${template.body}, NULL, true, ${template.description})
          ON CONFLICT ("tenant_Id", type) DO NOTHING
        `;
      }
      console.log('Default email templates created');
    } catch (error) {
      console.error('Error seeding default templates:', error);
    }
  }

  /**
   * Ensure baasix_SchemaDefinition table exists
   */
  private async ensureSchemaDefinitionTableOLD(): Promise<void> {
    const sql = getSqlClient();
    
    // Check if table exists
    const result = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'baasix_SchemaDefinition'
      )
    `;

    if (!result[0].exists) {
      console.log('Creating baasix_SchemaDefinition table...');
      
      await sql`
        CREATE TABLE "baasix_SchemaDefinition" (
          id SERIAL PRIMARY KEY,
          "collectionName" TEXT NOT NULL UNIQUE,
          schema JSONB NOT NULL,
          active BOOLEAN NOT NULL DEFAULT true,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "deletedAt" TIMESTAMPTZ
        )
      `;
    }
  }

  /**
   * Create or update a model from JSON schema definition
   */
  async createOrUpdateModel(
    collectionName: string,
    jsonSchema: InternalSchemaDefinition
  ): Promise<any> {
    try {
      console.log(`Creating/updating model: ${collectionName}`);

      let { fields, options, associations } = jsonSchema;

      // Add tenant fields for non-system schemas in multi-tenant mode
      const isSystemSchema = collectionName.startsWith('baasix_');
      const envValue = env.get('MULTI_TENANT');
      const isMultiTenant = envValue === 'true';

      console.log(`[createOrUpdateModel] ${collectionName}:`, {
        isSystemSchema,
        envValue: `"${envValue}"`,
        isMultiTenant,
        willAddTenantFields: isMultiTenant && !isSystemSchema
      });

      if (isMultiTenant && !isSystemSchema) {
        console.log(`[createOrUpdateModel] Adding tenant fields to ${collectionName}`);
        // Add tenant_Id field and tenant relation for multi-tenant isolation
        // IMPORTANT: Modify jsonSchema.fields directly so changes are reflected in createTableFromSchema
        jsonSchema.fields = {
          ...fields,
          tenant_Id: {
            type: 'UUID',
            allowNull: true,
            SystemGenerated: 'true',
            description: 'Tenant identifier for multi-tenant isolation'
          },
          tenant: {
            relType: 'BelongsTo',
            target: 'baasix_Tenant',
            foreignKey: 'tenant_Id',
            as: 'tenant',
            SystemGenerated: 'true',
            description: 'M2O relationship to tenant'
          }
        };

        // Update local fields variable to match
        fields = jsonSchema.fields;

        // Add tenant_Id to unique indexes for proper multi-tenant isolation
        if (!options) {
          options = {};
          jsonSchema.options = options;
        }
        if (!options.indexes) {
          options.indexes = [];
        }

        options.indexes = options.indexes.map((index: any) => {
          if (index.unique && !index.fields.includes('tenant_Id')) {
            return {
              ...index,
              fields: [...index.fields, 'tenant_Id']
            };
          }
          return index;
        });

        // Update jsonSchema.options to reflect index changes
        jsonSchema.options = options;
      }

      // Extract associations from fields if not provided separately
      // This maintains compatibility with Sequelize-style schemas where relations are in fields
      if (!associations) {
        associations = {};
        console.log(`[createOrUpdateModel] Extracting associations for ${collectionName} from fields:`, Object.keys(fields));
        for (const [fieldName, fieldSchema] of Object.entries(fields)) {
          if (isRelationField(fieldSchema)) {
            const relSchema = fieldSchema as any;
            console.log(`[createOrUpdateModel] Found relation field ${fieldName}:`, { relType: relSchema.relType, target: relSchema.target, polymorphic: relSchema.polymorphic });
            // Use the 'as' name as the key if provided, otherwise use fieldName
            // This allows relations to be accessed by their alias (e.g., 'category' instead of 'categoryId')
            const relationKey = relSchema.as || fieldName;
            associations[relationKey] = {
              type: relSchema.relType,
              model: relSchema.target,
              foreignKey: relSchema.foreignKey,
              targetKey: relSchema.targetKey,
              as: relSchema.as || fieldName,
              // For M2A (polymorphic), target IS the junction table
              // For BelongsToMany, through is explicitly set
              through: relSchema.through || (relSchema.polymorphic ? relSchema.target : undefined),
              onDelete: relSchema.onDelete,
              onUpdate: relSchema.onUpdate,
              // M2A/polymorphic specific fields
              polymorphic: relSchema.polymorphic,
              tables: relSchema.tables
            } as any;
          }
        }
        console.log(`[createOrUpdateModel] Extracted ${Object.keys(associations).length} associations for ${collectionName}:`, Object.keys(associations));
      }

      // Build column definitions
      const columns: Record<string, any> = {};

      console.log(`[createOrUpdateModel] ${collectionName} field names after tenant injection:`, Object.keys(fields));

      // Process each field
      for (const [fieldName, fieldSchema] of Object.entries(fields)) {
        // Skip relationship-only fields (no explicit type defined)
        // But process fields that have both type AND relType (e.g., foreign key columns)
        // Also skip fields where type is a relation indicator (M2O, O2O, etc.) — not a real column type
        const RELATION_TYPE_IND_MODEL = ["M2O", "O2O", "O2M", "M2M"];
        if (isRelationField(fieldSchema) && (!fieldSchema.type || RELATION_TYPE_IND_MODEL.includes(fieldSchema.type))) {
          continue;
        }

        try {
          const column = mapJsonTypeToDrizzle(fieldName, fieldSchema, collectionName);
          if (column) {
            columns[fieldName] = column;
          }
        } catch (error) {
          console.warn(`Failed to map field ${fieldName}:`, error);
        }
      }

      // Add timestamps if enabled (default: true)
      const includeTimestamps = options?.timestamps !== false;
      if (includeTimestamps) {
        if (!columns.createdAt) {
          columns.createdAt = timestamp('createdAt', { withTimezone: true }).notNull().defaultNow();
        }
        if (!columns.updatedAt) {
          columns.updatedAt = timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow();
        }
      }

      // Add deletedAt for paranoid mode
      if (options?.paranoid || jsonSchema?.paranoid) {
        if (!columns.deletedAt) {
          columns.deletedAt = timestamp('deletedAt', { withTimezone: true });
        }
      }

      // Create the table schema
      const tableSchema = pgTable(collectionName, columns);

      // Store the schema (soft-delete filtering will be applied at query time)
      this.schemas.set(collectionName, tableSchema);
      
      // Track paranoid mode for this table
      if (options?.paranoid || jsonSchema?.paranoid) {
        this.schemas.set(`${collectionName}_paranoid`, true);
      } else {
        this.schemas.delete(`${collectionName}_paranoid`);
      }

      // Handle associations (store them for later query use)
      if (associations) {
        // Cast to AssociationDefinition - internally uses 'model' which maps to 'target'
        relationBuilder.storeAssociations(collectionName, associations as any);
      }

      // NOTE: Index creation is now handled in createTableFromSchema 
      // to avoid DB queries during fast startup path

      // Register hooks if needed
      this.registerModelHooks(collectionName, jsonSchema);

      console.log(`Model ${collectionName} created successfully`);
      return tableSchema;
    } catch (error) {
      console.error(`Failed to create/update model ${collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Create indexes for a table
   */
  private async createIndexes(
    tableName: string,
    indexes: Array<{
      name?: string;
      fields: string[];
      unique?: boolean;
      nullsNotDistinct?: boolean;
      type?: 'BTREE' | 'HASH' | 'GIST' | 'GIN' | 'FULLTEXT';
    }>
  ): Promise<void> {
    const sql = getSqlClient();
    // Check PostgreSQL version once for all indexes
    const supportsNullsNotDistinct = await isPgVersionAtLeast(15);

    for (const index of indexes) {
      try {
        const indexName = index.name || `${tableName}_${index.fields.join('_')}_idx`;
        const unique = index.unique ? 'UNIQUE' : '';
        const method = index.type || 'BTREE';
        const fields = index.fields.map(f => `"${f}"`).join(', ');
        // Support NULLS NOT DISTINCT for unique indexes (PostgreSQL 15+)
        let nullsNotDistinct = '';
        if (index.unique && index.nullsNotDistinct) {
          if (supportsNullsNotDistinct) {
            nullsNotDistinct = ' NULLS NOT DISTINCT';
          } else {
            console.warn(`Index ${indexName}: NULLS NOT DISTINCT requires PostgreSQL 15+, ignoring option`);
          }
        }

        // Check if index already exists
        const exists = await sql`
          SELECT EXISTS (
            SELECT FROM pg_indexes 
            WHERE tablename = ${tableName} 
            AND indexname = ${indexName}
          )
        `;

        if (!exists[0].exists) {
          await sql.unsafe(`
            CREATE ${unique} INDEX "${indexName}"
            ON "${tableName}" USING ${method} (${fields})${nullsNotDistinct}
          `);
          console.log(`Created index ${indexName} on ${tableName}`);
        }
      } catch (error) {
        console.warn(`Failed to create index on ${tableName}:`, error);
      }
    }
  }

  /**
   * Register model-specific hooks
   */
  private registerModelHooks(
    collectionName: string,
    jsonSchema: InternalSchemaDefinition
  ): void {
    // Hook registration will be implemented based on schema configuration
    // For now, this is a placeholder for future hook registration
    // const hooksManager = HooksManager.getInstance();
    
    // Example: Register audit logging hook for all models
    // This can be customized based on schema options
    if (jsonSchema.options?.paranoid) {
      // Add soft-delete specific hooks if needed
    }
  }

  /**
   * Get a registered schema by collection name
   */
  getSchema(collectionName: string): any {
    return this.schemas.get(collectionName);
  }

  /**
   * Get all registered schemas
   */
  getAllSchemas(): Map<string, any> {
    return this.schemas;
  }

  /**
   * Check if a model/collection exists
   */
  modelExists(collectionName: string): boolean {
    return this.schemas.has(collectionName);
  }

  /**
   * Get table for a collection
   */
  getTable(collectionName: string): any {
    const schema = this.schemas.get(collectionName);
    if (!schema) {
      throw new Error(`Table not found for collection: ${collectionName}`);
    }
    return schema;
  }

  /**
   * Get primary key field name for a collection
   */
  getPrimaryKey(collectionName: string): string {
    // Get schema definition from schemaDefinitions Map (loaded during initialization)
    const schemaDef = this.schemaDefinitions.get(collectionName);

    if (schemaDef && schemaDef.schema && schemaDef.schema.fields) {
      // Find the field with primaryKey: true
      for (const [fieldName, fieldSchema] of Object.entries(schemaDef.schema.fields)) {
        if ((fieldSchema as any).primaryKey === true) {
          return fieldName;
        }
      }
    }

    // Default to 'id' if no primary key is explicitly defined
    return 'id';
  }

  /**
   * Get the names of fields marked `hidden` in the JSON schema definition.
   *
   * IMPORTANT: the `hidden` flag lives on the schema DEFINITION (schemaDefinitions
   * map), NOT on the runtime Drizzle table (`getSchema().columns`). Reading it from
   * the Drizzle table returns nothing, which previously let hidden fields like
   * `password` leak into API responses. Always source hidden fields from here.
   */
  getHiddenFieldNames(collectionName: string): string[] {
    const schemaDef = this.schemaDefinitions.get(collectionName);
    const fields = schemaDef?.schema?.fields;
    if (!fields) return [];

    const hidden: string[] = [];
    for (const [fieldName, fieldSchema] of Object.entries(fields)) {
      if ((fieldSchema as any)?.hidden === true) {
        hidden.push(fieldName);
      }
    }
    return hidden;
  }

  /**
   * Check if a collection has paranoid mode enabled (soft delete)
   */
  isParanoid(collectionName: string): boolean {
    return this.schemas.get(`${collectionName}_paranoid`) === true;
  }

  /**
   * Get schema options for a collection
   */
  getSchemaOptions(collectionName: string): any {
    const schema = this.getSchema(collectionName);
    if (!schema) return {};

    // Schema options are stored in the schema definition
    // For now, we track paranoid mode separately
    return {
      paranoid: this.isParanoid(collectionName)
    };
  }

  /**
   * Get schema definition with flags from baasix_SchemaDefinition table
   */
  async getSchemaDefinition(collectionName: string): Promise<any | null> {
    // Use the in-memory schemaDefinitions map (populated during initialization)
    // instead of querying the DB on every call
    const cached = this.schemaDefinitions.get(collectionName);
    if (cached) return cached.schema;
    return null;
  }

  /**
   * Get relation names for a collection
   */
  getRelationNames(collectionName: string): string[] {
    const associations = relationBuilder.getAssociations(collectionName);
    if (!associations) return [];
    return Object.keys(associations);
  }

  /**
   * Get relations for a collection
   */
  getRelations(collectionName: string): any {
    return this.relations.get(collectionName);
  }

  /**
   * Get a specific relation for a collection
   */
  getRelation(collectionName: string, relationName: string): any {
    const relations = this.relations.get(collectionName);
    return relations?.[relationName];
  }

  /**
   * Check if schema manager is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Add a new schema definition to the database
   */
  async addSchemaDefinition(
    collectionName: string,
    schema: SchemaDefinition
  ): Promise<void> {
    const db = getDatabase();
    
    // Check if schema already exists
    const existing = await db
      .select()
      .from(baasixSchemaDefinition)
      .where(eq(baasixSchemaDefinition.collectionName, collectionName))
      .limit(1);

    if (existing.length > 0) {
      // Update existing schema
      await db
        .update(baasixSchemaDefinition)
        .set({
          schema: schema as any,
          updatedAt: new Date(),
        } as any)
        .where(eq(baasixSchemaDefinition.collectionName, collectionName));
    } else {
      // Insert new schema
      await db.insert(baasixSchemaDefinition).values({
        collectionName,
        schema: schema as any,
      });
    }

    // Update in-memory cache
    this.schemaDefinitions.set(collectionName, { collectionName, schema });

    // Reload the schema
    await this.createOrUpdateModel(collectionName, schema);
  }

  /**
   * Remove a schema definition
   */
  async removeSchemaDefinition(collectionName: string): Promise<void> {
    const db = getDatabase();
    
    // Delete the schema definition
    await db
      .delete(baasixSchemaDefinition)
      .where(eq(baasixSchemaDefinition.collectionName, collectionName));

    // Remove from memory
    this.schemas.delete(collectionName);
    this.schemas.delete(`${collectionName}_paranoid`);
    this.relations.delete(collectionName);
    this.schemaDefinitions.delete(collectionName);
  }

  /**
   * Sync schemas - create/update tables in database
   * Similar to Sequelize.sync()
   */
  async sync(options?: { force?: boolean; alter?: boolean }): Promise<void> {
    console.log('Syncing schemas with database...');

    // For now, we rely on Drizzle Kit for migrations
    // In production, use: drizzle-kit push:pg or drizzle-kit migrate
    console.warn(
      'Schema sync is handled by Drizzle Kit. Run: npm run db:push'
    );
  }

  /**
   * Create or update a model (for schema routes compatibility)
   */
  async updateModel(collectionName: string, schema: any, accountability?: any): Promise<void> {
    console.log(`Creating/updating model: ${collectionName}`);
    console.log(`[updateModel] Schema fields for ${collectionName}:`, Object.keys(schema.fields || {}));

    // Add tenant fields for non-system schemas in multi-tenant mode BEFORE saving to database
    const isSystemSchema = collectionName.startsWith('baasix_');
    const envValue = env.get('MULTI_TENANT');
    const isMultiTenant = envValue === 'true';

    // Validate partitioning config before persisting anything (throws APIError on bad config)
    const partitionConfig = validatePartitioning(collectionName, schema, {
      isMultiTenant,
      pgOk: await isPgVersionAtLeast(12),
    });
    if (partitionConfig) {
      appendPartitionKeysToUniqueIndexes(schema, getPartitionKeyColumns(partitionConfig));
    }

    if (isMultiTenant && !isSystemSchema && !schema.fields?.tenant_Id) {
      console.log(`[updateModel] Adding tenant fields to schema for ${collectionName}`);
      schema.fields = {
        ...schema.fields,
        tenant_Id: {
          type: 'UUID',
          allowNull: true,
          SystemGenerated: 'true',
          description: 'Tenant identifier for multi-tenant isolation'
        },
        tenant: {
          relType: 'BelongsTo',
          target: 'baasix_Tenant',
          foreignKey: 'tenant_Id',
          as: 'tenant',
          SystemGenerated: 'true',
          description: 'M2O relationship to tenant'
        }
      };

      // Add tenant_Id to unique indexes for proper multi-tenant isolation
      if (schema.indexes && Array.isArray(schema.indexes)) {
        schema.indexes = schema.indexes.map((index: any) => {
          if (index.unique && !index.fields.includes('tenant_Id')) {
            return {
              ...index,
              fields: [...index.fields, 'tenant_Id']
            };
          }
          return index;
        });
      }
    }

    // Capture the previous in-memory definition BEFORE overwriting it, so we can detect
    // whether the physical table layout needs to change (conversion) below.
    const previousEntry: any = this.schemaDefinitions.get(collectionName);
    const previousSchema = previousEntry?.schema ?? previousEntry;
    let previousConfig: PartitioningConfig | null = null;
    try { previousConfig = normalizePartitioning(previousSchema?.partitioning); } catch { previousConfig = null; }

    // Store JSON schema definition in memory
    this.schemaDefinitions.set(collectionName, { collectionName, schema });

    // Update schema definition in database
    const db = getDatabase();
    const existingSchema = await db
      .select()
      .from(baasixSchemaDefinition)
      .where(eq(baasixSchemaDefinition.collectionName, collectionName))
      .limit(1);

    if (existingSchema.length > 0) {
      // Update existing schema
      await db
        .update(baasixSchemaDefinition)
        .set({ schema: schema as any, updatedAt: new Date() } as any)
        .where(eq(baasixSchemaDefinition.collectionName, collectionName));
      console.log(`Updated schema definition in database for ${collectionName}`);
    } else {
      // Insert new schema
      await db.insert(baasixSchemaDefinition).values({
        collectionName,
        schema: schema as any,
      });
      console.log(`Inserted new schema definition in database for ${collectionName}`);
    }

    // Create/update the Drizzle schema in memory
    await this.createOrUpdateModel(collectionName, schema);

    // Create the actual PostgreSQL table (or convert its layout if partitioning changed).
    // convertTableLayout runs its DDL in a transaction that rolls back on failure (e.g. the
    // in-txn NULL partition-key pre-check throws APIError(400)). The schema definition, however,
    // was already written to memory + DB above (outside that txn), so on a rolled-back conversion
    // we must restore the PREVIOUS definition — otherwise the persisted config would claim the
    // table is partitioned while it physically isn't, and later createPartitionsForTenant would 500.
    const physicallyPartitioned = await this.isTablePartitioned(collectionName);
    const wantsPartitioned = !!partitionConfig;
    // Only the PHYSICAL layout keys — strategy, interval, timeField — trigger a copy-and-swap
    // conversion. `premake` (how many future periods to pre-create) does NOT change the table's
    // partition scheme: a premake 1→2 bump just needs one extra period table, which the normal
    // sync path (createTableFromSchema → ensurePartitions) creates idempotently. Comparing full
    // configs here would needlessly convert (and leave a __preparted backup) on a premake change.
    const layoutSig = (c: PartitioningConfig | null) =>
      c ? JSON.stringify({ strategy: c.strategy, interval: c.interval, timeField: c.timeField }) : null;
    const layoutChanged = physicallyPartitioned !== null && (
      physicallyPartitioned !== wantsPartitioned ||
      (wantsPartitioned && layoutSig(partitionConfig) !== layoutSig(previousConfig))
    );
    if (layoutChanged) {
      try {
        await this.convertTableLayout(collectionName, schema, partitionConfig);
        // Re-ensure partitions once, post-conversion: a tenant created DURING the conversion
        // (its partition provisioned on the OLD/backup table, which was renamed aside) would
        // otherwise be missing on the freshly-promoted table until reconciliation. Idempotent
        // and cheap — closes most of that race window. Only meaningful for a partitioned target.
        if (partitionConfig) {
          try {
            await this.ensurePartitions(collectionName, schema);
          } catch (ensureErr) {
            console.warn(`[partitioning] post-conversion ensurePartitions for "${collectionName}" ` +
              `failed (reconciliation will heal) — continuing:`, ensureErr);
          }
        }
      } catch (err) {
        // Restore the pre-PATCH schema definition (memory + DB) so config and physical layout stay consistent.
        if (previousEntry !== undefined) {
          this.schemaDefinitions.set(collectionName, previousEntry);
          if (existingSchema.length > 0) {
            await db.update(baasixSchemaDefinition)
              .set({ schema: previousSchema as any, updatedAt: new Date() } as any)
              .where(eq(baasixSchemaDefinition.collectionName, collectionName));
          }
          await this.createOrUpdateModel(collectionName, previousSchema);
        }
        throw err;
      }
    } else {
      await this.createTableFromSchema(collectionName, schema);
    }

    console.log(`Model ${collectionName} created/updated successfully`);
  }

  /**
   * Delete a model (for schema routes compatibility)
   */
  async deleteModel(collectionName: string): Promise<void> {
    console.log(`Deleting model: ${collectionName}`);
    this.schemas.delete(collectionName);
    this.schemas.delete(`${collectionName}_paranoid`);
    // In production, this would drop the table
  }

  /**
   * Add an index to a collection
   */
  async addIndex(collectionName: string, indexData: any, accountability?: any): Promise<void> {
    const sql = getSqlClient();
    const db = getDatabase();

    try {
      const fields = indexData.fields;
      if (!Array.isArray(fields) || fields.length === 0) {
        throw new Error('Index fields must be a non-empty array');
      }

      const indexName = indexData.name || `${collectionName}_${fields.join('_')}_idx`;
      const unique = indexData.unique ? 'UNIQUE' : '';
      // Support NULLS NOT DISTINCT for unique indexes (PostgreSQL 15+)
      let nullsNotDistinct = '';
      if (indexData.unique && indexData.nullsNotDistinct) {
        const supportsNullsNotDistinct = await isPgVersionAtLeast(15);
        if (supportsNullsNotDistinct) {
          nullsNotDistinct = ' NULLS NOT DISTINCT';
        } else {
          console.warn(`Index ${indexName}: NULLS NOT DISTINCT requires PostgreSQL 15+, ignoring option`);
        }
      }

      // Check if table exists
      const tableExists = await sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_name = ${collectionName}
        )
      `;

      if (!tableExists[0].exists) {
        throw new Error(`Table ${collectionName} does not exist`);
      }

      // Check if index already exists
      const indexExists = await sql`
        SELECT EXISTS (
          SELECT FROM pg_indexes
          WHERE tablename = ${collectionName}
          AND indexname = ${indexName}
        )
      `;

      if (!indexExists[0].exists) {
        // Build CREATE INDEX statement
        const fieldList = fields.map((f: string) => `"${f}"`).join(', ');
        const createIndexSQL = `CREATE ${unique} INDEX "${indexName}" ON "${collectionName}" (${fieldList})${nullsNotDistinct}`;

        await sql.unsafe(createIndexSQL);
        console.log(`Created index ${indexName} on ${collectionName}`);
      } else {
        console.log(`Index ${indexName} already exists on ${collectionName}`);
      }

      // Persist index metadata in schema definition (even if index existed in DB already)
      const existingSchema = await db
        .select()
        .from(baasixSchemaDefinition)
        .where(eq(baasixSchemaDefinition.collectionName, collectionName))
        .limit(1);

      if (existingSchema.length === 0) {
        throw new Error(`Schema definition for ${collectionName} not found`);
      }

      const schema = (existingSchema[0].schema as any) || {};
      if (!schema.indexes || !Array.isArray(schema.indexes)) {
        schema.indexes = [];
      }

      const indexMeta = {
        name: indexName,
        fields,
        unique: !!indexData.unique,
        ...(indexData.type ? { type: indexData.type } : {}),
        ...(indexData.nullsNotDistinct ? { nullsNotDistinct: true } : {}),
      };

      const existingIndexPos = schema.indexes.findIndex((idx: any) => idx?.name === indexName);
      if (existingIndexPos >= 0) {
        schema.indexes[existingIndexPos] = {
          ...schema.indexes[existingIndexPos],
          ...indexMeta,
        };
      } else {
        schema.indexes.push(indexMeta);
      }

      await db
        .update(baasixSchemaDefinition)
        .set({ schema: schema as any, updatedAt: new Date() } as any)
        .where(eq(baasixSchemaDefinition.collectionName, collectionName));

      // Keep in-memory schema definition cache in sync with DB
      this.schemaDefinitions.set(collectionName, { collectionName, schema });
      console.log(`Persisted index ${indexName} in schema definition for ${collectionName}`);
    } catch (error) {
      console.error(`Failed to create index on ${collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Remove an index (stub for compatibility)
   */
  async removeIndex(collectionName: string, indexName: string, accountability?: any): Promise<void> {
    const sql = getSqlClient();
    const db = getDatabase();

    try {
      if (!indexName || typeof indexName !== 'string') {
        throw new Error('Index name is required');
      }

      // Remove the physical index if it exists
      const indexExists = await sql`
        SELECT EXISTS (
          SELECT FROM pg_indexes
          WHERE tablename = ${collectionName}
          AND indexname = ${indexName}
        )
      `;

      if (indexExists[0].exists) {
        await sql.unsafe(`DROP INDEX IF EXISTS "${indexName}"`);
        console.log(`Dropped index ${indexName} from ${collectionName}`);
      } else {
        console.log(`Index ${indexName} does not exist on ${collectionName}, continuing with schema cleanup`);
      }

      // Remove index metadata from schema definition (also handles metadata-only drift)
      const existingSchema = await db
        .select()
        .from(baasixSchemaDefinition)
        .where(eq(baasixSchemaDefinition.collectionName, collectionName))
        .limit(1);

      if (existingSchema.length === 0) {
        throw new Error(`Schema definition for ${collectionName} not found`);
      }

      const schema = (existingSchema[0].schema as any) || {};
      let schemaChanged = false;

      if (Array.isArray(schema.indexes)) {
        const initialCount = schema.indexes.length;
        schema.indexes = schema.indexes.filter((idx: any) => idx?.name !== indexName);
        schemaChanged = schemaChanged || schema.indexes.length !== initialCount;
      }

      // Legacy shape support: cleanup options.indexes if present
      if (schema.options && Array.isArray(schema.options.indexes)) {
        const initialCount = schema.options.indexes.length;
        schema.options.indexes = schema.options.indexes.filter((idx: any) => idx?.name !== indexName);
        schemaChanged = schemaChanged || schema.options.indexes.length !== initialCount;
      }

      if (schemaChanged) {
        await db
          .update(baasixSchemaDefinition)
          .set({ schema: schema as any, updatedAt: new Date() } as any)
          .where(eq(baasixSchemaDefinition.collectionName, collectionName));

        this.schemaDefinitions.set(collectionName, { collectionName, schema });
        console.log(`Removed index ${indexName} from schema definition for ${collectionName}`);
      } else {
        console.log(`Index ${indexName} was not present in schema definition for ${collectionName}`);
      }
    } catch (error) {
      console.error(`Failed to remove index ${indexName} from ${collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Add missing foreign key indexes to all collections
   * Useful for migrating existing databases to use auto-indexing
   */
  async addMissingForeignKeyIndexes(accountability?: any): Promise<{
    created: Array<{ collection: string; indexName: string; field: string }>;
    skipped: Array<{ collection: string; indexName: string; reason: string }>;
    errors: Array<{ collection: string; indexName: string; error: string }>;
  }> {
    const sql = getSqlClient();
    const result = {
      created: [] as Array<{ collection: string; indexName: string; field: string }>,
      skipped: [] as Array<{ collection: string; indexName: string; reason: string }>,
      errors: [] as Array<{ collection: string; indexName: string; error: string }>,
    };

    console.log('Scanning for missing foreign key indexes...');

    // Fetch all schema definitions from database (not from memory cache which has Drizzle table objects)
    const schemaDefinitions = await sql`
      SELECT "collectionName", schema FROM "baasix_SchemaDefinition"
    `;

    console.log(`Found ${schemaDefinitions.length} schemas to scan for missing indexes`);

    // Track which schemas need to be updated
    const schemasToUpdate: Map<string, { schema: any; newIndexes: Array<{ name: string; fields: string[]; unique: boolean }> }> = new Map();

    for (const schemaDef of schemaDefinitions) {
      const collectionName = schemaDef.collectionName;
      const schema = schemaDef.schema;
      
      if (!schema?.fields) continue;

      const newIndexes: Array<{ name: string; fields: string[]; unique: boolean }> = [];

      // Find all BelongsTo relationships (M2O, O2O)
      for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
        const field = fieldDef as any;
        
        // Skip if field definition is null/undefined
        if (!field) continue;
        
        // Check if this is a BelongsTo relation
        if (field.relType === 'BelongsTo' && field.foreignKey) {
          const fkColumn = field.foreignKey;
          const indexName = `${collectionName}_${fkColumn}_idx`;

          // Check if index already exists in schema definition
          const existsInSchema = schema.indexes?.some((idx: any) => idx.name === indexName);

          try {
            // Check if index already exists in database
            const indexExists = await sql`
              SELECT EXISTS (
                SELECT FROM pg_indexes
                WHERE tablename = ${collectionName}
                AND indexname = ${indexName}
              )
            `;

            if (indexExists[0].exists && existsInSchema) {
              result.skipped.push({
                collection: collectionName,
                indexName,
                reason: 'Index already exists',
              });
              continue;
            }

            // Check if column exists
            const columnExists = await sql`
              SELECT EXISTS (
                SELECT FROM information_schema.columns
                WHERE table_name = ${collectionName}
                AND column_name = ${fkColumn}
              )
            `;

            if (!columnExists[0].exists) {
              result.skipped.push({
                collection: collectionName,
                indexName,
                reason: `Column ${fkColumn} does not exist`,
              });
              continue;
            }

            // Create the index in database if not exists
            if (!indexExists[0].exists) {
              const createIndexSQL = `CREATE INDEX "${indexName}" ON "${collectionName}" ("${fkColumn}")`;
              await sql.unsafe(createIndexSQL);
              console.log(`Created index ${indexName} on ${collectionName}(${fkColumn})`);
            }

            // Add to schema definition if not exists
            if (!existsInSchema) {
              newIndexes.push({
                name: indexName,
                fields: [fkColumn],
                unique: false,
              });
            }

            result.created.push({
              collection: collectionName,
              indexName,
              field: fkColumn,
            });
          } catch (error: any) {
            result.errors.push({
              collection: collectionName,
              indexName,
              error: error.message,
            });
            console.error(`Failed to create index ${indexName}:`, error.message);
          }
        }
      }

      // Check for junction tables (M2M/M2A) and add individual FK indexes
      if (schema.isJunction) {
        // Find all FK columns in junction table (columns ending with _id)
        for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
          const field = fieldDef as any;
          
          // Skip if field definition is null/undefined
          if (!field) continue;
          
          // Skip non-FK fields and primary keys
          if (field.primaryKey || field.relType) continue;
          
          // Check if it's a FK column (ends with _id or is item_id for M2A)
          if (fieldName.endsWith('_id') || fieldName === 'item_id') {
            const indexName = `${collectionName}_${fieldName}_idx`;
            const existsInSchema = schema.indexes?.some((idx: any) => idx.name === indexName);

            try {
              // Check if index already exists in database
              const indexExists = await sql`
                SELECT EXISTS (
                  SELECT FROM pg_indexes
                  WHERE tablename = ${collectionName}
                  AND indexname = ${indexName}
                )
              `;

              if (indexExists[0].exists && existsInSchema) {
                result.skipped.push({
                  collection: collectionName,
                  indexName,
                  reason: 'Index already exists',
                });
                continue;
              }

              // Create the index in database if not exists
              if (!indexExists[0].exists) {
                const createIndexSQL = `CREATE INDEX "${indexName}" ON "${collectionName}" ("${fieldName}")`;
                await sql.unsafe(createIndexSQL);
                console.log(`Created index ${indexName} on ${collectionName}(${fieldName})`);
              }

              // Add to schema definition if not exists
              if (!existsInSchema) {
                newIndexes.push({
                  name: indexName,
                  fields: [fieldName],
                  unique: false,
                });
              }

              result.created.push({
                collection: collectionName,
                indexName,
                field: fieldName,
              });
            } catch (error: any) {
              result.errors.push({
                collection: collectionName,
                indexName,
                error: error.message,
              });
              console.error(`Failed to create index ${indexName}:`, error.message);
            }
          }
        }

        // Also add index on 'collection' column for M2A junction tables
        if (schema.fields.collection) {
          const indexName = `${collectionName}_collection_idx`;
          const existsInSchema = schema.indexes?.some((idx: any) => idx.name === indexName);

          try {
            const indexExists = await sql`
              SELECT EXISTS (
                SELECT FROM pg_indexes
                WHERE tablename = ${collectionName}
                AND indexname = ${indexName}
              )
            `;

            if (indexExists[0].exists && existsInSchema) {
              result.skipped.push({
                collection: collectionName,
                indexName,
                reason: 'Index already exists',
              });
            } else {
              // Create the index in database if not exists
              if (!indexExists[0].exists) {
                const createIndexSQL = `CREATE INDEX "${indexName}" ON "${collectionName}" ("collection")`;
                await sql.unsafe(createIndexSQL);
                console.log(`Created index ${indexName} on ${collectionName}(collection)`);
              }

              // Add to schema definition if not exists
              if (!existsInSchema) {
                newIndexes.push({
                  name: indexName,
                  fields: ['collection'],
                  unique: false,
                });
              }

              result.created.push({
                collection: collectionName,
                indexName,
                field: 'collection',
              });
            }
          } catch (error: any) {
            result.errors.push({
              collection: collectionName,
              indexName,
              error: error.message,
            });
          }
        }
      }

      // Track schemas that need updating (FK indexes only update schema definitions)
      if (newIndexes.length > 0) {
        schemasToUpdate.set(collectionName, { schema, newIndexes });
      }

      // Also create any schema-defined indexes that are missing from the database
      if (schema.indexes && Array.isArray(schema.indexes)) {
        for (const indexDef of schema.indexes) {
          const fields = indexDef.fields;
          if (!fields || !Array.isArray(fields) || fields.length === 0) continue;

          const indexName = indexDef.name || `${collectionName}_${fields.join('_')}_idx`;

          try {
            // Check if index already exists in database
            const indexExists = await sql`
              SELECT EXISTS (
                SELECT FROM pg_indexes
                WHERE tablename = ${collectionName}
                AND indexname = ${indexName}
              )
            `;

            if (indexExists[0].exists) {
              result.skipped.push({
                collection: collectionName,
                indexName,
                reason: 'Index already exists in database',
              });
              continue;
            }

            // Verify all columns exist
            const columnsExist = await sql`
              SELECT column_name FROM information_schema.columns
              WHERE table_name = ${collectionName}
              AND column_name = ANY(${fields})
            `;
            const existingCols = new Set(columnsExist.map((c: any) => c.column_name));
            const missingCols = fields.filter((f: string) => !existingCols.has(f));
            if (missingCols.length > 0) {
              result.skipped.push({
                collection: collectionName,
                indexName,
                reason: `Columns missing: ${missingCols.join(', ')}`,
              });
              continue;
            }

            // Build and execute CREATE INDEX
            const unique = indexDef.unique ? 'UNIQUE' : '';
            const fieldList = fields.map((f: string) => `"${f}"`).join(', ');
            let nullsNotDistinct = '';
            if (indexDef.unique && indexDef.nullsNotDistinct) {
              const supportsNND = await isPgVersionAtLeast(15);
              if (supportsNND) {
                nullsNotDistinct = ' NULLS NOT DISTINCT';
              }
            }
            const createIndexSQL = `CREATE ${unique} INDEX "${indexName}" ON "${collectionName}" (${fieldList})${nullsNotDistinct}`;
            await sql.unsafe(createIndexSQL);
            console.log(`Created schema-defined index ${indexName} on ${collectionName}(${fields.join(', ')})`);

            result.created.push({
              collection: collectionName,
              indexName,
              field: fields.join(', '),
            });
          } catch (error: any) {
            result.errors.push({
              collection: collectionName,
              indexName,
              error: error.message,
            });
            console.error(`Failed to create schema-defined index ${indexName}:`, error.message);
          }
        }
      }
    }

    // Update schema definitions with new indexes
    for (const [collectionName, { schema, newIndexes }] of schemasToUpdate) {
      try {
        const updatedSchema = { ...schema };
        if (!updatedSchema.indexes) {
          updatedSchema.indexes = [];
        }
        updatedSchema.indexes.push(...newIndexes);
        
        // Update the schema definition directly in the database
        await sql`
          UPDATE "baasix_SchemaDefinition"
          SET schema = ${JSON.stringify(updatedSchema)}::jsonb,
              "updatedAt" = NOW()
          WHERE "collectionName" = ${collectionName}
        `;
        console.log(`Updated schema definition for ${collectionName} with ${newIndexes.length} new indexes`);
      } catch (error: any) {
        console.error(`Failed to update schema definition for ${collectionName}:`, error.message);
        // Don't add to errors since the indexes were created successfully
      }
    }

    console.log(`Index migration complete: ${result.created.length} created, ${result.skipped.length} skipped, ${result.errors.length} errors`);
    return result;
  }
}

/** Unique constraints on a partitioned table must contain all partition key columns. */
function appendPartitionKeysToUniqueIndexes(schema: any, keys: string[]): void {
  for (const holder of [schema, schema.options]) {
    if (!holder?.indexes || !Array.isArray(holder.indexes)) continue;
    holder.indexes = holder.indexes.map((index: any) => {
      if (!index.unique) return index;
      const missing = keys.filter((k) => !index.fields.includes(k));
      return missing.length ? { ...index, fields: [...index.fields, ...missing] } : index;
    });
  }
}

/**
 * Export singleton instance
 */
export const schemaManager = SchemaManager.getInstance();

/**
 * Initialize schema manager
 */
export async function initializeSchemas(): Promise<void> {
  await schemaManager.initialize();
}

/**
 * Get schema by collection name
 */
export function getSchema(collectionName: string): any {
  return schemaManager.getSchema(collectionName);
}

/**
 * Get all schemas
 */
export function getAllSchemas(): Map<string, any> {
  return schemaManager.getAllSchemas();
}
