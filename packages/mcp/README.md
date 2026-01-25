# Baasix Local MCP Server

A Model Context Protocol (MCP) server that provides Claude Desktop and other MCP clients with local access to Baasix Backend-as-a-Service operations.

> **Note:** This is the **Local MCP** package that runs on your machine. Baasix also has a **Remote MCP** built into the core server at `/mcp` endpoint. See [Choosing Local vs Remote MCP](#choosing-local-vs-remote-mcp) for guidance.

**Baasix** is an open-source BaaS that generates REST APIs from data models, featuring 50+ filter operators, visual workflows, multi-tenancy, and real-time subscriptions.

## Features

- **57 MCP Tools** for comprehensive Baasix operations
- **Schema Management** - Create, update, delete collections and relationships
- **CRUD Operations** - Full item management with powerful query capabilities
- **50+ Filter Operators** - From basic comparison to geospatial and JSONB queries
- **Relations** - M2O, O2M, M2M, and polymorphic M2A relationships
- **Aggregation** - SUM, AVG, COUNT, MIN, MAX with groupBy
- **Permissions** - Role-based access control management
- **File Management** - Upload, list, and manage files
- **Authentication** - Login, register, magic links, invitations
- **Multi-tenancy** - Tenant management and switching
- **Realtime** - Enable/disable WAL-based realtime per collection

## Choosing Local vs Remote MCP

| Feature | Local MCP (this package) | Remote MCP (built-in) |
|---------|--------------------------|----------------------|
| **Transport** | stdio | HTTP (Streamable HTTP) |
| **Setup** | Install `@baasix/mcp` | Enable `MCP_ENABLED=true` on server |
| **Authentication** | Environment variables | HTTP headers |
| **Best For** | Claude Desktop, local dev | Production, cloud, remote servers |
| **Process** | Runs locally | Runs on Baasix server |
| **Config File** | `.mcp.json` | `.mcp.json` or `.vscode/mcp.json` |

**Use Local MCP when:**
- Using Claude Desktop (requires stdio transport)
- Working offline with local Baasix server
- Need environment-based configuration

**Use Remote MCP when:**
- Connecting to remote/cloud Baasix servers
- Using VS Code with GitHub Copilot (supports HTTP)
- Want simpler setup without npm packages

## Quick Start

### 1. Install dependencies
```bash
npm install @baasix/mcp
```

### 2. Configure your AI tool
See [IDE Integration](#ide-integration) below.

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BAASIX_URL` | Yes | `http://localhost:8056` | Baasix server URL |
| `BAASIX_AUTH_TOKEN` | No* | - | Pre-obtained JWT token |
| `BAASIX_EMAIL` | No* | - | Email for auto-authentication |
| `BAASIX_PASSWORD` | No* | - | Password for auto-authentication |

*Either `BAASIX_AUTH_TOKEN` OR both `BAASIX_EMAIL` and `BAASIX_PASSWORD` must be provided.

## IDE Integration

### Claude Code / Anthropic CLI

Create a `.mcp.json` file in your project root:

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

Or add via CLI:
```bash
claude mcp add baasix -- npx @baasix/mcp
```

### Claude Desktop

Add to your Claude Desktop configuration:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

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

### VS Code with GitHub Copilot

For VS Code, you can use either Local MCP (stdio) or Remote MCP (HTTP).

**Local MCP (stdio)** - Create `.vscode/mcp.json`:

```jsonc
{
  "servers": {
    "baasix": {
      "type": "stdio",
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

**Remote MCP (HTTP)** - Create `.vscode/mcp.json`:

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
    { "id": "mcpEmail", "type": "promptString", "description": "Baasix Email" },
    { "id": "mcpPassword", "type": "promptString", "description": "Password", "password": true }
  ]
}
```

### Cursor IDE

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

## Available Tools

### Schema Management (13 tools)
| Tool | Description |
|------|-------------|
| `baasix_list_schemas` | List all collections with search/pagination |
| `baasix_get_schema` | Get detailed schema for a collection |
| `baasix_create_schema` | Create a new collection schema |
| `baasix_update_schema` | Update existing schema |
| `baasix_delete_schema` | Delete a collection schema |
| `baasix_add_index` | Add index to collection |
| `baasix_remove_index` | Remove index from collection |
| `baasix_create_relationship` | Create M2O/O2M/M2M/M2A relationship |
| `baasix_update_relationship` | Update existing relationship |
| `baasix_delete_relationship` | Delete a relationship |
| `baasix_export_schemas` | Export all schemas as JSON |
| `baasix_import_schemas` | Import schemas from JSON |

### Item Management (5 tools)
| Tool | Description |
|------|-------------|
| `baasix_list_items` | Query items with filters, sort, pagination |
| `baasix_get_item` | Get specific item by ID |
| `baasix_create_item` | Create new item |
| `baasix_update_item` | Update existing item |
| `baasix_delete_item` | Delete item |
| `baasix_sort_items` | Reorder items in collection |

### File Management (3 tools)
| Tool | Description |
|------|-------------|
| `baasix_list_files` | List files with metadata |
| `baasix_get_file_info` | Get file details |
| `baasix_delete_file` | Delete file |

### Authentication (10 tools)
| Tool | Description |
|------|-------------|
| `baasix_auth_status` | Check authentication status |
| `baasix_refresh_auth` | Refresh authentication token |
| `baasix_register_user` | Register new user |
| `baasix_login` | Login with email/password |
| `baasix_logout` | Logout current user |
| `baasix_get_current_user` | Get current user info |
| `baasix_send_invite` | Send user invitation |
| `baasix_verify_invite` | Verify invitation token |
| `baasix_send_magic_link` | Send magic link/code |
| `baasix_get_user_tenants` | Get user's available tenants |
| `baasix_switch_tenant` | Switch tenant context |

### Permissions (9 tools)
| Tool | Description |
|------|-------------|
| `baasix_list_roles` | List all roles |
| `baasix_list_permissions` | List all permissions |
| `baasix_get_permission` | Get permission by ID |
| `baasix_get_permissions` | Get permissions for a role |
| `baasix_create_permission` | Create new permission |
| `baasix_update_permission` | Update permission |
| `baasix_delete_permission` | Delete permission |
| `baasix_update_permissions` | Bulk update role permissions |
| `baasix_reload_permissions` | Reload permission cache |

### Reports & Analytics (2 tools)
| Tool | Description |
|------|-------------|
| `baasix_generate_report` | Generate reports with grouping |
| `baasix_collection_stats` | Get collection statistics |

### Notifications (3 tools)
| Tool | Description |
|------|-------------|
| `baasix_list_notifications` | List user notifications |
| `baasix_send_notification` | Send notification to users |
| `baasix_mark_notification_seen` | Mark notification as seen |

### Settings & Templates (4 tools)
| Tool | Description |
|------|-------------|
| `baasix_get_settings` | Get application settings |
| `baasix_update_settings` | Update settings |
| `baasix_list_templates` | List email templates |
| `baasix_get_template` | Get email template |
| `baasix_update_template` | Update email template |

### Realtime (5 tools)
| Tool | Description |
|------|-------------|
| `baasix_realtime_status` | Get realtime service status |
| `baasix_realtime_config` | Check PostgreSQL WAL configuration |
| `baasix_realtime_collections` | List collections with realtime enabled |
| `baasix_realtime_enable` | Enable realtime for a collection |
| `baasix_realtime_disable` | Disable realtime for a collection |

### Utilities (2 tools)
| Tool | Description |
|------|-------------|
| `baasix_server_info` | Get server health/info |

## Filter Operators Reference

When using `baasix_list_items`, the `filter` parameter supports 50+ operators:

### Comparison Operators
```json
{"field": {"eq": "value"}}      // Equal
{"field": {"neq": "value"}}     // Not equal
{"field": {"gt": 100}}          // Greater than
{"field": {"gte": 100}}         // Greater than or equal
{"field": {"lt": 100}}          // Less than
{"field": {"lte": 100}}         // Less than or equal
```

### String Operators
```json
{"field": {"contains": "text"}}       // Contains substring
{"field": {"icontains": "text"}}      // Contains (case-insensitive)
{"field": {"startswith": "pre"}}      // Starts with
{"field": {"like": "pat%tern"}}       // SQL LIKE pattern
{"field": {"regex": "^\\d+$"}}        // Regular expression
```

### List Operators
```json
{"field": {"in": ["a", "b", "c"]}}    // In list
{"field": {"nin": ["x", "y"]}}        // Not in list
{"field": {"between": [10, 100]}}     // Between range
```

### Logical Operators
```json
{"AND": [{"status": {"eq": "active"}}, {"price": {"lt": 100}}]}
{"OR": [{"type": {"eq": "A"}}, {"type": {"eq": "B"}}]}
{"NOT": {"deleted": {"eq": true}}}
```

### Dynamic Variables
```json
{"author_Id": {"eq": "$CURRENT_USER"}}    // Current user's ID
{"createdAt": {"gte": "$NOW-DAYS_7"}}     // 7 days ago
```

For the complete list of 50+ operators, see the [Filter Reference](https://baasix.dev/docs/guides/data/filtering).

## Package Usage

### Installation
```bash
npm install @baasix/mcp
```

### Programmatic Usage
```javascript
import { startMCPServer } from '@baasix/mcp';

startMCPServer().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
```

## Requirements

- Node.js 18+
- Baasix server running (v0.1.0+)
- PostgreSQL 14+ (with PostGIS for geospatial)

## Links

- **Baasix Website**: https://baasix.dev
- **Documentation**: https://baasix.dev/docs/extend/mcp
- **GitHub**: https://github.com/baasix/baasix
- **npm Package**: https://www.npmjs.com/package/@baasix/mcp

## License

MIT
