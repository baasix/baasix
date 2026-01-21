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
├── mcp-server.js          # MCP server entry point (for AI integration)
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

This sample project includes pre-configured MCP (Model Context Protocol) server files for AI-powered development. The MCP server allows AI assistants like Claude, GitHub Copilot, and Cursor to interact directly with your Baasix backend.

### Configuration Files

#### `.mcp.json` (Claude Code / Anthropic CLI)

This file configures the MCP server for Claude Code and the Anthropic CLI:

```json
{
  "mcpServers": {
    "baasix": {
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

This file configures the MCP server for VS Code with GitHub Copilot:

```jsonc
{
  "servers": {
    "baasix": {
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
  "inputs": []
}
```

### Using the MCP Server

1. **Install the MCP server package:**
   ```bash
   npm install @baasix/mcp
   ```

2. **Start your Baasix server first:**
   ```bash
   npm start
   ```

3. **Configure your AI tool:**
   - The configuration files are already included in this sample project
   - Update the environment variables (`BAASIX_URL`, `BAASIX_EMAIL`, `BAASIX_PASSWORD`) to match your setup

4. **Available MCP Tools:**
   - 40+ tools for schema management, CRUD operations, permissions, authentication, and more
   - Full documentation: [Baasix MCP Server](https://github.com/baasix/baasix/tree/main/packages/mcp)

### MCP Server Entry Point

The `mcp-server.js` file is the entry point for the MCP server:

```javascript
import { startMCPServer } from "@baasix/mcp";

if (import.meta.url === `file://${process.argv[1]}`) {
  startMCPServer().catch((error) => {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
  });
}
```

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

For full documentation, visit: https://baasix.com/docs
