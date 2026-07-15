import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
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

// Allowlisted keys for page/block update payloads (guards against tenant_Id/page_Id injection)
const PAGE_UPDATE_KEYS = ["name", "slug", "icon", "description", "isPublic", "enabled", "sort", "parent_Id", "options", "roles"];
const BLOCK_UPDATE_KEYS = ["type", "collection", "position", "config", "configVersion"];
const PAGE_CREATE_KEYS = ["name", "slug", "icon", "description", "isPublic", "enabled", "sort", "parent_Id", "options"];

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
                throw new Error(
                    `Baasix API Error: ${retryError.response?.data?.error?.message || retryError.response?.data?.message || retryError.message}`
                );
            }
        }

        throw new Error(`Baasix API Error: ${error.response?.data?.error?.message || error.response?.data?.message || error.message}`);
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
                    resources: {},
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
                        description: `Get the full schema definition (columns, types, constraints, relationships, indexes) for a specific database table/collection.

IMPORTANT: Always call this BEFORE using baasix_update_schema to get the current schema.
The update_schema tool performs a full replacement, so you need the complete current schema to avoid losing existing fields.`,
                        inputSchema: {
                            type: "object",
                            properties: {
                                collection: {
                                    type: "string",
                                    description: "Collection name of the table to inspect",
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
                        description: `Modify an existing collection schema — add new columns, change column types, or remove columns.
Use this when asked to "add a field", "add a column", or "alter a table".

⚠️ CRITICAL: This performs a FULL REPLACEMENT of the schema definition, NOT a merge.
You MUST first call baasix_get_schema to retrieve the current schema, then spread ALL existing fields
and add/modify/remove only the fields you need. If you send only new fields, ALL existing fields will
be LOST from the schema definition.

CORRECT WORKFLOW to add a column:
1. Call baasix_get_schema for the collection
2. Copy the entire existing schema (including name, timestamps, paranoid, and ALL fields)
3. Add/modify/remove the desired fields while keeping all other fields intact
4. Send the complete schema to baasix_update_schema

EXAMPLE — Adding a "description" field to an existing "products" table that has id, name, price:
{
  "collection": "products",
  "schema": {
    "name": "Product",
    "timestamps": true,
    "fields": {
      "id": { "type": "UUID", "primaryKey": true, "defaultValue": { "type": "UUIDV4" } },
      "name": { "type": "String", "allowNull": false, "values": { "length": 255 } },
      "price": { "type": "Decimal", "values": { "precision": 10, "scale": 2 } },
      "description": { "type": "Text", "allowNull": true }
    }
  }
}

❌ WRONG — This will DELETE the id, name, and price field definitions:
{
  "collection": "products",
  "schema": {
    "fields": {
      "description": { "type": "Text", "allowNull": true }
    }
  }
}

To REMOVE a column: Retrieve the full schema, remove the field from the fields object, and send the complete schema without that field.
To RENAME a column: Remove the old field and add a new one with the desired name (data will NOT be migrated).
To CHANGE a field type: Update the type property on the existing field definition.

Field types and options are the same as baasix_create_schema.`,
                        inputSchema: {
                            type: "object",
                            properties: {
                                collection: {
                                    type: "string",
                                    description: "Collection name of the table to modify",
                                },
                                schema: {
                                    type: "object",
                                    description: "The COMPLETE schema definition including ALL existing fields plus any additions/modifications. This REPLACES the entire schema — do NOT send partial fields.",
                                },
                            },
                            required: ["collection", "schema"],
                        },
                    },
                    {
                        name: "baasix_add_schema_field",
                        description: `Add a single field/column to an existing collection schema.
This is an additive operation and does NOT require sending the full schema.

Use this when asked to "add one field", "add one column", or "append a field".
For relationship fields, use baasix_create_relationship instead.` ,
                        inputSchema: {
                            type: "object",
                            properties: {
                                collection: {
                                    type: "string",
                                    description: "Collection name",
                                },
                                fieldName: {
                                    type: "string",
                                    description: "Field/column name to add",
                                },
                                field: {
                                    type: "object",
                                    description: "Field definition object",
                                },
                            },
                            required: ["collection", "fieldName", "field"],
                        },
                    },
                    {
                        name: "baasix_update_schema_field",
                        description: `Update a single existing field/column in a collection schema.
This updates one field only and does NOT require sending the complete schema.

Use this to change field options such as type, allowNull, defaultValue, or validations for one field.` ,
                        inputSchema: {
                            type: "object",
                            properties: {
                                collection: {
                                    type: "string",
                                    description: "Collection name",
                                },
                                fieldName: {
                                    type: "string",
                                    description: "Field/column name to update",
                                },
                                field: {
                                    type: "object",
                                    description: "Partial or complete field definition to merge into existing field",
                                },
                            },
                            required: ["collection", "fieldName", "field"],
                        },
                    },
                    {
                        name: "baasix_delete_schema_field",
                        description: `Delete a single field/column from a collection schema.
This operation updates schema definition only via schema manager logic.
It does not directly execute DROP COLUMN SQL.

Use this when asked to "remove one field" or "drop one column".` ,
                        inputSchema: {
                            type: "object",
                            properties: {
                                collection: {
                                    type: "string",
                                    description: "Collection name",
                                },
                                fieldName: {
                                    type: "string",
                                    description: "Field/column name to delete",
                                },
                            },
                            required: ["collection", "fieldName"],
                        },
                    },
                    {
                        name: "baasix_delete_schema",
                        description: `DROP/DELETE an entire database table and all its data permanently.
Use this when asked to "drop a table", "delete a collection", or "remove a table".

⚠️ WARNING: This is destructive and irreversible. The table, all its data, indexes, and relationships will be permanently deleted.
Do NOT use this to remove a column — use baasix_update_schema instead to modify the schema without the unwanted field.`,
                        inputSchema: {
                            type: "object",
                            properties: {
                                collection: {
                                    type: "string",
                                    description: "Collection name of the table to permanently delete",
                                },
                            },
                            required: ["collection"],
                        },
                    },
                    {
                        name: "baasix_add_index",
                        description: `Add a database index to a table for better query performance.
This is an ADDITIVE operation — it only adds the new index without affecting existing indexes or schema fields.

Supports btree (default), hash, gin, and gist index types. Can be unique.
Use this when asked to "add an index", "create an index", or "speed up queries on a field".

EXAMPLE — Add a unique index on email:
{
  "collection": "users",
  "indexDefinition": {
    "name": "users_email_unique",
    "fields": ["email"],
    "unique": true
  }
}

EXAMPLE — Add a composite index:
{
  "collection": "orders",
  "indexDefinition": {
    "name": "orders_status_date",
    "fields": ["status", "createdAt"]
  }
}`,
                        inputSchema: {
                            type: "object",
                            properties: {
                                collection: {
                                    type: "string",
                                    description: "Collection name of the table to add the index to",
                                },
                                indexDefinition: {
                                    type: "object",
                                    description: "Index definition with fields and options",
                                    properties: {
                                        name: {
                                            type: "string",
                                            description: "Index name (e.g., 'users_email_unique'). Use a descriptive name like {table}_{fields}_{type}",
                                        },
                                        fields: {
                                            type: "array",
                                            items: { type: "string" },
                                            description: "Array of field names to index (e.g., ['email'] or ['status', 'createdAt'] for composite)",
                                        },
                                        unique: {
                                            type: "boolean",
                                            description: "Whether the index should enforce uniqueness (default: false)",
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
                        description: `Remove an existing index from a database table.
This only removes the index — it does NOT delete any data or columns.
Use baasix_get_schema first to see the list of existing indexes on the table if you don't know the index name.`,
                        inputSchema: {
                            type: "object",
                            properties: {
                                collection: {
                                    type: "string",
                                    description: "Collection name of the table containing the index",
                                },
                                indexName: {
                                    type: "string",
                                    description: "Name of the index to remove (use baasix_get_schema to find index names)",
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
                        description: `Modify an existing foreign key / relationship between two database tables.
Use this to change delete behavior, alias, description, or other relationship properties.
This is a PARTIAL update — only pass the properties you want to change.

Note: You CANNOT change the relationship type or target table. To do that, delete and recreate the relationship.

EXAMPLE — Change onDelete behavior:
{
  "sourceCollection": "products",
  "fieldName": "category",
  "updateData": { "onDelete": "SET NULL" }
}

EXAMPLE — Update alias and description:
{
  "sourceCollection": "products",
  "fieldName": "category",
  "updateData": { "alias": "items", "description": "Product category" }
}`,
                        inputSchema: {
                            type: "object",
                            properties: {
                                sourceCollection: {
                                    type: "string",
                                    description: "Source collection name that owns the relationship",
                                },
                                fieldName: {
                                    type: "string",
                                    description: "Relationship field name to update (use baasix_get_schema to find relationship names)",
                                },
                                updateData: {
                                    type: "object",
                                    description: "Only the relationship properties to change (partial update). Supports: alias, description, onDelete (CASCADE/RESTRICT/SET NULL), onUpdate",
                                },
                            },
                            required: ["sourceCollection", "fieldName", "updateData"],
                        },
                    },
                    {
                        name: "baasix_delete_relationship",
                        description: `Remove a foreign key / relationship from a database table.
This drops the foreign key constraint and the FK column (e.g., category_Id) from the source table.
For M2M relationships, this also removes the junction table.

⚠️ WARNING: This will remove the FK column and any data stored in it. Use baasix_get_schema first to confirm the relationship field name.

Do NOT confuse with baasix_delete_schema (which deletes an entire table).`,
                        inputSchema: {
                            type: "object",
                            properties: {
                                sourceCollection: {
                                    type: "string",
                                    description: "Source collection name that owns the relationship",
                                },
                                fieldName: {
                                    type: "string",
                                    description: "Relationship field name to delete (use baasix_get_schema to find relationship names)",
                                },
                            },
                            required: ["sourceCollection", "fieldName"],
                        },
                    },
                    {
                        name: "baasix_export_schemas",
                        description: "Export all table definitions as JSON for backup or migration. Returns the complete schema definitions of every table in the database, including fields, indexes, and relationships.",
                        inputSchema: {
                            type: "object",
                            properties: {},
                            additionalProperties: false,
                        },
                    },
                    {
                        name: "baasix_import_schemas",
                        description: "Import table definitions from JSON data to recreate tables. Use this to restore schemas from a previous baasix_export_schemas backup or to migrate table structures between environments.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                schemas: {
                                    type: "object",
                                    description: "Schema data to import (format should match the output of baasix_export_schemas)",
                                },
                            },
                            required: ["schemas"],
                        },
                    },

                    // Item Management Tools
                    {
                        name: "baasix_list_items",
                        description: `Query items from a collection with powerful filtering, sorting, pagination, relations, and aggregation.

NOTE: For analytics, summaries, totals, sums, averages, counts, min/max, grouped reports, or dashboards → use baasix_generate_report instead. Use this tool (list_items) for fetching actual row data.

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
- $CURRENT_USER.field: User field (e.g., $CURRENT_USER.department)
- $CURRENT_ROLE: Current role's ID
- $CURRENT_ROLE.field: Role field
- $CURRENT_USERROLE: Active role-assignment (baasix_UserRole) row ID
- $CURRENT_USERROLE.field: Assignment row field, including custom columns (e.g., $CURRENT_USERROLE.team_id) or relations (e.g., $CURRENT_USERROLE.team.name)
- $CURRENT_TENANT: Current tenant's ID
- $CURRENT_TENANT.field: Tenant field (e.g., $CURRENT_TENANT.name)
- $CURRENT_SETTINGS.field: Settings field, tenant-aware (e.g., $CURRENT_SETTINGS.currency)
- $NOW: Current timestamp
- $NOW-DAYS_7: 7 days ago
- $NOW+MONTHS_1: 1 month from now

FILTER EXAMPLES:
- {"status": {"eq": "active"}}
- {"AND": [{"price": {"gte": 10}}, {"price": {"lte": 100}}]}
- {"tags": {"arraycontains": ["featured"]}}
- {"author_Id": {"eq": "$CURRENT_USER"}}
- {"tenant_Id": {"eq": "$CURRENT_TENANT"}}
- {"currency": {"eq": "$CURRENT_SETTINGS.currency"}}
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
                                count: {
                                    type: "boolean",
                                    description:
                                        "Whether to compute the total record count. Pass false to skip the COUNT query for faster reads (response totalCount will be null). Omit to use the server default (COUNT_BY_DEFAULT).",
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

                    // Page Builder Tools
                    {
                        name: "baasix_list_pages",
                        description: "List page-builder pages (baasix_Page): id, name, slug, icon, enabled, isPublic, sort, parent_Id. Pages render at /pages/?slug=<slug>.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                search: { type: "string", description: "Filter by name/slug substring" },
                                includeDisabled: { type: "boolean", description: "Include disabled pages (default true)" },
                                limit: { type: "number", description: "Max pages (default 100)" },
                                page: { type: "number", description: "Page number for pagination (default 1)" },
                            },
                        },
                    },
                    {
                        name: "baasix_get_page",
                        description: "Get one page WITH all its blocks (ids, types, positions, configs). Identify by id or slug.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                id: { type: "string", description: "Page id" },
                                slug: { type: "string", description: "Page slug (when id not given)" },
                            },
                        },
                    },
                    {
                        name: "baasix_create_page",
                        description: "Create a page-builder page. Slug: lowercase a-z0-9 with dashes, unique per tenant. Renders at /pages/?slug=<slug>. Add blocks with baasix_create_block; read resource baasix://docs/block-config for the config format.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                name: { type: "string", description: "Display name" },
                                slug: { type: "string", description: "URL slug (lowercase a-z0-9-)" },
                                icon: { type: "string", description: "Lucide icon name" },
                                description: { type: "string" },
                                isPublic: { type: "boolean", description: "Public page at /p/?slug= (default false)" },
                                enabled: { type: "boolean", description: "Default true" },
                                sort: { type: "number" },
                                parent_Id: { type: "string", description: "Parent page id for menu nesting" },
                                options: { type: "object", description: "Page options JSON, e.g. {menuGroup:true}" },
                            },
                            required: ["name", "slug"],
                        },
                    },
                    {
                        name: "baasix_update_page",
                        description: "Update fields of a page. Allowed fields: name, slug, icon, description, isPublic, enabled, sort, parent_Id, options, roles. roles is an array of role ids (null = visible to all roles).",
                        inputSchema: {
                            type: "object",
                            properties: {
                                id: { type: "string", description: "Page id" },
                                data: { type: "object", description: "Partial page fields" },
                            },
                            required: ["id", "data"],
                        },
                    },
                    {
                        name: "baasix_delete_page",
                        description: "Delete a page AND all its blocks (cascade). Irreversible.",
                        inputSchema: {
                            type: "object",
                            properties: { id: { type: "string", description: "Page id" } },
                            required: ["id"],
                        },
                    },
                    {
                        name: "baasix_create_block",
                        description: "Add a block to a page. Server validates config against the block type and bound collection schema — call baasix_get_schema + baasix_validate_block_config first. Types REQUIRING collection: table, form, details, kanban, calendar, chart, cardlist, map, geochart, media, feed, filter. Collectionless: markdown, buttons, iframe, upload (code: only with recordField). position={row>=0, col 0-11, span 1-12} on a 12-column grid. Full reference: resource baasix://docs/block-config.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                page_Id: { type: "string", description: "Owning page id" },
                                type: {
                                    type: "string",
                                    enum: ["table", "form", "details", "kanban", "calendar", "chart", "cardlist", "map", "markdown", "filter", "buttons", "media", "feed", "iframe", "upload", "code", "geochart"],
                                },
                                collection: { type: "string", description: "Bound collection (see type rules)" },
                                position: {
                                    type: "object",
                                    properties: { row: { type: "number" }, col: { type: "number" }, span: { type: "number" } },
                                    required: ["row", "col", "span"],
                                },
                                config: { type: "object", description: "Per-type config (see baasix://docs/block-config)" },
                                configVersion: { type: "number" },
                            },
                            required: ["page_Id", "type", "position"],
                        },
                    },
                    {
                        name: "baasix_update_block",
                        description: "Update a block. Allowed fields: type, collection, position, config, configVersion. A config patch replaces the WHOLE config key — send the complete new config object.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                id: { type: "string", description: "Block id (from baasix_get_page)" },
                                data: { type: "object", description: "Partial block fields, e.g. {config:{...}}" },
                            },
                            required: ["id", "data"],
                        },
                    },
                    {
                        name: "baasix_delete_block",
                        description: "Delete a single block from a page.",
                        inputSchema: {
                            type: "object",
                            properties: { id: { type: "string", description: "Block id" } },
                            required: ["id"],
                        },
                    },
                    {
                        name: "baasix_validate_block_config",
                        description: "Validate a block payload (type + collection + config + position) against the live schema WITHOUT creating anything. Returns {valid, errors}.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                type: { type: "string" },
                                collection: { type: "string" },
                                config: { type: "object" },
                                position: { type: "object" },
                            },
                            required: ["type"],
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
                        description: `Run an aggregate/analytics query on a database table. Use this for summaries, totals, averages, counts, grouping, and any analytics query. Prefer this over baasix_list_items when the user asks for sums, counts, averages, min/max, grouped data, dashboards, or reports.

EXAMPLES:
1. Sum of quantity: aggregate: {"total": {"function": "sum", "field": "quantity"}}
2. Count by status: groupBy: ["status"], aggregate: {"count": {"function": "count", "field": "*"}}
3. Average price for active products: filter: {"status": {"eq": "active"}}, aggregate: {"avg": {"function": "avg", "field": "price"}}
4. Min/max: aggregate: {"min": {"function": "min", "field": "price"}, "max": {"function": "max", "field": "price"}}`,
                        inputSchema: {
                            type: "object",
                            properties: {
                                collection: {
                                    type: "string",
                                    description: "Table/collection name to report on",
                                },
                                fields: {
                                    type: "array",
                                    items: { type: "string" },
                                    description: 'Columns to return. Default ["*"]. Use dot notation for relations: ["category.name"].',
                                },
                                filter: {
                                    type: "object",
                                    description: "Row filter applied before aggregation. Same operators as baasix_list_items.",
                                },
                                sort: {
                                    type: "array",
                                    items: { type: "string" },
                                    description: 'Sort results. Format: ["field:direction"]. E.g. ["count:desc", "name:asc"].',
                                },
                                limit: {
                                    type: "number",
                                    description: "Max rows returned. Default -1 (all). Set to limit grouped results.",
                                },
                                page: {
                                    type: "number",
                                    description: "Page number for pagination (works with limit).",
                                },
                                aggregate: {
                                    type: "object",
                                    description: 'Aggregation definitions. Each key is the result alias. Value: {function: "count|sum|avg|min|max", field: "columnName"}. E.g. {"total": {"function": "sum", "field": "quantity"}}',
                                },
                                groupBy: {
                                    type: "array",
                                    items: { type: "string" },
                                    description: "Columns to group by. Required when using aggregate with breakdowns.",
                                },
                            },
                            required: ["collection"],
                        },
                    },
                    {
                        name: "baasix_collection_stats",
                        description: `Run multiple aggregate queries across different tables in a single call. Each query uses the full report engine (filter, aggregate, groupBy, etc.).

Each stats entry requires:
- name: A unique label for this stat in the results (e.g. "total_orders", "active_users")
- collection: The table to query
- query: Full report query object with fields, filter, aggregate, groupBy, sort, limit, page

EXAMPLES:
1. Get counts: stats: [{"name": "users", "collection": "users", "query": {"aggregate": {"total": {"function": "count", "field": "*"}}}}]
2. Multi-table: stats: [{"name": "orders", "collection": "orders", "query": {"aggregate": {"count": {"function": "count", "field": "*"}}}}, {"name": "revenue", "collection": "orders", "query": {"aggregate": {"total": {"function": "sum", "field": "amount"}}}}]`,
                        inputSchema: {
                            type: "object",
                            properties: {
                                stats: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            name: {
                                                type: "string",
                                                description: "Unique label for this stat in the results",
                                            },
                                            collection: {
                                                type: "string",
                                                description: "Table/collection to query",
                                            },
                                            query: {
                                                type: "object",
                                                description: "Report query: {fields?, filter?, sort?, limit?, page?, aggregate?, groupBy?}",
                                            },
                                        },
                                        required: ["name", "collection", "query"],
                                    },
                                    description: "Array of stat queries to run across tables",
                                },
                            },
                            required: ["stats"],
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
                                    description: "Template body as HTML string with Liquid variables",
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

FIELDS — which COLUMNS the role may access. IMPORTANT, this is the #1 mistake:
- "*" means the collection's OWN/DIRECT columns ONLY. It does NOT include any
  related/nested data. A relation that is not listed here is stripped from the
  response entirely (even if relConditions targets it).
- To allow a relation you must list it explicitly. Each "*" segment = ONE level;
  add another ".*" to go one level deeper (there is NO "**" syntax):
  - "author.*"   → author's direct fields (one level deep)
  - "author.*.*" → author's fields + author's relations one level deeper
  - "*.*"         → own columns + all first-level relations
- ["*"]                       → own columns, NO relations
- ["*", "author.*"]           → own columns + author's direct fields
- ["*", "author.*.*"]         → own columns + author + author's nested relations
- ["name", "price"]           → only these two own columns

CONDITIONS vs RELCONDITIONS — these are DIFFERENT. Do not confuse them:
- conditions = a ROW FILTER on THIS collection. Decides WHICH RECORDS of the
  permissioned collection the role can see/act on. Merged into the main query's
  WHERE clause. Keys are columns of THIS collection.
    {"published": {"eq": true}}                  → only published records
    {"author_Id": {"eq": "$CURRENT_USER"}}       → only the user's own records
    {"tenant_Id": {"eq": "$CURRENT_TENANT"}}     → tenant isolation
- relConditions = a filter on RELATED records returned alongside. Decides WHICH
  RELATED ROWS appear inside array relations (HasMany / M2M). Keyed by RELATION
  NAME, then the related collection's columns. Does NOT restrict the main records.
  Only takes effect if that relation is also granted in FIELDS.
    {"reviews": {"approved": {"eq": true}}}      → only approved reviews in response
    {"orders": {"items": {"status": {"eq": "shipped"}}}}  → nested relation filter

Rule of thumb: "which rows of THIS collection?" → conditions.
               "which related rows inside the response?" → relConditions.

EXAMPLE (read own published products, with only approved reviews, author name visible):
{
  "role_Id": "uuid",
  "collection": "products",
  "action": "read",
  "fields": ["*", "author.firstName", "reviews.*"],
  "conditions": {"published": {"eq": true}, "author_Id": {"eq": "$CURRENT_USER"}},
  "relConditions": {"reviews": {"approved": {"eq": true}}}
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
                                    description:
                                        'Allowed COLUMNS. "*" = own/direct columns ONLY (no relations). List relations explicitly: "author.*" (one level), "author.*.*" (one level deeper). Each "*" segment is one level — there is NO "**" syntax. A relation not listed here is omitted from the response.',
                                },
                                conditions: {
                                    type: "object",
                                    description:
                                        'ROW FILTER on THIS collection — which RECORDS the role can access. Keys are this collection\'s columns. E.g. {"author_Id": {"eq": "$CURRENT_USER"}}. NOT for filtering related data (use relConditions for that).',
                                },
                                defaultValues: {
                                    type: "object",
                                    description:
                                        'Default values auto-set on create/update (e.g., {"author_Id": "$CURRENT_USER"})',
                                },
                                relConditions: {
                                    type: "object",
                                    description:
                                        'Filter on RELATED records returned in array relations — which related ROWS appear in the response. Keyed by RELATION NAME. E.g. {"reviews": {"approved": {"eq": true}}}. Only applies to relations also granted in fields. Does NOT restrict the main records (use conditions for that).',
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
                                    description:
                                        'Allowed COLUMNS. "*" = own/direct columns ONLY (no relations). List relations explicitly: "author.*" (one level), "author.*.*" (one level deeper). Each "*" segment is one level — there is NO "**" syntax. A relation not listed is omitted from the response.',
                                },
                                conditions: {
                                    type: "object",
                                    description:
                                        'ROW FILTER on THIS collection — which RECORDS the role can access (keys are this collection\'s columns). NOT for filtering related data.',
                                },
                                defaultValues: {
                                    type: "object",
                                    description: "Default values auto-set on create/update",
                                },
                                relConditions: {
                                    type: "object",
                                    description:
                                        'Filter on RELATED records in array relations — which related ROWS appear in the response (keyed by RELATION NAME). Does NOT restrict the main records.',
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
                                    description:
                                        'Permissions keyed by collection then action, e.g. {"products": {"read": {"fields": ["*"], "conditions": {...}, "relConditions": {...}}}}. Same field semantics as baasix_create_permission: fields "*" = own columns only (relations need "rel.*", "rel.*.*" for deeper — no "**" syntax); conditions = row filter on THIS collection; relConditions = filter on related rows keyed by relation name.',
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
                    case "baasix_add_schema_field":
                        return await this.handleAddSchemaField(args);
                    case "baasix_update_schema_field":
                        return await this.handleUpdateSchemaField(args);
                    case "baasix_delete_schema_field":
                        return await this.handleDeleteSchemaField(args);
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

                    // Page Builder
                    case "baasix_list_pages":
                        return await this.handleListPages(args);
                    case "baasix_get_page":
                        return await this.handleGetPage(args);
                    case "baasix_create_page":
                        return await this.handleCreatePage(args);
                    case "baasix_update_page":
                        return await this.handleUpdatePage(args);
                    case "baasix_delete_page":
                        return await this.handleDeletePage(args);
                    case "baasix_create_block":
                        return await this.handleCreateBlock(args);
                    case "baasix_update_block":
                        return await this.handleUpdateBlock(args);
                    case "baasix_delete_block":
                        return await this.handleDeleteBlock(args);
                    case "baasix_validate_block_config":
                        return await this.handleValidateBlockConfig(args);

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

        this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
            resources: [
                {
                    uri: "baasix://docs/block-config",
                    name: "Page-builder block config reference",
                    description: "Block types, per-type config schemas, position grid and filter DSL for baasix_Block configs (fetched live from the connected server)",
                    mimeType: "text/markdown",
                },
            ],
        }));

        this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
            const { uri } = request.params;
            if (uri !== "baasix://docs/block-config") {
                throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
            }
            // Single source of truth: the doc ships with the server (core), not this package.
            try {
                const doc = await baasixRequest("/pages/block-config-doc");
                return { contents: [{ uri, mimeType: "text/markdown", text: typeof doc === "string" ? doc : JSON.stringify(doc) }] };
            } catch (error) {
                throw new McpError(
                    ErrorCode.InternalError,
                    `Could not fetch the block-config doc from ${BAASIX_URL} (server too old or unreachable): ${error.message}`
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

    async handleAddSchemaField(args) {
        const { collection, fieldName, field } = args;
        const result = await baasixRequest(`/schemas/${collection}/fields`, {
            method: "POST",
            data: { fieldName, field },
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

    async handleUpdateSchemaField(args) {
        const { collection, fieldName, field } = args;
        const result = await baasixRequest(`/schemas/${collection}/fields/${fieldName}`, {
            method: "PATCH",
            data: { field },
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

    async handleDeleteSchemaField(args) {
        const { collection, fieldName } = args;
        const result = await baasixRequest(`/schemas/${collection}/fields/${fieldName}`, {
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
            count,
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
        if (count !== undefined) params.append("count", count.toString());

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

    // Page Builder Methods
    async handleListPages(args = {}) {
        const params = new URLSearchParams();
        params.set("fields", JSON.stringify(["id", "name", "slug", "icon", "enabled", "isPublic", "sort", "parent_Id", "options"]));
        params.set("sort", JSON.stringify(["sort"]));
        params.set("limit", String(args.limit ?? 100));
        params.set("page", String(args.page ?? 1));
        if (args.search) {
            params.set("search", args.search);
            params.set("searchFields", JSON.stringify(["name", "slug"]));
        }
        if (args.includeDisabled === false) params.set("filter", JSON.stringify({ enabled: { eq: true } }));
        const result = await baasixRequest(`/items/baasix_Page?${params}`);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    async handleGetPage(args) {
        const { id, slug } = args;
        if (!id && !slug) throw new Error("Provide id or slug");
        const params = new URLSearchParams();
        params.set("fields", JSON.stringify(["*", "blocks.*"]));
        params.set("limit", "1");
        params.set("filter", JSON.stringify(id ? { id: { eq: id } } : { slug: { eq: slug } }));
        const result = await baasixRequest(`/items/baasix_Page?${params}`);
        const page = result?.data?.[0];
        if (!page) throw new Error("Page not found");
        return { content: [{ type: "text", text: JSON.stringify(page, null, 2) }] };
    }

    async handleCreatePage(args) {
        const body = {};
        for (const key of PAGE_CREATE_KEYS) {
            if (args[key] !== undefined) body[key] = args[key];
        }
        const result = await baasixRequest("/items/baasix_Page", { method: "POST", data: body });
        return { content: [{ type: "text", text: JSON.stringify({ ...result, hint: `Page will render at /pages/?slug=${args.slug}` }, null, 2) }] };
    }

    async handleUpdatePage(args) {
        const { id, data } = args;
        const body = {};
        for (const key of PAGE_UPDATE_KEYS) {
            if (data && key in data) body[key] = data[key];
        }
        if (Object.keys(body).length === 0) {
            throw new Error("No updatable fields in data — allowed: " + PAGE_UPDATE_KEYS.join(", "));
        }
        const result = await baasixRequest(`/items/baasix_Page/${encodeURIComponent(id)}`, { method: "PATCH", data: body });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    async handleDeletePage(args) {
        const { id } = args;
        const result = await baasixRequest(`/items/baasix_Page/${encodeURIComponent(id)}`, { method: "DELETE" });
        return { content: [{ type: "text", text: JSON.stringify(result ?? { deleted: id }, null, 2) }] };
    }

    async handleCreateBlock(args) {
        const { page_Id, type, collection = null, position, config = null, configVersion } = args;
        const result = await baasixRequest("/items/baasix_Block", {
            method: "POST",
            data: { page_Id, type, collection, position, config, ...(configVersion != null ? { configVersion } : {}) },
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    async handleUpdateBlock(args) {
        const { id, data } = args;
        const body = {};
        for (const key of BLOCK_UPDATE_KEYS) {
            if (data && key in data) body[key] = data[key];
        }
        if (Object.keys(body).length === 0) {
            throw new Error("No updatable fields in data — allowed: " + BLOCK_UPDATE_KEYS.join(", "));
        }
        const result = await baasixRequest(`/items/baasix_Block/${encodeURIComponent(id)}`, { method: "PATCH", data: body });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    async handleDeleteBlock(args) {
        const { id } = args;
        const result = await baasixRequest(`/items/baasix_Block/${encodeURIComponent(id)}`, { method: "DELETE" });
        return { content: [{ type: "text", text: JSON.stringify(result ?? { deleted: id }, null, 2) }] };
    }

    async handleValidateBlockConfig(args) {
        const { type, collection, config, position } = args;
        const result = await baasixRequest("/pages/validate-block", { method: "POST", data: { type, collection, config, position } });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
        const { collection, fields, filter, sort, limit, page, aggregate, groupBy } = args;
        const body = {};
        if (fields) body.fields = fields;
        if (filter) body.filter = filter;
        if (sort) {
            // Convert "field:desc" → "-field", "field:asc" → "field" for ItemsService
            body.sort = sort.map(s => {
                const [field, dir] = s.split(':');
                return dir?.toLowerCase() === 'desc' ? `-${field}` : field;
            });
        }
        if (limit !== undefined) body.limit = limit;
        if (page !== undefined) body.page = page;
        if (aggregate) body.aggregate = aggregate;
        if (groupBy) body.groupBy = groupBy;

        const report = await baasixRequest(`/reports/${encodeURIComponent(collection)}`, {
            method: 'POST',
            data: body,
        });
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
        const { stats } = args;
        const result = await baasixRequest(`/reports/stats`, {
            method: 'POST',
            data: { stats },
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
