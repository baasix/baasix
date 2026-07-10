import type { MigrationContext, MigrationResult } from "../services/MigrationService.js";

export const version = "0.1.83";
export const name = "Block type enum to string";
export const description = "Convert baasix_Block.type from a PG enum to varchar so new block types never need a migration";
export const type = "schema";

export async function up(context: MigrationContext): Promise<MigrationResult> {
  const { sql, log } = context;
  const cols = await sql`
    SELECT udt_name, data_type FROM information_schema.columns
    WHERE table_name = 'baasix_Block' AND column_name = 'type'`;
  if (cols.length === 0) {
    return { success: true, message: "baasix_Block.type not found; nothing to do" };
  }
  const { udt_name, data_type } = cols[0];
  if (data_type !== "USER-DEFINED") {
    return { success: true, message: `baasix_Block.type already ${data_type}; nothing to do` };
  }
  log(`Converting baasix_Block.type from enum "${udt_name}" to varchar`);
  await sql`ALTER TABLE "baasix_Block" ALTER COLUMN "type" TYPE varchar(64) USING "type"::text`;
  // Drop the orphaned enum type if nothing else uses it
  const uses = await sql`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE udt_name = ${udt_name}`;
  if (uses[0].n === 0) {
    await sql.unsafe(`DROP TYPE IF EXISTS "${udt_name}"`);
    log(`Dropped enum type "${udt_name}"`);
  }
  return { success: true, message: "baasix_Block.type converted to varchar", metadata: { previousEnum: udt_name } };
}

export async function down(context: MigrationContext): Promise<MigrationResult> {
  // Intentionally a no-op: recreating the enum would break rows using post-0.1.83
  // block types. varchar is strictly more permissive, so staying on it is safe.
  context.log("down() is a no-op for block-type-to-string");
  return { success: true, message: "No-op (varchar retained)" };
}

export default { version, name, description, type, up, down };
