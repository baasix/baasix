import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function getPackageInfo(): Promise<Record<string, unknown>> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const packageJsonPath = path.resolve(__dirname, "../../package.json");
  const content = await fs.readFile(packageJsonPath, "utf-8");
  return JSON.parse(content);
}
