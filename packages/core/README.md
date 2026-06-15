<p align="center">
  <img src="https://raw.githubusercontent.com/baasix/baasix/main/packages/core/assets/banner_small.jpg" alt="Baasix Banner" />
</p>

<p align="center">
  <strong>A powerful, flexible Backend as a Source (BaaS) platform for rapid application development</strong>
</p>

<p align="center">
  <a href="https://baasix.com">Website</a> •
  <a href="https://baasix.com/docs">Documentation</a> •
  <a href="https://github.com/baasix/baasix/tree/main/samples/sample">Sample Project</a> •
  <a href="https://github.com/baasix/baasix">GitHub</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@baasix/baasix"><img src="https://img.shields.io/npm/v/@baasix/baasix.svg" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@baasix/baasix"><img src="https://img.shields.io/npm/dm/@baasix/baasix.svg" alt="npm downloads"></a>
  <a href="https://github.com/baasix/baasix/blob/main/packages/core/LICENSE.MD"><img src="https://img.shields.io/npm/l/@baasix/baasix.svg" alt="license"></a>
</p>

<p align="center">
  <a href="#-javascript-sdk">JavaScript SDK</a> •
  <a href="#-cli-command-line-interface">CLI</a> •
  <a href="#-mcp-server-ai-integration">MCP Server</a> •
  <a href="#-quick-start">Quick Start</a>
</p>

---

## ✨ Features

- **🗄️ Dynamic Database Management** — Create and modify data models on the fly with a flexible schema system
- **🔍 Powerful Query API** — Complex filtering, sorting, pagination, aggregation, and full-text search
- **🔐 Authentication & Authorization** — JWT, cookie-based auth, SSO providers, and role-based permissions
- **✅ Schema Validations** — Built-in field validation with min/max, patterns, required, unique, and custom rules
- **⚡ Workflow Automation** — Visual workflow builder with 17 node types and real-time monitoring
- **🧩 App Builder** — Compose internal tools and admin pages from 17 data-bound block types (table, form, kanban, calendar, chart, map, and more) on a 12-column grid, governed by your existing permissions
- **🔔 Notification System** — Built-in user notifications with real-time delivery via Socket.IO
- **📁 File Storage & Processing** — Upload, manage, and transform files with image optimization
- **📝 Pino Logger** — High-performance structured logging with configurable transports (Datadog, Loki, etc.)
- **🌍 PostGIS Geospatial Support** — Advanced spatial data operations
- **🧠 pgvector Embeddings Support** — Store and query vector embeddings for AI/semantic search
- **📊 Reporting & Analytics** — Generate complex reports with grouping and aggregation
- **🪝 Hooks System** — Extend functionality with custom hooks on CRUD operations
- **🏢 Multi-tenant Architecture** — Host multiple isolated organizations in a single instance with schema-level tenant scoping
- **⚡ Real-time Updates** — Socket.IO integration with Redis clustering, plus WAL-based CDC for database changes
- **🚀 High Performance** — Redis-based caching with configurable TTL
- **🖥️ CLI Tools** — Project scaffolding, TypeScript type generation, and migration management
- **✉️ Email Template Designer** — Visual email editor with code editing and variable placeholders

---

## 📦 JavaScript SDK

The official JavaScript/TypeScript SDK for Baasix provides a type-safe, easy-to-use client for web, Node.js, and React Native applications.

👉 **[GitHub: baasix/baasix](https://github.com/baasix/baasix)** | **[npm: @baasix/sdk](https://www.npmjs.com/package/@baasix/sdk)**

### Installation

```bash
npm install @baasix/sdk
```

### Quick Example

```typescript
import { createBaasix } from '@baasix/sdk';

// Create client
const baasix = createBaasix({
  url: 'https://your-baasix-instance.com',
});

// Login
const { user } = await baasix.auth.login({
  email: 'user@example.com',
  password: 'password123',
});

// Query items with type-safe filters
const { data: products } = await baasix.items('products').find({
  filter: { status: { eq: 'active' }, price: { gte: 10 } },
  sort: { createdAt: 'desc' },
  limit: 10,
});

// Create item
const productId = await baasix.items('products').create({
  name: 'New Product',
  price: 29.99,
});

// Real-time subscriptions
import { io } from 'socket.io-client';
baasix.realtime.setSocketClient(io);
await baasix.realtime.connect();

baasix.realtime.subscribe('products', (payload) => {
  console.log(`Product ${payload.action}:`, payload.data);
});
```

### WAL-Based Realtime (PostgreSQL Logical Replication)

For production environments, Baasix supports PostgreSQL's Write-Ahead Log (WAL) for capturing database changes at the database level. This catches ALL changes including direct SQL, migrations, and external tools.

**PostgreSQL Configuration:**
```sql
-- In postgresql.conf:
wal_level = logical
max_replication_slots = 4
max_wal_senders = 4
```

**Environment Variables:**
```bash
SOCKET_ENABLED=true
REALTIME_WAL_ENABLED=true
```

**Enable realtime for a collection:**
```bash
# Via API (admin only)
POST /realtime/collections/products/enable
{ "replicaIdentityFull": true }  # Optional: enables old values on UPDATE/DELETE
```

### SDK Features

- 🌐 **Universal** — Works in browsers, Node.js, and React Native
- 🔐 **Flexible Auth** — JWT tokens, HTTP-only cookies, OAuth (Google, Facebook, Apple, GitHub)
- 💾 **Customizable Storage** — LocalStorage, AsyncStorage, or custom adapters
- 📝 **Type-Safe** — Full TypeScript support with generics
- 📡 **Realtime** — WebSocket subscriptions for live data updates
- ⚡ **Query Builder** — Fluent API for complex queries with 50+ filter operators

### React Native Setup

```typescript
import { createBaasix, AsyncStorageAdapter } from '@baasix/sdk';
import AsyncStorage from '@react-native-async-storage/async-storage';

const baasix = createBaasix({
  url: 'https://api.example.com',
  storage: new AsyncStorageAdapter(AsyncStorage),
});
```

For complete SDK documentation, see the **[SDK README](https://github.com/baasix/baasix/tree/main/packages/sdk)**.

---

## 🖥️ CLI (Command-Line Interface)

The official CLI for Baasix provides project scaffolding, TypeScript type generation, extension creation, and migration management.

👉 **[npm: baasix](https://www.npmjs.com/package/baasix)**

### Installation

```bash
# Global installation
npm install -g baasix

# Or use with npx
npx baasix <command>
```

### Commands

| Command | Description |
|---------|-------------|
| `baasix init` | Create a new project with interactive configuration |
| `baasix generate` | Generate TypeScript types from your schemas |
| `baasix extension` | Scaffold a new hook or endpoint extension |
| `baasix migrate` | Run database migrations |

### Quick Start with CLI

```bash
# Create a new API project
npx baasix init --template api my-api

# Or with interactive prompts for full configuration
npx baasix init

# Skip all prompts with sensible defaults
npx baasix init --template api -y
```

### Project Templates

| Template | Description |
|----------|-------------|
| `api` | Standalone Baasix API server |
| `nextjs-app` | Next.js 14+ frontend (App Router) with SDK |
| `nextjs` | Next.js frontend (Pages Router) with SDK |

> **Note:** Next.js templates create **frontend-only** projects that connect to a separate Baasix API.

### Generate TypeScript Types

The CLI generates fully-typed interfaces with proper relation types and enum support:

```bash
# Generate types from running Baasix instance
baasix generate --url http://localhost:8056 --output ./src/types/baasix.d.ts
```

**Generated types include:**
- ✅ **Relations** typed as target collection types (not `unknown`)
- ✅ **Enums** as union types (`'published' | 'draft' | 'archived'`)
- ✅ **System collections** (`BaasixUser`, `BaasixRole`, `BaasixFile`)
- ✅ **Validation JSDoc** comments (`@min`, `@max`, `@length`)

```typescript
// Example generated types
export interface Product {
  id: string;
  name: string;
  status: 'published' | 'draft' | 'archived';  // Enum as union
  category?: Category | null;                   // Relation typed correctly
  userCreated?: BaasixUser | null;             // System relation
}
```

### Create Extensions

```bash
# Create a new hook extension
baasix extension --type hook --name order-notifications --collection orders

# Create a new endpoint extension  
baasix extension --type endpoint --name analytics
```

### Manage Migrations

```bash
# Create a migration
baasix migrate create --name add-products-table

# Check status
baasix migrate status --url http://localhost:8056

# Run pending migrations
baasix migrate run --url http://localhost:8056
```

For complete CLI documentation, see **[baasix.com/docs/getting-started/cli](https://baasix.com/docs/getting-started/cli)**.

---

## 🚀 Quick Start

### 1. Create a new project

```bash
mkdir my-baasix-app
cd my-baasix-app
npm init -y
```

### 2. Install Baasix

```bash
npm install @baasix/baasix
```

### 3. Create server.js

```javascript
import { startServer } from "@baasix/baasix";

// Basic usage - pretty printing in dev, JSON in production
startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

// With custom logger configuration
startServer({
  port: 8056,
  logger: {
    level: "info",      // 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'
    pretty: true,       // Human-readable output (default in development)
  }
});
```

### 4. Configure package.json

```json
{
  "type": "module",
  "scripts": {
    "start": "tsx server.js",
    "dev": "tsx watch server.js"
  },
  "devDependencies": {
    "tsx": "^4.16.0"
  }
}
```

### 5. Create .env file

```env
# Database
DATABASE_URL="postgresql://postgres:yourpassword@localhost:5432/baasix"

# Server
PORT=8056
SECRET_KEY=your-secret-key-min-32-chars

# System Cache - permissions, roles, settings (optional - defaults to memory)
# SYSTEM_CACHE_ADAPTER=redis
# SYSTEM_CACHE_REDIS_URL=redis://localhost:6379

# Data Cache - query results (optional - defaults to memory)
# DATA_CACHE_ADAPTER=redis
# DATA_CACHE_REDIS_URL=redis://localhost:6379

# Real-time (optional)
# WORKFLOWS_ENABLED=true            # master switch for the workflow subsystem; false disables hooks (no per-request overhead), schedules, /workflows/* routes, and code execution
# SOCKET_ENABLED=true
# REALTIME_ROW_LEVEL_SCOPING=false  # per-recipient row-level scoping for realtime broadcasts (A12); default off = fast room broadcast
# SOCKET_REDIS_ENABLED=true        # For multi-instance
# SOCKET_REDIS_URL=redis://localhost:6379

# Background Tasks (optional)
# TASK_SERVICE_ENABLED=true
# TASK_CONCURRENCY=1               # Max concurrent tasks per instance
# TASK_STALL_TIMEOUT=300           # Seconds before stuck task is recovered
# TASK_REDIS_ENABLED=true          # For multi-instance distributed locking
# TASK_REDIS_URL=redis://localhost:6379

# Request Body Size (optional)
# BODY_SIZE_LIMIT=20mb              # Max JSON body size (default: 20mb)

# File Upload (optional)
# MAX_UPLOAD_FILE_SIZE=50          # Default: 50MB, set to 100 for 100MB

# Log Cleanup (optional - disabled by default)
# AUDIT_LOG_CLEANUP_ENABLED=true   # Enable automatic audit log cleanup
# AUDIT_LOG_RETENTION_DAYS=90      # Retention period in days
# EMAIL_LOG_CLEANUP_ENABLED=true   # Enable automatic email log cleanup
# EMAIL_LOG_RETENTION_DAYS=30      # Retention period in days

# Query behavior (optional)
# COUNT_BY_DEFAULT=true            # Compute totalCount on list reads (per-request ?count= overrides)

# Security hardening (optional - all default to true/secure; set false to relax)
# PROTECT_PRIVILEGE_FIELDS=true    # role_Id/tenant_Id/emailVerified/hidden fields excluded from fields:["*"] (admins exempt). Tri-state: true | allow-password (non-admin may set password when explicitly granted; still hashed) | false
# PROTECT_IS_PUBLIC_FIELD=false    # make baasix_File isPublic opt-in (not settable via broad "*" grant); default off = backward compatible
# EXPOSE_ERROR_DETAILS=false       # include raw DB error text in responses; off in production (leaks schema / SQLi oracle)
# STORAGE_PATH_CONFINEMENT=true    # Confine local-disk file ops within storage root (blocks path traversal)
# STORAGE_FOLDER_STRUCTURE=false   # organize files into tenants/{t}/users/{u}|system folders (default off; existing files unaffected; migrate via POST /files/migrate-storage-structure)
# ASSET_XSS_PROTECTION=true        # Force executable upload types (html/svg/js/xml) to download, not render inline
# ASSET_NOSNIFF=true               # Send X-Content-Type-Options: nosniff on asset responses
# STRICT_TENANT_ISOLATION=true     # (Multi-tenant) restrict isTenantSpecific:false bypass to administrator; non-admin global roles stay tenant-scoped
# OAuth hardening (default off = secure restriction):
# OAUTH_ALLOW_UNVERIFIED_LINK=false # auto-link OAuth to existing account on unverified email (off = only verified; prevents takeover)
# OAUTH_ALLOW_DIRECT_IDTOKEN=false  # enable client-supplied direct idToken sign-in (off; requires JWKS verification)
# OAUTH_STATE_COOKIE_BINDING=false  # bind OAuth state to browser cookie for CSRF (off; may break cross-site callbacks)
# SSRF hardening:
# SSRF_ALLOW_PRIVATE_URL_FETCH=false # allow upload-from-URL/workflow HTTP to reach private/loopback/metadata IPs (off = blocked)
# URL_FETCH_TIMEOUT_MS=15000        # response timeout per hop for upload-from-URL (time-to-first-response, not total download; size capped by MAX_UPLOAD_FILE_SIZE)
# Image transform DoS limits:
# ASSET_MAX_DIMENSION=5000          # max output width/height (px) for image transforms; larger clamped
# ASSET_MAX_INPUT_PIXELS=100000000  # max input pixels the decoder accepts (decompression-bomb defense)
# Auth brute-force limiter (login/magic-link/password-reset; stricter than global RATE_LIMIT):
# AUTH_RATE_LIMIT=10                # max attempts per window, per (IP+email) pair (per-account budget per IP; does not cap total across accounts)
# AUTH_RATE_LIMIT_INTERVAL=900000   # window in ms (15 min)
# AUTH_RATE_LIMIT_DISABLED=false    # disable the auth limiter (auto-disabled in TEST_MODE)
# Note: SQL-injection protection (identifier allowlisting + JSONB numeric validation) is always on.
```

> **Multi-Instance Deployments:** When running multiple instances (PM2 cluster, Kubernetes, etc.), enable Redis for Socket.IO and Tasks to ensure proper coordination. See the [Deployment Guide](https://baasix.com/docs/deploy#multi-instance-deployment-scaling) for details.

### 6. Start the server

```bash
npm start
```

Visit `http://localhost:8056/` to verify the server is running.

---

## 📋 Requirements

- **Node.js** 18+
- **PostgreSQL** 14+ (PostGIS optional for geospatial; pgvector optional for vector embeddings)
- **Redis** 6+

---

## 📚 Documentation

Full documentation is available at **[baasix.com/docs](https://baasix.com/docs)**

### Popular Guides

- [Deployment Guide](https://baasix.com/docs/deploy) — Docker, PM2, Kubernetes deployment
- [Database Schema Guide](https://baasix.com/docs/guides/schema/design) — Schema system and relationships
- [Authentication Guide](https://baasix.com/docs/guides/authentication) — Auth setup and SSO providers
- [Extensions Guide](https://baasix.com/docs/extend/extensions) — Create custom hooks and endpoints
- [Advanced Query Guide](https://baasix.com/docs/guides/data/querying) — Complex filtering and aggregation

---

## 📦 Sample Project

Get started quickly with our complete sample project:

👉 **[github.com/baasix/baasix/samples/sample](https://github.com/baasix/baasix/tree/main/samples/sample)**

Includes:
- Ready-to-use server configuration
- Docker deployment files
- PM2 ecosystem configurations
- Kubernetes manifests
- Example extensions (hooks & endpoints)
- MCP configuration files for AI-powered development

---

## 🤖 MCP Server (AI Integration)

Baasix includes Model Context Protocol (MCP) support for AI assistants like Claude, GitHub Copilot, and Cursor. Choose between **Remote MCP** (built-in) or **Local MCP** (npm package).

| Type | Description | Best For |
|------|-------------|----------|
| **Remote MCP** | Built-in HTTP endpoint at `/mcp` | Production, cloud, remote servers |
| **Local MCP** | `@baasix/mcp` npm package | Claude Desktop, local development |

### Features
- **69 MCP Tools** for comprehensive Baasix operations
- **Schema Management** — Create, update, delete collections and relationships
- **CRUD Operations** — Full item management with powerful query capabilities
- **50+ Filter Operators** — From basic comparison to geospatial, vector similarity, and JSONB queries
- **Permissions** — Role-based access control management
- **Authentication** — Login, register, magic links, invitations
- **App Builder** — Create and validate App Builder pages and blocks from natural language (9 page-builder tools + a block-config reference resource)

### Remote MCP Setup (Recommended)

Enable the built-in MCP server:

```bash
# In your Baasix .env file
MCP_ENABLED=true
# MCP_PATH=/mcp                    # Optional: customize the endpoint path
# MCP_ENABLED_ACTIONS=all          # Optional: comma-separated list of: all, read, create, update, delete
```

**For Claude Code / Anthropic CLI** — Create `.mcp.json` in your project:
```json
{
  "mcpServers": {
    "baasix": {
      "type": "http",
      "url": "http://localhost:8056/mcp?email=admin@baasix.com&password=admin@123"
    }
  }
}
```

Or use headers:
```json
{
  "mcpServers": {
    "baasix": {
      "type": "http",
      "url": "http://localhost:8056/mcp",
      "headers": {
        "X-MCP-Email": "admin@baasix.com",
        "X-MCP-Password": "admin@123"
      }
    }
  }
}
```

**For VS Code with GitHub Copilot** — Create `.vscode/mcp.json`:
```jsonc
{
  "servers": {
    "baasix": {
      "type": "http",
      "url": "http://localhost:8056/mcp",
      "headers": {
        "X-MCP-Email": "${input:mcpEmail}",
        "X-MCP-Password": "${input:mcpPassword}"
      }
    }
  },
  "inputs": [
    { "id": "mcpEmail", "type": "promptString", "description": "Email" },
    { "id": "mcpPassword", "type": "promptString", "description": "Password", "password": true }
  ]
}
```

### Local MCP Setup

For Claude Desktop or local stdio-based integrations:

👉 **[Local MCP Package](https://github.com/baasix/baasix/tree/main/packages/mcp)** | **[npm: @baasix/mcp](https://www.npmjs.com/package/@baasix/mcp)**

**For Claude Desktop** — Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "baasix": {
      "command": "npx",
      "args": ["@baasix/mcp"],
      "env": {
        "BAASIX_URL": "http://localhost:8056",
        "BAASIX_EMAIL": "admin@baasix.com",
        "BAASIX_PASSWORD": "admin@123"
      }
    }
  }
}
```

For more configuration options and examples, see the [MCP Server documentation](https://baasix.dev/docs/extend/mcp).

---

## 🧩 App Builder

Turn your backend into a usable app without a second codebase. Administrators compose **pages**
from configurable **blocks**, and every role uses those pages as their workspace — all governed
by your existing permissions.

- **17 block types** — `table`, `form`, `details`, `kanban`, `calendar`, `chart`, `cardlist`, `map`, `geochart`, `markdown`, `filter`, `buttons`, `media`, `feed`, `iframe`, `upload`, `code`
- **In-place WYSIWYG editing** — the builder and the rendered app are the same components (admin-only "Editing" toggle)
- **12-column grid** that collapses to a stacked layout on mobile
- **Permission-governed** — every data block rides `baasix_Permission` and row-level conditions; nothing bypasses access control
- **Public pages** for forms and dashboards reachable without login
- **Export / import** page bundles between instances with a dry-run validation report
- **AI-ready** — build pages from natural language via the MCP page-builder tools

Pages and blocks are stored in the `baasix_Page` and `baasix_Block` system collections, so you
build them visually in the admin app, programmatically through the SDK, or with AI:

```javascript
// Pages and blocks are ordinary collections — use the items API
const page = await baasix.items("baasix_Page").create({
  name: "Operations",
  slug: "operations",
  icon: "gauge",
});

await baasix.items("baasix_Block").create({
  page_Id: page.id,
  type: "table",
  collection: "orders",
  position: { row: 0, col: 0, span: 8 },
  config: {
    columns: [{ field: "id" }, { field: "customer" }, { field: "total" }],
    filter: { status: { eq: "open" } },
    actions: { create: true, edit: true, view: true },
  },
});
// Renders at /pages/?slug=operations (public pages at /p/?slug=...)
```

Block configs are validated server-side on every save. See the
[App Builder guide](https://baasix.dev/docs/guides/app-builder).

---

## 🔧 Extensions

Extend Baasix with custom hooks and endpoints:

```javascript
// extensions/baasix-hook-example/index.js
import { ItemsService } from "@baasix/baasix";

export default (hooksService, context) => {
  hooksService.registerHook("posts", "items.create", async ({ data, accountability }) => {
    data.created_by = accountability.user.id;
    data.created_at = new Date();
    return { data };
  });
};
```

```javascript
// extensions/baasix-endpoint-example/index.js
import { APIError } from "@baasix/baasix";

export default {
  id: "custom-endpoint",
  handler: (app, context) => {
    app.get("/custom", async (req, res, next) => {
      res.json({ message: "Hello from custom endpoint!" });
    });
  },
};
```

---

## 🛠️ Available Exports

```javascript
// Server
import { startServer, app } from "@baasix/baasix";

// Services
import { 
  ItemsService, 
  FilesService, 
  MailService,
  NotificationService,
  PermissionService,
  WorkflowService 
} from "@baasix/baasix";

// Utilities
import {
  APIError,
  env,
  schemaManager,
  getDatabase,
  getSqlClient,
  triggerLogCleanup
} from "@baasix/baasix";

// Logger
import { getLogger, initializeLogger } from "@baasix/baasix";
```

---

## 🤝 Contributing

Contributions are welcome! Please visit our [GitHub repository](https://github.com/baasix/baasix) to:

- Report bugs
- Request features
- Submit pull requests

---

## 📄 License

This package contains components with different licenses:

| Component | License | Open Source |
|-----------|---------|-------------|
| Core API & Backend | MIT | ✅ Yes |
| Plugins & Utilities | MIT | ✅ Yes |
| Admin Dashboard (`app/`) | Proprietary | ❌ No |

See the [LICENSE.MD](./LICENSE.MD) file for complete details.

---

<p align="center">
  <sub>Built with ❤️ by the Baasix team</sub>
</p>
