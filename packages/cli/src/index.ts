import { Command } from "commander";
import { init } from "./commands/init.js";
import { generate } from "./commands/generate.js";
import { extension } from "./commands/extension.js";
import { migrate } from "./commands/migrate.js";
import { getPackageInfo } from "./utils/get-package-info.js";

import "dotenv/config";

// Handle exit signals
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

async function main() {
  const program = new Command("baasix");

  let packageInfo: Record<string, unknown> = {};
  try {
    packageInfo = await getPackageInfo();
  } catch {
    // Ignore errors reading package.json
  }

  program
    .addCommand(init)
    .addCommand(generate)
    .addCommand(extension)
    .addCommand(migrate)
    .version((packageInfo.version as string) || "0.1.0")
    .description("Baasix CLI - Backend-as-a-Service toolkit")
    .action(() => program.help());

  program.parse();
}

main().catch((error) => {
  console.error("Error running Baasix CLI:", error);
  process.exit(1);
});
