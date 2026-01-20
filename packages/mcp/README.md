# Baasix MCP Server

A Model Context Protocol (MCP) server that provides Claude Desktop and other MCP clients with direct access to Baasix Backend-as-a-Service operations.

**Baasix** is an open-source BaaS that generates REST APIs from data models, featuring 50+ filter operators, visual workflows, multi-tenancy, and real-time subscriptions.

## Features

- **45+ MCP Tools** for comprehensive Baasix operations
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

## Quick Start

### 1. Install dependencies
```bash
cd mcp
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env with your Baasix server details
```

### 3. Start the MCP server
```bash
npm start
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BAASIX_URL` | Yes | `http://localhost:8056` | Baasix server URL |
| `BAASIX_AUTH_TOKEN` | No* | - | Pre-obtained JWT token |
| `BAASIX_EMAIL` | No* | - | Email for auto-authentication |
| `BAASIX_PASSWORD` | No* | - | Password for auto-authentication |

*Either `BAASIX_AUTH_TOKEN` OR both `BAASIX_EMAIL` and `BAASIX_PASSWORD` must be provided.

### Environment Files
- `.env` - Development environment (default)
- `.env.production` - Production environment

### Available Scripts
- `npm run development` - Start with development environment
- `npm start` - Start with production environment
- `npm run dev` - Development mode with auto-restart
- `npm test` - Run tests
- `npm run debug` - Start with MCP inspector for debugging

## IDE Integration

Baasix MCP Server integrates with various AI-powered development tools. Below are configuration examples for popular IDEs and tools.

### Claude Desktop

Add to your Claude Desktop configuration (`claude_desktop_config.json`):

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "baasix": {
      "command": "node",
      "args": ["/path/to/baasix/mcp/server.js"],
      "env": {
        "BAASIX_URL": "http://localhost:8056",
        "BAASIX_EMAIL": "admin@baasix.com",
        "BAASIX_PASSWORD": "admin@123"
      }
    }
  }
}
```

### Claude Code (Anthropic CLI)

For Claude Code CLI, create a `.mcp.json` file in your project root:

```json
{
  "mcpServers": {
    "baasix": {
      "command": "node",
      "args": ["./mcp-server.js"],
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
claude mcp add baasix npm run start
```

### VS Code with GitHub Copilot

For VS Code with GitHub Copilot, create `.vscode/mcp.json` in your project:

```jsonc
{
  "servers": {
    "baasix": {
      "type": "stdio",
      "command": "node",
      "args": ["./mcp-server.js"],
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

### Cursor IDE

For Cursor, add to your Cursor settings or create a project-level configuration:

```json
{
  "mcpServers": {
    "baasix": {
      "command": "node",
      "args": ["./mcp-server.js"],
      "env": {
        "BAASIX_URL": "http://localhost:8056",
        "BAASIX_EMAIL": "admin@baasix.com",
        "BAASIX_PASSWORD": "admin@123"
      }
    }
  }
}
```

### Using the npm Package

If you're using the published npm package instead of the source:

```json
{
  "mcpServers": {
    "baasix": {
      "command": "npx",
      "args": ["@tspvivek/baasix-mcp-server"],
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
| `baasix_migrate_indexes` | Add missing FK indexes to all collections |
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

### Settings (2 tools)
| Tool | Description |
|------|-------------|
| `baasix_get_settings` | Get application settings |
| `baasix_update_settings` | Update settings |

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
| `baasix_sort_items` | Reorder items in collection |

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
{"field": {"istartswith": "pre"}}     // Starts with (case-insensitive)
{"field": {"endswith": "fix"}}        // Ends with
{"field": {"iendswith": "fix"}}       // Ends with (case-insensitive)
{"field": {"like": "pat%tern"}}       // SQL LIKE pattern
{"field": {"ilike": "pat%tern"}}      // LIKE (case-insensitive)
{"field": {"regex": "^\\d+$"}}        // Regular expression
{"field": {"iregex": "pattern"}}      // Regex (case-insensitive)
```

### Null/Empty Operators
```json
{"field": {"isNull": true}}           // IS NULL
{"field": {"isNull": false}}          // IS NOT NULL
{"field": {"empty": true}}            // Empty string or null
{"field": {"empty": false}}           // Not empty
```

### List Operators
```json
{"field": {"in": ["a", "b", "c"]}}    // In list
{"field": {"nin": ["x", "y"]}}        // Not in list
{"field": {"between": [10, 100]}}     // Between range
{"field": {"nbetween": [10, 100]}}    // Not between
```

### Array Operators
```json
{"tags": {"arraycontains": ["a", "b"]}}    // Contains all elements
{"tags": {"arraycontainsany": ["a", "b"]}} // Contains any element
{"tags": {"arraylength": 3}}               // Array has exact length
{"tags": {"arrayempty": true}}             // Array is empty
```

### JSONB Operators (PostgreSQL)
```json
{"meta": {"jsoncontains": {"key": "val"}}}      // JSON contains
{"meta": {"jsoncontainedby": {"a": 1}}}         // JSON contained by
{"meta": {"jsonhaskey": "key"}}                 // Has key
{"meta": {"jsonhasanykeys": ["a", "b"]}}        // Has any keys
{"meta": {"jsonhasallkeys": ["a", "b"]}}        // Has all keys
{"meta": {"jsonpath": "$.store.book[0].title"}} // JSONPath query
```

### Geospatial Operators (PostGIS)
```json
{"location": {"dwithin": {"geometry": {"type": "Point", "coordinates": [-73.9, 40.7]}, "distance": 5000}}}
{"location": {"intersects": {"type": "Polygon", "coordinates": [...]}}}
{"location": {"contains": {"type": "Point", "coordinates": [...]}}}
{"location": {"within": {"type": "Polygon", "coordinates": [...]}}}
{"location": {"overlaps": {"type": "Polygon", "coordinates": [...]}}}
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
{"createdAt": {"gte": "$NOW"}}            // Current timestamp
{"createdAt": {"gte": "$NOW-DAYS_7"}}     // 7 days ago
{"dueDate": {"lte": "$NOW+MONTHS_1"}}     // 1 month from now
```

### Relation Filtering
```json
// Filter by related collection fields
{"category.name": {"eq": "Electronics"}}
{"author.role.name": {"eq": "admin"}}
```

## Query Parameters for baasix_list_items

```javascript
{
  collection: "products",           // Required: collection name
  filter: {...},                    // Filter object (see above)
  sort: "createdAt:desc",          // Sort: "field:asc" or "field:desc"
  page: 1,                         // Page number
  limit: 10,                       // Items per page (-1 for all)
  fields: ["*", "category.*"],     // Fields to include (* for all)
  search: "keyword",               // Full-text search
  searchFields: ["name", "desc"],  // Fields to search in
  aggregate: {                     // Aggregation functions
    total: {function: "sum", field: "price"},
    count: {function: "count", field: "id"}
  },
  groupBy: ["category_Id"],        // Group by fields
  relConditions: {                 // Filter related records
    "reviews": {"approved": {"eq": true}}
  }
}
```

## Schema Definition Example

When using `baasix_create_schema`:

```javascript
{
  collection: "products",
  schema: {
    name: "Product",
    timestamps: true,        // Adds createdAt, updatedAt
    paranoid: false,         // Set true for soft deletes
    fields: {
      id: {
        type: "UUID",
        primaryKey: true,
        defaultValue: {type: "UUIDV4"}
      },
      sku: {
        type: "SUID",
        unique: true,
        defaultValue: {type: "SUID"}
      },
      name: {
        type: "String",
        allowNull: false,
        values: {length: 255},
        validate: {notEmpty: true, len: [3, 255]}
      },
      price: {
        type: "Decimal",
        values: {precision: 10, scale: 2},
        defaultValue: 0.00,
        validate: {min: 0, max: 999999.99}
      },
      quantity: {
        type: "Integer",
        defaultValue: 0,
        validate: {isInt: true, min: 0}
      },
      email: {
        type: "String",
        validate: {isEmail: true}
      },
      tags: {
        type: "Array",
        values: {type: "String"},
        defaultValue: []
      },
      metadata: {
        type: "JSONB",
        defaultValue: {}
      }
    }
  }
}
```

### Field Validation Rules

| Rule | Type | Description |
|------|------|-------------|
| `min` | number | Minimum value for numeric fields |
| `max` | number | Maximum value for numeric fields |
| `isInt` | boolean | Validate as integer |
| `notEmpty` | boolean | String cannot be empty |
| `isEmail` | boolean | Valid email format |
| `isUrl` | boolean | Valid URL format |
| `len` | [min, max] | String length range |
| `is` / `matches` | regex | Pattern matching |

```javascript
// Validation examples
{
  "email": {
    "type": "String",
    "validate": {"isEmail": true, "notEmpty": true}
  },
  "age": {
    "type": "Integer",
    "validate": {"isInt": true, "min": 0, "max": 120}
  },
  "username": {
    "type": "String",
    "validate": {"notEmpty": true, "len": [3, 50]}
  },
  "phone": {
    "type": "String",
    "validate": {"matches": "^\\+?[1-9]\\d{1,14}$"}
  }
}
```

### Default Value Types

| Type | Description |
|------|-------------|
| `UUIDV4` | Random UUID v4 |
| `SUID` | Short unique ID (compact, URL-safe) |
| `NOW` | Current timestamp |
| `AUTOINCREMENT` | Auto-incrementing integer |
| `SQL` | Custom SQL expression |
| Static | Any constant value (`"active"`, `false`, `0`) |

```javascript
// Default value examples
{
  "id": {"type": "UUID", "defaultValue": {"type": "UUIDV4"}},
  "shortCode": {"type": "SUID", "defaultValue": {"type": "SUID"}},
  "createdAt": {"type": "DateTime", "defaultValue": {"type": "NOW"}},
  "orderNum": {"type": "Integer", "defaultValue": {"type": "AUTOINCREMENT"}},
  "sortOrder": {"type": "Integer", "defaultValue": {"type": "SQL", "value": "(SELECT MAX(sort)+1 FROM items)"}},
  "status": {"type": "String", "defaultValue": "pending"},
  "isActive": {"type": "Boolean", "defaultValue": true}
}
```

### Supported Field Types
- **String**: `values: {length: 255}` for VARCHAR
- **Text**: Unlimited length text
- **Integer**, **BigInt**: Whole numbers
- **Decimal**: `values: {precision: 10, scale: 2}`
- **Float**, **Real**, **Double**: Floating point
- **Boolean**: true/false
- **Date**, **DateTime**, **Time**: Date/time values
- **UUID**: `defaultValue: {type: "UUIDV4"}`
- **SUID**: `defaultValue: {type: "SUID"}` - Short unique ID
- **JSONB**: JSON with indexing
- **Array**: `values: {type: "String|Integer|etc"}`
- **Geometry**, **Geography**: PostGIS spatial types
- **Enum**: `values: {values: ["A", "B", "C"]}`

## Relationship Types

When using `baasix_create_relationship`:

```javascript
// Many-to-One (products.category_Id → categories.id)
{
  sourceCollection: "products",
  relationshipData: {
    type: "M2O",
    name: "category",      // Creates category_Id field
    target: "categories",
    alias: "products"      // Reverse relation name
  }
}

// Many-to-Many (products ↔ tags)
// Auto-generates junction table: products_tags_tags_junction
{
  sourceCollection: "products",
  relationshipData: {
    type: "M2M",
    name: "tags",
    target: "tags",
    alias: "products"
  }
}

// Many-to-Many with custom junction table name
// Useful when auto-generated name exceeds PostgreSQL's 63 char limit
{
  sourceCollection: "products",
  relationshipData: {
    type: "M2M",
    name: "tags",
    target: "tags",
    alias: "products",
    through: "product_tags"  // Custom junction table name (max 63 chars)
  }
}

// Many-to-Any (polymorphic - comments can belong to posts OR products)
{
  sourceCollection: "comments",
  relationshipData: {
    type: "M2A",
    name: "commentable",
    tables: ["posts", "products"],
    alias: "comments",
    through: "comment_refs"  // Optional custom junction table name
  }
}
```

### Junction Tables (M2M/M2A)

- **Auto-generated name**: `{source}_{target}_{name}_junction`
- **Custom name**: Use `through` property (max 63 characters for PostgreSQL)
- **Schema property**: Junction tables have `isJunction: true` in their schema definition
- **Auto-indexed**: Foreign key columns are automatically indexed for better query performance

## Permission Structure

When using `baasix_create_permission`:

```javascript
{
  role_Id: "uuid-of-role",
  collection: "products",
  action: "read",                    // read, create, update, delete
  fields: ["*"],                     // Or specific: ["name", "price"]
  conditions: {                      // Row-level security
    "published": {"eq": true}
  },
  relConditions: {                   // Filter related data
    "reviews": {"approved": {"eq": true}}
  }
}
```

## Package Usage

### Installation
```bash
npm install @tspvivek/baasix-mcp-server
```

### Usage
```javascript
import { startMCPServer } from '@tspvivek/baasix-mcp-server';

startMCPServer().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
```

### Custom Server Instance
```javascript
import { BaasixMCPServer } from '@tspvivek/baasix-mcp-server';

const server = new BaasixMCPServer();
server.run().catch(console.error);
```

## Claude Code CLI Commands

```bash
# Add MCP server
claude mcp add baasix npm run start

# Remove MCP server
claude mcp remove baasix
```

## File Structure

```
mcp/
├── server.js              # Entry point
├── package.json           # Dependencies and scripts
├── .env                   # Development config
├── .env.example           # Template
├── .env.production        # Production config
├── README.md              # This file
└── baasix/
    ├── index.js           # MCP server implementation
    └── config.js          # Configuration management
```

## Requirements

- Node.js 18+
- Baasix server running (v0.1.0-alpha.2+)
- PostgreSQL 14+ (with PostGIS for geospatial)

## Links

- **Baasix Website**: https://baasix.dev
- **Documentation**: https://baasix.dev/docs
- **GitHub**: https://github.com/tspvivek/baasix
- **npm Package**: https://www.npmjs.com/package/@tspvivek/baasix

## License

MIT
