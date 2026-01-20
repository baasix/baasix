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
  multiselect,
} from "@clack/prompts";
import chalk from "chalk";
import { Command } from "commander";
import crypto from "node:crypto";
import { detectPackageManager, installDependencies, type PackageManager } from "../utils/package-manager.js";

type ProjectTemplate = "api" | "nextjs" | "nextjs-app";

interface InitOptions {
  cwd: string;
  template?: ProjectTemplate;
  name?: string;
  yes?: boolean;
}

interface ProjectConfig {
  projectName: string;
  template: ProjectTemplate;
  // Database
  databaseUrl: string;
  // Features
  socketEnabled: boolean;
  multiTenant: boolean;
  publicRegistration: boolean;
  // Storage
  storageDriver: "LOCAL" | "S3";
  s3Config?: {
    endpoint: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
    region: string;
  };
  // Cache
  cacheAdapter: "memory" | "redis";
  redisUrl?: string;
  // Auth
  authServices: string[];
  // Mail
  mailEnabled: boolean;
  // OpenAPI
  openApiEnabled: boolean;
}

function generateSecret(length: number = 64): string {
  return crypto.randomBytes(length).toString("base64url").slice(0, length);
}

async function initAction(opts: InitOptions) {
  const cwd = path.resolve(opts.cwd);

  intro(chalk.bgCyan.black(" Baasix Project Setup "));

  // Get project name
  let projectName = opts.name;
  if (!projectName) {
    const result = await text({
      message: "What is your project name?",
      placeholder: "my-baasix-app",
      defaultValue: "my-baasix-app",
      validate: (value) => {
        if (!value) return "Project name is required";
        if (!/^[a-z0-9-_]+$/i.test(value)) return "Project name must be alphanumeric with dashes or underscores";
        return undefined;
      },
    });

    if (isCancel(result)) {
      cancel("Operation cancelled");
      process.exit(0);
    }
    projectName = result as string;
  }

  // Select template
  let template = opts.template;
  if (!template) {
    const result = await select({
      message: "Select a project template:",
      options: [
        {
          value: "api",
          label: "API Only",
          hint: "Baasix server with basic configuration",
        },
        {
          value: "nextjs-app",
          label: "Next.js (App Router)",
          hint: "Next.js 14+ with App Router and SDK integration",
        },
        {
          value: "nextjs",
          label: "Next.js (Pages Router)",
          hint: "Next.js with Pages Router and SDK integration",
        },
      ],
    });

    if (isCancel(result)) {
      cancel("Operation cancelled");
      process.exit(0);
    }
    template = result as ProjectTemplate;
  }

  // Collect configuration options
  const config = await collectProjectConfig(projectName, template, opts.yes);
  if (!config) {
    cancel("Operation cancelled");
    process.exit(0);
  }

  const projectPath = path.join(cwd, projectName);

  // Check if directory exists
  if (existsSync(projectPath)) {
    const overwrite = await confirm({
      message: `Directory ${projectName} already exists. Overwrite?`,
      initialValue: false,
    });

    if (isCancel(overwrite) || !overwrite) {
      cancel("Operation cancelled");
      process.exit(0);
    }
  }

  const s = spinner();
  s.start("Creating project structure...");

  try {
    // Create project directory
    await fs.mkdir(projectPath, { recursive: true });

    // Generate based on template
    if (template === "api") {
      await createApiProject(projectPath, config);
    } else if (template === "nextjs-app" || template === "nextjs") {
      await createNextJsProject(projectPath, config, template === "nextjs-app");
    }

    s.stop("Project structure created");

    // Detect package manager
    const packageManager = detectPackageManager(cwd);

    // Install dependencies
    const shouldInstall = opts.yes || await confirm({
      message: `Install dependencies with ${packageManager}?`,
      initialValue: true,
    });

    if (shouldInstall && !isCancel(shouldInstall)) {
      s.start("Installing dependencies...");
      try {
        await installDependencies({
          dependencies: [],
          packageManager,
          cwd: projectPath,
        });
        s.stop("Dependencies installed");
      } catch (error) {
        s.stop("Failed to install dependencies");
        log.warn(`Run ${chalk.cyan(`cd ${projectName} && ${packageManager} install`)} to install manually`);
      }
    }

    outro(chalk.green("✨ Project created successfully!"));

    // Print next steps
    console.log();
    console.log(chalk.bold("Next steps:"));
    console.log(`  ${chalk.cyan(`cd ${projectName}`)}`);
    if (template === "api") {
      console.log(`  ${chalk.cyan("# Review and update your .env file")}`);
      console.log(`  ${chalk.cyan(`${packageManager} run dev`)}`);
    } else {
      console.log(`  ${chalk.cyan(`${packageManager} run dev`)} ${chalk.dim("# Start Next.js frontend")}`);
      console.log();
      console.log(chalk.dim("  Note: This is a frontend-only project. You need a separate Baasix API."));
      console.log(chalk.dim(`  To create an API: ${chalk.cyan("npx baasix init --template api")}`));
    }
    console.log();

  } catch (error) {
    s.stop("Failed to create project");
    log.error(error instanceof Error ? error.message : "Unknown error");
    process.exit(1);
  }
}

async function collectProjectConfig(
  projectName: string,
  template: ProjectTemplate,
  skipPrompts?: boolean
): Promise<ProjectConfig | null> {
  // If skipPrompts is true, return default configuration
  if (skipPrompts) {
    return {
      projectName,
      template,
      databaseUrl: "postgresql://postgres:password@localhost:5432/baasix",
      socketEnabled: false,
      multiTenant: false,
      publicRegistration: true,
      storageDriver: "LOCAL",
      s3Config: undefined,
      cacheAdapter: "memory",
      redisUrl: undefined,
      authServices: ["LOCAL"],
      mailEnabled: false,
      openApiEnabled: true,
    };
  }

  // Database URL
  const dbUrl = await text({
    message: "PostgreSQL connection URL:",
    placeholder: "postgresql://postgres:password@localhost:5432/baasix",
    defaultValue: "postgresql://postgres:password@localhost:5432/baasix",
  });

  if (isCancel(dbUrl)) return null;

  // Multi-tenant
  const multiTenant = await confirm({
    message: "Enable multi-tenancy?",
    initialValue: false,
  });

  if (isCancel(multiTenant)) return null;

  // Public registration
  const publicRegistration = await confirm({
    message: "Allow public user registration?",
    initialValue: true,
  });

  if (isCancel(publicRegistration)) return null;

  // Real-time / Socket
  const socketEnabled = await confirm({
    message: "Enable real-time features (WebSocket)?",
    initialValue: false,
  });

  if (isCancel(socketEnabled)) return null;

  // Storage driver
  const storageDriver = await select({
    message: "Select storage driver:",
    options: [
      { value: "LOCAL", label: "Local Storage", hint: "Store files locally in uploads folder" },
      { value: "S3", label: "S3 Compatible", hint: "AWS S3, DigitalOcean Spaces, MinIO, etc." },
    ],
  });

  if (isCancel(storageDriver)) return null;

  let s3Config: ProjectConfig["s3Config"];
  if (storageDriver === "S3") {
    const endpoint = await text({
      message: "S3 endpoint:",
      placeholder: "s3.amazonaws.com",
      defaultValue: "s3.amazonaws.com",
    });
    if (isCancel(endpoint)) return null;

    const bucket = await text({
      message: "S3 bucket name:",
      placeholder: "my-bucket",
    });
    if (isCancel(bucket)) return null;

    const accessKey = await text({
      message: "S3 Access Key ID:",
      placeholder: "AKIAIOSFODNN7EXAMPLE",
    });
    if (isCancel(accessKey)) return null;

    const secretKey = await text({
      message: "S3 Secret Access Key:",
      placeholder: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    });
    if (isCancel(secretKey)) return null;

    const region = await text({
      message: "S3 Region:",
      placeholder: "us-east-1",
      defaultValue: "us-east-1",
    });
    if (isCancel(region)) return null;

    s3Config = {
      endpoint: endpoint as string,
      bucket: bucket as string,
      accessKey: accessKey as string,
      secretKey: secretKey as string,
      region: region as string,
    };
  }

  // Cache adapter
  const cacheAdapter = await select({
    message: "Select cache adapter:",
    options: [
      { value: "memory", label: "In-Memory", hint: "Simple, good for development" },
      { value: "redis", label: "Redis/Valkey", hint: "Recommended for production" },
    ],
  });

  if (isCancel(cacheAdapter)) return null;

  let redisUrl: string | undefined;
  if (cacheAdapter === "redis") {
    const url = await text({
      message: "Redis connection URL:",
      placeholder: "redis://localhost:6379",
      defaultValue: "redis://localhost:6379",
    });
    if (isCancel(url)) return null;
    redisUrl = url as string;
  }

  // Auth services
  const authServices = await multiselect({
    message: "Select authentication methods:",
    options: [
      { value: "LOCAL", label: "Email/Password", hint: "Built-in authentication" },
      { value: "GOOGLE", label: "Google OAuth" },
      { value: "FACEBOOK", label: "Facebook OAuth" },
      { value: "GITHUB", label: "GitHub OAuth" },
      { value: "APPLE", label: "Apple Sign In" },
    ],
    initialValues: ["LOCAL"],
    required: true,
  });

  if (isCancel(authServices)) return null;

  // OpenAPI
  const openApiEnabled = await confirm({
    message: "Enable OpenAPI documentation (Swagger)?",
    initialValue: true,
  });

  if (isCancel(openApiEnabled)) return null;

  // Mail (optional)
  const mailEnabled = await confirm({
    message: "Configure email sending?",
    initialValue: false,
  });

  if (isCancel(mailEnabled)) return null;

  return {
    projectName,
    template,
    databaseUrl: dbUrl as string,
    socketEnabled: socketEnabled as boolean,
    multiTenant: multiTenant as boolean,
    publicRegistration: publicRegistration as boolean,
    storageDriver: storageDriver as "LOCAL" | "S3",
    s3Config,
    cacheAdapter: cacheAdapter as "memory" | "redis",
    redisUrl,
    authServices: authServices as string[],
    mailEnabled: mailEnabled as boolean,
    openApiEnabled: openApiEnabled as boolean,
  };
}

async function createApiProject(projectPath: string, config: ProjectConfig) {
  const secretKey = generateSecret(64);

  // package.json
  const packageJson = {
    name: config.projectName,
    version: "0.1.0",
    type: "module",
    scripts: {
      dev: "tsx watch server.js",
      start: "tsx server.js",
    },
    dependencies: {
      "@tspvivek/baasix": "latest",
      "dotenv": "^16.3.1",
    },
    devDependencies: {
      "tsx": "^4.16.0",
    },
  };

  await fs.writeFile(
    path.join(projectPath, "package.json"),
    JSON.stringify(packageJson, null, 2)
  );

  // server.js
  const serverJs = `import { startServer } from "@tspvivek/baasix";

startServer({
  port: process.env.PORT || 8056,
  logger: {
    level: process.env.LOG_LEVEL || "info",
    pretty: process.env.NODE_ENV !== "production",
  },
}).catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
`;

  await fs.writeFile(path.join(projectPath, "server.js"), serverJs);

  // Generate .env file based on config
  const envContent = generateEnvContent(config, secretKey);
  await fs.writeFile(path.join(projectPath, ".env"), envContent);

  // .env.example (sanitized version)
  const envExample = generateEnvExample(config);
  await fs.writeFile(path.join(projectPath, ".env.example"), envExample);

  // .gitignore
  const gitignore = `node_modules/
.env
uploads/
logs/
dist/
.cache/
.temp/
`;

  await fs.writeFile(path.join(projectPath, ".gitignore"), gitignore);

  // Create extensions directory
  await fs.mkdir(path.join(projectPath, "extensions"), { recursive: true });
  await fs.writeFile(
    path.join(projectPath, "extensions", ".gitkeep"),
    "# Place your Baasix extensions here\n"
  );

  // Create uploads directory (for local storage)
  if (config.storageDriver === "LOCAL") {
    await fs.mkdir(path.join(projectPath, "uploads"), { recursive: true });
    await fs.writeFile(path.join(projectPath, "uploads", ".gitkeep"), "");
  }

  // Create migrations directory
  await fs.mkdir(path.join(projectPath, "migrations"), { recursive: true });
  await fs.writeFile(path.join(projectPath, "migrations", ".gitkeep"), "");

  // README.md
  const readme = generateReadme(config);
  await fs.writeFile(path.join(projectPath, "README.md"), readme);
}

function generateEnvContent(config: ProjectConfig, secretKey: string): string {
  const lines: string[] = [];

  // Server section
  lines.push("#-----------------------------------");
  lines.push("# Server");
  lines.push("#-----------------------------------");
  lines.push("PORT=8056");
  lines.push("HOST=localhost");
  lines.push("NODE_ENV=development");
  lines.push("LOG_LEVEL=info");
  lines.push("");

  // Database section
  lines.push("#-----------------------------------");
  lines.push("# Database");
  lines.push("#-----------------------------------");
  lines.push(`DATABASE_URL="${config.databaseUrl}"`);
  lines.push("DATABASE_LOGGING=false");
  lines.push("DATABASE_POOL_MAX=20");
  lines.push("");

  // Security section
  lines.push("#-----------------------------------");
  lines.push("# Security");
  lines.push("#-----------------------------------");
  lines.push(`SECRET_KEY=${secretKey}`);
  lines.push("ACCESS_TOKEN_EXPIRES_IN=31536000");
  lines.push("");

  // Multi-tenancy section
  lines.push("#-----------------------------------");
  lines.push("# Multi-tenancy");
  lines.push("#-----------------------------------");
  lines.push(`MULTI_TENANT=${config.multiTenant}`);
  lines.push(`PUBLIC_REGISTRATION=${config.publicRegistration}`);
  if (!config.multiTenant) {
    lines.push("DEFAULT_ROLE_REGISTERED=user");
  }
  lines.push("");

  // Socket section
  lines.push("#-----------------------------------");
  lines.push("# Real-time (WebSocket)");
  lines.push("#-----------------------------------");
  lines.push(`SOCKET_ENABLED=${config.socketEnabled}`);
  if (config.socketEnabled) {
    lines.push('SOCKET_CORS_ENABLED_ORIGINS="http://localhost:3000,http://localhost:8056"');
    lines.push("SOCKET_PATH=/realtime");
    if (config.cacheAdapter === "redis" && config.redisUrl) {
      lines.push("SOCKET_REDIS_ENABLED=true");
      lines.push(`SOCKET_REDIS_URL=${config.redisUrl}`);
    }
  }
  lines.push("");

  // Cache section
  lines.push("#-----------------------------------");
  lines.push("# Cache");
  lines.push("#-----------------------------------");
  lines.push("CACHE_ENABLED=true");
  lines.push(`CACHE_ADAPTER=${config.cacheAdapter}`);
  lines.push("CACHE_TTL=300");
  lines.push("CACHE_STRATEGY=explicit");
  if (config.cacheAdapter === "memory") {
    lines.push("CACHE_SIZE_GB=1");
  } else if (config.cacheAdapter === "redis" && config.redisUrl) {
    lines.push(`CACHE_REDIS_URL=${config.redisUrl}`);
  }
  lines.push("");

  // Storage section
  lines.push("#-----------------------------------");
  lines.push("# Storage");
  lines.push("#-----------------------------------");
  if (config.storageDriver === "LOCAL") {
    lines.push('STORAGE_SERVICES_ENABLED="LOCAL"');
    lines.push('STORAGE_DEFAULT_SERVICE="LOCAL"');
    lines.push("STORAGE_TEMP_PATH=./.temp");
    lines.push("");
    lines.push("# Local Storage");
    lines.push("LOCAL_STORAGE_DRIVER=LOCAL");
    lines.push('LOCAL_STORAGE_PATH="./uploads"');
  } else if (config.storageDriver === "S3" && config.s3Config) {
    lines.push('STORAGE_SERVICES_ENABLED="S3"');
    lines.push('STORAGE_DEFAULT_SERVICE="S3"');
    lines.push("STORAGE_TEMP_PATH=./.temp");
    lines.push("");
    lines.push("# S3 Compatible Storage");
    lines.push("S3_STORAGE_DRIVER=S3");
    lines.push(`S3_STORAGE_ENDPOINT=${config.s3Config.endpoint}`);
    lines.push(`S3_STORAGE_BUCKET=${config.s3Config.bucket}`);
    lines.push(`S3_STORAGE_ACCESS_KEY_ID=${config.s3Config.accessKey}`);
    lines.push(`S3_STORAGE_SECRET_ACCESS_KEY=${config.s3Config.secretKey}`);
    lines.push(`S3_STORAGE_REGION=${config.s3Config.region}`);
  }
  lines.push("");

  // Auth section
  lines.push("#-----------------------------------");
  lines.push("# Authentication");
  lines.push("#-----------------------------------");
  lines.push(`AUTH_SERVICES_ENABLED=${config.authServices.join(",")}`);
  lines.push('AUTH_APP_URL="http://localhost:3000,http://localhost:8056"');
  lines.push("");
  
  if (config.authServices.includes("GOOGLE")) {
    lines.push("# Google OAuth");
    lines.push("GOOGLE_CLIENT_ID=your_google_client_id");
    lines.push("GOOGLE_CLIENT_SECRET=your_google_client_secret");
    lines.push("");
  }
  
  if (config.authServices.includes("FACEBOOK")) {
    lines.push("# Facebook OAuth");
    lines.push("FACEBOOK_CLIENT_ID=your_facebook_client_id");
    lines.push("FACEBOOK_CLIENT_SECRET=your_facebook_client_secret");
    lines.push("");
  }
  
  if (config.authServices.includes("GITHUB")) {
    lines.push("# GitHub OAuth");
    lines.push("GITHUB_CLIENT_ID=your_github_client_id");
    lines.push("GITHUB_CLIENT_SECRET=your_github_client_secret");
    lines.push("");
  }
  
  if (config.authServices.includes("APPLE")) {
    lines.push("# Apple Sign In");
    lines.push("APPLE_CLIENT_ID=your_apple_client_id");
    lines.push("APPLE_CLIENT_SECRET=your_apple_client_secret");
    lines.push("APPLE_TEAM_ID=your_apple_team_id");
    lines.push("APPLE_KEY_ID=your_apple_key_id");
    lines.push("");
  }

  // CORS section
  lines.push("#-----------------------------------");
  lines.push("# CORS");
  lines.push("#-----------------------------------");
  lines.push('AUTH_CORS_ALLOWED_ORIGINS="http://localhost:3000,http://localhost:8056"');
  lines.push("AUTH_CORS_ALLOW_ANY_PORT=true");
  lines.push("AUTH_CORS_CREDENTIALS=true");
  lines.push("");

  // Cookies section
  lines.push("#-----------------------------------");
  lines.push("# Cookies");
  lines.push("#-----------------------------------");
  lines.push("AUTH_COOKIE_HTTP_ONLY=true");
  lines.push("AUTH_COOKIE_SECURE=false");
  lines.push("AUTH_COOKIE_SAME_SITE=lax");
  lines.push("AUTH_COOKIE_PATH=/");
  lines.push("");

  // Mail section
  if (config.mailEnabled) {
    lines.push("#-----------------------------------");
    lines.push("# Mail");
    lines.push("#-----------------------------------");
    lines.push('MAIL_SENDERS_ENABLED="SMTP"');
    lines.push('MAIL_DEFAULT_SENDER="SMTP"');
    lines.push("SEND_WELCOME_EMAIL=true");
    lines.push("");
    lines.push("# SMTP Configuration");
    lines.push("SMTP_SMTP_HOST=smtp.example.com");
    lines.push("SMTP_SMTP_PORT=587");
    lines.push("SMTP_SMTP_SECURE=false");
    lines.push("SMTP_SMTP_USER=your_smtp_user");
    lines.push("SMTP_SMTP_PASS=your_smtp_password");
    lines.push('SMTP_FROM_ADDRESS="Your App" <noreply@example.com>');
    lines.push("");
  }

  // OpenAPI section
  lines.push("#-----------------------------------");
  lines.push("# OpenAPI Documentation");
  lines.push("#-----------------------------------");
  lines.push(`OPENAPI_ENABLED=${config.openApiEnabled}`);
  if (config.openApiEnabled) {
    lines.push("OPENAPI_INCLUDE_AUTH=true");
    lines.push("OPENAPI_INCLUDE_SCHEMA=true");
    lines.push("OPENAPI_INCLUDE_PERMISSIONS=true");
  }
  lines.push("");

  return lines.join("\n");
}

function generateEnvExample(config: ProjectConfig): string {
  const lines: string[] = [];

  lines.push("# Database (PostgreSQL 14+ required)");
  lines.push('DATABASE_URL="postgresql://username:password@localhost:5432/baasix"');
  lines.push("");
  lines.push("# Server");
  lines.push("PORT=8056");
  lines.push("NODE_ENV=development");
  lines.push("");
  lines.push("# Security (REQUIRED - generate unique keys)");
  lines.push("SECRET_KEY=your-secret-key-minimum-32-characters-long");
  lines.push("");
  lines.push("# Features");
  lines.push(`MULTI_TENANT=${config.multiTenant}`);
  lines.push(`PUBLIC_REGISTRATION=${config.publicRegistration}`);
  lines.push(`SOCKET_ENABLED=${config.socketEnabled}`);
  lines.push("");
  lines.push("# Storage");
  lines.push(`STORAGE_DEFAULT_SERVICE="${config.storageDriver}"`);
  if (config.storageDriver === "LOCAL") {
    lines.push('LOCAL_STORAGE_PATH="./uploads"');
  } else {
    lines.push("S3_STORAGE_ENDPOINT=your-s3-endpoint");
    lines.push("S3_STORAGE_BUCKET=your-bucket-name");
    lines.push("S3_STORAGE_ACCESS_KEY_ID=your-access-key");
    lines.push("S3_STORAGE_SECRET_ACCESS_KEY=your-secret-key");
  }
  lines.push("");
  lines.push("# Cache");
  lines.push(`CACHE_ADAPTER=${config.cacheAdapter}`);
  if (config.cacheAdapter === "redis") {
    lines.push("CACHE_REDIS_URL=redis://localhost:6379");
  }
  lines.push("");
  lines.push("# Auth");
  lines.push(`AUTH_SERVICES_ENABLED=${config.authServices.join(",")}`);
  lines.push("");

  return lines.join("\n");
}

function generateReadme(config: ProjectConfig): string {
  return `# ${config.projectName}

A Baasix Backend-as-a-Service project.

## Configuration

| Feature | Status |
|---------|--------|
| Multi-tenancy | ${config.multiTenant ? "✅ Enabled" : "❌ Disabled"} |
| Public Registration | ${config.publicRegistration ? "✅ Enabled" : "❌ Disabled"} |
| Real-time (WebSocket) | ${config.socketEnabled ? "✅ Enabled" : "❌ Disabled"} |
| Storage | ${config.storageDriver} |
| Cache | ${config.cacheAdapter} |
| Auth Methods | ${config.authServices.join(", ")} |
| OpenAPI Docs | ${config.openApiEnabled ? "✅ Enabled" : "❌ Disabled"} |

## Getting Started

1. **Configure your database**

   Edit \`.env\` and verify your PostgreSQL connection:
   \`\`\`
   DATABASE_URL="postgresql://username:password@localhost:5432/baasix"
   \`\`\`

2. **Start the server**

   \`\`\`bash
   npm run dev
   \`\`\`

3. **Access the API**

   - API: http://localhost:8056
   - ${config.openApiEnabled ? "Swagger UI: http://localhost:8056/documentation" : "OpenAPI: Disabled"}
   - Default admin: admin@baasix.com / admin@123

## Project Structure

\`\`\`
${config.projectName}/
├── .env                 # Environment configuration
├── .env.example         # Example configuration
├── package.json
├── server.js            # Server entry point
├── extensions/          # Custom hooks and endpoints
├── migrations/          # Database migrations
${config.storageDriver === "LOCAL" ? "└── uploads/           # Local file storage" : ""}
\`\`\`

## Extensions

Place your custom hooks and endpoints in the \`extensions/\` directory:

- **Endpoint extensions**: Add custom API routes
- **Hook extensions**: Add lifecycle hooks (before/after CRUD)

See [Extensions Documentation](https://baasix.com/docs/extensions) for details.

## Migrations

\`\`\`bash
# Create a migration
npx baasix migrate create -n create_products_table

# Run migrations
npx baasix migrate run

# Check status
npx baasix migrate status
\`\`\`

## Documentation

- [Baasix Documentation](https://baasix.com/docs)
- [SDK Guide](https://baasix.com/docs/sdk-guide)
- [API Reference](https://baasix.com/docs/api-reference)
`;
}

function generateNextJsEnvContent(config: ProjectConfig): string {
  const lines: string[] = [];

  // Next.js environment variables (frontend only)
  lines.push("#-----------------------------------");
  lines.push("# Baasix API Connection");
  lines.push("#-----------------------------------");
  lines.push("# URL of your Baasix API server");
  lines.push("NEXT_PUBLIC_BAASIX_URL=http://localhost:8056");
  lines.push("");
  lines.push("# Note: Create a separate Baasix API project using:");
  lines.push("#   npx baasix init --template api");
  lines.push("");

  return lines.join("\n");
}

async function createNextJsProject(projectPath: string, config: ProjectConfig, useAppRouter: boolean) {
  // package.json - Frontend only, no API dependencies
  const packageJson = {
    name: config.projectName,
    version: "0.1.0",
    private: true,
    scripts: {
      dev: "next dev",
      build: "next build",
      start: "next start",
      lint: "next lint",
    },
    dependencies: {
      "@tspvivek/baasix-sdk": "latest",
      next: "^14.0.0",
      react: "^18.2.0",
      "react-dom": "^18.2.0",
    },
    devDependencies: {
      "@types/node": "^20.0.0",
      "@types/react": "^18.2.0",
      "@types/react-dom": "^18.2.0",
      typescript: "^5.0.0",
    },
  };

  await fs.writeFile(
    path.join(projectPath, "package.json"),
    JSON.stringify(packageJson, null, 2)
  );

  // .env.local - Only frontend environment variables
  const envContent = generateNextJsEnvContent(config);
  await fs.writeFile(path.join(projectPath, ".env.local"), envContent);

  // tsconfig.json
  const tsconfig = {
    compilerOptions: {
      target: "es5",
      lib: ["dom", "dom.iterable", "esnext"],
      allowJs: true,
      skipLibCheck: true,
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      module: "esnext",
      moduleResolution: "bundler",
      resolveJsonModule: true,
      isolatedModules: true,
      jsx: "preserve",
      incremental: true,
      plugins: [{ name: "next" }],
      paths: {
        "@/*": [useAppRouter ? "./src/*" : "./*"],
      },
    },
    include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
    exclude: ["node_modules"],
  };

  await fs.writeFile(
    path.join(projectPath, "tsconfig.json"),
    JSON.stringify(tsconfig, null, 2)
  );

  // next.config.mjs
  const nextConfig = `/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
`;

  await fs.writeFile(path.join(projectPath, "next.config.mjs"), nextConfig);

  if (useAppRouter) {
    // App Router structure
    await fs.mkdir(path.join(projectPath, "src", "app"), { recursive: true });
    await fs.mkdir(path.join(projectPath, "src", "lib"), { recursive: true });

    // src/lib/baasix.ts - SDK client
    const baasixClient = `import { createBaasix } from "@tspvivek/baasix-sdk";

export const baasix = createBaasix({
  url: process.env.NEXT_PUBLIC_BAASIX_URL || "http://localhost:8056",
  authMode: "jwt",
  autoRefresh: true,
});

// Re-export for convenience
export type { User, Role, QueryParams, Filter } from "@tspvivek/baasix-sdk";
`;

    await fs.writeFile(path.join(projectPath, "src", "lib", "baasix.ts"), baasixClient);

    // src/app/layout.tsx
    const layout = `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "${config.projectName}",
  description: "Built with Baasix",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;

    await fs.writeFile(path.join(projectPath, "src", "app", "layout.tsx"), layout);

    // src/app/globals.css
    const globalsCss = `* {
  box-sizing: border-box;
  padding: 0;
  margin: 0;
}

html,
body {
  max-width: 100vw;
  overflow-x: hidden;
  font-family: system-ui, -apple-system, sans-serif;
}

body {
  background: #0a0a0a;
  color: #ededed;
}

a {
  color: #0070f3;
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}
`;

    await fs.writeFile(path.join(projectPath, "src", "app", "globals.css"), globalsCss);

    // src/app/page.tsx
    const page = `"use client";

import { useState, useEffect } from "react";
import { baasix, type User } from "@/lib/baasix";

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    baasix.auth.getCachedUser().then((u) => {
      setUser(u);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }, []);

  const handleLogin = async () => {
    setError(null);
    try {
      const { user } = await baasix.auth.login({
        email: "admin@baasix.com",
        password: "admin@123",
      });
      setUser(user);
    } catch (err) {
      setError("Login failed. Make sure your Baasix API server is running.");
      console.error("Login failed:", err);
    }
  };

  const handleLogout = async () => {
    await baasix.auth.logout();
    setUser(null);
  };

  if (loading) {
    return (
      <main style={{ padding: "2rem", textAlign: "center" }}>
        <p>Loading...</p>
      </main>
    );
  }

  return (
    <main style={{ padding: "2rem", maxWidth: "800px", margin: "0 auto" }}>
      <h1 style={{ marginBottom: "1rem" }}>🚀 ${config.projectName}</h1>
      <p style={{ marginBottom: "2rem", color: "#888" }}>
        Next.js Frontend with Baasix SDK
      </p>

      {error && (
        <div style={{ padding: "1rem", background: "#3a1a1a", borderRadius: "8px", marginBottom: "1rem", color: "#ff6b6b" }}>
          {error}
        </div>
      )}

      {user ? (
        <div>
          <p style={{ marginBottom: "1rem" }}>
            Welcome, <strong>{user.email}</strong>!
          </p>
          <button
            onClick={handleLogout}
            style={{
              padding: "0.5rem 1rem",
              background: "#333",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Logout
          </button>
        </div>
      ) : (
        <div>
          <p style={{ marginBottom: "1rem" }}>Not logged in</p>
          <button
            onClick={handleLogin}
            style={{
              padding: "0.5rem 1rem",
              background: "#0070f3",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Login as Admin
          </button>
        </div>
      )}

      <div style={{ marginTop: "3rem", padding: "1rem", background: "#111", borderRadius: "8px" }}>
        <h2 style={{ marginBottom: "0.5rem", fontSize: "1.2rem" }}>Getting Started</h2>
        <p style={{ marginBottom: "1rem", color: "#888", fontSize: "0.9rem" }}>
          This is a frontend-only Next.js app. You need a separate Baasix API server.
        </p>
        <ol style={{ paddingLeft: "1.5rem", lineHeight: "1.8" }}>
          <li>Create a Baasix API project: <code>npx baasix init --template api</code></li>
          <li>Start the API server: <code>cd your-api && npm run dev</code></li>
          <li>Update <code>.env.local</code> with your API URL if needed</li>
          <li>Start this Next.js app: <code>npm run dev</code></li>
        </ol>
      </div>

      <div style={{ marginTop: "1.5rem", padding: "1rem", background: "#111", borderRadius: "8px" }}>
        <h2 style={{ marginBottom: "0.5rem", fontSize: "1.2rem" }}>API Connection</h2>
        <p style={{ color: "#888", fontSize: "0.9rem" }}>
          Currently configured to connect to: <code>{process.env.NEXT_PUBLIC_BAASIX_URL || "http://localhost:8056"}</code>
        </p>
      </div>
    </main>
  );
}
`;

    await fs.writeFile(path.join(projectPath, "src", "app", "page.tsx"), page);

  } else {
    // Pages Router structure
    await fs.mkdir(path.join(projectPath, "pages"), { recursive: true });
    await fs.mkdir(path.join(projectPath, "lib"), { recursive: true });
    await fs.mkdir(path.join(projectPath, "styles"), { recursive: true });

    // lib/baasix.ts
    const baasixClient = `import { createBaasix } from "@tspvivek/baasix-sdk";

export const baasix = createBaasix({
  url: process.env.NEXT_PUBLIC_BAASIX_URL || "http://localhost:8056",
  authMode: "jwt",
  autoRefresh: true,
});

export type { User, Role, QueryParams, Filter } from "@tspvivek/baasix-sdk";
`;

    await fs.writeFile(path.join(projectPath, "lib", "baasix.ts"), baasixClient);

    // pages/_app.tsx
    const app = `import type { AppProps } from "next/app";
import "@/styles/globals.css";

export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
`;

    await fs.writeFile(path.join(projectPath, "pages", "_app.tsx"), app);

    // styles/globals.css
    const globalsCss = `* {
  box-sizing: border-box;
  padding: 0;
  margin: 0;
}

html,
body {
  max-width: 100vw;
  overflow-x: hidden;
  font-family: system-ui, -apple-system, sans-serif;
}

body {
  background: #0a0a0a;
  color: #ededed;
}

a {
  color: #0070f3;
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}
`;

    await fs.writeFile(path.join(projectPath, "styles", "globals.css"), globalsCss);

    // pages/index.tsx - Frontend only with SDK
    const index = `import { useState, useEffect } from "react";
import { baasix, type User } from "@/lib/baasix";

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    baasix.auth.getCachedUser().then((u) => {
      setUser(u);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }, []);

  const handleLogin = async () => {
    setError(null);
    try {
      const { user } = await baasix.auth.login({
        email: "admin@baasix.com",
        password: "admin@123",
      });
      setUser(user);
    } catch (err) {
      setError("Login failed. Make sure your Baasix API server is running.");
      console.error("Login failed:", err);
    }
  };

  const handleLogout = async () => {
    await baasix.auth.logout();
    setUser(null);
  };

  if (loading) {
    return (
      <main style={{ padding: "2rem", textAlign: "center" }}>
        <p>Loading...</p>
      </main>
    );
  }

  return (
    <main style={{ padding: "2rem", maxWidth: "800px", margin: "0 auto" }}>
      <h1 style={{ marginBottom: "1rem" }}>🚀 ${config.projectName}</h1>
      <p style={{ marginBottom: "2rem", color: "#888" }}>
        Next.js Frontend with Baasix SDK
      </p>

      {error && (
        <div style={{ padding: "1rem", background: "#3a1a1a", borderRadius: "8px", marginBottom: "1rem", color: "#ff6b6b" }}>
          {error}
        </div>
      )}

      {user ? (
        <div>
          <p style={{ marginBottom: "1rem" }}>
            Welcome, <strong>{user.email}</strong>!
          </p>
          <button
            onClick={handleLogout}
            style={{
              padding: "0.5rem 1rem",
              background: "#333",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Logout
          </button>
        </div>
      ) : (
        <div>
          <p style={{ marginBottom: "1rem" }}>Not logged in</p>
          <button
            onClick={handleLogin}
            style={{
              padding: "0.5rem 1rem",
              background: "#0070f3",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Login as Admin
          </button>
        </div>
      )}

      <div style={{ marginTop: "3rem", padding: "1rem", background: "#111", borderRadius: "8px" }}>
        <h2 style={{ marginBottom: "0.5rem", fontSize: "1.2rem" }}>Getting Started</h2>
        <p style={{ marginBottom: "1rem", color: "#888", fontSize: "0.9rem" }}>
          This is a frontend-only Next.js app. You need a separate Baasix API server.
        </p>
        <ol style={{ paddingLeft: "1.5rem", lineHeight: "1.8" }}>
          <li>Create a Baasix API project: <code>npx baasix init --template api</code></li>
          <li>Start the API server: <code>cd your-api && npm run dev</code></li>
          <li>Update <code>.env.local</code> with your API URL if needed</li>
          <li>Start this Next.js app: <code>npm run dev</code></li>
        </ol>
      </div>

      <div style={{ marginTop: "1.5rem", padding: "1rem", background: "#111", borderRadius: "8px" }}>
        <h2 style={{ marginBottom: "0.5rem", fontSize: "1.2rem" }}>API Connection</h2>
        <p style={{ color: "#888", fontSize: "0.9rem" }}>
          Currently configured to connect to: <code>{process.env.NEXT_PUBLIC_BAASIX_URL || "http://localhost:8056"}</code>
        </p>
      </div>
    </main>
  );
}
`;

    await fs.writeFile(path.join(projectPath, "pages", "index.tsx"), index);
  }

  // .gitignore - No api/ folder references since this is frontend-only
  const gitignore = `# Dependencies
node_modules/
.pnp
.pnp.js

# Testing
coverage/

# Next.js
.next/
out/
build/

# Environment
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Misc
.DS_Store
*.pem
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Vercel
.vercel

# TypeScript
*.tsbuildinfo
next-env.d.ts
`;

  await fs.writeFile(path.join(projectPath, ".gitignore"), gitignore);

  // README.md - Frontend-only documentation
  const readme = `# ${config.projectName}

A Next.js frontend project that connects to a Baasix API server using the SDK.

## Architecture

This is a **frontend-only** project. You need a separate Baasix API server running.

\`\`\`
┌─────────────────┐     HTTP/WS      ┌─────────────────┐
│   Next.js App   │ ◄──────────────► │   Baasix API    │
│   (Frontend)    │   via SDK        │   (Backend)     │
└─────────────────┘                  └─────────────────┘
     Port 3000                            Port 8056
\`\`\`

## Getting Started

### 1. Start your Baasix API Server

If you don't have a Baasix API project yet, create one:

\`\`\`bash
npx baasix init --template api my-api
cd my-api
npm install
npm run dev
\`\`\`

### 2. Configure this Frontend

Update \`.env.local\` if your API is running on a different URL:

\`\`\`
NEXT_PUBLIC_BAASIX_URL=http://localhost:8056
\`\`\`

### 3. Start the Frontend

\`\`\`bash
npm install
npm run dev
\`\`\`

### 4. Open your browser

- Frontend: http://localhost:3000

## Default Admin Credentials

Use these credentials to login (configured in your API server):

- Email: admin@baasix.com
- Password: admin@123

## Project Structure

\`\`\`
${config.projectName}/
├── .env.local           # API URL configuration
├── package.json
${useAppRouter ? `├── src/
│   ├── app/             # Next.js App Router pages
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── globals.css
│   └── lib/
│       └── baasix.ts    # SDK client` : `├── pages/              # Next.js Pages Router
│   ├── _app.tsx
│   └── index.tsx
├── lib/
│   └── baasix.ts       # SDK client
└── styles/
    └── globals.css`}
\`\`\`

## SDK Usage

The SDK is pre-configured in \`${useAppRouter ? 'src/lib/baasix.ts' : 'lib/baasix.ts'}\`:

\`\`\`typescript
import { baasix } from "${useAppRouter ? '@/lib/baasix' : '@/lib/baasix'}";

// Authentication
const { user } = await baasix.auth.login({ email, password });
await baasix.auth.logout();

// CRUD operations
const items = await baasix.items("posts").list();
const item = await baasix.items("posts").create({ title: "Hello" });
await baasix.items("posts").update(id, { title: "Updated" });
await baasix.items("posts").delete(id);
\`\`\`

## Documentation

- [Baasix Documentation](https://baasix.com/docs)
- [SDK Guide](https://baasix.com/docs/sdk-guide)
- [Next.js Documentation](https://nextjs.org/docs)
`;

  await fs.writeFile(path.join(projectPath, "README.md"), readme);
}

export const init = new Command("init")
  .description("Initialize a new Baasix project")
  .option("-c, --cwd <path>", "Working directory", process.cwd())
  .option("-t, --template <template>", "Project template (api, nextjs, nextjs-app)")
  .option("-n, --name <name>", "Project name")
  .option("-y, --yes", "Skip confirmation prompts")
  .action(initAction);
