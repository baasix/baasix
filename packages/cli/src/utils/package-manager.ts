import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export type PackageManager = "npm" | "pnpm" | "bun" | "yarn";

export function detectPackageManager(cwd: string): PackageManager {
  if (existsSync(path.join(cwd, "bun.lockb"))) {
    return "bun";
  }
  if (existsSync(path.join(cwd, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (existsSync(path.join(cwd, "yarn.lock"))) {
    return "yarn";
  }
  return "npm";
}

export function installDependencies({
  dependencies,
  packageManager,
  cwd,
  dev = false,
}: {
  dependencies: string[];
  packageManager: PackageManager;
  cwd: string;
  dev?: boolean;
}): Promise<boolean> {
  let installCommand: string;
  const devFlag = dev ? (packageManager === "npm" ? " --save-dev" : " -D") : "";

  switch (packageManager) {
    case "npm":
      installCommand = `npm install${devFlag}`;
      break;
    case "pnpm":
      installCommand = `pnpm add${devFlag}`;
      break;
    case "bun":
      installCommand = `bun add${devFlag}`;
      break;
    case "yarn":
      installCommand = `yarn add${devFlag}`;
      break;
    default:
      throw new Error("Invalid package manager");
  }

  const command = `${installCommand} ${dependencies.join(" ")}`;

  return new Promise((resolve, reject) => {
    exec(command, { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(true);
    });
  });
}
