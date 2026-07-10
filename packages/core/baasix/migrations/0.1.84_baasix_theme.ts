import type { MigrationContext, MigrationResult } from "../services/MigrationService.js";

export const version = "0.1.84";
export const name = "baasix_Theme collection";
export const description = "Documents the addition of baasix_Theme to systemschema.ts. No-op: schemaManager.initialize() creates missing SYSTEM tables at boot.";
export const type = "schema";

/**
 * ⚠ Verified against live code (schemaManager.ts):
 *   initialize() -> ensureSystemSchemas() diffs systemSchemas (systemschema.ts) against
 *   baasix_SchemaDefinition; any collectionName not yet in that table is inserted and its
 *   name is pushed onto `needSyncing` (schemaManager.ts ~L284-291). initialize() then calls
 *   loadAndCreateAllSchemas(needSyncing) (~L128-130), which runs createTableFromSchema for
 *   every schema in needSyncing (~L523-532) — i.e. it CREATE TABLEs any new SYSTEM collection
 *   on every boot, including against a pre-existing database that predates this collection.
 *
 * baasix_Theme was added to systemschema.ts in this same release, so the table is created
 * automatically the next time the server boots against any DB (fresh or pre-existing) —
 * no explicit CREATE TABLE is needed here. This migration is a version marker only, kept
 * for changelog/history consistency with the migration-per-release convention.
 */
export async function up(context: MigrationContext): Promise<MigrationResult> {
  const { sql, log } = context;
  const tables = await sql`
    SELECT 1 FROM information_schema.tables WHERE table_name = 'baasix_Theme'`;
  if (tables.length > 0) {
    return { success: true, message: "baasix_Theme already exists (created by schemaManager at boot); nothing to do" };
  }
  log("baasix_Theme not found yet — schemaManager.initialize() will create it on next boot from systemschema.ts");
  return { success: true, message: "No-op: baasix_Theme is created by schemaManager.initialize() at boot, not by this migration" };
}

export async function down(context: MigrationContext): Promise<MigrationResult> {
  context.log("down() is a no-op for baasix_Theme (system-managed table)");
  return { success: true, message: "No-op" };
}

export default { version, name, description, type, up, down };
