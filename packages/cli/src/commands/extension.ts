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

type ExtensionType = "hook" | "endpoint";

interface ExtensionOptions {
  cwd: string;
  type?: ExtensionType;
  name?: string;
  collection?: string;
  typescript?: boolean;
}

async function extensionAction(opts: ExtensionOptions) {
  const cwd = path.resolve(opts.cwd);

  intro(chalk.bgMagenta.black(" Baasix Extension Generator "));

  // Select extension type
  let extensionType = opts.type;
  if (!extensionType) {
    const result = await select({
      message: "What type of extension do you want to create?",
      options: [
        {
          value: "hook",
          label: "Hook",
          hint: "Intercept and modify CRUD operations",
        },
        {
          value: "endpoint",
          label: "Custom Endpoint",
          hint: "Add new API routes",
        },
      ],
    });

    if (isCancel(result)) {
      cancel("Operation cancelled");
      process.exit(0);
    }
    extensionType = result as ExtensionType;
  }

  // Get extension name
  let extensionName = opts.name;
  if (!extensionName) {
    const result = await text({
      message: "What is your extension name?",
      placeholder: extensionType === "hook" ? "my-hook" : "my-endpoint",
      validate: (value) => {
        if (!value) return "Extension name is required";
        if (!/^[a-z0-9-_]+$/i.test(value)) return "Name must be alphanumeric with dashes or underscores";
        return undefined;
      },
    });

    if (isCancel(result)) {
      cancel("Operation cancelled");
      process.exit(0);
    }
    extensionName = result as string;
  }

  // For hooks, ask for collection name
  let collectionName = opts.collection;
  if (extensionType === "hook" && !collectionName) {
    const result = await text({
      message: "Which collection should this hook apply to?",
      placeholder: "posts",
      validate: (value) => {
        if (!value) return "Collection name is required";
        return undefined;
      },
    });

    if (isCancel(result)) {
      cancel("Operation cancelled");
      process.exit(0);
    }
    collectionName = result as string;
  }

  // Use TypeScript?
  let useTypeScript = opts.typescript ?? false;
  if (opts.typescript === undefined) {
    const result = await confirm({
      message: "Use TypeScript?",
      initialValue: false,
    });

    if (isCancel(result)) {
      cancel("Operation cancelled");
      process.exit(0);
    }
    useTypeScript = result;
  }

  const s = spinner();
  s.start("Creating extension...");

  try {
    // Determine extensions directory
    const extensionsDir = path.join(cwd, "extensions");
    if (!existsSync(extensionsDir)) {
      await fs.mkdir(extensionsDir, { recursive: true });
    }

    const ext = useTypeScript ? "ts" : "js";
    const extensionDir = path.join(extensionsDir, `baasix-${extensionType}-${extensionName}`);

    // Check if extension already exists
    if (existsSync(extensionDir)) {
      s.stop("Extension already exists");
      const overwrite = await confirm({
        message: `Extension baasix-${extensionType}-${extensionName} already exists. Overwrite?`,
        initialValue: false,
      });

      if (isCancel(overwrite) || !overwrite) {
        cancel("Operation cancelled");
        process.exit(0);
      }
    }

    await fs.mkdir(extensionDir, { recursive: true });

    if (extensionType === "hook") {
      await createHookExtension(extensionDir, extensionName, collectionName!, useTypeScript);
    } else {
      await createEndpointExtension(extensionDir, extensionName, useTypeScript);
    }

    s.stop("Extension created");

    outro(chalk.green(`✨ Extension created at extensions/baasix-${extensionType}-${extensionName}/`));

    // Print next steps
    console.log();
    console.log(chalk.bold("Next steps:"));
    console.log(`  ${chalk.dim("1.")} Edit ${chalk.cyan(`extensions/baasix-${extensionType}-${extensionName}/index.${ext}`)}`);
    console.log(`  ${chalk.dim("2.")} Restart your Baasix server to load the extension`);
    console.log();

  } catch (error) {
    s.stop("Failed to create extension");
    log.error(error instanceof Error ? error.message : "Unknown error");
    process.exit(1);
  }
}

async function createHookExtension(
  extensionDir: string,
  name: string,
  collection: string,
  useTypeScript: boolean
) {
  const ext = useTypeScript ? "ts" : "js";

  const typeAnnotations = useTypeScript
    ? `
import type { HooksService } from "@tspvivek/baasix";

interface HookContext {
  ItemsService: any;
  schemaManager: any;
  services: Record<string, any>;
}

interface HookPayload {
  data?: Record<string, any>;
  query?: Record<string, any>;
  id?: string | string[];
  accountability: {
    user: { id: string; email: string };
    role: { id: string; name: string };
  };
  collection: string;
  schema: any;
}
`
    : "";

  const hookContent = `${typeAnnotations}
/**
 * Hook extension for ${collection} collection
 * 
 * Available hooks:
 * - items.create (before/after creating an item)
 * - items.read (before/after reading items)
 * - items.update (before/after updating an item)
 * - items.delete (before/after deleting an item)
 */
export default (hooksService${useTypeScript ? ": HooksService" : ""}, context${useTypeScript ? ": HookContext" : ""}) => {
  const { ItemsService } = context;

  // Hook for creating items
  hooksService.registerHook(
    "${collection}",
    "items.create",
    async ({ data, accountability, collection, schema }${useTypeScript ? ": HookPayload" : ""}) => {
      console.log(\`[${name}] Creating \${collection} item:\`, data);
      
      // Example: Add created_by field
      // data.created_by = accountability.user.id;
      
      // Return modified data
      return { data };
    }
  );

  // Hook for reading items
  hooksService.registerHook(
    "${collection}",
    "items.read",
    async ({ query, data, accountability, collection, schema }${useTypeScript ? ": HookPayload" : ""}) => {
      console.log(\`[${name}] Reading \${collection} with query:\`, query);
      
      // Example: Filter results for non-admin users
      // if (accountability.role.name !== "administrator") {
      //   query.filter = { ...query.filter, published: true };
      // }
      
      return { query };
    }
  );

  // Hook for updating items
  hooksService.registerHook(
    "${collection}",
    "items.update",
    async ({ id, data, accountability, schema }${useTypeScript ? ": HookPayload" : ""}) => {
      console.log(\`[${name}] Updating item \${id}:\`, data);
      
      // Example: Add updated_by field
      // data.updated_by = accountability.user.id;
      
      return { id, data };
    }
  );

  // Hook for deleting items
  hooksService.registerHook(
    "${collection}",
    "items.delete",
    async ({ id, accountability }${useTypeScript ? ": HookPayload" : ""}) => {
      console.log(\`[${name}] Deleting item:\`, id);
      
      // Example: Soft delete instead of hard delete
      // const itemsService = new ItemsService("${collection}", { accountability, schema });
      // await itemsService.update(id, { deletedAt: new Date() });
      // return { skip: true }; // Skip the actual delete
      
      return { id };
    }
  );
};
`;

  await fs.writeFile(path.join(extensionDir, `index.${ext}`), hookContent);

  // Create README
  const readme = `# baasix-hook-${name}

A Baasix hook extension for the \`${collection}\` collection.

## Available Hooks

- \`items.create\` - Before/after creating an item
- \`items.read\` - Before/after reading items
- \`items.update\` - Before/after updating an item
- \`items.delete\` - Before/after deleting an item

## Usage

This extension is automatically loaded when placed in the \`extensions/\` directory.

Edit \`index.${ext}\` to customize the hook behavior.

## Documentation

See [Hooks Documentation](https://baasix.com/docs/hooks) for more details.
`;

  await fs.writeFile(path.join(extensionDir, "README.md"), readme);
}

async function createEndpointExtension(
  extensionDir: string,
  name: string,
  useTypeScript: boolean
) {
  const ext = useTypeScript ? "ts" : "js";

  const typeAnnotations = useTypeScript
    ? `
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { APIError } from "@tspvivek/baasix";

interface EndpointContext {
  ItemsService: any;
  schemaManager: any;
  services: Record<string, any>;
}

interface RequestWithAccountability extends FastifyRequest {
  accountability?: {
    user: { id: string; email: string };
    role: { id: string; name: string };
  };
}
`
    : `import { APIError } from "@tspvivek/baasix";`;

  const endpointContent = `${typeAnnotations}

/**
 * Custom endpoint extension
 * 
 * Register custom routes on the Fastify app instance.
 */
const registerEndpoint = (app${useTypeScript ? ": FastifyInstance" : ""}, context${useTypeScript ? ": EndpointContext" : ""}) => {
  const { ItemsService } = context;

  // GET endpoint example
  app.get("/${name}", async (req${useTypeScript ? ": RequestWithAccountability" : ""}, res${useTypeScript ? ": FastifyReply" : ""}) => {
    try {
      // Check authentication (optional)
      if (!req.accountability || !req.accountability.user) {
        throw new APIError("Unauthorized", 401);
      }

      const { user, role } = req.accountability;

      // Your custom logic here
      const result = {
        message: "Hello from ${name} endpoint!",
        user: {
          id: user.id,
          email: user.email,
        },
        timestamp: new Date().toISOString(),
      };

      return res.send(result);
    } catch (error) {
      throw error;
    }
  });

  // POST endpoint example
  app.post("/${name}", async (req${useTypeScript ? ": RequestWithAccountability" : ""}, res${useTypeScript ? ": FastifyReply" : ""}) => {
    try {
      if (!req.accountability || !req.accountability.user) {
        throw new APIError("Unauthorized", 401);
      }

      const body = req.body${useTypeScript ? " as Record<string, any>" : ""};

      // Example: Create an item using ItemsService
      // const itemsService = new ItemsService("my_collection", {
      //   accountability: req.accountability,
      //   schema: context.schemaManager,
      // });
      // const itemId = await itemsService.createOne(body);

      return res.status(201).send({
        message: "Created successfully",
        data: body,
      });
    } catch (error) {
      throw error;
    }
  });

  // Parameterized endpoint example
  app.get("/${name}/:id", async (req${useTypeScript ? ": RequestWithAccountability" : ""}, res${useTypeScript ? ": FastifyReply" : ""}) => {
    try {
      const { id } = req.params${useTypeScript ? " as { id: string }" : ""};

      return res.send({
        message: \`Getting item \${id}\`,
        id,
      });
    } catch (error) {
      throw error;
    }
  });
};

export default {
  id: "${name}",
  handler: registerEndpoint,
};
`;

  await fs.writeFile(path.join(extensionDir, `index.${ext}`), endpointContent);

  // Create README
  const readme = `# baasix-endpoint-${name}

A Baasix custom endpoint extension.

## Endpoints

- \`GET /${name}\` - Example GET endpoint
- \`POST /${name}\` - Example POST endpoint
- \`GET /${name}/:id\` - Example parameterized endpoint

## Usage

This extension is automatically loaded when placed in the \`extensions/\` directory.

Edit \`index.${ext}\` to customize the endpoints.

## Documentation

See [Custom Endpoints Documentation](https://baasix.com/docs/custom-endpoints) for more details.
`;

  await fs.writeFile(path.join(extensionDir, "README.md"), readme);
}

export const extension = new Command("extension")
  .alias("ext")
  .description("Generate a new Baasix extension (hook or endpoint)")
  .option("-c, --cwd <path>", "Working directory", process.cwd())
  .option("-t, --type <type>", "Extension type (hook, endpoint)")
  .option("-n, --name <name>", "Extension name")
  .option("--collection <collection>", "Collection name (for hooks)")
  .option("--typescript", "Use TypeScript")
  .option("--no-typescript", "Use JavaScript")
  .action(extensionAction);
