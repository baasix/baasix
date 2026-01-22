# Baasix Sample Application

This is a sample project demonstrating how to deploy Baasix using the `@baasix/baasix` npm package.

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment file and configure
cp .env.example .env
# Edit .env with your configuration

# Start the server
npm start
```

## Project Structure

```
my-baasix-app/
├── server.js              # Main entry point
├── mcp-server.js          # MCP server entry point (for Local MCP)
├── package.json           # Dependencies
├── .env                   # Environment configuration
├── .env.example           # Example environment file
├── .env.production        # Production environment template
├── .mcp.json              # Claude Code / Anthropic CLI MCP config
├── .vscode/
│   └── mcp.json           # VS Code / GitHub Copilot MCP config
├── extensions/            # Custom extensions (optional)
│   ├── baasix-hook-*/     # Hook extensions
│   └── baasix-endpoint-*/ # Endpoint extensions
├── uploads/               # Local file storage (created automatically)
└── deployment/            # Deployment configurations
    ├── docker/            # Docker deployment files
    ├── pm2/               # PM2 deployment files
    └── k8s/               # Kubernetes deployment files
```

## MCP Server (AI Integration)

This sample project includes pre-configured MCP (Model Context Protocol) files for AI-powered development. Baasix provides **two MCP options**:

| Type | Description | Best For |
|------|-------------|----------|
| **Remote MCP** | Built-in HTTP endpoint at `/mcp` | Production, cloud, VS Code Copilot |
| **Local MCP** | `@baasix/mcp` npm package | Claude Desktop, local development |

Both provide 57 tools for schema management, CRUD operations, permissions, authentication, and more.

### Configuration Files

#### `.mcp.json` (Claude Code / Anthropic CLI)

This file configures both Remote and Local MCP servers:

```json
{
  "mcpServers": {
    "baasix-remote": {
      "type": "http",
      "url": "http://localhost:8056/mcp",
      "headers": {
        "X-MCP-Email": "admin@baasix.com",
        "X-MCP-Password": "admin@123"
      }
    },
    "baasix-local": {
      "command": "npx",
      "args": ["tsx", "./mcp-server.js"],
      "env": {
        "BAASIX_URL": "http://localhost:8056",
        "BAASIX_EMAIL": "admin@baasix.com",
        "BAASIX_PASSWORD": "admin@123"
      }
    }
  }
}
```

#### `.vscode/mcp.json` (VS Code / GitHub Copilot)

This file configures both Remote and Local MCP servers:

```jsonc
{
  "servers": {
    "baasix-remote": {
      "type": "http",
      "url": "http://localhost:8056/mcp",
      "headers": {
        "X-MCP-Email": "${input:mcpEmail}",
        "X-MCP-Password": "${input:mcpPassword}"
      }
    },
    "baasix-local": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "./mcp-server.js"],
      "env": {
        "BAASIX_URL": "http://localhost:8056",
        "BAASIX_EMAIL": "admin@baasix.com",
        "BAASIX_PASSWORD": "admin@123"
      }
    }
  },
  "inputs": [
    { "id": "mcpEmail", "type": "promptString", "description": "Baasix Email" },
    { "id": "mcpPassword", "type": "promptString", "description": "Password", "password": true }
  ]
}
```

### Using Remote MCP (Recommended)

1. **Enable MCP in your Baasix server:**
   ```bash
   # In your .env file
   MCP_ENABLED=true
   # MCP_PATH=/mcp  # Optional: customize the endpoint path
   ```

2. **Start your Baasix server:**
   ```bash
   npm start
   ```

3. **Configure your AI tool with Remote MCP:**
   - Use `baasix-remote` server configuration
   - Update credentials in headers

### Using Local MCP

1. **Install the Local MCP package:**
   ```bash
   npm install @baasix/mcp
   ```

2. **Start your Baasix server first:**
   ```bash
   npm start
   ```

3. **Configure your AI tool with Local MCP:**
   - Use `baasix-local` server configuration
   - The Local MCP will connect to your Baasix server via HTTP internally

### Local MCP Entry Point

The `mcp-server.js` file is the optional entry point for custom Local MCP configurations:

```javascript
import { startMCPServer } from "@baasix/mcp";

if (import.meta.url === `file://${process.argv[1]}`) {
  startMCPServer().catch((error) => {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
  });
}
```

### Available MCP Tools

Both Remote and Local MCP provide 57 tools:

- **Schema Management** (13 tools) — Create, update, delete collections and relationships
- **Item Management** (6 tools) — Full CRUD with 50+ filter operators
- **Authentication** (10 tools) — Login, register, magic links, invitations
- **Permissions** (9 tools) — Role-based access control management
- **File Management** (3 tools) — Upload, list, manage files
- **Reports & Analytics** (2 tools) — Generate reports with grouping
- **Notifications** (3 tools) — User notification system
- **Realtime** (5 tools) — WAL-based realtime management
- **Settings & Utils** (6 tools) — Application settings and utilities

Full documentation: [Baasix MCP Server](https://baasix.dev/docs/mcp-server-docs)

## Deployment Options

### 1. Manual Deployment
See `deployment/manual/README.md`

### 2. Docker Deployment
See `deployment/docker/README.md`

### 3. PM2 Deployment
See `deployment/pm2/README.md`

### 4. Kubernetes Deployment
See `deployment/k8s/README.md`

## Creating Extensions

### Hook Extension

Create `extensions/baasix-hook-example/index.js`:

```javascript
import { ItemsService } from "@baasix/baasix";

export default (hooksService, context) => {
  hooksService.registerHook("posts", "items.create", async ({ data, accountability }) => {
    data.created_by = accountability.user.id;
    data.created_at = new Date();
    return { data };
  });
};
```

### Endpoint Extension

Create `extensions/baasix-endpoint-example/index.js`:

```javascript
import { APIError } from "@baasix/baasix";

const registerEndpoint = (app, context) => {
  app.get("/custom-endpoint", async (req, res, next) => {
    try {
      if (!req.accountability || !req.accountability.user) {
        throw new APIError("Unauthorized", 401);
      }
      res.json({ message: "Hello from custom endpoint!" });
    } catch (error) {
      next(error);
    }
  });
};

export default {
  id: "custom-endpoint",
  handler: registerEndpoint,
};
```

## Environment Variables

See `.env.example` for all available configuration options.

### Multi-Instance Deployment

When running multiple instances (PM2 cluster, Kubernetes, etc.), configure Redis for coordination:

```bash
# Socket.IO - Required for WebSocket broadcasting across instances
SOCKET_ENABLED=true
SOCKET_REDIS_ENABLED=true
SOCKET_REDIS_URL=redis://localhost:6379

# Tasks - Required for distributed task locking
TASK_SERVICE_ENABLED=true
TASK_REDIS_ENABLED=true
TASK_REDIS_URL=redis://localhost:6379

# Cache - Recommended for consistency
CACHE_ADAPTER=redis
CACHE_REDIS_URL=redis://localhost:6379
```

## Documentation

For full documentation, visit: https://baasix.dev/docs
