import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import axios from "axios";
import { loadEnvironmentConfig } from "./config.js";

// Load configuration
const config = loadEnvironmentConfig();

// Configuration from loaded config
const BAASIX_URL = config.BAASIX_URL || "http://localhost:8056";
const BAASIX_AUTH_TOKEN = config.BAASIX_AUTH_TOKEN;
const BAASIX_EMAIL = config.BAASIX_EMAIL;
const BAASIX_PASSWORD = config.BAASIX_PASSWORD;

// Authentication state
let authToken = null;
let authExpiry = null;

// Helper function to get valid auth token
async function getAuthToken() {
    // Priority 1: Use provided token if available
    if (BAASIX_AUTH_TOKEN) {
        return BAASIX_AUTH_TOKEN;
    }

    // Priority 2: Check if current token is still valid
    if (authToken && authExpiry && Date.now() < authExpiry) {
        return authToken;
    }

    // Priority 3: Auto-authenticate using email/password
    if (BAASIX_EMAIL && BAASIX_PASSWORD) {
        try {
            const response = await axios.post(`${BAASIX_URL}/auth/login`, {
                email: BAASIX_EMAIL,
                password: BAASIX_PASSWORD,
            });

            authToken = response.data.token;
            authExpiry = Date.now() + 60 * 60 * 1000; // 1 hour

            return authToken;
        } catch (error) {
            throw new Error(`Authentication failed: ${error.response?.data?.message || error.message}`);
        }
    }

    throw new Error(
        "No authentication method available. Please provide BAASIX_AUTH_TOKEN or BAASIX_EMAIL/BAASIX_PASSWORD"
    );
}

// Helper function to make authenticated requests
async function baasixRequest(endpoint, options = {}) {
    const token = await getAuthToken();

    const config = {
        baseURL: BAASIX_URL,
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(token && { Authorization: `Bearer ${token}` }),
            ...options.headers,
        },
    };

    try {
        const response = await axios(endpoint, config);
        return response.data;
    } catch (error) {
        // If auth error and using auto-login, clear token and retry once
        if (error.response?.status === 401 && authToken && !BAASIX_AUTH_TOKEN) {
            authToken = null;
            authExpiry = null;

            try {
                const newToken = await getAuthToken();
                if (newToken) {
                    config.headers.Authorization = `Bearer ${newToken}`;
                    const retryResponse = await axios(endpoint, config);
                    return retryResponse.data;
                }
            } catch (retryError) {
                throw new Error(`Baasix API Error: ${retryError.response?.data?.message || retryError.message}`);
            }
        }

        throw new Error(`Baasix API Error: ${error.response?.data?.message || error.message}`);
    }
}

class BaasixMCPServer {
    server;

    constructor() {
        this.server = new Server(
            {
                name: "baasix-mcp-server",
                version: "0.1.0",
            },
            {
                capabilities: {
                    tools: {},
                },
            }
        );

        this.setupHandlers();
        this.setupErrorHandling();
    }

    setupErrorHandling() {
        this.server.onerror = (error) => {
            console.error("[MCP Error]", error);
        };

        process.on("SIGINT", async () => {
            await this.server.close();
            process.exit(0);
        });
    }

    setupHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: [
                    // Schema Management Tools
                    {
                        name: "baasix_list_schemas",
                        description:
                            "Get all available collections/schemas in Baasix with optional search and pagination",
                        inputSchema: {
                            type: "object",
                            properties: {
                                search: {
                                    type: "string",
                                    description: "Search term to filter schemas by collection name or schema name",
                                },
                                page: {
                                    type: "number",
                                    description: "Page number for pagination (default: 1)",
                                    default: 1,
                                },
                                limit: {
                                    type: "number",
                                    description: "Number of schemas per page (default: 10)",
                                    default: 10,
                                },
                                sort: {
                                    type: "string",
                                    description:
                                        'Sort field and direction (e.g., "collectionName:asc", "collectionName:desc")',
                                    default: "collectionName:asc",
                                },
                            },
                            additionalProperties: false,
                        },
                    },
                    {
                        name: "baasix_get_schema",
                        description: "Get detailed schema information for a specific collection",
                        inputSchema: {
                            type: "object",
                            properties: {
                                collection: {
                                    type: "string",
                                    description: "Collection name",
                                },
                            },
                            required: ["collection"],
                        },
                    },
                    {
                        name: "baasix_create_schema",
                        description: `Create a new collection schema in Baasix.

FIELD TYPES:
- String: VARCHAR with values.length (e.g., 255)
- Text: Unlimited text
- Integer, BigInt: Whole numbers
- Decimal: values.precision & values.scale
- Float, Real, Double: Floating point
- Boolean: true/false
- Date, DateTime, Time: Date/time
- UUID: With defaultValue.type: "UUIDV4"
- SUID: Short unique ID with defaultValue.type: "SUID"
- JSONB: JSON with indexing
- Array: values.type specifies element type
- Geometry, Geography: PostGIS spatial
- Enum: values.values array

DEFAULT VALUE TYPES:
- { type: "UUIDV4" } - Random UUID v4
- { type: "SUID" } - Short unique ID
- { type: "NOW" } - Current timestamp
- { type: "AUTOINCREMENT" } - Auto-incrementing integer
- { type: "SQL", value: "..." } - Custom SQL expression
- Static values: "active", false, 0, etc.

VALIDATION RULES:
- min: number - Minimum value (numeric fields)
- max: number - Maximum value (numeric fields)
- isInt: true - Must be integer
- notEmpty: true - String cannot be empty
- isEmail: true - Valid email format
- isUrl: true - Valid URL format
- len: [min, max] - String length range
- is/matches: "regex" - Pattern matching

SCHEMA OPTIONS:
- timestamps: true adds createdAt/updatedAt
- paranoid: true enables soft deletes (deletedAt)

EXAMPLE:
{
  "name": "Product",
  "timestamps": true,
  "fields": {
    "id": {"type": "UUID", "primaryKey": true, "defaultValue": {"type": "UUIDV4"}},
    "sku": {"type": "SUID", "unique": true, "defaultValue": {"type": "SUID"}},
    "name": {"type": "String", "allowNull": false, "values": {"length": 255}, "validate": {"notEmpty": true}},
    "price": {"type": "Decimal", "values": {"precision": 10, "scale": 2}, "validate": {"min": 0}},
    "email": {"type": "String", "validate": {"isEmail": true}},
    "quantity": {"type": "Integer", "defaultValue": 0, "validate": {"isInt": true, "min": 0}}
  }
}`,
                        inputSchema: {
                            type: "object",
                            properties: {
                                collection: {
                                    type: "string",
                                    description: "Collection name (lowercase, snake_case recommended)",
                                },
                                schema: {
                                    type: "object",
                                    description: "Schema definition with name, fields, timestamps, paranoid options",
                                },
                            },
                            required: ["collection", "schema"],
                        },
                    },
                    {
                        name: "baasix_update_schema",
                        description: "Update an existing collection schema",
                        inputSchema: {
                            type: "object",
                            properties: {
                                collection: {
                                    type: "string",
                                    description: "Collection name",
                                },
                                schema: {
                                    type: "object",
                                    description: "Updated schema definition",
                                },
                            },
                            required: ["collection", "schema"],
                        },
                    },
                    {
                        name: "baasix_delete_schema",
                        description: "Delete a collection schema",
                        inputSchema: {
                            type: "object",
                            properties: {
                                collection: {
                                    type: "string",
                                    description: "Collection name",
                                },
                            },
                            required: ["collection"],
                        },
                    },
                    {
                        name: "baasix_add_index",
                        description: "Add an index to a collection schema",
                        inputSchema: {
                            type: "object",
                            properties: {
                                collection: {
                                    type: "string",
                                    description: "Collection name",
                                },
                                indexDefinition: {
                                    type: "object",
                                    description: "Index definition with fields and options",
                                    properties: {
                                        name: {
                                            type: "string",
                                            description: "Index name",
                                        },
                                        fields: {
                                            type: "array",
                                            items: { type: "string" },
                                            description: "Array of field names to index",
                                        },
                                        unique: {
                                            type: "boolean",
                                            description: "Whether the index should be unique",
                                        },
                                        nullsNotDistinct: {
                                            type: "boolean",
                                            description: "When true, NULL values are considered equal for unique indexes (PostgreSQL 15+). Only applies when unique is true.",
                                        },
                                    },
                                    required: ["name", "fields"],
                                },
                            },
                            required: ["collection", "indexDefinition"],
                        },
                    },
                    {
                        name: "baasix_remove_index",
                        description: "Remove an index from a collection schema",
                        inputSchema: {
                            type: "object",
                            properties: {
                                collection: {
                                    type: "string",
                                    description: "Collection name",
                                },
                                indexName: {
                                    type: "string",
                                    description: "Name of the index to remove",
                                },
                            },
                            required: ["collection", "indexName"],
                        },
                    },
                    {
                        name: "baasix_create_relationship",
                        description: `Create a relationship between collections.

RELATIONSHIP TYPES:
- M2O (Many-to-One): Creates foreign key with auto-index. products.category → categories
- O2M (One-to-Many): Virtual reverse of M2O. categories.products → products
- O2O (One-to-One): Creates foreign key with auto-index. user.profile → profiles
- M2M (Many-to-Many): Creates junction table with auto-indexed FKs. products ↔ tags
- M2A (Many-to-Any): Polymorphic junction table. comments → posts OR products

AUTO-INDEXING:
All foreign key columns are automatically indexed for better query performance:
- M2O/O2O: Index on the FK column (e.g., category_Id)
- M2M/M2A: Indexes on both FK columns in junction tables

JUNCTION TABLES (M2M/M2A):
- Auto-generated name: {source}_{target}_{name}_junction
- Custom name: Use "through" property (max 63 chars for PostgreSQL)
- Junction tables are marked with isJunction: true in schema

EXAMPLE M2O:
{
  "name": "category",        // Creates category_Id field + index
  "type": "M2O",
  "target": "categories",
  "alias": "products",       // Reverse relation name
  "onDelete": "CASCADE"      // CASCADE, RESTRICT, SET NULL
}

EXAMPLE M2M:
{
  "name": "tags",
  "type": "M2M",
  "target": "tags",
  "alias": "products"
}

EXAMPLE M2M with custom junction table:
{
  "name": "tags",
  "type": "M2M",
  "target": "tags",
  "alias": "products",
  "through": "product_tag_mapping"  // Custom junction table name
}`,
                        inputSchema: {
                            type: "object",
                            properties: {
                                sourceCollection: {
                                    type: "string",
                                    description: "Source collection name",
                                },
                                relationshipData: {
                                    type: "object",
                                    description: "Relationship configuration",
                                    properties: {
                                        name: {
                                            type: "string",
                                            description: "Relationship field name (creates fieldName_Id for M2O)",
                                        },
                                        type: {
                                            type: "string",
                                            enum: ["M2O", "O2M", "O2O", "M2M", "M2A"],
                                            description:
                                                "M2O=Many-to-One, O2M=One-to-Many, M2M=Many-to-Many, M2A=Many-to-Any (polymorphic)",
                                        },
                                        target: {
                                            type: "string",
                                            description: "Target collection name",
                                        },
                                        alias: {
                                            type: "string",
                                            description:
                                                "Alias for reverse relationship (required for bidirectional access)",
                                        },
                                        description: {
                                            type: "string",
                                            description: "Relationship description",
                                        },
                                        onDelete: {
                                            type: "string",
                                            enum: ["CASCADE", "RESTRICT", "SET NULL"],
                                            description: "Delete behavior (default: CASCADE)",
                                        },
                                        onUpdate: {
                                            type: "string",
                                            enum: ["CASCADE", "RESTRICT", "SET NULL"],
                                            description: "Update behavior",
                                        },
                                        tables: {
                                            type: "array",
                                            items: { type: "string" },
                                            description: "Target tables for M2A (polymorphic) relationships",
                                        },
                                        through: {
                                            type: "string",
                                            description:
                                                "Custom junction table name for M2M/M2A relationships (max 63 chars). If not provided, auto-generated as {source}_{target}_{name}_junction",
                                        },
                                    },
                                    required: ["name", "type"],
                                },
                            },
                            required: ["sourceCollection", "relationshipData"],
                        },
                    },
                    {
                        name: "baasix_update_relationship",
                        description: "Update an existing relationship",
                        inputSchema: {
                            type: "object",
                            properties: {
                                sourceCollection: {
                                    type: "string",
                                    description: "Source collection name",
                                },
                                fieldName: {
                                    type: "string",
                                    description: "Relationship field name",
                                },
                                updateData: {
                                    type: "object",
                                    description: "Update data for the relationship",
                                },
                            },
                            required: ["sourceCollection", "fieldName", "updateData"],
                        },
                    },
                    {
                        name: "baasix_delete_relationship",
                        description: "Delete a relationship",
                        inputSchema: {
                            type: "object",
                            properties: {
                                sourceCollection: {
                                    type: "string",
                                    description: "Source collection name",
                                },
                                fieldName: {
                                    type: "string",
                                    description: "Relationship field name",
                                },
                            },
                            required: ["sourceCollection", "fieldName"],
                        },
                    },
                    {
                        name: "baasix_export_schemas",
                        description: "Export all schemas as JSON",
                        inputSchema: {
                            type: "object",
                            properties: {},
                            additionalProperties: false,
                        },
                    },
                    {
                        name: "baasix_import_schemas",
                        description: "Import schemas from JSON data",
                        inputSchema: {
                            type: "object",
                            properties: {
                                schemas: {
                                    type: "object",
                                    description: "Schema data to import",
                                },
                            },
                            required: ["schemas"],
                        },
                    },

                    // Item Management Tools
                    {
                        name: "baasix_list_items",
                        description: `Query items from a collection with powerful filtering, sorting, pagination, relations, and aggregation.

FILTER OPERATORS (50+):
- Comparison: eq, neq, gt, gte, lt, lte
- String: contains, icontains, startswith, endswith, like, ilike, regex
- Null: isNull (true/false), empty (true/false)
- List: in, nin, between, nbetween
- Array: arraycontains, arraycontainsany, arraylength, arrayempty
- JSONB: jsoncontains, jsonhaskey, jsonhasanykeys, jsonhasallkeys, jsonpath
- Geospatial: dwithin, intersects, contains, within, overlaps
- Logical: AND, OR, NOT

DYNAMIC VARIABLES:
- $CURRENT_USER: Current user's ID
- $NOW: Current timestamp
- $NOW-DAYS_7: 7 days ago
- $NOW+MONTHS_1: 1 month from now

FILTER EXAMPLES:
- {"status": {"eq": "active"}}
- {"AND": [{"price": {"gte": 10}}, {"price": {"lte": 100}}]}
- {"tags": {"arraycontains": ["featured"]}}
- {"author_Id": {"eq": "$CURRENT_USER"}}
- {"category.name": {"eq": "Electronics"}} (relation filter)`,
                        inputSchema: {
                            type: "object",
                            properties: {
                                collection: {
                                    type: "string",
                                    description: "Collection name",
                                },
                                filter: {
                                    type: "object",
                                    description:
                                        "Filter criteria using operators like eq, neq, gt, gte, lt, lte, contains, in, between, etc.",
                                },
                                fields: {
                                    type: "array",
                                    items: { type: "string" },
                                    description:
                                        'Fields to return. Use ["*"] for all, ["*", "relation.*"] to include relations',
                                },
                                sort: {
                                    type: "string",
                                    description: 'Sort field and direction (e.g., "createdAt:desc", "name:asc")',
                                },
                                page: {
                                    type: "number",
                                    description: "Page number (default: 1)",
                                    default: 1,
                                },
                                limit: {
                                    type: "number",
                                    description: "Items per page (default: 10, use -1 for all)",
                                    default: 10,
                                },
                                search: {
                                    type: "string",
                                    description: "Full-text search query",
                                },
                                searchFields: {
                                    type: "array",
                                    items: { type: "string" },
                                    description: 'Fields to search in (e.g., ["name", "description"])',
                                },
                                aggregate: {
                                    type: "object",
                                    description:
                                        'Aggregation functions: {alias: {function: "sum|avg|count|min|max", field: "fieldName"}}',
                                },
                                groupBy: {
                                    type: "array",
                                    items: { type: "string" },
                                    description: "Fields to group by for aggregation",
                                },
                                relConditions: {
                                    type: "object",
                                    description:
                                        'Filter conditions for related records: {"reviews": {"approved": {"eq": true}}}',
                                },
                            },
                            required: ["collection"],
                        },
                    },
                    {
                        name: "baasix_get_item",
                        description: "Get a specific item by ID from a collection, optionally including related data",
                        inputSchema: {
                            type: "object",
                            properties: {
                                collection: {
                                    type: "string",
                                    description: "Collection name",
                                },
                                id: {
                                    type: "string",
                                    description: "Item ID (UUID)",
                                },
                                fields: {
                                    type: "array",
                                    items: { type: "string" },
                                    description: 'Fields to return. Use ["*", "relation.*"] to include relations',
                                },
                            },
                            required: ["collection", "id"],
                        },
                    },
                    {
                        name: "baasix_create_item",
                        description: "Create a new item in a collection",
                        inputSchema: {
                            type: "object",
                            properties: {
                                collection: {
                                    type: "string",
                                    description: "Collection name",
                                },
                                data: {
                                    type: "object",
                                    description: "Item data",
                                },
                            },
                            required: ["collection", "data"],
                        },
                    },
                    {
                        name: "baasix_update_item",
                        description: "Update an existing item in a collection",
                        inputSchema: {
                            type: "object",
                            properties: {
                                collection: {
                                    type: "string",
                                    description: "Collection name",
                                },
                                id: {
                                    type: "string",
                                    description: "Item ID",
                                },
                                data: {
                                    type: "object",
                                    description: "Updated item data",
                                },
                            },
                            required: ["collection", "id", "data"],
                        },
                    },
                    {
                        name: "baasix_delete_item",
                        description: "Delete an item from a collection",
                        inputSchema: {
                            type: "object",
                            properties: {
                                collection: {
                                    type: "string",
                                    description: "Collection name",
                                },
                                id: {
                                    type: "string",
                                    description: "Item ID",
                                },
                            },
                            required: ["collection", "id"],
                        },
                    },

                    // File Management Tools
                    {
                        name: "baasix_list_files",
                        description: "List files with metadata and optional filtering",
                        inputSchema: {
                            type: "object",
                            properties: {
                                filter: {
                                    type: "object",
                                    description: "Filter criteria",
                                },
                                page: {
                                    type: "number",
                                    description: "Page number (default: 1)",
                                    default: 1,
                                },
                                limit: {
                                    type: "number",
                                    description: "Files per page (default: 10)",
                                    default: 10,
                                },
                            },
                        },
                    },
                    {
                        name: "baasix_get_file_info",
                        description: "Get detailed information about a specific file",
                        inputSchema: {
                            type: "object",
                            properties: {
                                id: {
                                    type: "string",
                                    description: "File ID",
                                },
                            },
                            required: ["id"],
                        },
                    },
                    {
                        name: "baasix_delete_file",
                        description: "Delete a file",
                        inputSchema: {
                            type: "object",
                            properties: {
                                id: {
                                    type: "string",
                                    description: "File ID",
                                },
                            },
                            required: ["id"],
                        },
                    },

                    // Authentication Tools
                    {
                        name: "baasix_auth_status",
                        description: "Check the current authentication status and token validity",
                        inputSchema: {
                            type: "object",
                            properties: {},
                            additionalProperties: false,
                        },
                    },
                    {
                        name: "baasix_refresh_auth",
                        description: "Force refresh the authentication token (only works for email/password auth)",
                        inputSchema: {
                            type: "object",
                            properties: {},
                            additionalProperties: false,
                        },
                    },

                    // Reports and Analytics Tools
                    {
                        name: "baasix_generate_report",
                        description: "Generate reports with grouping and aggregation for a collection",
                        inputSchema: {
                            type: "object",
                            properties: {
                                collection: {
                                    type: "string",
                                    description: "Collection name",
                                },
                                groupBy: {
                                    type: "string",
                                    description: "Field to group by",
                                },
                                filter: {
                                    type: "object",
                                    description: "Filter criteria",
                                },
                                dateRange: {
                                    type: "object",
                                    properties: {
                                        start: { type: "string" },
                                        end: { type: "string" },
                                    },
                                    description: "Date range filter",
                                },
                            },
                            required: ["collection"],
                        },
                    },
                    {
                        name: "baasix_collection_stats",
                        description: "Get collection statistics and analytics",
                        inputSchema: {
                            type: "object",
                            properties: {
                                collections: {
                                    type: "array",
                                    items: { type: "string" },
                                    description: "Specific collections to get stats for",
                                },
                                timeframe: {
                                    type: "string",
                                    description: 'Timeframe for stats (e.g., "24h", "7d", "30d")',
                                },
                            },
                        },
                    },

                    // Notification Tools
                    {
                        name: "baasix_list_notifications",
                        description: "List notifications for the authenticated user",
                        inputSchema: {
                            type: "object",
                            properties: {
                                page: {
                                    type: "number",
                                    description: "Page number (default: 1)",
                                    default: 1,
                                },
                                limit: {
                                    type: "number",
                                    description: "Notifications per page (default: 10)",
                                    default: 10,
                                },
                                seen: {
                                    type: "boolean",
                                    description: "Filter by seen status",
                                },
                            },
                        },
                    },
                    {
                        name: "baasix_send_notification",
                        description: "Send a notification to specified users",
                        inputSchema: {
                            type: "object",
                            properties: {
                                recipients: {
                                    type: "array",
                                    items: { type: "string" },
                                    description: "Array of user IDs to send notification to",
                                },
                                title: {
                                    type: "string",
                                    description: "Notification title",
                                },
                                message: {
                                    type: "string",
                                    description: "Notification message",
                                },
                                type: {
                                    type: "string",
                                    description: "Notification type",
                                    default: "info",
                                },
                            },
                            required: ["recipients", "title", "message"],
                        },
                    },
                    {
                        name: "baasix_mark_notification_seen",
                        description: "Mark a notification as seen",
                        inputSchema: {
                            type: "object",
                            properties: {
                                id: {
                                    type: "string",
                                    description: "Notification ID",
                                },
                            },
                            required: ["id"],
                        },
                    },

                    // Settings Tools
                    {
                        name: "baasix_get_settings",
                        description: "Get application settings",
                        inputSchema: {
                            type: "object",
                            properties: {
                                key: {
                                    type: "string",
                                    description: "Specific setting key to retrieve",
                                },
                            },
                        },
                    },
                    {
                        name: "baasix_update_settings",
                        description: "Update application settings",
                        inputSchema: {
                            type: "object",
                            properties: {
                                settings: {
                                    type: "object",
                                    description: "Settings object to update",
                                },
                            },
                            required: ["settings"],
                        },
                    },

                    // Email Template Tools
                    {
                        name: "baasix_list_templates",
                        description: "List all email templates with optional filtering",
                        inputSchema: {
                            type: "object",
                            properties: {
                                filter: {
                                    type: "object",
                                    description: "Filter criteria (e.g., {type: {eq: 'magic_link'}})",
                                },
                                page: {
                                    type: "number",
                                    description: "Page number (default: 1)",
                                    default: 1,
                                },
                                limit: {
                                    type: "number",
                                    description: "Templates per page (default: 10)",
                                    default: 10,
                                },
                            },
                        },
                    },
                    {
                        name: "baasix_get_template",
                        description: "Get a specific email template by ID",
                        inputSchema: {
                            type: "object",
                            properties: {
                                id: {
                                    type: "string",
                                    description: "Template ID (UUID)",
                                },
                            },
                            required: ["id"],
                        },
                    },
                    {
                        name: "baasix_update_template",
                        description: `Update an email template's subject, description, or body content.

TEMPLATE TYPES:
- magic_link: Magic link authentication emails
- invite: User invitation emails
- password_reset: Password reset emails
- welcome: Welcome emails
- verification: Email verification emails

AVAILABLE VARIABLES:
- User: {{user.firstName}}, {{user.lastName}}, {{user.fullName}}, {{user.email}}
- Tenant: {{tenant.name}}, {{tenant.logo}}, {{tenant.website}}
- Auth: {{magicLink}}, {{magicCode}}, {{resetPasswordLink}}, {{inviteLink}}
- DateTime: {{currentDate}}, {{currentTime}}, {{currentYear}}`,
                        inputSchema: {
                            type: "object",
                            properties: {
                                id: {
                                    type: "string",
                                    description: "Template ID (UUID)",
                                },
                                subject: {
                                    type: "string",
                                    description: "Email subject line (supports variables like {{user.firstName}})",
                                },
                                description: {
                                    type: "string",
                                    description: "Template description",
                                },
                                body: {
                                    type: "string",
                                    description: "Template body as HTML string or GrapesJS project JSON",
                                },
                                isActive: {
                                    type: "boolean",
                                    description: "Whether the template is active",
                                },
                            },
                            required: ["id"],
                        },
                    },

                    // Permission Tools
                    {
                        name: "baasix_list_roles",
                        description: "List all available roles",
                        inputSchema: {
                            type: "object",
                            properties: {},
                            additionalProperties: false,
                        },
                    },
                    {
                        name: "baasix_list_permissions",
                        description: "List all permissions with optional filtering",
                        inputSchema: {
                            type: "object",
                            properties: {
                                filter: {
                                    type: "object",
                                    description: "Filter criteria",
                                },
                                sort: {
                                    type: "string",
                                    description: 'Sort field and direction (e.g., "collection:asc")',
                                },
                                page: {
                                    type: "number",
                                    description: "Page number (default: 1)",
                                    default: 1,
                                },
                                limit: {
                                    type: "number",
                                    description: "Permissions per page (default: 10)",
                                    default: 10,
                                },
                            },
                        },
                    },
                    {
                        name: "baasix_get_permission",
                        description: "Get a specific permission by ID",
                        inputSchema: {
                            type: "object",
                            properties: {
                                id: {
                                    type: "string",
                                    description: "Permission ID",
                                },
                            },
                            required: ["id"],
                        },
                    },
                    {
                        name: "baasix_get_permissions",
                        description: "Get permissions for a specific role",
                        inputSchema: {
                            type: "object",
                            properties: {
                                role: {
                                    type: "string",
                                    description: "Role name",
                                },
                            },
                            required: ["role"],
                        },
                    },
                    {
                        name: "baasix_create_permission",
                        description: `Create a new permission for role-based access control.

ACTIONS: create, read, update, delete

FIELDS:
- ["*"] for all fields
- ["name", "price"] for specific fields

CONDITIONS (Row-level security):
- Uses same filter operators as queries
- {"published": {"eq": true}} - only published records
- {"author_Id": {"eq": "$CURRENT_USER"}} - only own records

RELCONDITIONS (Filter related data):
- {"reviews": {"approved": {"eq": true}}} - only approved reviews in response

EXAMPLE:
{
  "role_Id": "uuid",
  "collection": "products",
  "action": "read",
  "fields": ["*"],
  "conditions": {"published": {"eq": true}}
}`,
                        inputSchema: {
                            type: "object",
                            properties: {
                                role_Id: {
                                    type: "string",
                                    description: "Role ID (UUID)",
                                },
                                collection: {
                                    type: "string",
                                    description: "Collection name",
                                },
                                action: {
                                    type: "string",
                                    enum: ["create", "read", "update", "delete"],
                                    description: "Permission action",
                                },
                                fields: {
                                    type: "array",
                                    items: { type: "string" },
                                    description: 'Allowed fields (["*"] for all)',
                                },
                                conditions: {
                                    type: "object",
                                    description: "Row-level security conditions using filter operators",
                                },
                                defaultValues: {
                                    type: "object",
                                    description:
                                        'Default values auto-set on creation (e.g., {"author_Id": "$CURRENT_USER"})',
                                },
                                relConditions: {
                                    type: "object",
                                    description: "Filter conditions for related records in response",
                                },
                            },
                            required: ["role_Id", "collection", "action"],
                        },
                    },
                    {
                        name: "baasix_update_permission",
                        description: "Update an existing permission",
                        inputSchema: {
                            type: "object",
                            properties: {
                                id: {
                                    type: "string",
                                    description: "Permission ID",
                                },
                                role_Id: {
                                    type: "string",
                                    description: "Role ID",
                                },
                                collection: {
                                    type: "string",
                                    description: "Collection name",
                                },
                                action: {
                                    type: "string",
                                    enum: ["create", "read", "update", "delete"],
                                    description: "Permission action",
                                },
                                fields: {
                                    type: "array",
                                    items: { type: "string" },
                                    description: "Allowed fields",
                                },
                                conditions: {
                                    type: "object",
                                    description: "Permission conditions",
                                },
                                defaultValues: {
                                    type: "object",
                                    description: "Default values for creation",
                                },
                                relConditions: {
                                    type: "object",
                                    description: "Relationship conditions",
                                },
                            },
                            required: ["id"],
                        },
                    },
                    {
                        name: "baasix_delete_permission",
                        description: "Delete a permission",
                        inputSchema: {
                            type: "object",
                            properties: {
                                id: {
                                    type: "string",
                                    description: "Permission ID",
                                },
                            },
                            required: ["id"],
                        },
                    },
                    {
                        name: "baasix_reload_permissions",
                        description: "Reload the permission cache",
                        inputSchema: {
                            type: "object",
                            properties: {},
                            additionalProperties: false,
                        },
                    },
                    {
                        name: "baasix_update_permissions",
                        description: "Update permissions for a role",
                        inputSchema: {
                            type: "object",
                            properties: {
                                role: {
                                    type: "string",
                                    description: "Role name",
                                },
                                permissions: {
                                    type: "object",
                                    description: "Permissions object",
                                },
                            },
                            required: ["role", "permissions"],
                        },
                    },

                    // Realtime Tools
                    {
                        name: "baasix_realtime_status",
                        description: `Get the status of the realtime service including WAL configuration.

Returns information about:
- Whether realtime is initialized and consuming WAL
- PostgreSQL replication configuration (wal_level, max_replication_slots)
- Publication and replication slot status
- Collections with realtime enabled`,
                        inputSchema: {
                            type: "object",
                            properties: {},
                            additionalProperties: false,
                        },
                    },
                    {
                        name: "baasix_realtime_config",
                        description: `Check PostgreSQL replication configuration for WAL-based realtime.

Returns:
- walLevel: Should be 'logical' for realtime to work
- maxReplicationSlots: Number of available replication slots
- maxWalSenders: Number of WAL sender processes
- replicationSlotExists: Whether the baasix slot exists
- publicationExists: Whether the baasix publication exists
- tablesInPublication: List of tables currently in the publication`,
                        inputSchema: {
                            type: "object",
                            properties: {},
                            additionalProperties: false,
                        },
                    },
                    {
                        name: "baasix_realtime_collections",
                        description: "Get list of collections with realtime enabled and their action configurations",
                        inputSchema: {
                            type: "object",
                            properties: {},
                            additionalProperties: false,
                        },
                    },
                    {
                        name: "baasix_realtime_enable",
                        description: `Enable realtime for a collection. Changes will be broadcast via WebSocket when data is modified.

The realtime config is stored in the schema definition and can include specific actions to broadcast.`,
                        inputSchema: {
                            type: "object",
                            properties: {
                                collection: {
                                    type: "string",
                                    description: "Collection name to enable realtime for",
                                },
                                actions: {
                                    type: "array",
                                    items: { type: "string", enum: ["insert", "update", "delete"] },
                                    description: 'Actions to broadcast (default: ["insert", "update", "delete"])',
                                },
                                replicaIdentityFull: {
                                    type: "boolean",
                                    description: "Set REPLICA IDENTITY FULL for old values on UPDATE/DELETE (default: false)",
                                },
                            },
                            required: ["collection"],
                        },
                    },
                    {
                        name: "baasix_realtime_disable",
                        description: "Disable realtime for a collection",
                        inputSchema: {
                            type: "object",
                            properties: {
                                collection: {
                                    type: "string",
                                    description: "Collection name to disable realtime for",
                                },
                            },
                            required: ["collection"],
                        },
                    },

                    // Utility Tools
                    {
                        name: "baasix_server_info",
                        description: "Get Baasix server information and health status",
                        inputSchema: {
                            type: "object",
                            properties: {},
                            additionalProperties: false,
                        },
                    },
                    {
                        name: "baasix_sort_items",
                        description: "Sort items within a collection (move item before/after another)",
                        inputSchema: {
                            type: "object",
                            properties: {
                                collection: {
                                    type: "string",
                                    description: "Collection name",
                                },
                                item: {
                                    type: "string",
                                    description: "ID of item to move",
                                },
                                to: {
                                    type: "string",
                                    description: "ID of target item to move before",
                                },
                            },
                            required: ["collection", "item", "to"],
                        },
                    },

                    // Auth Tools
                    {
                        name: "baasix_register_user",
                        description: "Register a new user",
                        inputSchema: {
                            type: "object",
                            properties: {
                                email: {
                                    type: "string",
                                    format: "email",
                                    description: "User email address",
                                },
                                password: {
                                    type: "string",
                                    description: "User password",
                                },
                                firstName: {
                                    type: "string",
                                    description: "User first name",
                                },
                                lastName: {
                                    type: "string",
                                    description: "User last name",
                                },
                                tenant: {
                                    type: "object",
                                    description: "Tenant information for multi-tenant mode",
                                },
                                roleName: {
                                    type: "string",
                                    description: "Role name to assign",
                                },
                                inviteToken: {
                                    type: "string",
                                    description: "Invitation token",
                                },
                                authMode: {
                                    type: "string",
                                    enum: ["jwt", "cookie"],
                                    description: "Authentication mode",
                                    default: "jwt",
                                },
                            },
                            required: ["email", "password"],
                        },
                    },
                    {
                        name: "baasix_login",
                        description: "Login user with email and password",
                        inputSchema: {
                            type: "object",
                            properties: {
                                email: {
                                    type: "string",
                                    format: "email",
                                    description: "User email address",
                                },
                                password: {
                                    type: "string",
                                    description: "User password",
                                },
                                tenant_Id: {
                                    type: "string",
                                    description: "Tenant ID for multi-tenant mode",
                                },
                                authMode: {
                                    type: "string",
                                    enum: ["jwt", "cookie"],
                                    description: "Authentication mode",
                                    default: "jwt",
                                },
                            },
                            required: ["email", "password"],
                        },
                    },
                    {
                        name: "baasix_send_invite",
                        description: "Send an invitation to a user",
                        inputSchema: {
                            type: "object",
                            properties: {
                                email: {
                                    type: "string",
                                    format: "email",
                                    description: "Email address to invite",
                                },
                                role_Id: {
                                    type: "string",
                                    description: "Role ID to assign",
                                },
                                tenant_Id: {
                                    type: "string",
                                    description: "Tenant ID",
                                },
                                link: {
                                    type: "string",
                                    format: "uri",
                                    description: "Application URL for the invitation link",
                                },
                            },
                            required: ["email", "role_Id", "link"],
                        },
                    },
                    {
                        name: "baasix_verify_invite",
                        description: "Verify an invitation token",
                        inputSchema: {
                            type: "object",
                            properties: {
                                token: {
                                    type: "string",
                                    description: "Invitation token",
                                },
                                link: {
                                    type: "string",
                                    format: "uri",
                                    description: "Application URL to validate",
                                },
                            },
                            required: ["token"],
                        },
                    },
                    {
                        name: "baasix_send_magic_link",
                        description: "Send magic link or code for authentication",
                        inputSchema: {
                            type: "object",
                            properties: {
                                email: {
                                    type: "string",
                                    format: "email",
                                    description: "User email address",
                                },
                                link: {
                                    type: "string",
                                    format: "uri",
                                    description: "Application URL for magic link",
                                },
                                mode: {
                                    type: "string",
                                    enum: ["link", "code"],
                                    description: "Magic authentication mode",
                                    default: "link",
                                },
                            },
                            required: ["email"],
                        },
                    },
                    {
                        name: "baasix_get_user_tenants",
                        description: "Get available tenants for the current user",
                        inputSchema: {
                            type: "object",
                            properties: {},
                            additionalProperties: false,
                        },
                    },
                    {
                        name: "baasix_switch_tenant",
                        description: "Switch to a different tenant context",
                        inputSchema: {
                            type: "object",
                            properties: {
                                tenant_Id: {
                                    type: "string",
                                    description: "Tenant ID to switch to",
                                },
                            },
                            required: ["tenant_Id"],
                        },
                    },
                    {
                        name: "baasix_logout",
                        description: "Logout the current user",
                        inputSchema: {
                            type: "object",
                            properties: {},
                            additionalProperties: false,
                        },
                    },
                    {
                        name: "baasix_get_current_user",
                        description: "Get current user information with role and permissions",
                        inputSchema: {
                            type: "object",
                            properties: {
                                fields: {
                                    type: "array",
                                    items: { type: "string" },
                                    description: "Specific fields to retrieve",
                                },
                            },
                        },
                    },
                ],
            };
        });

        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;

            try {
                switch (name) {
                    // Schema Management
                    case "baasix_list_schemas":
                        return await this.handleListSchemas(args);
                    case "baasix_get_schema":
                        return await this.handleGetSchema(args);
                    case "baasix_create_schema":
                        return await this.handleCreateSchema(args);
                    case "baasix_update_schema":
                        return await this.handleUpdateSchema(args);
                    case "baasix_delete_schema":
                        return await this.handleDeleteSchema(args);
                    case "baasix_add_index":
                        return await this.handleAddIndex(args);
                    case "baasix_remove_index":
                        return await this.handleRemoveIndex(args);
                    case "baasix_create_relationship":
                        return await this.handleCreateRelationship(args);
                    case "baasix_update_relationship":
                        return await this.handleUpdateRelationship(args);
                    case "baasix_delete_relationship":
                        return await this.handleDeleteRelationship(args);
                    case "baasix_export_schemas":
                        return await this.handleExportSchemas(args);
                    case "baasix_import_schemas":
                        return await this.handleImportSchemas(args);

                    // Item Management
                    case "baasix_list_items":
                        return await this.handleListItems(args);
                    case "baasix_get_item":
                        return await this.handleGetItem(args);
                    case "baasix_create_item":
                        return await this.handleCreateItem(args);
                    case "baasix_update_item":
                        return await this.handleUpdateItem(args);
                    case "baasix_delete_item":
                        return await this.handleDeleteItem(args);

                    // File Management
                    case "baasix_list_files":
                        return await this.handleListFiles(args);
                    case "baasix_get_file_info":
                        return await this.handleGetFileInfo(args);
                    case "baasix_delete_file":
                        return await this.handleDeleteFile(args);

                    // Authentication
                    case "baasix_auth_status":
                        return await this.handleAuthStatus(args);
                    case "baasix_refresh_auth":
                        return await this.handleRefreshAuth(args);

                    // Reports and Analytics
                    case "baasix_generate_report":
                        return await this.handleGenerateReport(args);
                    case "baasix_collection_stats":
                        return await this.handleGetStats(args);

                    // Notifications
                    case "baasix_list_notifications":
                        return await this.handleListNotifications(args);
                    case "baasix_send_notification":
                        return await this.handleSendNotification(args);
                    case "baasix_mark_notification_seen":
                        return await this.handleMarkNotificationSeen(args);

                    // Settings
                    case "baasix_get_settings":
                        return await this.handleGetSettings(args);
                    case "baasix_update_settings":
                        return await this.handleUpdateSettings(args);

                    // Email Templates
                    case "baasix_list_templates":
                        return await this.handleListTemplates(args);
                    case "baasix_get_template":
                        return await this.handleGetTemplate(args);
                    case "baasix_update_template":
                        return await this.handleUpdateTemplate(args);

                    // Permissions
                    case "baasix_list_roles":
                        return await this.handleListRoles(args);
                    case "baasix_list_permissions":
                        return await this.handleListPermissions(args);
                    case "baasix_get_permission":
                        return await this.handleGetPermission(args);
                    case "baasix_get_permissions":
                        return await this.handleGetPermissions(args);
                    case "baasix_create_permission":
                        return await this.handleCreatePermission(args);
                    case "baasix_update_permission":
                        return await this.handleUpdatePermission(args);
                    case "baasix_delete_permission":
                        return await this.handleDeletePermission(args);
                    case "baasix_reload_permissions":
                        return await this.handleReloadPermissions(args);
                    case "baasix_update_permissions":
                        return await this.handleUpdatePermissions(args);

                    // Realtime
                    case "baasix_realtime_status":
                        return await this.handleRealtimeStatus(args);
                    case "baasix_realtime_config":
                        return await this.handleRealtimeConfig(args);
                    case "baasix_realtime_collections":
                        return await this.handleRealtimeCollections(args);
                    case "baasix_realtime_enable":
                        return await this.handleRealtimeEnable(args);
                    case "baasix_realtime_disable":
                        return await this.handleRealtimeDisable(args);

                    // Utilities
                    case "baasix_server_info":
                        return await this.handleServerInfo(args);
                    case "baasix_sort_items":
                        return await this.handleSortItems(args);

                    // Auth
                    case "baasix_register_user":
                        return await this.handleRegisterUser(args);
                    case "baasix_login":
                        return await this.handleLogin(args);
                    case "baasix_send_invite":
                        return await this.handleSendInvite(args);
                    case "baasix_verify_invite":
                        return await this.handleVerifyInvite(args);
                    case "baasix_send_magic_link":
                        return await this.handleSendMagicLink(args);
                    case "baasix_get_user_tenants":
                        return await this.handleGetUserTenants(args);
                    case "baasix_switch_tenant":
                        return await this.handleSwitchTenant(args);
                    case "baasix_logout":
                        return await this.handleLogout(args);
                    case "baasix_get_current_user":
                        return await this.handleGetCurrentUser(args);

                    default:
                        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
                }
            } catch (error) {
                if (error instanceof McpError) {
                    throw error;
                }

                console.error(`Error in tool ${name}:`, error);
                throw new McpError(
                    ErrorCode.InternalError,
                    `Tool execution failed: ${error instanceof Error ? error.message : "Unknown error"}`
                );
            }
        });
    }

    // Schema Management Methods
    async handleListSchemas(args) {
        const { search, page, limit, sort = "collectionName:asc" } = args;
        const params = new URLSearchParams();
        if (search) params.append("search", search);
        if (page !== undefined) params.append("page", page.toString());
        if (limit !== undefined) params.append("limit", limit.toString());
        params.append("sort", sort);

        const schemas = await baasixRequest(`/schemas?${params}`);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(schemas, null, 2),
                },
            ],
        };
    }

    async handleGetSchema(args) {
        const { collection } = args;
        const schema = await baasixRequest(`/schemas/${collection}`);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(schema, null, 2),
                },
            ],
        };
    }

    async handleCreateSchema(args) {
        const { collection, schema } = args;
        const result = await baasixRequest(`/schemas`, {
            method: "POST",
            data: { collectionName: collection, schema },
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    async handleUpdateSchema(args) {
        const { collection, schema } = args;
        const result = await baasixRequest(`/schemas/${collection}`, {
            method: "PATCH",
            data: { schema },
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    async handleDeleteSchema(args) {
        const { collection } = args;
        const result = await baasixRequest(`/schemas/${collection}`, {
            method: "DELETE",
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    async handleAddIndex(args) {
        const { collection, indexDefinition } = args;
        const result = await baasixRequest(`/schemas/${collection}/indexes`, {
            method: "POST",
            data: indexDefinition,
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    async handleRemoveIndex(args) {
        const { collection, indexName } = args;
        const result = await baasixRequest(`/schemas/${collection}/indexes/${indexName}`, {
            method: "DELETE",
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    async handleCreateRelationship(args) {
        const { sourceCollection, relationshipData } = args;
        const result = await baasixRequest(`/schemas/${sourceCollection}/relationships`, {
            method: "POST",
            data: relationshipData,
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    async handleUpdateRelationship(args) {
        const { sourceCollection, fieldName, updateData } = args;
        const result = await baasixRequest(`/schemas/${sourceCollection}/relationships/${fieldName}`, {
            method: "PATCH",
            data: updateData,
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    async handleDeleteRelationship(args) {
        const { sourceCollection, fieldName } = args;
        const result = await baasixRequest(`/schemas/${sourceCollection}/relationships/${fieldName}`, {
            method: "DELETE",
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    async handleExportSchemas(args) {
        const result = await baasixRequest("/schemas-export");
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    async handleImportSchemas(args) {
        const { schemas } = args;
        // Note: This is a simplified version. The actual API uses file upload.
        // For MCP, we'll accept JSON data directly.
        const result = await baasixRequest("/schemas-import", {
            method: "POST",
            data: schemas,
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    // Item Management Methods
    async handleListItems(args) {
        const {
            collection,
            filter,
            sort,
            page = 1,
            limit = 10,
            fields,
            search,
            searchFields,
            aggregate,
            groupBy,
            relConditions,
        } = args;

        const params = new URLSearchParams();
        if (filter) params.append("filter", JSON.stringify(filter));
        if (sort) params.append("sort", sort);
        params.append("page", page.toString());
        params.append("limit", limit.toString());
        if (fields) params.append("fields", JSON.stringify(fields));
        if (search) params.append("search", search);
        if (searchFields) params.append("searchFields", JSON.stringify(searchFields));
        if (aggregate) params.append("aggregate", JSON.stringify(aggregate));
        if (groupBy) params.append("groupBy", JSON.stringify(groupBy));
        if (relConditions) params.append("relConditions", JSON.stringify(relConditions));

        const items = await baasixRequest(`/items/${collection}?${params}`);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(items, null, 2),
                },
            ],
        };
    }

    async handleGetItem(args) {
        const { collection, id, fields } = args;
        const params = new URLSearchParams();
        if (fields) params.append("fields", JSON.stringify(fields));

        const queryString = params.toString() ? `?${params}` : "";
        const item = await baasixRequest(`/items/${collection}/${id}${queryString}`);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(item, null, 2),
                },
            ],
        };
    }

    async handleCreateItem(args) {
        const { collection, data } = args;
        const result = await baasixRequest(`/items/${collection}`, {
            method: "POST",
            data,
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    async handleUpdateItem(args) {
        const { collection, id, data } = args;
        const result = await baasixRequest(`/items/${collection}/${id}`, {
            method: "PUT",
            data,
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    async handleDeleteItem(args) {
        const { collection, id } = args;
        const result = await baasixRequest(`/items/${collection}/${id}`, {
            method: "DELETE",
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    // File Management Methods
    async handleListFiles(args) {
        const { filter, page = 1, limit = 10 } = args;
        const params = new URLSearchParams();
        if (filter) params.append("filter", JSON.stringify(filter));
        params.append("page", page.toString());
        params.append("limit", limit.toString());

        const files = await baasixRequest(`/files?${params}`);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(files, null, 2),
                },
            ],
        };
    }

    async handleGetFileInfo(args) {
        const { id } = args;
        const file = await baasixRequest(`/files/${id}`);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(file, null, 2),
                },
            ],
        };
    }

    async handleDeleteFile(args) {
        const { id } = args;
        const result = await baasixRequest(`/files/${id}`, {
            method: "DELETE",
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    // Authentication Methods
    async handleAuthStatus(args) {
        try {
            const token = await getAuthToken();
            const status = {
                auth_method: BAASIX_AUTH_TOKEN ? "Manual Token" : BAASIX_EMAIL ? "Auto-login" : "None",
                configured_user: BAASIX_EMAIL || "Not configured",
                manual_token_provided: !!BAASIX_AUTH_TOKEN,
                authenticated: !!token,
                auto_login_expires: authExpiry ? new Date(authExpiry).toISOString() : "N/A",
                auto_login_valid: !!(authToken && authExpiry && Date.now() < authExpiry),
            };

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(status, null, 2),
                    },
                ],
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(
                            {
                                error: error.message,
                                auth_method: "None",
                                manual_token_provided: !!BAASIX_AUTH_TOKEN,
                                configured_user: BAASIX_EMAIL || "Not configured",
                            },
                            null,
                            2
                        ),
                    },
                ],
            };
        }
    }

    async handleRefreshAuth(args) {
        if (BAASIX_AUTH_TOKEN) {
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(
                            {
                                message: "Using manual token (BAASIX_AUTH_TOKEN), no refresh needed",
                                auth_method: "Manual Token",
                            },
                            null,
                            2
                        ),
                    },
                ],
            };
        }

        // Clear current auto-login token to force refresh
        authToken = null;
        authExpiry = null;

        try {
            const token = await getAuthToken();
            const result = {
                success: !!token,
                user: BAASIX_EMAIL || "Not configured",
                token_received: !!token,
                expires: authExpiry ? new Date(authExpiry).toISOString() : "Unknown",
                auth_method: "Auto-login",
            };

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(
                            {
                                success: false,
                                error: error.message,
                                user: BAASIX_EMAIL || "Not configured",
                            },
                            null,
                            2
                        ),
                    },
                ],
            };
        }
    }

    // Reports and Analytics Methods
    async handleGenerateReport(args) {
        const { collection, groupBy, filter, dateRange } = args;
        const params = new URLSearchParams();
        if (groupBy) params.append("groupBy", groupBy);
        if (filter) params.append("filter", JSON.stringify(filter));
        if (dateRange) params.append("dateRange", JSON.stringify(dateRange));

        const report = await baasixRequest(`/reports/${collection}?${params}`);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(report, null, 2),
                },
            ],
        };
    }

    async handleGetStats(args) {
        const { collections, timeframe } = args;
        const params = new URLSearchParams();
        if (collections) params.append("collections", JSON.stringify(collections));
        if (timeframe) params.append("timeframe", timeframe);

        const stats = await baasixRequest(`/reports/stats?${params}`);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(stats, null, 2),
                },
            ],
        };
    }

    // Notification Methods
    async handleListNotifications(args) {
        const { page = 1, limit = 10, seen } = args;
        const params = new URLSearchParams();
        params.append("page", page.toString());
        params.append("limit", limit.toString());
        if (seen !== undefined) params.append("seen", seen.toString());

        const notifications = await baasixRequest(`/notifications?${params}`);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(notifications, null, 2),
                },
            ],
        };
    }

    async handleSendNotification(args) {
        const { recipients, title, message, type = "info" } = args;
        const result = await baasixRequest("/notifications", {
            method: "POST",
            data: { recipients, title, message, type },
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    async handleMarkNotificationSeen(args) {
        const { id } = args;
        const result = await baasixRequest(`/notifications/${id}/seen`, {
            method: "PUT",
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    // Settings Methods
    async handleGetSettings(args) {
        const { key } = args;
        const endpoint = key ? `/settings/${key}` : "/settings";
        const settings = await baasixRequest(endpoint);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(settings, null, 2),
                },
            ],
        };
    }

    async handleUpdateSettings(args) {
        const { settings } = args;
        const result = await baasixRequest("/settings", {
            method: "PUT",
            data: settings,
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    // Email Template Methods
    async handleListTemplates(args) {
        const { filter, page = 1, limit = 10 } = args;
        const params = new URLSearchParams();
        if (filter) params.append("filter", JSON.stringify(filter));
        params.append("page", page.toString());
        params.append("limit", limit.toString());

        const templates = await baasixRequest(`/items/baasix_Template?${params}`);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(templates, null, 2),
                },
            ],
        };
    }

    async handleGetTemplate(args) {
        const { id } = args;
        const template = await baasixRequest(`/items/baasix_Template/${id}`);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(template, null, 2),
                },
            ],
        };
    }

    async handleUpdateTemplate(args) {
        const { id, ...updateData } = args;
        const result = await baasixRequest(`/items/baasix_Template/${id}`, {
            method: "PATCH",
            data: updateData,
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    // Permission Methods
    async handleListRoles(args) {
        const roles = await baasixRequest("/permissions/roles");
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(roles, null, 2),
                },
            ],
        };
    }

    async handleListPermissions(args) {
        const { filter, sort, page = 1, limit = 10 } = args;
        const params = new URLSearchParams();
        if (filter) params.append("filter", JSON.stringify(filter));
        if (sort) params.append("sort", sort);
        params.append("page", page.toString());
        params.append("limit", limit.toString());

        const permissions = await baasixRequest(`/permissions?${params}`);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(permissions, null, 2),
                },
            ],
        };
    }

    async handleGetPermission(args) {
        const { id } = args;
        const permission = await baasixRequest(`/permissions/${id}`);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(permission, null, 2),
                },
            ],
        };
    }

    async handleGetPermissions(args) {
        const { role } = args;
        const permissions = await baasixRequest(`/permissions/${role}`);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(permissions, null, 2),
                },
            ],
        };
    }

    async handleCreatePermission(args) {
        const { role_Id, collection, action, fields, conditions, defaultValues, relConditions } = args;
        const result = await baasixRequest("/permissions", {
            method: "POST",
            data: { role_Id, collection, action, fields, conditions, defaultValues, relConditions },
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    async handleUpdatePermission(args) {
        const { id, role_Id, collection, action, fields, conditions, defaultValues, relConditions } = args;
        const result = await baasixRequest(`/permissions/${id}`, {
            method: "PATCH",
            data: { role_Id, collection, action, fields, conditions, defaultValues, relConditions },
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    async handleDeletePermission(args) {
        const { id } = args;
        const result = await baasixRequest(`/permissions/${id}`, {
            method: "DELETE",
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    async handleReloadPermissions(args) {
        const result = await baasixRequest("/permissions/reload", {
            method: "POST",
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    async handleUpdatePermissions(args) {
        const { role, permissions } = args;
        const result = await baasixRequest(`/permissions/${role}`, {
            method: "PUT",
            data: permissions,
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    // Realtime Methods
    async handleRealtimeStatus(args) {
        const result = await baasixRequest("/realtime/status");
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    async handleRealtimeConfig(args) {
        const result = await baasixRequest("/realtime/config");
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    async handleRealtimeCollections(args) {
        const result = await baasixRequest("/realtime/collections");
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    async handleRealtimeEnable(args) {
        const { collection, actions, replicaIdentityFull } = args;
        const result = await baasixRequest(`/realtime/collections/${collection}/enable`, {
            method: "POST",
            data: {
                actions: actions || ["insert", "update", "delete"],
                replicaIdentityFull: replicaIdentityFull || false,
            },
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    async handleRealtimeDisable(args) {
        const { collection } = args;
        const result = await baasixRequest(`/realtime/collections/${collection}/disable`, {
            method: "POST",
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    // Utility Methods
    async handleServerInfo(args) {
        try {
            const info = await baasixRequest("/utils/info");
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(
                            {
                                baasix_server: info,
                                mcp_server: {
                                    name: "baasix-mcp-server",
                                    version: "0.1.0",
                                    timestamp: new Date().toISOString(),
                                    uptime: process.uptime(),
                                    memory: process.memoryUsage(),
                                    nodejs: process.version,
                                    baasix_url: BAASIX_URL,
                                },
                            },
                            null,
                            2
                        ),
                    },
                ],
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(
                            {
                                error: "Could not fetch Baasix server info",
                                mcp_server: {
                                    name: "baasix-mcp-server",
                                    version: "0.1.0",
                                    timestamp: new Date().toISOString(),
                                    uptime: process.uptime(),
                                    memory: process.memoryUsage(),
                                    nodejs: process.version,
                                    baasix_url: BAASIX_URL,
                                },
                            },
                            null,
                            2
                        ),
                    },
                ],
            };
        }
    }

    async handleSortItems(args) {
        const { collection, item, to } = args;
        const result = await baasixRequest(`/utils/sort/${collection}`, {
            method: "POST",
            data: { item, to },
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    // Auth Methods
    async handleRegisterUser(args) {
        const { email, password, firstName, lastName, tenant, roleName, inviteToken, authMode, ...customParams } = args;
        const result = await baasixRequest("/auth/register", {
            method: "POST",
            data: { email, password, firstName, lastName, tenant, roleName, inviteToken, authMode, ...customParams },
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    async handleLogin(args) {
        const { email, password, tenant_Id, authMode } = args;
        const result = await baasixRequest("/auth/login", {
            method: "POST",
            data: { email, password, tenant_Id, authMode },
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    async handleSendInvite(args) {
        const { email, role_Id, tenant_Id, link } = args;
        const result = await baasixRequest("/auth/invite", {
            method: "POST",
            data: { email, role_Id, tenant_Id, link },
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    async handleVerifyInvite(args) {
        const { token, link } = args;
        const params = new URLSearchParams();
        if (link) params.append("link", link);

        const result = await baasixRequest(`/auth/verify-invite/${token}?${params}`);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    async handleSendMagicLink(args) {
        const { email, link, mode } = args;
        const result = await baasixRequest("/auth/magiclink", {
            method: "POST",
            data: { email, link, mode },
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    async handleGetUserTenants() {
        const result = await baasixRequest("/auth/tenants");
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    async handleSwitchTenant(args) {
        const { tenant_Id } = args;
        const result = await baasixRequest("/auth/switch-tenant", {
            method: "POST",
            data: { tenant_Id },
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    async handleLogout() {
        const result = await baasixRequest("/auth/logout");
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    async handleGetCurrentUser(args) {
        const { fields } = args;
        const params = new URLSearchParams();
        if (fields) params.append("fields", fields.join(","));

        const result = await baasixRequest(`/auth/me?${params}`);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error("Baasix MCP Server running on stdio");
    }
}

// Export the server class
export { BaasixMCPServer };

// Export the main function to start MCP server
export const startMCPServer = async () => {
    const server = new BaasixMCPServer();
    return server.run();
};
