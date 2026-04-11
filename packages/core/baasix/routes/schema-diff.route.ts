import { getSqlClient, getDatabase } from "../utils/db.js";
import { schemaManager } from "../utils/schemaManager.js";
import { adminOnly } from "../utils/auth.js";
import { APIError } from "../utils/errorHandler.js";
import type { Express } from "../types/index.js";

/**
 * Determines which schema fields should produce actual database columns.
 * Relation-only fields (no explicit type) do NOT produce columns,
 * but BelongsTo relations produce a foreignKey column.
 */
function getExpectedColumns(schema: any): Map<string, { type: string; fromField: string }> {
  const columns = new Map<string, { type: string; fromField: string }>();

  for (const [fieldName, fieldSchema] of Object.entries(schema.fields)) {
    const fs = fieldSchema as any;

    // BelongsTo relations create a foreign key column
    if (fs.relType === "BelongsTo") {
      const foreignKey = fs.foreignKey || `${fieldName}_Id`;
      if (foreignKey === fieldName && fs.type) {
        // Field itself is the FK column with explicit type
        columns.set(fieldName, { type: fs.type, fromField: fieldName });
      } else if (foreignKey !== fieldName) {
        // Separate FK column
        columns.set(foreignKey, { type: fs.type || "UUID", fromField: fieldName });
      }
      // If foreignKey === fieldName but no explicit type, handled by FK logic
      if (foreignKey === fieldName && !fs.type) {
        columns.set(foreignKey, { type: "UUID", fromField: fieldName });
      }
      continue;
    }

    // Skip relation-only fields (no explicit type)
    if (fs.relType && !fs.type) continue;

    columns.set(fieldName, { type: fs.type || "String", fromField: fieldName });
  }

  // Implicit columns from schema flags
  if (schema.timestamps !== false) {
    if (!columns.has("createdAt")) columns.set("createdAt", { type: "DateTime", fromField: "[timestamps]" });
    if (!columns.has("updatedAt")) columns.set("updatedAt", { type: "DateTime", fromField: "[timestamps]" });
  }
  if (schema.paranoid) {
    if (!columns.has("deletedAt")) columns.set("deletedAt", { type: "DateTime", fromField: "[paranoid]" });
  }
  if (schema.sortEnabled) {
    if (!columns.has("sort")) columns.set("sort", { type: "Integer", fromField: "[sortEnabled]" });
  }
  if (schema.usertrack) {
    if (!columns.has("userCreated")) columns.set("userCreated", { type: "UUID", fromField: "[usertrack]" });
    if (!columns.has("userUpdated")) columns.set("userUpdated", { type: "UUID", fromField: "[usertrack]" });
  }

  return columns;
}

const registerEndpoint = (app: Express, context?: any) => {

  /**
   * GET /utils/schema-diff
   * Compare schema definitions with actual database tables/columns.
   * Admin-only endpoint.
   */
  app.get("/utils/schema-diff", adminOnly, async (req, res, next) => {
    try {
      const sql = getSqlClient();

      // 1. Get all tables in the public schema from the actual database
      // Tables to exclude from comparison (e.g. PostGIS internal tables)
      const excludedTables = ['spatial_ref_sys'];

      const dbTables = await sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
          AND table_name != ALL(${excludedTables})
        ORDER BY table_name
      `;
      const dbTableNames = new Set(dbTables.map((t: any) => t.table_name));

      // 2. Get all columns per table from the database
      const dbColumns = await sql`
        SELECT table_name, column_name, data_type, is_nullable, column_default,
               character_maximum_length, numeric_precision, numeric_scale
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name != ALL(${excludedTables})
        ORDER BY table_name, ordinal_position
      `;

      const dbColumnsByTable = new Map<string, any[]>();
      for (const col of dbColumns) {
        if (!dbColumnsByTable.has(col.table_name)) {
          dbColumnsByTable.set(col.table_name, []);
        }
        dbColumnsByTable.get(col.table_name)!.push(col);
      }

      // 3. Get all schema definitions from baasix
      const allSchemaDefinitions = new Map<string, any>();
      // Access internal schemaDefinitions via the public API
      const schemasMap = schemaManager.getAllSchemas();
      for (const [collectionName] of schemasMap) {
        const schemaDef = await schemaManager.getSchemaDefinition(collectionName);
        if (schemaDef) {
          allSchemaDefinitions.set(collectionName, schemaDef);
        }
      }

      const schemaCollectionNames = new Set(allSchemaDefinitions.keys());

      // 4. Compute diffs

      // Tables in schema but not in database
      const tablesOnlyInSchema: string[] = [];
      for (const name of schemaCollectionNames) {
        if (!dbTableNames.has(name)) {
          tablesOnlyInSchema.push(name);
        }
      }

      // Tables in database but not in schema
      const tablesOnlyInDb: string[] = [];
      for (const name of dbTableNames) {
        if (!schemaCollectionNames.has(name)) {
          tablesOnlyInDb.push(name);
        }
      }

      // Per-table field diffs (only for tables that exist in both)
      const fieldDiffs: Array<{
        collection: string;
        fieldsOnlyInSchema: Array<{ column: string; type: string; fromField: string }>;
        fieldsOnlyInDb: Array<{ column: string; dataType: string; isNullable: string; columnDefault: string | null }>;
      }> = [];

      for (const [collectionName, schemaDef] of allSchemaDefinitions) {
        if (!dbTableNames.has(collectionName)) continue; // table doesn't exist in DB

        const expectedColumns = getExpectedColumns(schemaDef);
        const actualColumns = dbColumnsByTable.get(collectionName) || [];
        const actualColumnNames = new Set(actualColumns.map((c: any) => c.column_name));

        const fieldsOnlyInSchema: Array<{ column: string; type: string; fromField: string }> = [];
        const fieldsOnlyInDb: Array<{ column: string; dataType: string; isNullable: string; columnDefault: string | null }> = [];

        // Fields in schema but not in database
        for (const [colName, meta] of expectedColumns) {
          if (!actualColumnNames.has(colName)) {
            fieldsOnlyInSchema.push({ column: colName, type: meta.type, fromField: meta.fromField });
          }
        }

        // Fields in database but not in schema
        for (const col of actualColumns) {
          if (!expectedColumns.has(col.column_name)) {
            fieldsOnlyInDb.push({
              column: col.column_name,
              dataType: col.data_type,
              isNullable: col.is_nullable,
              columnDefault: col.column_default,
            });
          }
        }

        if (fieldsOnlyInSchema.length > 0 || fieldsOnlyInDb.length > 0) {
          fieldDiffs.push({
            collection: collectionName,
            fieldsOnlyInSchema,
            fieldsOnlyInDb,
          });
        }
      }

      // 5. Summary
      const summary = {
        totalSchemaCollections: schemaCollectionNames.size,
        totalDbTables: dbTableNames.size,
        tablesOnlyInSchemaCount: tablesOnlyInSchema.length,
        tablesOnlyInDbCount: tablesOnlyInDb.length,
        collectionsWithFieldDiffs: fieldDiffs.length,
      };

      return res.status(200).json({
        data: {
          summary,
          tablesOnlyInSchema,
          tablesOnlyInDb,
          fieldDiffs,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * DELETE /utils/schema-diff/table/schema/:collection
   * Remove a collection from schema definitions (keeps database table).
   */
  app.delete("/utils/schema-diff/table/schema/:collection", adminOnly, async (req, res, next) => {
    try {
      const { collection } = req.params;

      // Verify collection exists in schema
      const schemaDef = await schemaManager.getSchemaDefinition(collection);
      if (!schemaDef) {
        throw new APIError(`Collection '${collection}' not found in schema definitions`, 404);
      }

      // Prevent deleting system schemas
      if (collection.startsWith("baasix_")) {
        throw new APIError(`Cannot remove system schema '${collection}'`, 400);
      }

      await schemaManager.removeSchemaDefinition(collection);

      return res.status(200).json({
        data: { message: `Schema definition '${collection}' removed successfully` },
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * DELETE /utils/schema-diff/table/db/:table
   * Drop a table from the database (keeps schema definition).
   */
  app.delete("/utils/schema-diff/table/db/:table", adminOnly, async (req, res, next) => {
    try {
      const { table } = req.params;
      const sql = getSqlClient();

      // Validate table name: only allow alphanumeric and underscores
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
        throw new APIError("Invalid table name", 400);
      }

      // Verify table exists
      const exists = await sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = ${table}
        )
      `;
      if (!exists[0].exists) {
        throw new APIError(`Table '${table}' not found in database`, 404);
      }

      // Prevent dropping system tables
      if (table.startsWith("baasix_")) {
        throw new APIError(`Cannot drop system table '${table}'`, 400);
      }

      await sql.unsafe(`DROP TABLE IF EXISTS "${table}" CASCADE`);

      return res.status(200).json({
        data: { message: `Table '${table}' dropped from database successfully` },
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * DELETE /utils/schema-diff/field/schema/:collection/:field
   * Remove a field from a schema definition (keeps database column).
   */
  app.delete("/utils/schema-diff/field/schema/:collection/:field", adminOnly, async (req, res, next) => {
    try {
      const { collection, field } = req.params;

      const schemaDef = await schemaManager.getSchemaDefinition(collection);
      if (!schemaDef) {
        throw new APIError(`Collection '${collection}' not found in schema definitions`, 404);
      }

      if (!schemaDef.fields || !schemaDef.fields[field]) {
        throw new APIError(`Field '${field}' not found in schema for '${collection}'`, 404);
      }

      // Remove the field from schema
      const updatedSchema = { ...schemaDef };
      const updatedFields = { ...updatedSchema.fields };
      delete updatedFields[field];
      updatedSchema.fields = updatedFields;

      // Persist updated schema
      const db = getDatabase();
      const { pgTable, text, jsonb, timestamp } = await import("drizzle-orm/pg-core");
      const { eq } = await import("drizzle-orm");

      const baasixSchemaDefinition = pgTable("baasix_SchemaDefinition", {
        collectionName: text("collectionName").primaryKey().notNull(),
        schema: jsonb("schema").notNull(),
        createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow(),
        updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow(),
      });

      await db
        .update(baasixSchemaDefinition)
        .set({ schema: updatedSchema as any, updatedAt: new Date() } as any)
        .where(eq(baasixSchemaDefinition.collectionName, collection));

      // Update in-memory schema definition
      // Re-initialize the model so in-memory state matches
      await schemaManager.updateModel(collection, updatedSchema);

      return res.status(200).json({
        data: { message: `Field '${field}' removed from schema definition of '${collection}'` },
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * DELETE /utils/schema-diff/field/db/:collection/:column
   * Drop a column from a database table (keeps schema field).
   */
  app.delete("/utils/schema-diff/field/db/:collection/:column", adminOnly, async (req, res, next) => {
    try {
      const { collection, column } = req.params;
      const sql = getSqlClient();

      // Validate names
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(collection) || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(column)) {
        throw new APIError("Invalid table or column name", 400);
      }

      // Verify column exists
      const colExists = await sql`
        SELECT EXISTS (
          SELECT FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = ${collection}
            AND column_name = ${column}
        )
      `;
      if (!colExists[0].exists) {
        throw new APIError(`Column '${column}' not found in table '${collection}'`, 404);
      }

      await sql.unsafe(`ALTER TABLE "${collection}" DROP COLUMN IF EXISTS "${column}" CASCADE`);

      return res.status(200).json({
        data: { message: `Column '${column}' dropped from table '${collection}'` },
      });
    } catch (error) {
      next(error);
    }
  });
};

export default {
  id: "schema-diff",
  handler: registerEndpoint,
};
