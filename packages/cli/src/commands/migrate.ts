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
import { getConfig, type BaasixConfig } from "../utils/get-config.js";
import {
  fetchMigrations,
  runMigrations as apiRunMigrations,
  rollbackMigrations as apiRollbackMigrations,
  type MigrationInfo,
} from "../utils/api-client.js";

type MigrateAction = "status" | "run" | "create" | "rollback" | "reset" | "list";

interface MigrateOptions {
  cwd: string;
  url?: string;
  action?: MigrateAction;
  name?: string;
  steps?: number;
  yes?: boolean;
}

async function migrateAction(action: MigrateAction | undefined, opts: MigrateOptions) {
  const cwd = path.resolve(opts.cwd);

  intro(chalk.bgMagenta.black(" Baasix Migrations "));

  // Load config
  const config = await getConfig(cwd);
  if (!config && !opts.url) {
    log.error(
      "No Baasix configuration found. Create a .env file with BAASIX_URL or use --url flag."
    );
    process.exit(1);
  }

  // Override URL if provided
  const effectiveConfig: BaasixConfig = config
    ? { ...config, url: opts.url || config.url }
    : { url: opts.url || "http://localhost:8056" };

  // Select action if not provided
  let selectedAction = action || opts.action;
  if (!selectedAction) {
    const result = await select({
      message: "What migration action do you want to perform?",
      options: [
        {
          value: "status",
          label: "Status",
          hint: "Show current migration status",
        },
        {
          value: "list",
          label: "List",
          hint: "List all available migrations",
        },
        {
          value: "run",
          label: "Run",
          hint: "Run pending migrations",
        },
        {
          value: "create",
          label: "Create",
          hint: "Create a new migration file",
        },
        {
          value: "rollback",
          label: "Rollback",
          hint: "Rollback the last batch of migrations",
        },
        {
          value: "reset",
          label: "Reset",
          hint: "Rollback all migrations (dangerous!)",
        },
      ],
    });

    if (isCancel(result)) {
      cancel("Operation cancelled");
      process.exit(0);
    }
    selectedAction = result as MigrateAction;
  }

  const s = spinner();

  try {
    switch (selectedAction) {
      case "status":
        await showStatus(s, effectiveConfig, cwd);
        break;

      case "list":
        await listMigrations(s, effectiveConfig, cwd);
        break;

      case "run":
        await runMigrations(s, effectiveConfig, cwd, opts.yes);
        break;

      case "create":
        await createMigration(s, cwd, opts.name);
        break;

      case "rollback":
        await rollbackMigrations(s, effectiveConfig, cwd, opts.steps || 1, opts.yes);
        break;

      case "reset":
        await resetMigrations(s, effectiveConfig, cwd, opts.yes);
        break;
    }
  } catch (error) {
    s.stop("Migration failed");
    if (error instanceof Error) {
      log.error(error.message);
    } else {
      log.error("Unknown error occurred");
    }
    process.exit(1);
  }
}

async function showStatus(
  s: ReturnType<typeof spinner>,
  config: BaasixConfig,
  cwd: string
) {
  s.start("Checking migration status...");

  // Get executed migrations from database
  const executedMigrations = await getExecutedMigrations(config);

  // Get local migration files
  const localMigrations = await getLocalMigrations(cwd);

  s.stop("Migration status retrieved");

  // Calculate pending
  const executedNames = new Set(executedMigrations.map((m) => m.name));
  const pendingMigrations = localMigrations.filter((m) => !executedNames.has(m));

  console.log();
  console.log(chalk.bold("📊 Migration Status"));
  console.log(chalk.dim("─".repeat(50)));
  console.log(`  Total migrations:    ${chalk.cyan(localMigrations.length)}`);
  console.log(`  Executed:            ${chalk.green(executedMigrations.length)}`);
  console.log(
    `  Pending:             ${pendingMigrations.length > 0 ? chalk.yellow(pendingMigrations.length) : chalk.gray("0")}`
  );
  console.log();

  if (pendingMigrations.length > 0) {
    console.log(chalk.bold("Pending migrations:"));
    for (const migration of pendingMigrations) {
      console.log(`  ${chalk.yellow("○")} ${migration}`);
    }
    console.log();
    console.log(
      chalk.dim(`Run ${chalk.cyan("baasix migrate run")} to execute pending migrations.`)
    );
  } else {
    console.log(chalk.green("✓ All migrations have been executed."));
  }

  outro("");
}

async function listMigrations(
  s: ReturnType<typeof spinner>,
  config: BaasixConfig,
  cwd: string
) {
  s.start("Fetching migrations...");

  const executedMigrations = await getExecutedMigrations(config);
  const localMigrations = await getLocalMigrations(cwd);

  s.stop("Migrations retrieved");

  const executedMap = new Map(executedMigrations.map((m) => [m.name, m]));

  console.log();
  console.log(chalk.bold("📋 All Migrations"));
  console.log(chalk.dim("─".repeat(70)));

  if (localMigrations.length === 0) {
    console.log(chalk.dim("  No migrations found."));
  } else {
    for (const name of localMigrations) {
      const executed = executedMap.get(name);
      if (executed) {
        const executedDate = executed.executedAt
          ? new Date(executed.executedAt).toLocaleDateString()
          : "unknown date";
        console.log(
          `  ${chalk.green("✓")} ${name} ${chalk.dim(`(batch ${executed.batch || "?"}, ${executedDate})`)}`
        );
      } else {
        console.log(`  ${chalk.yellow("○")} ${name} ${chalk.dim("(pending)")}`);
      }
    }
  }

  console.log();
  outro("");
}

async function runMigrations(
  s: ReturnType<typeof spinner>,
  config: BaasixConfig,
  cwd: string,
  skipConfirm?: boolean
) {
  s.start("Checking for pending migrations...");

  const executedMigrations = await getExecutedMigrations(config);
  const localMigrations = await getLocalMigrations(cwd);

  const executedNames = new Set(executedMigrations.map((m) => m.name));
  const pendingMigrations = localMigrations.filter((m) => !executedNames.has(m));

  if (pendingMigrations.length === 0) {
    s.stop("No pending migrations");
    log.info("All migrations have already been executed.");
    outro("");
    return;
  }

  s.stop(`Found ${pendingMigrations.length} pending migrations`);

  console.log();
  console.log(chalk.bold("Migrations to run:"));
  for (const name of pendingMigrations) {
    console.log(`  ${chalk.cyan("→")} ${name}`);
  }
  console.log();

  if (!skipConfirm) {
    const confirmed = await confirm({
      message: `Run ${pendingMigrations.length} migration(s)?`,
      initialValue: true,
    });

    if (isCancel(confirmed) || !confirmed) {
      cancel("Operation cancelled");
      process.exit(0);
    }
  }

  s.start("Running migrations...");

  try {
    const result = await apiRunMigrations(config, {
      step: pendingMigrations.length,
    });

    if (result.success) {
      s.stop("Migrations executed");
      outro(chalk.green(`✨ ${result.message}`));
    } else {
      s.stop("Migration failed");
      log.error(result.message);
      process.exit(1);
    }
  } catch (error) {
    s.stop("Migration failed");
    throw error;
  }
}

async function createMigration(
  s: ReturnType<typeof spinner>,
  cwd: string,
  name?: string
) {
  // Get migration name
  let migrationName = name;
  if (!migrationName) {
    const result = await text({
      message: "Migration name:",
      placeholder: "create_users_table",
      validate: (value) => {
        if (!value) return "Migration name is required";
        if (!/^[a-z0-9_]+$/i.test(value)) {
          return "Migration name can only contain letters, numbers, and underscores";
        }
        return undefined;
      },
    });

    if (isCancel(result)) {
      cancel("Operation cancelled");
      process.exit(0);
    }
    migrationName = result as string;
  }

  s.start("Creating migration file...");

  const migrationsDir = path.join(cwd, "migrations");

  // Ensure migrations directory exists
  if (!existsSync(migrationsDir)) {
    await fs.mkdir(migrationsDir, { recursive: true });
  }

  // Generate timestamp prefix
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, "")
    .slice(0, 14);
  const filename = `${timestamp}_${migrationName}.js`;
  const filepath = path.join(migrationsDir, filename);

  // Check if file exists
  if (existsSync(filepath)) {
    s.stop("File already exists");
    log.error(`Migration file ${filename} already exists.`);
    process.exit(1);
  }

  // Generate migration template
  const template = `/**
 * Migration: ${migrationName}
 * Created: ${new Date().toISOString()}
 */

/**
 * Run the migration
 * @param {import("@tspvivek/baasix-sdk").BaasixClient} baasix - Baasix client
 */
export async function up(baasix) {
  // Example: Create a collection
  // await baasix.schema.create("tableName", {
  //   name: "TableName",
  //   timestamps: true,
  //   fields: {
  //     id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
  //     name: { type: "String", allowNull: false, values: { length: 255 } },
  //   },
  // });

  // Example: Add a field
  // await baasix.schema.update("tableName", {
  //   fields: {
  //     newField: { type: "String", allowNull: true },
  //   },
  // });

  // Example: Insert data
  // await baasix.items("tableName").create({ name: "Example" });
}

/**
 * Reverse the migration
 * @param {import("@tspvivek/baasix-sdk").BaasixClient} baasix - Baasix client
 */
export async function down(baasix) {
  // Reverse the changes made in up()
  // Example: Drop a collection
  // await baasix.schema.delete("tableName");
}
`;

  await fs.writeFile(filepath, template);

  s.stop("Migration created");

  outro(chalk.green(`✨ Created migration: ${chalk.cyan(filename)}`));
  console.log();
  console.log(`  Edit: ${chalk.dim(path.relative(cwd, filepath))}`);
  console.log();
}

async function rollbackMigrations(
  s: ReturnType<typeof spinner>,
  config: BaasixConfig,
  cwd: string,
  steps: number,
  skipConfirm?: boolean
) {
  s.start("Fetching executed migrations...");

  const executedMigrations = await getExecutedMigrations(config);

  if (executedMigrations.length === 0) {
    s.stop("No migrations to rollback");
    log.info("No migrations have been executed.");
    outro("");
    return;
  }

  // Get migrations to rollback (by batch, descending)
  const sortedByBatch = [...executedMigrations].sort(
    (a, b) => (b.batch || 0) - (a.batch || 0)
  );
  const batchesToRollback = new Set<number>();
  const migrationsToRollback: MigrationInfo[] = [];

  for (const migration of sortedByBatch) {
    const batch = migration.batch || 0;
    if (batchesToRollback.size < steps) {
      batchesToRollback.add(batch);
    }
    if (batchesToRollback.has(batch)) {
      migrationsToRollback.push(migration);
    }
  }

  s.stop(`Found ${migrationsToRollback.length} migration(s) to rollback`);

  console.log();
  console.log(chalk.bold("Migrations to rollback:"));
  for (const migration of migrationsToRollback) {
    console.log(
      `  ${chalk.red("←")} ${migration.name} ${chalk.dim(`(batch ${migration.batch || "?"})`)}`
    );
  }
  console.log();

  if (!skipConfirm) {
    const confirmed = await confirm({
      message: `Rollback ${migrationsToRollback.length} migration(s)?`,
      initialValue: false,
    });

    if (isCancel(confirmed) || !confirmed) {
      cancel("Operation cancelled");
      process.exit(0);
    }
  }

  s.start("Rolling back migrations...");

  try {
    const result = await apiRollbackMigrations(config, {
      step: steps,
    });

    if (result.success) {
      s.stop("Rollback complete");
      outro(chalk.green(`✨ ${result.message}`));
    } else {
      s.stop("Rollback failed");
      log.error(result.message);
      process.exit(1);
    }
  } catch (error) {
    s.stop("Rollback failed");
    throw error;
  }
}

async function resetMigrations(
  s: ReturnType<typeof spinner>,
  config: BaasixConfig,
  cwd: string,
  skipConfirm?: boolean
) {
  s.start("Fetching all executed migrations...");

  const executedMigrations = await getExecutedMigrations(config);

  if (executedMigrations.length === 0) {
    s.stop("No migrations to reset");
    log.info("No migrations have been executed.");
    outro("");
    return;
  }

  s.stop(`Found ${executedMigrations.length} executed migration(s)`);

  console.log();
  log.warn(chalk.red.bold("⚠️  This will rollback ALL migrations!"));
  console.log();

  if (!skipConfirm) {
    const confirmed = await confirm({
      message: `Reset all ${executedMigrations.length} migration(s)? This cannot be undone!`,
      initialValue: false,
    });

    if (isCancel(confirmed) || !confirmed) {
      cancel("Operation cancelled");
      process.exit(0);
    }

    // Double confirmation for dangerous operation
    const doubleConfirm = await text({
      message: "Type 'reset' to confirm:",
      placeholder: "reset",
      validate: (value) =>
        value !== "reset" ? "Please type 'reset' to confirm" : undefined,
    });

    if (isCancel(doubleConfirm)) {
      cancel("Operation cancelled");
      process.exit(0);
    }
  }

  s.start("Resetting all migrations...");

  try {
    // Rollback all batches
    const maxBatch = Math.max(...executedMigrations.map((m) => m.batch || 0));
    const result = await apiRollbackMigrations(config, {
      step: maxBatch,
    });

    if (result.success) {
      s.stop("Reset complete");
      outro(chalk.green(`✨ ${result.message}`));
    } else {
      s.stop("Reset failed");
      log.error(result.message);
      process.exit(1);
    }
  } catch (error) {
    s.stop("Reset failed");
    throw error;
  }
}

async function getExecutedMigrations(config: BaasixConfig): Promise<MigrationInfo[]> {
  try {
    return await fetchMigrations(config);
  } catch {
    // If migrations endpoint doesn't exist, return empty
    return [];
  }
}

async function getLocalMigrations(cwd: string): Promise<string[]> {
  const migrationsDir = path.join(cwd, "migrations");

  if (!existsSync(migrationsDir)) {
    return [];
  }

  const files = await fs.readdir(migrationsDir);
  return files.filter((f) => f.endsWith(".js") || f.endsWith(".ts")).sort();
}

export const migrate = new Command("migrate")
  .description("Run database migrations")
  .argument(
    "[action]",
    "Migration action (status, list, run, create, rollback, reset)"
  )
  .option("-c, --cwd <path>", "Working directory", process.cwd())
  .option("--url <url>", "Baasix server URL")
  .option("-n, --name <name>", "Migration name (for create)")
  .option("-s, --steps <number>", "Number of batches to rollback", parseInt)
  .option("-y, --yes", "Skip confirmation prompts")
  .action(migrateAction);
