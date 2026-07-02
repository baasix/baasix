/**
 * Migration: Restructure session limits
 * Version: 0.1.82
 * Type: data
 *
 * Converts legacy mobile_session_limit / web_session_limit / session_limit_roles
 * settings into the structured session_limits JSON column, then drops the legacy
 * columns and removes their field definitions from baasix_SchemaDefinition.
 */

import type { MigrationContext, MigrationResult } from "../services/MigrationService.js";

export const version = "0.1.82";
export const name = "Session limits restructure";
export const description = "Move session limits to structured session_limits JSON; drop legacy columns";
export const type = "data";

interface LegacyRow {
  mobile_session_limit?: number | null;
  web_session_limit?: number | null;
  session_limit_roles?: string[] | string | null;
}

/** Pure conversion of one legacy settings row; null means "leave session_limits NULL". */
export function convertLegacySessionLimits(row: LegacyRow): Record<string, any> | null {
  const entry: Record<string, number> = {};
  if (typeof row.web_session_limit === "number" && row.web_session_limit !== -1) {
    entry.web = row.web_session_limit;
  }
  if (typeof row.mobile_session_limit === "number" && row.mobile_session_limit !== -1) {
    entry.mobile = row.mobile_session_limit;
  }
  if (Object.keys(entry).length === 0) {
    return null;
  }

  let roles = row.session_limit_roles;
  if (typeof roles === "string") {
    try {
      roles = JSON.parse(roles);
    } catch {
      roles = null;
    }
  }

  if (Array.isArray(roles) && roles.length > 0) {
    const perRole: Record<string, any> = {};
    for (const roleId of roles) {
      perRole[String(roleId)] = { ...entry };
    }
    return { roles: perRole };
  }

  return { default: entry };
}

export async function up(context: MigrationContext): Promise<MigrationResult> {
  const { sql, log } = context;

  // Defensive: schema sync normally creates this before migrations run.
  await sql`ALTER TABLE "baasix_Settings" ADD COLUMN IF NOT EXISTS "session_limits" JSONB`;

  const legacyColumns = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'baasix_Settings' AND column_name = 'web_session_limit'
  `;

  let converted = 0;
  if (legacyColumns.length > 0) {
    const rows = await sql`
      SELECT id, "mobile_session_limit", "web_session_limit", "session_limit_roles", "session_limits"
      FROM "baasix_Settings"
    `;

    for (const row of rows) {
      if (row.session_limits) continue; // already configured in the new shape
      const newLimits = convertLegacySessionLimits(row as LegacyRow);
      if (!newLimits) continue;
      await sql`
        UPDATE "baasix_Settings"
        SET "session_limits" = ${JSON.stringify(newLimits)}::jsonb
        WHERE id = ${row.id}
      `;
      converted++;
    }
    log(`Converted ${converted} settings row(s) to session_limits`);

    await sql`
      ALTER TABLE "baasix_Settings"
      DROP COLUMN IF EXISTS "mobile_session_limit",
      DROP COLUMN IF EXISTS "web_session_limit",
      DROP COLUMN IF EXISTS "session_limit_roles"
    `;
    log("Dropped legacy session limit columns");
  } else {
    log("Legacy columns not present; nothing to convert");
  }

  // Remove legacy field definitions from the stored schema (sync never deletes fields).
  await sql`
    UPDATE "baasix_SchemaDefinition"
    SET schema = ((schema #- '{fields,mobile_session_limit}') #- '{fields,web_session_limit}') #- '{fields,session_limit_roles}'
    WHERE "collectionName" = 'baasix_Settings'
  `;
  log("Removed legacy field definitions from baasix_SchemaDefinition");

  return {
    success: true,
    message: "Session limits restructured",
    metadata: { convertedRows: converted },
  };
}

export async function down(context: MigrationContext): Promise<MigrationResult> {
  const { sql, log } = context;
  // Restore legacy columns (data is not reconstructed; new-shape config remains authoritative).
  await sql`
    ALTER TABLE "baasix_Settings"
    ADD COLUMN IF NOT EXISTS "mobile_session_limit" INTEGER DEFAULT -1,
    ADD COLUMN IF NOT EXISTS "web_session_limit" INTEGER DEFAULT -1,
    ADD COLUMN IF NOT EXISTS "session_limit_roles" JSON
  `;
  log("Restored legacy session limit columns (empty)");
  return { success: true, message: "Legacy columns restored" };
}

export default { version, name, description, type, up, down };
