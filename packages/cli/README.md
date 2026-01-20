# Baasix CLI

Command-line interface for [Baasix](https://baasix.com) Backend-as-a-Service.

## Installation

```bash
# Global installation
npm install -g baasix

# Or use npx
npx baasix <command>
```

## Commands

### `baasix init`

Initialize a new Baasix project with scaffolding.

```bash
baasix init [project-name]

# Skip prompts with defaults
baasix init --name my-app --template api -y
```

**Options:**

| Option | Description |
|--------|-------------|
| `-n, --name <name>` | Project name |
| `-t, --template <template>` | Project template: `api`, `nextjs`, `nextjs-app` |
| `-y, --yes` | Skip prompts and use sensible defaults |
| `-c, --cwd <path>` | Working directory (default: current) |

**Templates:**

| Template | Description |
|----------|-------------|
| `api` | Standalone Baasix API server |
| `nextjs-app` | Next.js 14+ frontend (App Router) with Baasix SDK |
| `nextjs` | Next.js frontend (Pages Router) with Baasix SDK |

> **Note:** Next.js templates create **frontend-only** projects. You need a separate Baasix API server running.

**Example:**

```bash
# Create API server
npx baasix init --template api my-api

# Create Next.js frontend (separate from API)
npx baasix init --template nextjs-app my-frontend
```

### `baasix generate`

Generate TypeScript types from your Baasix schemas with full support for:
- ✅ **Relations** — Properly typed as target collection types
- ✅ **Enums** — Generated as union types (`'active' | 'inactive'`)
- ✅ **System collections** — `BaasixUser`, `BaasixRole`, `BaasixFile`, etc.
- ✅ **Validations** — JSDoc comments with `@min`, `@max`, `@length`, `@format`

```bash
baasix generate
baasix gen
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `-o, --output <path>` | Output file path | `baasix.d.ts` |
| `-t, --target <target>` | Generation target (see below) | Interactive |
| `--url <url>` | Baasix server URL | `http://localhost:8056` |
| `-y, --yes` | Skip confirmation prompts | - |

**Generation Targets:**

| Target | Description |
|--------|-------------|
| `types` | TypeScript interfaces for all collections |
| `sdk-types` | Typed SDK helpers with collection methods |
| `schema-json` | Export schemas as JSON |

**Example Output:**

```typescript
// System collections (referenced by relations)
export interface BaasixUser {
  id: string;
  firstName: string;
  lastName?: string | null;
  email?: string | null;
  // ...
}

// Your collections with proper relation types
export interface Product {
  id: string;
  name: string;
  price: number;
  status: 'published' | 'draft' | 'archived';  // Enum as union type
  category_Id?: string | null;
  category?: Category | null;                   // Relation typed correctly
  userCreated?: BaasixUser | null;             // System relation
  createdAt?: string;
  updatedAt?: string;
}

export interface Category {
  id: string;
  name: string;
  products?: Product[] | null;  // HasMany relation as array
}

// Collection type map
export type CollectionName = "products" | "categories";
```

**Usage:**

```bash
# Generate types from running Baasix instance
baasix generate --url http://localhost:8056 --output ./src/types/baasix.d.ts

# Use in your code
```

```typescript
import type { Product, Category, BaasixUser } from "./types/baasix";
import { createBaasix } from "@tspvivek/baasix-sdk";

const baasix = createBaasix({ url: "http://localhost:8056" });

// Type-safe queries with properly typed relations
const products = await baasix.items<Product>("products").list({
  fields: ["*", "category.*", "userCreated.*"]
});

// products[0].category is typed as Category | null
// products[0].status is typed as 'published' | 'draft' | 'archived'
```

### `baasix extension`

Scaffold a new Baasix extension.

```bash
baasix extension
baasix ext
```

**Options:**

| Option | Description |
|--------|-------------|
| `-t, --type <type>` | Extension type: `hook` or `endpoint` |
| `-n, --name <name>` | Extension name |
| `--collection <name>` | Collection name (for hooks) |
| `--typescript` | Use TypeScript (default) |
| `--no-typescript` | Use JavaScript |

**Extension Types:**

#### Hook Extension

Lifecycle hooks triggered on CRUD operations:

```bash
baasix extension --type hook --name audit-log --collection orders
```

```javascript
// extensions/baasix-hook-audit-log/index.js
export default (hooksService, context) => {
  const { ItemsService } = context;

  hooksService.registerHook("orders", "items.create", async ({ data, accountability }) => {
    console.log(`Creating order:`, data);
    data.created_by = accountability.user.id;
    return { data };
  });

  hooksService.registerHook("orders", "items.update", async ({ id, data, accountability }) => {
    console.log(`Updating order ${id}:`, data);
    data.updated_by = accountability.user.id;
    return { id, data };
  });
};
```

#### Endpoint Extension

Custom REST API endpoints:

```bash
baasix extension --type endpoint --name analytics
```

```javascript
// extensions/baasix-endpoint-analytics/index.js
import { APIError } from "@tspvivek/baasix";

export default {
  id: "analytics",
  handler: (app, context) => {
    const { ItemsService } = context;

    app.get("/analytics/dashboard", async (req, res) => {
      if (!req.accountability?.user) {
        throw new APIError("Unauthorized", 401);
      }
      
      // Your custom logic
      res.json({ message: "Hello from analytics!" });
    });
  },
};
```

### `baasix migrate`

Database migration management.

```bash
baasix migrate [action]
```

**Actions:**

| Action | Description |
|--------|-------------|
| `status` | Show migration status (pending/executed) |
| `list` | List all local migrations |
| `run` | Run pending migrations |
| `create` | Create a new migration file |
| `rollback` | Rollback the last batch |
| `reset` | Rollback all migrations (dangerous!) |

**Options:**

| Option | Description |
|--------|-------------|
| `--url <url>` | Baasix server URL |
| `-n, --name <name>` | Migration name (for create) |
| `-s, --steps <number>` | Number of batches to rollback |
| `-y, --yes` | Skip confirmation prompts |

**Example:**

```bash
# Create a new migration
baasix migrate create --name add-products-table

# Check status
baasix migrate status --url http://localhost:8056

# Run pending migrations
baasix migrate run --url http://localhost:8056

# Rollback last batch
baasix migrate rollback --url http://localhost:8056 --steps 1
```

**Migration File Example:**

```javascript
// migrations/20240115120000_add-products-table.js
export async function up(baasix) {
  await baasix.schema.create("products", {
    name: "Products",
    timestamps: true,
    fields: {
      id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
      name: { type: "String", allowNull: false, values: { length: 255 } },
      price: { type: "Decimal", values: { precision: 10, scale: 2 } },
      status: { type: "Enum", values: ["published", "draft", "archived"], defaultValue: "draft" },
      description: { type: "Text" },
    },
  });
}

export async function down(baasix) {
  await baasix.schema.delete("products");
}
```

## Configuration

The CLI reads configuration from environment variables or a `.env` file:

```env
# Required for most commands
BAASIX_URL=http://localhost:8056

# Authentication (optional, for protected operations)
BAASIX_EMAIL=admin@example.com
BAASIX_PASSWORD=your-password

# Or use token auth
BAASIX_TOKEN=your-jwt-token
```

## Project Structure

### API Template

```
my-api/
├── server.js           # Entry point
├── package.json        # Dependencies
├── .env                # Configuration
├── .env.example        # Example configuration
├── extensions/         # Custom hooks & endpoints
├── migrations/         # Database migrations
└── uploads/            # File uploads
```

### Next.js Template (Frontend Only)

```
my-frontend/
├── src/
│   ├── app/            # Next.js App Router pages
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── globals.css
│   └── lib/
│       └── baasix.ts   # Pre-configured SDK client
├── package.json
├── .env.local          # Just NEXT_PUBLIC_BAASIX_URL
└── README.md
```

> **Architecture:** Next.js templates are frontend-only. Create a separate API project with `--template api`.

## CI/CD Integration

```yaml
# .github/workflows/deploy.yml
- name: Generate Types
  run: npx baasix generate --url ${{ secrets.BAASIX_URL }} -o ./src/types/baasix.d.ts -y

- name: Run Migrations
  run: npx baasix migrate run --url ${{ secrets.BAASIX_URL }} -y

- name: Build
  run: npm run build
```

## License

MIT
