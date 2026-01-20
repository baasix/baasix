import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  outro,
  select,
  spinner,
  text,
} from "@clack/prompts";
import chalk from "chalk";
import { Command } from "commander";
import { format as prettierFormat } from "prettier";
import { getConfig } from "../utils/get-config.js";
import { fetchSchemas, type SchemaInfo, type FieldDefinition } from "../utils/api-client.js";

type GenerateTarget = "types" | "sdk-types" | "schema-json";

interface GenerateOptions {
  cwd: string;
  output?: string;
  target?: GenerateTarget;
  url?: string;
  yes?: boolean;
}

async function generateAction(opts: GenerateOptions) {
  const cwd = path.resolve(opts.cwd);

  intro(chalk.bgBlue.black(" Baasix Type Generator "));

  // Load config
  const config = await getConfig(cwd);
  if (!config && !opts.url) {
    log.error("No Baasix configuration found. Create a .env file with BAASIX_URL or use --url flag.");
    process.exit(1);
  }

  const baasixUrl = opts.url || config?.url || "http://localhost:8056";

  // Select generation target
  let target = opts.target;
  if (!target) {
    const result = await select({
      message: "What do you want to generate?",
      options: [
        {
          value: "types",
          label: "TypeScript Types",
          hint: "Generate types for all collections",
        },
        {
          value: "sdk-types",
          label: "SDK Collection Types",
          hint: "Generate typed SDK helpers for collections",
        },
        {
          value: "schema-json",
          label: "Schema JSON",
          hint: "Export all schemas as JSON",
        },
      ],
    });

    if (isCancel(result)) {
      cancel("Operation cancelled");
      process.exit(0);
    }
    target = result as GenerateTarget;
  }

  // Get output path
  let outputPath = opts.output;
  if (!outputPath) {
    const defaultPath = target === "schema-json" ? "schemas.json" : "baasix.d.ts";
    const result = await text({
      message: "Output file path:",
      placeholder: defaultPath,
      defaultValue: defaultPath,
    });

    if (isCancel(result)) {
      cancel("Operation cancelled");
      process.exit(0);
    }
    outputPath = result as string;
  }

  const s = spinner();
  s.start("Fetching schemas from Baasix...");

  try {
    // Fetch schemas from API
    const schemas = await fetchSchemas({
      url: baasixUrl,
      email: config?.email,
      password: config?.password,
      token: config?.token,
    });

    if (!schemas || schemas.length === 0) {
      s.stop("No schemas found");
      log.warn("No schemas found in your Baasix instance.");
      process.exit(0);
    }

    s.message(`Found ${schemas.length} schemas`);

    let output: string;

    if (target === "types") {
      output = generateTypeScriptTypes(schemas);
    } else if (target === "sdk-types") {
      output = generateSDKTypes(schemas);
    } else {
      output = JSON.stringify(schemas, null, 2);
    }

    // Format with prettier if TypeScript
    if (target !== "schema-json") {
      try {
        output = await prettierFormat(output, {
          parser: "typescript",
          printWidth: 100,
          tabWidth: 2,
          singleQuote: true,
        });
      } catch {
        // Ignore prettier errors
      }
    }

    // Check if file exists
    const fullOutputPath = path.resolve(cwd, outputPath);
    if (existsSync(fullOutputPath) && !opts.yes) {
      s.stop("File already exists");
      const overwrite = await confirm({
        message: `File ${outputPath} already exists. Overwrite?`,
        initialValue: true,
      });

      if (isCancel(overwrite) || !overwrite) {
        cancel("Operation cancelled");
        process.exit(0);
      }
      s.start("Writing file...");
    }

    // Ensure directory exists
    const outputDir = path.dirname(fullOutputPath);
    if (!existsSync(outputDir)) {
      await fs.mkdir(outputDir, { recursive: true });
    }

    await fs.writeFile(fullOutputPath, output);

    s.stop("Types generated successfully");

    outro(chalk.green(`✨ Generated ${outputPath}`));

    // Print usage info
    if (target === "types" || target === "sdk-types") {
      console.log();
      console.log(chalk.bold("Usage:"));
      console.log(`  ${chalk.dim("// Import types in your TypeScript files")}`);
      console.log(`  ${chalk.cyan(`import type { Products, Users } from "./${outputPath.replace(/\.d\.ts$/, "")}";`)}`);
      console.log();
    }

  } catch (error: any) {
    s.stop("Failed to generate types");
    
    // Check for 403 Forbidden - schema access denied
    if (error?.response?.status === 403 || error?.status === 403) {
      log.error("Schema access denied (403 Forbidden)");
      console.log();
      console.log(chalk.yellow("Possible causes:"));
      console.log(chalk.dim("  1. SCHEMAS_PUBLIC=false is set on the server"));
      console.log(chalk.dim("  2. You don't have read permission on baasix_SchemaDefinition"));
      console.log();
      console.log(chalk.yellow("Solutions:"));
      console.log(chalk.dim("  • Set SCHEMAS_PUBLIC=true in server .env (allows all authenticated users)"));
      console.log(chalk.dim("  • Use admin credentials in CLI config (.env or baasix.config.json)"));
      console.log(chalk.dim("  • Grant read permission to your role for baasix_SchemaDefinition collection"));
      process.exit(1);
    }
    
    // Check for 401 Unauthorized
    if (error?.response?.status === 401 || error?.status === 401) {
      log.error("Authentication required (401 Unauthorized)");
      console.log();
      console.log(chalk.yellow("Add credentials to your config:"));
      console.log(chalk.dim("  • Create .env with BAASIX_EMAIL and BAASIX_PASSWORD"));
      console.log(chalk.dim("  • Or use BAASIX_TOKEN for token-based auth"));
      process.exit(1);
    }
    
    if (error instanceof Error) {
      log.error(error.message);
    } else {
      log.error("Unknown error occurred");
    }
    process.exit(1);
  }
}

function fieldTypeToTS(field: FieldDefinition, allSchemas?: SchemaInfo[]): { type: string; jsdoc?: string } {
  // Handle relation fields
  if (field.relType && field.target) {
    const targetType = toPascalCase(field.target);
    
    // Check if it's a system collection (baasix_*)
    const isSystemCollection = field.target.startsWith("baasix_");
    
    // For HasMany and BelongsToMany, return array type
    if (field.relType === "HasMany" || field.relType === "BelongsToMany") {
      return { type: `${targetType}[] | null` };
    }
    
    // For BelongsTo and HasOne, return single type
    return { type: `${targetType} | null` };
  }

  const type = field.type?.toUpperCase(); // Normalize to uppercase for comparison

  // Handle nullable
  const nullable = field.allowNull !== false;
  const nullSuffix = nullable ? " | null" : "";

  // Build JSDoc comment for validations
  const jsdocParts: string[] = [];
  
  if (field.validate) {
    if (field.validate.min !== undefined) jsdocParts.push(`@min ${field.validate.min}`);
    if (field.validate.max !== undefined) jsdocParts.push(`@max ${field.validate.max}`);
    if (field.validate.len) jsdocParts.push(`@length ${field.validate.len[0]}-${field.validate.len[1]}`);
    if (field.validate.isEmail) jsdocParts.push(`@format email`);
    if (field.validate.isUrl) jsdocParts.push(`@format url`);
    if (field.validate.isIP) jsdocParts.push(`@format ip`);
    if (field.validate.isUUID) jsdocParts.push(`@format uuid`);
    if (field.validate.regex) jsdocParts.push(`@pattern ${field.validate.regex}`);
  }
  
  // Add length info for strings
  if (field.values && typeof field.values === 'object' && !Array.isArray(field.values)) {
    const vals = field.values as Record<string, unknown>;
    if (vals.length) jsdocParts.push(`@maxLength ${vals.length}`);
    if (vals.precision && vals.scale) jsdocParts.push(`@precision ${vals.precision},${vals.scale}`);
  }

  const jsdoc = jsdocParts.length > 0 ? jsdocParts.join(' ') : undefined;

  switch (type) {
    case "STRING":
    case "TEXT":
    case "UUID":
    case "SUID":
      return { type: `string${nullSuffix}`, jsdoc };

    case "INTEGER":
    case "BIGINT":
    case "FLOAT":
    case "REAL":
    case "DOUBLE":
    case "DECIMAL":
      return { type: `number${nullSuffix}`, jsdoc };

    case "BOOLEAN":
      return { type: `boolean${nullSuffix}`, jsdoc };

    case "DATE":
    case "DATETIME":
    case "TIME":
      return { type: `string${nullSuffix}`, jsdoc }; // ISO date strings

    case "JSON":
    case "JSONB":
      return { type: `Record<string, unknown>${nullSuffix}`, jsdoc };

    case "ARRAY": {
      const vals = field.values as Record<string, unknown> | undefined;
      const arrayType = vals?.type as string || "unknown";
      const innerType = arrayType.toUpperCase() === "STRING" ? "string" :
                        arrayType.toUpperCase() === "INTEGER" ? "number" :
                        arrayType.toUpperCase() === "BOOLEAN" ? "boolean" : "unknown";
      return { type: `${innerType}[]${nullSuffix}`, jsdoc };
    }

    case "ENUM": {
      // Enum values can be directly in field.values as array or in field.values.values
      let enumValues: string[] | undefined;
      
      if (Array.isArray(field.values)) {
        enumValues = field.values as string[];
      } else if (field.values && typeof field.values === 'object') {
        const vals = field.values as Record<string, unknown>;
        if (Array.isArray(vals.values)) {
          enumValues = vals.values as string[];
        }
      }
      
      if (enumValues && enumValues.length > 0) {
        const enumType = enumValues.map((v: string) => `"${v}"`).join(" | ");
        return { type: `(${enumType})${nullSuffix}`, jsdoc };
      }
      return { type: `string${nullSuffix}`, jsdoc };
    }

    case "GEOMETRY":
    case "POINT":
    case "LINESTRING":
    case "POLYGON":
      return { type: `GeoJSON.Geometry${nullSuffix}`, jsdoc };

    default:
      return { type: `unknown${nullSuffix}`, jsdoc };
  }
}

function toPascalCase(str: string): string {
  return str
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}

function generateTypeScriptTypes(schemas: SchemaInfo[]): string {
  const lines: string[] = [
    "/**",
    " * Auto-generated TypeScript types for Baasix collections",
    ` * Generated at: ${new Date().toISOString()}`,
    " * ",
    " * Do not edit this file manually. Re-run 'baasix generate types' to update.",
    " */",
    "",
    "// GeoJSON types for PostGIS fields",
    "declare namespace GeoJSON {",
    "  interface Point { type: 'Point'; coordinates: [number, number]; }",
    "  interface LineString { type: 'LineString'; coordinates: [number, number][]; }",
    "  interface Polygon { type: 'Polygon'; coordinates: [number, number][][]; }",
    "  type Geometry = Point | LineString | Polygon;",
    "}",
    "",
  ];

  // Collect all referenced system collections
  const referencedSystemCollections = new Set<string>();
  for (const schema of schemas) {
    for (const field of Object.values(schema.schema.fields)) {
      const fieldDef = field as FieldDefinition;
      if (fieldDef.relType && fieldDef.target && fieldDef.target.startsWith("baasix_")) {
        referencedSystemCollections.add(fieldDef.target);
      }
    }
  }

  // Generate types for referenced system collections first
  const systemSchemas = schemas.filter(
    (s) => referencedSystemCollections.has(s.collectionName)
  );

  for (const schema of systemSchemas) {
    const typeName = toPascalCase(schema.collectionName);
    const fields = schema.schema.fields;

    lines.push(`/**`);
    lines.push(` * ${schema.schema.name || schema.collectionName} (system collection)`);
    lines.push(` */`);
    lines.push(`export interface ${typeName} {`);

    for (const [fieldName, field] of Object.entries(fields)) {
      const fieldDef = field as FieldDefinition;
      // Skip relation fields for system collections to avoid circular refs
      if (fieldDef.relType) continue;
      
      const { type: tsType, jsdoc } = fieldTypeToTS(fieldDef, schemas);
      const optional = fieldDef.allowNull !== false && !fieldDef.primaryKey ? "?" : "";
      if (jsdoc) {
        lines.push(`  /** ${jsdoc} */`);
      }
      lines.push(`  ${fieldName}${optional}: ${tsType};`);
    }

    lines.push(`}`);
    lines.push("");
  }

  // Filter out system collections for user schemas
  const userSchemas = schemas.filter(
    (s) => !s.collectionName.startsWith("baasix_")
  );

  for (const schema of userSchemas) {
    const typeName = toPascalCase(schema.collectionName);
    const fields = schema.schema.fields;

    lines.push(`/**`);
    lines.push(` * ${schema.schema.name || schema.collectionName} collection`);
    lines.push(` */`);
    lines.push(`export interface ${typeName} {`);

    for (const [fieldName, field] of Object.entries(fields)) {
      const fieldDef = field as FieldDefinition;
      const { type: tsType, jsdoc } = fieldTypeToTS(fieldDef, schemas);
      const optional = fieldDef.allowNull !== false && !fieldDef.primaryKey ? "?" : "";
      if (jsdoc) {
        lines.push(`  /** ${jsdoc} */`);
      }
      lines.push(`  ${fieldName}${optional}: ${tsType};`);
    }

    // Add timestamp fields if enabled
    if (schema.schema.timestamps) {
      lines.push(`  createdAt?: string;`);
      lines.push(`  updatedAt?: string;`);
    }

    // Add soft delete field if paranoid
    if (schema.schema.paranoid) {
      lines.push(`  deletedAt?: string | null;`);
    }

    lines.push(`}`);
    lines.push("");
  }

  // Generate a union type of all collection names
  lines.push("/**");
  lines.push(" * All collection names");
  lines.push(" */");
  lines.push("export type CollectionName =");
  for (const schema of userSchemas) {
    lines.push(`  | "${schema.collectionName}"`);
  }
  lines.push(";");
  lines.push("");

  // Generate a type map
  lines.push("/**");
  lines.push(" * Map collection names to their types");
  lines.push(" */");
  lines.push("export interface CollectionTypeMap {");
  for (const schema of userSchemas) {
    const typeName = toPascalCase(schema.collectionName);
    lines.push(`  ${schema.collectionName}: ${typeName};`);
  }
  lines.push("}");
  lines.push("");

  return lines.join("\n");
}

function generateSDKTypes(schemas: SchemaInfo[]): string {
  const lines: string[] = [
    "/**",
    " * Auto-generated typed SDK helpers for Baasix collections",
    ` * Generated at: ${new Date().toISOString()}`,
    " * ",
    " * Do not edit this file manually. Re-run 'baasix generate sdk-types' to update.",
    " */",
    "",
    'import { createBaasix } from "@tspvivek/baasix-sdk";',
    'import type { QueryParams, Filter, PaginatedResponse } from "@tspvivek/baasix-sdk";',
    "",
  ];

  // Generate types first
  lines.push(generateTypeScriptTypes(schemas));

  // Generate typed items helper
  lines.push("/**");
  lines.push(" * Create a typed Baasix client with collection-specific methods");
  lines.push(" */");
  lines.push("export function createTypedBaasix(config: Parameters<typeof createBaasix>[0]) {");
  lines.push("  const client = createBaasix(config);");
  lines.push("");
  lines.push("  return {");
  lines.push("    ...client,");
  lines.push("    /**");
  lines.push("     * Type-safe items access");
  lines.push("     */");
  lines.push("    collections: {");

  const userSchemas = schemas.filter((s) => !s.collectionName.startsWith("baasix_"));

  for (const schema of userSchemas) {
    const typeName = toPascalCase(schema.collectionName);
    lines.push(`      ${schema.collectionName}: client.items<${typeName}>("${schema.collectionName}"),`);
  }

  lines.push("    },");
  lines.push("  };");
  lines.push("}");
  lines.push("");

  return lines.join("\n");
}

export const generate = new Command("generate")
  .alias("gen")
  .description("Generate TypeScript types from Baasix schemas")
  .option("-c, --cwd <path>", "Working directory", process.cwd())
  .option("-o, --output <path>", "Output file path")
  .option("-t, --target <target>", "Generation target (types, sdk-types, schema-json)")
  .option("--url <url>", "Baasix server URL")
  .option("-y, --yes", "Skip confirmation prompts")
  .action(generateAction);
