// @ts-nocheck
/**
 * MCPService - Model Context Protocol Server for Baasix
 *
 * This service provides MCP tools that call Baasix HTTP routes internally,
 * ensuring all route-level validation, permission checks, and cache
 * invalidation are applied consistently.
 *
 * Enable via environment variable: MCP_ENABLED=true
 * Access at: http://localhost:8056/mcp (or custom MCP_PATH)
 *
 * Note: @ts-nocheck is used because the MCP SDK + Zod combination causes
 * TypeScript to hang during compilation due to complex generic type inference.
 * The explicit type annotations are kept for documentation and IDE support.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import env from "../utils/env.js";

// ==================== Type Definitions ====================

/**
 * MCPAccountability mirrors the shape built by the auth middleware.
 * Used for session management and passed as bearer token for route calls.
 *
 * Shape: { user: { id, email, isAdmin, role, ... }, role: { id, name, isTenantSpecific }, permissions[], tenant, ipaddress, token }
 */
interface MCPAccountability {
  user: {
    id: string | number;
    email?: string;
    firstName?: string;
    lastName?: string;
    isAdmin: boolean;
    role: string;
    [key: string]: any;
  } | null;
  role: {
    id: string | number;
    name: string;
    isTenantSpecific?: boolean;
    description?: string;
  } | null;
  permissions: any[];
  tenant: string | number | null;
  ipaddress: string;
  token?: string;
}

interface ToolExtra {
  sessionId?: string;
}

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

// Input types for all tools - explicit to avoid Zod inference
interface ListSchemasInput {
  search?: string;
  page?: number;
  limit?: number;
  sort?: string;
}

interface GetSchemaInput {
  collection: string;
}

interface CreateSchemaInput {
  collection: string;
  schema: { fields: Record<string, unknown> };
}

interface UpdateSchemaInput {
  collection: string;
  schema: { fields?: Record<string, unknown> };
}

interface DeleteSchemaInput {
  collection: string;
}

interface AddIndexInput {
  collection: string;
  indexDefinition: {
    name?: string;
    fields: string[];
    unique?: boolean;
    type?: "btree" | "hash" | "gin" | "gist";
  };
}

interface RemoveIndexInput {
  collection: string;
  indexName: string;
}

interface CreateRelationshipInput {
  sourceCollection: string;
  relationshipData: {
    name: string;
    type: "M2O" | "O2M" | "O2O" | "M2M" | "M2A";
    target?: string;
    alias?: string;
    onDelete?: "CASCADE" | "RESTRICT" | "SET NULL";
    onUpdate?: "CASCADE" | "RESTRICT" | "SET NULL";
    tables?: string[];
    through?: string;
  };
}

interface DeleteRelationshipInput {
  sourceCollection: string;
  fieldName: string;
}

interface ImportSchemasInput {
  schemas: Record<string, unknown>;
}

interface ListItemsInput {
  collection: string;
  filter?: Record<string, unknown>;
  fields?: string[];
  sort?: string;
  page?: number;
  limit?: number;
  search?: string;
  searchFields?: string[];
  aggregate?: Record<string, unknown>;
  groupBy?: string[];
  relConditions?: Record<string, unknown>;
}

interface GetItemInput {
  collection: string;
  id: string;
  fields?: string[];
}

interface CreateItemInput {
  collection: string;
  data: Record<string, unknown>;
}

interface UpdateItemInput {
  collection: string;
  id: string;
  data: Record<string, unknown>;
}

interface DeleteItemInput {
  collection: string;
  id: string;
}

interface ListFilesInput {
  filter?: Record<string, unknown>;
  page?: number;
  limit?: number;
}

interface FileIdInput {
  id: string;
}

interface ListPermissionsInput {
  filter?: Record<string, unknown>;
  sort?: string;
  page?: number;
  limit?: number;
}

interface CreatePermissionInput {
  role_Id: string;
  collection: string;
  action: "create" | "read" | "update" | "delete";
  fields?: string[];
  conditions?: Record<string, unknown>;
  defaultValues?: Record<string, unknown>;
  relConditions?: Record<string, unknown>;
}

interface UpdatePermissionInput {
  id: string;
  role_Id?: string;
  collection?: string;
  action?: "create" | "read" | "update" | "delete";
  fields?: string[];
  conditions?: Record<string, unknown>;
  defaultValues?: Record<string, unknown>;
  relConditions?: Record<string, unknown>;
}

interface PermissionIdInput {
  id: string;
}



interface GetSettingsInput {
  key?: string;
}

interface UpdateSettingsInput {
  settings: Record<string, unknown>;
}

interface ListTemplatesInput {
  filter?: Record<string, unknown>;
  page?: number;
  limit?: number;
}

interface GetTemplateInput {
  id: string;
}

interface UpdateTemplateInput {
  id: string;
  subject?: string;
  description?: string;
  body?: string;
  isActive?: boolean;
}

interface ListNotificationsInput {
  page?: number;
  limit?: number;
  seen?: boolean;
}

interface MarkNotificationSeenInput {
  id: string;
}

interface SortItemsInput {
  collection: string;
  item: string;
  to: string;
  mode?: 'before' | 'after';
}

interface GenerateReportInput {
  collection: string;
  fields?: string[];
  filter?: Record<string, unknown>;
  sort?: string[];
  limit?: number;
  page?: number;
  aggregate?: Record<string, unknown>;
  groupBy?: string[];
}

interface CollectionStatsInput {
  stats: Array<{
    name: string;
    collection: string;
    query: Record<string, unknown>;
  }>;
}

interface SendNotificationInput {
  recipients: string[];
  title: string;
  message: string;
  type?: string;
}

interface GetPermissionsInput {
  role: string;
}

interface UpdatePermissionsInput {
  role: string;
  permissions: Array<{
    collection: string;
    action: "create" | "read" | "update" | "delete";
    fields?: string[];
    conditions?: Record<string, unknown>;
  }>;
}

interface GetCurrentUserInput {
  fields?: string[];
}

interface RegisterUserInput {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  roleName?: string;
}

interface SendInviteInput {
  email: string;
  role_Id: string;
  tenant_Id?: string;
  link: string;
}

interface VerifyInviteInput {
  token: string;
  link?: string;
}

interface SendMagicLinkInput {
  email: string;
  link?: string;
  mode?: "link" | "code";
}

interface SwitchTenantInput {
  tenant_Id: string;
}

interface LoginInput {
  email: string;
  password: string;
}

interface RefreshAuthInput {
  refreshToken?: string;
}

interface UpdateRelationshipInput {
  sourceCollection: string;
  relationshipName: string;
  relationshipData: {
    alias?: string;
    onDelete?: "CASCADE" | "RESTRICT" | "SET NULL";
    onUpdate?: "CASCADE" | "RESTRICT" | "SET NULL";
    description?: string;
  };
}

// ==================== Helper Functions ====================

// Session storage for authenticated MCP clients
const mcpSessions = new Map<string, MCPAccountability>();

/**
 * Store accountability info for an MCP session
 */
export function setMCPSession(sessionId: string, accountability: MCPAccountability): void {
  mcpSessions.set(sessionId, accountability);
}

/**
 * Get accountability info from session
 */
function getAccountabilityFromSession(sessionId: string): MCPAccountability | undefined {
  return mcpSessions.get(sessionId);
}

/**
 * Get default accountability (admin for now, can be configured)
 */
function getDefaultAccountability(): MCPAccountability {
  return {
    user: null,
    role: {
      id: "public",
      name: "public",
      isTenantSpecific: false,
    },
    permissions: [],
    tenant: null,
    ipaddress: "127.0.0.1",
  };
}

/**
 * Remove an MCP session
 */
export function removeMCPSession(sessionId: string): void {
  mcpSessions.delete(sessionId);
}

/**
 * Get accountability from extra context
 */
function getAccountability(extra: ToolExtra): MCPAccountability {
  if (extra.sessionId) {
    const session = getAccountabilityFromSession(extra.sessionId);
    if (session) return session;
  }
  return getDefaultAccountability();
}

/**
 * Create success response
 */
function successResult(data: unknown): ToolResult {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Create error response
 */
function errorResult(error: Error | string): ToolResult {
  const message = typeof error === "string" ? error : error.message;
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }, null, 2) }],
    isError: true,
  };
}

// ==================== MCP Server Creation ====================

/**
 * Create and configure the MCP server with all Baasix tools
 */
export function createMCPServer(): McpServer {
  const server = new McpServer({
    name: "Baasix Backend-as-a-Service",
    version: "0.1.0",
    instructions: `You are connected to a Baasix server — an open-source Backend-as-a-Service (BaaS) that provides a complete backend via API.

KEY CONCEPTS:
- "Collection" = a database table (e.g., "products", "orders", "users")
- "Schema" = the definition/structure of a table (its columns, types, constraints)
- "Item" = a row/record in a table
- "Relationship" = a foreign key or junction table between two collections
- System collections are prefixed with "baasix_" (e.g., baasix_User, baasix_Role) — avoid modifying these unless explicitly asked

COMMON TASK MAPPING:
- "Create a table" or "create a collection" → use baasix_create_schema (this creates both the schema definition AND the database table)
- "Add a column/field" → use baasix_update_schema
- "Insert/add data" or "create a record" → use baasix_create_item
- "Query/list/fetch data" or "get rows" → use baasix_list_items
- "Sum", "count", "average", "total", "report", "stats", "analytics", "dashboard", "min/max" → use baasix_generate_report (NOT baasix_list_items)
- "Stats across multiple tables" → use baasix_collection_stats
- "Link two tables" or "add a foreign key" → use baasix_create_relationship
- "Add an index" → use baasix_add_index
- "Set permissions" → use baasix_create_permission or baasix_update_permissions
- "Check what tables exist" → use baasix_list_schemas

WORKFLOW FOR CREATING A NEW TABLE:
1. baasix_create_schema — define the table name and fields
2. baasix_create_relationship — (optional) link it to other tables
3. baasix_add_index — (optional) add indexes for performance
4. baasix_create_permission — (optional) set role-based access

SCHEMA FIELD TYPES: String (VARCHAR), Text (unlimited), Integer, BigInt, Decimal (precision/scale), Float, Real, Double, Boolean, Date, DateTime, Time, UUID, SUID (short ID), JSONB, Array, Enum

DEFAULT VALUE TYPES: { type: "UUIDV4" }, { type: "SUID" }, { type: "NOW" }, { type: "AUTOINCREMENT" }, { type: "SQL", value: "..." }

EXAMPLE — Creating a "products" table:
Call baasix_create_schema with:
  collection: "products"
  schema: {
    "timestamps": true,
    "fields": {
      "id": { "type": "UUID", "primaryKey": true, "defaultValue": { "type": "UUIDV4" } },
      "name": { "type": "String", "allowNull": false, "values": { "length": 255 } },
      "price": { "type": "Decimal", "values": { "precision": 10, "scale": 2 }, "defaultValue": 0 },
      "inStock": { "type": "Boolean", "defaultValue": true }
    }
  }
`,
  });

  // ==================== Helper Functions ====================

  /**
   * Call a Baasix REST route with the MCP session's bearer token.
   * This ensures all schema/relationship operations go through the same
   * route logic (validation, processSchemaFlags, permission checks, cache invalidation)
   * without duplicating code.
   */
  async function callRoute(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    extra: ToolExtra,
    body?: any
  ): Promise<{ ok: boolean; data?: any; error?: string; status?: number }> {
    const { default: axios } = await import("axios");
    const baseUrl = `http://localhost:${env.get("PORT") || "8056"}`;
    const accountability = getAccountability(extra);
    const token = accountability.token;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await axios({
        method,
        url: `${baseUrl}${path}`,
        headers,
        data: body,
        validateStatus: () => true, // don't throw on non-2xx
      });

      if (response.status >= 200 && response.status < 300) {
        return { ok: true, data: response.data, status: response.status };
      }
      const msg = response.data?.message || response.data?.error || JSON.stringify(response.data);
      return { ok: false, error: msg, status: response.status };
    } catch (err: any) {
      return { ok: false, error: err.message || 'Route call failed' };
    }
  }

  // ==================== Schema Management Tools ====================
  // All schema tools call the REST routes via HTTP with the session's bearer token.
  // This ensures route-level validation, processSchemaFlags, permission checks and cache
  // invalidation are applied exactly once (in the route) — zero duplicated logic.

  server.tool(
    "baasix_list_schemas",
    "List all database tables (collections) and their schema definitions. Use this to discover what tables exist. System tables are prefixed with 'baasix_'.",
    {
      search: z.string().optional().describe("Search term to filter schemas by collection name"),
      page: z.number().optional().default(1).describe("Page number for pagination"),
      limit: z.number().optional().default(10).describe("Number of schemas per page"),
      sort: z.string().optional().default("collectionName:asc").describe("Sort field and direction"),
    },
    async (args: ListSchemasInput, extra: ToolExtra): Promise<ToolResult> => {
      const { search, page, limit, sort } = args;
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (page) params.set('page', String(page));
      if (limit) params.set('limit', String(limit));
      if (sort) params.set('sort', sort);
      const qs = params.toString();

      const res = await callRoute('GET', `/schemas${qs ? '?' + qs : ''}`, extra);
      if (!res.ok) return errorResult(res.error || 'Failed to list schemas');
      return successResult(res.data);
    }
  );

  server.tool(
    "baasix_get_schema",
    "Get the full schema definition (columns, types, constraints, relationships) for a specific database table/collection.",
    {
      collection: z.string().describe("Collection name"),
    },
    async (args: GetSchemaInput, extra: ToolExtra): Promise<ToolResult> => {
      const { collection } = args;
      const res = await callRoute('GET', `/schemas/${encodeURIComponent(collection)}`, extra);
      if (!res.ok) return errorResult(res.error || `Schema '${collection}' not found`);
      return successResult(res.data);
    }
  );

  server.tool(
    "baasix_create_schema",
    `CREATE A NEW DATABASE TABLE. This is the tool to use when asked to "create a table", "create a collection", "add a new model", or "define a new entity".

This creates both the schema definition AND the actual PostgreSQL table with all specified columns.

FIELD TYPES:
- String: VARCHAR — requires values.length (e.g., { "type": "String", "values": { "length": 255 } })
- Text: Unlimited length text
- Integer, BigInt: Whole numbers
- Decimal: requires values.precision & values.scale (e.g., { "type": "Decimal", "values": { "precision": 10, "scale": 2 } })
- Float, Real, Double: Floating point numbers
- Boolean: true/false
- Date, DateTime, Time: Date/time values
- UUID: Use with defaultValue { "type": "UUIDV4" } for auto-generated IDs
- SUID: Short unique ID with defaultValue { "type": "SUID" }
- JSONB: JSON data with indexing support
- Array: Specify element type via values.type (e.g., { "type": "Array", "values": { "type": "String" } })
- Enum: Specify allowed values via values.values (e.g., { "type": "Enum", "values": { "values": ["active", "inactive"] } })

FIELD OPTIONS: allowNull (boolean), unique (boolean), primaryKey (boolean), defaultValue (value or { type: "UUIDV4"|"SUID"|"NOW"|"AUTOINCREMENT" })

ALWAYS include an "id" field as primary key. Add "timestamps": true in the schema for automatic createdAt/updatedAt. Add "paranoid": true for soft deletes (deletedAt).

EXAMPLE — Create a "products" table:
collection: "products"
schema: { "timestamps": true, "fields": { "id": { "type": "UUID", "primaryKey": true, "defaultValue": { "type": "UUIDV4" } }, "name": { "type": "String", "allowNull": false, "values": { "length": 255 } }, "price": { "type": "Decimal", "values": { "precision": 10, "scale": 2 }, "defaultValue": 0 }, "inStock": { "type": "Boolean", "defaultValue": true } } }`,
    {
      collection: z.string().describe("Collection name"),
      schema: z
        .object({
          fields: z.record(z.any()).describe("Field definitions"),
        })
        .passthrough()
        .describe("Schema definition"),
    },
    async (args: CreateSchemaInput, extra: ToolExtra): Promise<ToolResult> => {
      const { collection, schema } = args;
      const res = await callRoute('POST', '/schemas', extra, { collectionName: collection, schema });
      if (!res.ok) return errorResult(res.error || `Failed to create collection '${collection}'`);
      return successResult({
        success: true,
        message: `Collection '${collection}' created successfully`,
        collectionName: collection,
      });
    }
  );

  server.tool(
    "baasix_update_schema",
    "Modify an existing database table — add new columns, change column types, or remove columns. Use this when asked to 'add a field', 'add a column', or 'alter a table'.",
    {
      collection: z.string().describe("Collection name"),
      schema: z
        .object({
          fields: z.record(z.any()).optional().describe("Updated field definitions"),
        })
        .passthrough()
        .describe("Schema updates"),
    },
    async (args: UpdateSchemaInput, extra: ToolExtra): Promise<ToolResult> => {
      const { collection, schema } = args;
      const res = await callRoute('PATCH', `/schemas/${encodeURIComponent(collection)}`, extra, { schema });
      if (!res.ok) return errorResult(res.error || `Failed to update collection '${collection}'`);
      return successResult({ success: true, message: `Collection '${collection}' updated successfully` });
    }
  );

  server.tool(
    "baasix_delete_schema",
    "DROP/DELETE an entire database table and all its data permanently. Use this when asked to 'drop a table', 'delete a collection', or 'remove a table'.",
    {
      collection: z.string().describe("Collection name to delete"),
    },
    async (args: DeleteSchemaInput, extra: ToolExtra): Promise<ToolResult> => {
      const { collection } = args;
      const res = await callRoute('DELETE', `/schemas/${encodeURIComponent(collection)}`, extra);
      if (!res.ok) return errorResult(res.error || `Failed to delete collection '${collection}'`);
      return successResult({ success: true, message: `Collection '${collection}' deleted successfully` });
    }
  );

  server.tool(
    "baasix_add_index",
    "Add a database index to a table for better query performance. Supports btree, hash, gin, and gist index types. Can be unique.",
    {
      collection: z.string().describe("Collection name"),
      indexDefinition: z
        .object({
          name: z.string().optional().describe("Index name (auto-generated if not provided)"),
          fields: z.array(z.string()).describe("Fields to index"),
          unique: z.boolean().optional().describe("Whether the index should be unique"),
          type: z.enum(["btree", "hash", "gin", "gist"]).optional().describe("Index type"),
        })
        .describe("Index definition"),
    },
    async (args: AddIndexInput, extra: ToolExtra): Promise<ToolResult> => {
      const { collection, indexDefinition } = args;
      const res = await callRoute('POST', `/schemas/${encodeURIComponent(collection)}/indexes`, extra, indexDefinition);
      if (!res.ok) return errorResult(res.error || `Failed to add index to '${collection}'`);
      return successResult({ success: true, message: `Index added to '${collection}' successfully` });
    }
  );

  server.tool(
    "baasix_remove_index",
    "Remove a database index from a table.",
    {
      collection: z.string().describe("Collection name"),
      indexName: z.string().describe("Name of the index to remove"),
    },
    async (args: RemoveIndexInput, extra: ToolExtra): Promise<ToolResult> => {
      const { collection, indexName } = args;
      const res = await callRoute('DELETE', `/schemas/${encodeURIComponent(collection)}/indexes/${encodeURIComponent(indexName)}`, extra);
      if (!res.ok) return errorResult(res.error || `Failed to remove index '${indexName}' from '${collection}'`);
      return successResult({ success: true, message: `Index '${indexName}' removed from '${collection}'` });
    }
  );

  server.tool(
    "baasix_create_relationship",
    `Create a foreign key / relationship between two database tables. Use this when asked to 'link tables', 'add a foreign key', 'create a relation', or 'connect collections'.

RELATIONSHIP TYPES:
- M2O (Many-to-One / BelongsTo): Adds a foreign key column. Example: products.category_Id → categories.id
- O2M (One-to-Many / HasMany): Virtual reverse of M2O. Example: categories.products → products
- O2O (One-to-One / HasOne): Unique foreign key. Example: users.profile_Id → profiles.id
- M2M (Many-to-Many): Auto-creates a junction table. Example: products ↔ tags
- M2A (Many-to-Any): Polymorphic — one source to multiple target tables

PARAMETERS:
- sourceCollection: the table that gets the foreign key (e.g., "products")
- name: the field name for the FK (e.g., "category" creates "category_Id" column)
- type: relationship type (M2O, O2M, O2O, M2M, M2A)
- target: the related table (e.g., "categories")
- alias: reverse-access name on the target table (e.g., "products" so categories.products works)
- onDelete: CASCADE | RESTRICT | SET NULL

EXAMPLE — products belongsTo categories:
sourceCollection: "products"
relationshipData: { "name": "category", "type": "M2O", "target": "categories", "alias": "products", "onDelete": "CASCADE" }`,
    {
      sourceCollection: z.string().describe("Source collection name"),
      relationshipData: z
        .object({
          name: z.string().describe("Relationship field name"),
          type: z.enum(["M2O", "O2M", "O2O", "M2M", "M2A"]).describe("Relationship type"),
          target: z.string().optional().describe("Target collection name"),
          alias: z.string().optional().describe("Alias for reverse relationship"),
          onDelete: z.enum(["CASCADE", "RESTRICT", "SET NULL"]).optional().describe("Delete behavior"),
          onUpdate: z.enum(["CASCADE", "RESTRICT", "SET NULL"]).optional().describe("Update behavior"),
          tables: z.array(z.string()).optional().describe("Target tables for M2A relationships"),
          through: z.string().optional().describe("Custom junction table name for M2M/M2A"),
        })
        .describe("Relationship configuration"),
    },
    async (args: CreateRelationshipInput, extra: ToolExtra): Promise<ToolResult> => {
      const { sourceCollection, relationshipData } = args;
      const res = await callRoute('POST', `/schemas/${encodeURIComponent(sourceCollection)}/relationships`, extra, relationshipData);
      if (!res.ok) return errorResult(res.error || `Failed to create relationship '${relationshipData.name}' on '${sourceCollection}'`);
      return successResult({
        success: true,
        message: `Relationship '${relationshipData.name}' created on '${sourceCollection}'`,
      });
    }
  );

  server.tool(
    "baasix_delete_relationship",
    "Remove a foreign key / relationship from a database table.",
    {
      sourceCollection: z.string().describe("Source collection name"),
      fieldName: z.string().describe("Relationship field name"),
    },
    async (args: DeleteRelationshipInput, extra: ToolExtra): Promise<ToolResult> => {
      const { sourceCollection, fieldName } = args;
      const res = await callRoute('DELETE', `/schemas/${encodeURIComponent(sourceCollection)}/relationships/${encodeURIComponent(fieldName)}`, extra);
      if (!res.ok) return errorResult(res.error || `Failed to remove relationship '${fieldName}' from '${sourceCollection}'`);
      return successResult({ success: true, message: `Relationship '${fieldName}' removed from '${sourceCollection}'` });
    }
  );

  server.tool(
    "baasix_export_schemas",
    "Export all table definitions as JSON for backup or migration.",
    {},
    async (_args: Record<string, never>, extra: ToolExtra): Promise<ToolResult> => {
      const res = await callRoute('GET', '/schemas-export', extra);
      if (!res.ok) return errorResult(res.error || 'Failed to export schemas');
      return successResult(res.data);
    }
  );

  server.tool(
    "baasix_import_schemas",
    "Import table definitions from JSON data to recreate tables.",
    {
      schemas: z.record(z.any()).describe("Schema data to import"),
    },
    async (args: ImportSchemasInput, extra: ToolExtra): Promise<ToolResult> => {
      const { schemas } = args;
      // The import route expects a file upload (multipart/form-data).
      // Use native Node.js FormData + Blob (available in Node 18+).
      const { default: axios } = await import("axios");
      const baseUrl = `http://localhost:${env.get("PORT") || "8056"}`;
      const accountability = getAccountability(extra);
      const token = accountability.token;

      const jsonStr = JSON.stringify(schemas);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const form = new FormData();
      form.append('schema', blob, 'schema.json');

      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      try {
        const response = await axios.post(`${baseUrl}/schemas-import`, form, {
          headers,
          validateStatus: () => true,
        });

        if (response.status >= 200 && response.status < 300) {
          return successResult(response.data);
        }
        const msg = response.data?.message || response.data?.error || JSON.stringify(response.data);
        return errorResult(msg);
      } catch (err: any) {
        return errorResult(err.message || 'Failed to import schemas');
      }
    }
  );

  // ==================== Item Management Tools ====================

  server.tool(
    "baasix_list_items",
    `Query/list/fetch rows from a database table. Use this when asked to 'get data', 'list records', 'query items', 'search', or 'fetch rows' from any table.

NOTE: For analytics, summaries, totals, sums, averages, counts, min/max, grouped reports, or dashboards → use baasix_generate_report instead. Use this tool (list_items) for fetching actual row data.

--- FIELDS (selecting columns & related data) ---
Use dot notation to include related table data. Wildcards expand to all columns.
- ["*"] → all columns on the main table
- ["name", "price"] → only specific columns
- ["*", "category.*"] → all main columns + all columns from the related "category" table
- ["name", "category.name", "category.id"] → specific columns from main + related table
- ["*", "author.profile.*"] → deep nested relations (up to 7 levels)
The primary key column is always returned even if not listed.

--- FILTER OPERATORS (case-sensitive, use exactly as shown) ---
Comparison: eq, ne, gt, gte, lt, lte
String: like, notLike, iLike, notILike, startsWith, endsWith, nstartsWith, nendsWith
Null check: isNull (true/false), isNotNull (true/false)
List: in, notIn, between, notBetween
Misc: not, is
Array (PostgreSQL arrays): arraycontains, arraycontained
JSONB: jsonbContains, jsonbContainedBy, jsonbHasKey, jsonbHasAnyKeys, jsonbHasAllKeys, jsonbPathExists, jsonbPathMatch, jsonbNotContains, jsonbKeyEquals, jsonbKeyNotEquals, jsonbKeyGt, jsonbKeyGte, jsonbKeyLt, jsonbKeyLte, jsonbKeyIn, jsonbKeyNotIn, jsonbKeyLike, jsonbKeyIsNull, jsonbKeyIsNotNull, jsonbArrayLength, jsonbTypeOf, jsonbDeepValue
Geospatial: dwithin, intersects, nIntersects, within, containsGEO
Logical (combine conditions): AND, OR

Type casting in filters — add "cast" to force column type:
{"price": {"cast": "numeric", "gt": 100}}
{"createdAt": {"cast": "date", "gte": "2024-01-01"}}
Valid cast types: text, varchar, integer, int, bigint, numeric, decimal, real, float, double precision, boolean, date, timestamp, timestamptz, time, uuid, json, jsonb, text[], varchar[], integer[], bigint[], uuid[]

--- DYNAMIC VARIABLES (use as string values in filters) ---
$CURRENT_USER → current authenticated user's ID
$CURRENT_USER.fieldName → any field on current user (e.g., $CURRENT_USER.tenant_Id)
$CURRENT_ROLE → current role ID
$CURRENT_ROLE.fieldName → any field on current role
$NOW → current ISO timestamp
$NOW+DAYS_7 → 7 days from now, $NOW-DAYS_7 → 7 days ago
Pattern: $NOW[+/-](YEARS|MONTHS|WEEKS|DAYS|HOURS|MINUTES|SECONDS)_N

--- SORT ---
Format: "fieldName:asc" or "fieldName:desc"
Relation sort: "category.name:asc" (sort by related table field)

--- SEARCH (PostgreSQL full-text search) ---
The search parameter performs full-text search with prefix matching.
By default searches all text/varchar/uuid columns. Use searchFields to limit which columns are searched.

--- AGGREGATE (SQL aggregation functions) ---
Format: {"aliasName": {"function": "functionName", "field": "columnName"}}
Functions: count, countDistinct, sum, avg, min, max, array_agg
Examples:
{"total": {"function": "count", "field": "*"}} → count all rows
{"avgPrice": {"function": "avg", "field": "price"}} → average price
{"uniqueCategories": {"function": "countDistinct", "field": "category"}} → count distinct
Relation aggregation: {"orderTotal": {"function": "sum", "field": "orders.total"}} → sum via join

--- GROUPBY ---
Format: array of field names. Supports date extraction: ["date:year:createdAt", "status"]
Date parts: year, month, day, hour. Relation paths: ["category.name"]

--- RELCONDITIONS (filter on related/joined tables) ---
Filter rows based on conditions on their related records. Keys are relation names, values are filter objects.
{"category": {"status": {"eq": "active"}}} → only rows whose related category has status=active
{"author": {"verified": {"eq": true}}} → only rows whose author is verified
Nested: {"author": {"department": {"name": {"eq": "Engineering"}}}} → filter by author's department name
Supports same operators and dynamic variables as filter.

--- FILTER EXAMPLES ---
{"status": {"eq": "active"}}  →  exact match
{"status": {"ne": "archived"}}  →  not equal
{"AND": [{"price": {"gte": 10}}, {"price": {"lte": 100}}]}  →  range
{"OR": [{"status": {"eq": "active"}}, {"status": {"eq": "pending"}}]}  →  either condition
{"name": {"iLike": "%john%"}}  →  case-insensitive pattern
{"email": {"startsWith": "admin"}}  →  prefix match
{"deletedAt": {"isNull": true}}  →  null check
{"category": {"in": ["books", "electronics"]}}  →  list membership
{"tags": {"arraycontains": ["featured"]}}  →  PostgreSQL array contains
{"metadata": {"jsonbHasKey": "color"}}  →  JSONB key exists
{"age": {"between": [18, 65]}}  →  between range
{"userId": {"eq": "$CURRENT_USER"}}  →  current user's records
{"createdAt": {"gte": "$NOW-DAYS_30"}}  →  last 30 days`,
    {
      collection: z.string().describe("Table/collection name to query"),
      filter: z.record(z.any()).optional().describe("Filter object using operators like {field: {operator: value}}. Combine with AND/OR for complex queries."),
      fields: z.array(z.string()).optional().describe("Columns to return. Use [\"*\"] for all, dot notation for relations: [\"*\", \"category.*\"]"),
      sort: z.string().optional().describe("Sort as 'field:asc' or 'field:desc'. Supports relation paths like 'category.name:asc'"),
      page: z.number().optional().default(1).describe("Page number for pagination (starts at 1)"),
      limit: z.number().optional().default(10).describe("Rows per page. Use -1 to fetch ALL rows (no pagination)"),
      search: z.string().optional().describe("Full-text search query string. Searches text/varchar columns by default."),
      searchFields: z.array(z.string()).optional().describe("Limit search to specific columns: [\"name\", \"description\"]"),
      aggregate: z.record(z.any()).optional().describe("Aggregation: {alias: {function: 'count|sum|avg|min|max|countDistinct|array_agg', field: 'columnName'}}"),
      groupBy: z.array(z.string()).optional().describe("Group results by fields: [\"status\"] or date extraction [\"date:year:createdAt\"]"),
      relConditions: z.record(z.any()).optional().describe("Filter by related table data: {relationName: {field: {operator: value}}}"),
    },
    async (args: ListItemsInput, extra: ToolExtra): Promise<ToolResult> => {
      const { collection, filter, fields, sort, page, limit, search, searchFields, aggregate, groupBy, relConditions } =
        args;
      try {
        const params = new URLSearchParams();
        if (page) params.set('page', String(page));
        if (limit) params.set('limit', String(limit));
        if (filter) params.set('filter', JSON.stringify(filter));
        if (fields) params.set('fields', JSON.stringify(fields));
        if (sort) {
          const [field, direction] = sort.split(":");
          params.set('sort', JSON.stringify([direction?.toLowerCase() === "desc" ? `-${field}` : field]));
        }
        if (search) params.set('search', search);
        if (searchFields) params.set('searchFields', searchFields.join(','));
        if (aggregate) params.set('aggregate', JSON.stringify(aggregate));
        if (groupBy) params.set('groupBy', groupBy.join(','));
        if (relConditions) params.set('relConditions', JSON.stringify(relConditions));

        const qs = params.toString();
        const res = await callRoute('GET', `/items/${encodeURIComponent(collection)}${qs ? '?' + qs : ''}`, extra);
        if (!res.ok) return errorResult(res.error || 'Failed to list items');
        return successResult(res.data);
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  server.tool(
    "baasix_get_item",
    `Get a single row/record by its ID from a database table. Optionally include related data from linked tables.

FIELDS — use dot notation to include related data:
- ["*"] → all columns on this table
- ["*", "category.*"] → all columns + all related category columns
- ["name", "category.name", "author.email"] → specific fields from main + related tables
- ["*", "author.profile.*"] → deep nested relations (up to 7 levels)
The primary key is always returned.`,
    {
      collection: z.string().describe("Table/collection name"),
      id: z.string().describe("Row ID (UUID)"),
      fields: z.array(z.string()).optional().describe("Columns to return. Use [\"*\"] for all, dot notation for relations: [\"*\", \"category.*\"]"),
    },
    async (args: GetItemInput, extra: ToolExtra): Promise<ToolResult> => {
      const { collection, id, fields } = args;
      try {
        const params = new URLSearchParams();
        if (fields) params.set('fields', JSON.stringify(fields));
        const qs = params.toString();
        const res = await callRoute('GET', `/items/${encodeURIComponent(collection)}/${encodeURIComponent(id)}${qs ? '?' + qs : ''}`, extra);
        if (!res.ok) return errorResult(res.error || 'Failed to get item');
        return successResult(res.data);
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  server.tool(
    "baasix_create_item",
    `Insert a new row/record into a database table. Use this when asked to 'add data', 'insert a record', or 'create an entry'.

Pass field values as a key-value object. For UUID primary keys with UUIDV4 default, you can omit the id field — it will be auto-generated.
For tables with timestamps: true, createdAt and updatedAt are auto-managed.
For foreign key fields, use the "_Id" suffixed column name (e.g., category_Id, author_Id).

EXAMPLE: collection: "products", data: {"name": "Widget", "price": 9.99, "category_Id": "<uuid>", "inStock": true}`,
    {
      collection: z.string().describe("Table/collection name to insert into"),
      data: z.record(z.any()).describe("Row data as {columnName: value}. FK columns use _Id suffix (e.g., category_Id)."),
    },
    async (args: CreateItemInput, extra: ToolExtra): Promise<ToolResult> => {
      const { collection, data } = args;
      try {
        const res = await callRoute('POST', `/items/${encodeURIComponent(collection)}`, extra, data);
        if (!res.ok) return errorResult(res.error || 'Failed to create item');
        return successResult(res.data);
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  server.tool(
    "baasix_update_item",
    `Update/modify an existing row/record in a database table by its ID. Only pass the fields you want to change — unspecified fields remain unchanged.

For tables with timestamps: true, updatedAt is automatically updated.
For foreign key fields, use the "_Id" suffixed column name (e.g., category_Id).`,
    {
      collection: z.string().describe("Table/collection name"),
      id: z.string().describe("Row ID (UUID) to update"),
      data: z.record(z.any()).describe("Fields to update as {columnName: newValue}. Only changed fields needed."),
    },
    async (args: UpdateItemInput, extra: ToolExtra): Promise<ToolResult> => {
      const { collection, id, data } = args;
      try {
        const res = await callRoute('PATCH', `/items/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`, extra, data);
        if (!res.ok) return errorResult(res.error || 'Failed to update item');
        return successResult(res.data);
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  server.tool(
    "baasix_delete_item",
    "Delete a row/record from a database table by its ID. For tables with paranoid: true (soft delete), the record is marked as deleted (deletedAt is set) rather than permanently removed.",
    {
      collection: z.string().describe("Table/collection name"),
      id: z.string().describe("Row ID (UUID) to delete"),
    },
    async (args: DeleteItemInput, extra: ToolExtra): Promise<ToolResult> => {
      const { collection, id } = args;
      try {
        const res = await callRoute('DELETE', `/items/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`, extra);
        if (!res.ok) return errorResult(res.error || 'Failed to delete item');
        return successResult({ success: true, message: `Item '${id}' deleted` });
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  // ==================== File Management Tools ====================

  server.tool(
    "baasix_list_files",
    `List uploaded files with metadata (filename, size, type, dimensions, storage location).

Filter examples:
By type: {"type": {"startsWith": "image/"}}
By name: {"originalFilename": {"iLike": "%report%"}}
Public files only: {"isPublic": {"eq": true}}`,
    {
      filter: z.record(z.any()).optional().describe("Filter using same operators as baasix_list_items: {\"type\": {\"startsWith\": \"image/\"}}"),
      page: z.number().optional().default(1).describe("Page number"),
      limit: z.number().optional().default(10).describe("Files per page. Use -1 for all."),
    },
    async (args: ListFilesInput, extra: ToolExtra): Promise<ToolResult> => {
      const { filter, page, limit } = args;
      try {
        const params = new URLSearchParams();
        if (page) params.set('page', String(page));
        if (limit) params.set('limit', String(limit));
        if (filter) params.set('filter', JSON.stringify(filter));
        const qs = params.toString();
        const res = await callRoute('GET', `/files${qs ? '?' + qs : ''}`, extra);
        if (!res.ok) return errorResult(res.error || 'Failed to list files');
        return successResult(res.data);
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  server.tool(
    "baasix_get_file_info",
    "Get detailed metadata about a specific uploaded file — filename, size, MIME type, dimensions, storage location, and who uploaded it.",
    {
      id: z.string().describe("File UUID"),
    },
    async (args: FileIdInput, extra: ToolExtra): Promise<ToolResult> => {
      const { id } = args;
      try {
        const res = await callRoute('GET', `/files/${encodeURIComponent(id)}`, extra);
        if (!res.ok) return errorResult(res.error || 'Failed to get file info');
        return successResult(res.data);
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  server.tool(
    "baasix_delete_file",
    "Delete an uploaded file by its UUID. Removes both the file record and the actual file from storage.",
    {
      id: z.string().describe("File UUID"),
    },
    async (args: FileIdInput, extra: ToolExtra): Promise<ToolResult> => {
      const { id } = args;
      try {
        const res = await callRoute('DELETE', `/files/${encodeURIComponent(id)}`, extra);
        if (!res.ok) return errorResult(res.error || 'Failed to delete file');
        return successResult({ success: true, message: `File '${id}' deleted` });
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  // ==================== Permission Tools ====================

  server.tool(
    "baasix_list_roles",
    "List all user roles with their IDs, names, and descriptions. Use this to get role UUIDs needed for permission tools. Default roles: 'administrator' (full access), 'public' (unauthenticated access). Custom roles can be created for granular access control.",
    {},
    async (_args: Record<string, never>, extra: ToolExtra): Promise<ToolResult> => {
      try {
        const res = await callRoute('GET', '/items/baasix_Role?limit=-1', extra);
        if (!res.ok) return errorResult(res.error || 'Failed to list roles');
        return successResult({ data: res.data?.data || res.data });
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  server.tool(
    "baasix_list_permissions",
    `List all access control permission rules with optional filtering.

Each permission defines: role_Id (which role), collection (which table), action (create/read/update/delete), fields (which columns), conditions (row-level security), defaultValues (auto-set values), and relConditions (related table security).

Filter examples:
All permissions for a role: {"role_Id": {"eq": "<role-uuid>"}}
All read permissions: {"action": {"eq": "read"}}
Permissions for a table: {"collection": {"eq": "products"}}`,
    {
      filter: z.record(z.any()).optional().describe("Filter: {\"role_Id\": {\"eq\": \"<uuid>\"}}, {\"collection\": {\"eq\": \"products\"}}, {\"action\": {\"eq\": \"read\"}}"),
      sort: z.string().optional().describe("Sort as 'field:asc' or 'field:desc'"),
      page: z.number().optional().default(1).describe("Page number"),
      limit: z.number().optional().default(10).describe("Permissions per page. Use -1 for all."),
    },
    async (args: ListPermissionsInput, extra: ToolExtra): Promise<ToolResult> => {
      const { filter, sort, page, limit } = args;
      try {
        const params = new URLSearchParams();
        if (page) params.set('page', String(page));
        if (limit) params.set('limit', String(limit));
        if (filter) params.set('filter', JSON.stringify(filter));
        if (sort) {
          const [field, direction] = sort.split(":");
          params.set('sort', JSON.stringify([direction?.toLowerCase() === "desc" ? `-${field}` : field]));
        }
        const qs = params.toString();
        const res = await callRoute('GET', `/permissions${qs ? '?' + qs : ''}`, extra);
        if (!res.ok) return errorResult(res.error || 'Failed to list permissions');
        return successResult(res.data);
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  server.tool(
    "baasix_create_permission",
    `Grant a role permission to perform an action on a table. Use this to set up access control (RBAC + row-level security).

First use baasix_list_roles to get the role UUID, then create permissions for that role.

--- ACTIONS ---
create: allow inserting new rows
read: allow querying/viewing rows
update: allow modifying existing rows
delete: allow deleting rows
Each action needs its own permission rule. A role with no permissions for a table cannot access it at all.

--- FIELDS (column-level access control) ---
["*"] → allow access to ALL columns
["name", "price", "status"] → allow access to ONLY these columns
For read: controls which columns are returned. For create/update: controls which columns can be written.

--- CONDITIONS (row-level security / RLS) ---
Uses the same filter operators as baasix_list_items. These conditions are enforced as security constraints — always ANDed with any user query, cannot be bypassed.
Only published: {"published": {"eq": true}}
Only own records: {"author_Id": {"eq": "$CURRENT_USER"}}
Only own tenant: {"tenant_Id": {"eq": "$CURRENT_USER.tenant_Id"}}
Multiple conditions: {"AND": [{"status": {"in": ["active", "draft"]}}, {"author_Id": {"eq": "$CURRENT_USER"}}]}

DYNAMIC VARIABLES in conditions:
$CURRENT_USER → current user's ID
$CURRENT_USER.fieldName → any field on the user (e.g., $CURRENT_USER.tenant_Id, $CURRENT_USER.department_Id)
$CURRENT_ROLE → current role ID
$NOW, $NOW+DAYS_7, $NOW-MONTHS_1 → timestamp math

--- RELCONDITIONS (row-level security on RELATED tables) ---
Restrict access based on data in related tables. Keys are relation names.
{"category": {"isPublic": {"eq": true}}} → only allow access if the related category is public
{"organization": {"members": {"user_Id": {"eq": "$CURRENT_USER"}}}} → nested relation check
These are merged with any query-level relConditions using AND.

--- DEFAULTVALUES (auto-injected values on create/update) ---
Values automatically set when this role creates or updates records. User-provided values override these.
{"status": "draft"} → new records default to draft status
{"author_Id": "$CURRENT_USER"} → auto-set author to current user
{"tenant_Id": "$CURRENT_USER.tenant_Id"} → auto-set tenant
Supports all dynamic variables.

--- EXAMPLES ---
Allow editors to read all products:
role_Id: "<uuid>", collection: "products", action: "read", fields: ["*"]

Allow users to only read their own posts:
role_Id: "<uuid>", collection: "posts", action: "read", fields: ["*"], conditions: {"author_Id": {"eq": "$CURRENT_USER"}}

Allow users to create posts with auto-set author:
role_Id: "<uuid>", collection: "posts", action: "create", fields: ["title", "content"], defaultValues: {"author_Id": "$CURRENT_USER", "status": "draft"}

Allow users to only update their own posts, only title and content:
role_Id: "<uuid>", collection: "posts", action: "update", fields: ["title", "content"], conditions: {"author_Id": {"eq": "$CURRENT_USER"}}`,
    {
      role_Id: z.string().describe("Role UUID — get this from baasix_list_roles"),
      collection: z.string().describe("Table/collection name this permission applies to"),
      action: z.enum(["create", "read", "update", "delete"]).describe("The CRUD action to allow"),
      fields: z.array(z.string()).optional().describe("Allowed columns: [\"*\"] for all, or [\"name\", \"price\"] for specific. Omit for all."),
      conditions: z.record(z.any()).optional().describe("Row-level security filter (same operators as filter in baasix_list_items). Always enforced."),
      defaultValues: z.record(z.any()).optional().describe("Auto-injected values on create/update: {\"author_Id\": \"$CURRENT_USER\", \"status\": \"draft\"}"),
      relConditions: z.record(z.any()).optional().describe("Row-level security on related tables: {\"category\": {\"isPublic\": {\"eq\": true}}}"),
    },
    async (args: CreatePermissionInput, extra: ToolExtra): Promise<ToolResult> => {
      const { role_Id, collection, action, fields, conditions, defaultValues, relConditions } = args;
      try {
        const data: Record<string, unknown> = { role_Id, collection, action };
        if (fields) data.fields = fields;
        if (conditions) data.conditions = conditions;
        if (defaultValues) data.defaultValues = defaultValues;
        if (relConditions) data.relConditions = relConditions;

        const res = await callRoute('POST', '/permissions', extra, data);
        if (!res.ok) return errorResult(res.error || 'Failed to create permission');
        return successResult(res.data);
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  server.tool(
    "baasix_update_permission",
    `Update an existing permission rule. Only pass the fields you want to change — unspecified fields remain unchanged.

See baasix_create_permission for full documentation of conditions, relConditions, defaultValues, and fields options.
Use baasix_list_permissions or baasix_get_permissions to find the permission ID to update.`,
    {
      id: z.string().describe("Permission UUID — get from baasix_list_permissions or baasix_get_permissions"),
      role_Id: z.string().optional().describe("Change which role this permission applies to"),
      collection: z.string().optional().describe("Change which table this permission applies to"),
      action: z.enum(["create", "read", "update", "delete"]).optional().describe("Change the CRUD action"),
      fields: z.array(z.string()).optional().describe("Change allowed columns: [\"*\"] for all, or specific column names"),
      conditions: z.record(z.any()).optional().describe("Change row-level security conditions (same operators as filter)"),
      defaultValues: z.record(z.any()).optional().describe("Change auto-injected values on create/update"),
      relConditions: z.record(z.any()).optional().describe("Change row-level security on related tables"),
    },
    async (args: UpdatePermissionInput, extra: ToolExtra): Promise<ToolResult> => {
      const { id, ...updateData } = args;
      try {
        const res = await callRoute('PATCH', `/permissions/${encodeURIComponent(id)}`, extra, updateData);
        if (!res.ok) return errorResult(res.error || 'Failed to update permission');
        return successResult(res.data);
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  server.tool(
    "baasix_delete_permission",
    "Delete a permission rule by its UUID. This revokes the access it granted. The permission cache is automatically reloaded.",
    {
      id: z.string().describe("Permission UUID — get from baasix_list_permissions or baasix_get_permissions"),
    },
    async (args: PermissionIdInput, extra: ToolExtra): Promise<ToolResult> => {
      const { id } = args;
      try {
        const res = await callRoute('DELETE', `/permissions/${encodeURIComponent(id)}`, extra);
        if (!res.ok) return errorResult(res.error || 'Failed to delete permission');
        return successResult({ success: true, message: `Permission '${id}' deleted` });
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  server.tool(
    "baasix_reload_permissions",
    "Force-reload the permission cache from the database. Normally not needed as create/update/delete permission tools auto-reload. Use this if permissions seem stale.",
    {},
    async (_args: Record<string, never>, extra: ToolExtra): Promise<ToolResult> => {
      try {
        const res = await callRoute('POST', '/permissions/reload', extra);
        if (!res.ok) return errorResult(res.error || 'Failed to reload permissions');
        return successResult({ success: true, message: "Permissions reloaded" });
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  // ==================== Settings Tools ====================

  server.tool(
    "baasix_get_settings",
    "Get application settings. Pass a key to get a specific setting, or omit to get all settings. Settings include project info, auth config, email config, etc.",
    {
      key: z.string().optional().describe("Specific setting key to retrieve (e.g., 'project_name', 'auth_password_policy'). Omit for all settings."),
    },
    async (args: GetSettingsInput, extra: ToolExtra): Promise<ToolResult> => {
      const { key } = args;
      try {
        const path = key ? `/settings?key=${encodeURIComponent(key)}` : '/settings';
        const res = await callRoute('GET', path, extra);
        if (!res.ok) return errorResult(res.error || 'Failed to get settings');
        return successResult({ data: res.data });
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  server.tool(
    "baasix_update_settings",
    "Update application settings. Pass an object with the settings keys and their new values. Only specified keys are updated.",
    {
      settings: z.record(z.any()).describe("Settings to update as {key: value}. Use baasix_get_settings first to see available keys."),
    },
    async (args: UpdateSettingsInput, extra: ToolExtra): Promise<ToolResult> => {
      const { settings } = args;
      try {
        const res = await callRoute('PATCH', '/settings', extra, settings);
        if (!res.ok) return errorResult(res.error || 'Failed to update settings');
        return successResult({
          success: true,
          message: "Settings updated",
        });
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  // ==================== Email Template Tools ====================

  server.tool(
    "baasix_list_templates",
    "List all email templates (invitation, password reset, welcome, etc.).",
    {
      filter: z.record(z.any()).optional().describe("Filter criteria"),
      page: z.number().optional().default(1).describe("Page number"),
      limit: z.number().optional().default(10).describe("Templates per page"),
    },
    async (args: ListTemplatesInput, extra: ToolExtra): Promise<ToolResult> => {
      const { filter, page, limit } = args;
      try {
        const params = new URLSearchParams();
        if (page) params.set('page', String(page));
        if (limit) params.set('limit', String(limit));
        if (filter) params.set('filter', JSON.stringify(filter));
        const qs = params.toString();
        const res = await callRoute('GET', `/items/baasix_Template${qs ? '?' + qs : ''}`, extra);
        if (!res.ok) return errorResult(res.error || 'Failed to list templates');
        return successResult(res.data);
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  server.tool(
    "baasix_get_template",
    "Get a specific email template by ID",
    {
      id: z.string().describe("Template ID (UUID)"),
    },
    async (args: GetTemplateInput, extra: ToolExtra): Promise<ToolResult> => {
      const { id } = args;
      try {
        const res = await callRoute('GET', `/items/baasix_Template/${encodeURIComponent(id)}`, extra);
        if (!res.ok) return errorResult(res.error || 'Failed to get template');
        return successResult(res.data);
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  server.tool(
    "baasix_update_template",
    `Update an email template's subject, description, or body content.

TEMPLATE TYPES:
- magic_link: Magic link authentication emails
- invite: User invitation emails
- password_reset: Password reset emails
- welcome: Welcome emails
- verification: Email verification emails

AVAILABLE VARIABLES:
- User: {{user.firstName}}, {{user.lastName}}, {{user.fullName}}, {{user.email}}
- Tenant: {{tenant.name}}, {{tenant.logo}}, {{tenant.website}}
- Auth: {{magicLink}}, {{magicCode}}, {{resetPasswordLink}}, {{inviteLink}}`,
    {
      id: z.string().describe("Template ID (UUID)"),
      subject: z.string().optional().describe("Email subject line"),
      description: z.string().optional().describe("Template description"),
      body: z.string().optional().describe("Template body as HTML"),
      isActive: z.boolean().optional().describe("Whether the template is active"),
    },
    async (args: UpdateTemplateInput, extra: ToolExtra): Promise<ToolResult> => {
      const { id, ...updateData } = args;
      try {
        const res = await callRoute('PATCH', `/items/baasix_Template/${encodeURIComponent(id)}`, extra, updateData);
        if (!res.ok) return errorResult(res.error || 'Failed to update template');
        return successResult(res.data);
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  // ==================== Notification Tools ====================

  server.tool(
    "baasix_list_notifications",
    "List in-app notifications for the current authenticated user. Filter by seen/unseen status to find unread notifications.",
    {
      page: z.number().optional().default(1).describe("Page number"),
      limit: z.number().optional().default(10).describe("Notifications per page. Use -1 for all."),
      seen: z.boolean().optional().describe("Filter: true = only seen, false = only unseen, omit = all"),
    },
    async (args: ListNotificationsInput, extra: ToolExtra): Promise<ToolResult> => {
      const { page, limit, seen } = args;
      try {
        const params = new URLSearchParams();
        if (page) params.set('page', String(page));
        if (limit) params.set('limit', String(limit));
        if (seen !== undefined) params.set('seen', String(seen));
        const qs = params.toString();
        const res = await callRoute('GET', `/notifications${qs ? '?' + qs : ''}`, extra);
        if (!res.ok) return errorResult(res.error || 'Failed to list notifications');
        return successResult(res.data);
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  server.tool(
    "baasix_mark_notification_seen",
    "Mark a notification as seen/read by its UUID.",
    {
      id: z.string().describe("Notification UUID"),
    },
    async (args: MarkNotificationSeenInput, extra: ToolExtra): Promise<ToolResult> => {
      const { id } = args;
      try {
        const res = await callRoute('POST', '/notifications/mark-seen', extra, { notificationIds: [id] });
        if (!res.ok) return errorResult(res.error || 'Failed to mark notification as seen');
        return successResult(res.data);
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  // ==================== Utility Tools ====================

  server.tool(
    "baasix_server_info",
    "Get server health, version, uptime, and memory usage.",
    {},
    async (_args: Record<string, never>, _extra: ToolExtra): Promise<ToolResult> => {
      try {
        const info = {
          name: "baasix",
          version: env.get("npm_package_version") || "0.1.0",
          environment: env.get("NODE_ENV") || "development",
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          nodejs: process.version,
          mcp: {
            enabled: true,
            version: "0.1.0",
          },
        };

        return successResult(info);
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  server.tool(
    "baasix_sort_items",
    `Reorder a row within a sortable table — move it before or after another row. The table must have a "sort" field.

MODE:
- "before" (default): Places item directly before the target row
- "after": Places item directly after the target row

EXAMPLE: Move task "abc" before task "xyz":
  collection: "tasks", item: "abc", to: "xyz", mode: "before"`,
    {
      collection: z.string().describe("Table/collection name (must have a sort field)"),
      item: z.string().describe("UUID of the row to move"),
      to: z.string().describe("UUID of the target row to position relative to"),
      mode: z.enum(["before", "after"]).optional().default("before").describe("'before' = place item before target (default), 'after' = place item after target"),
    },
    async (args: SortItemsInput, extra: ToolExtra): Promise<ToolResult> => {
      const { collection, item, to, mode } = args;
      try {
        const { sortItems } = await import("../utils/sortUtils.js");
        const accountability = getAccountability(extra);

        const result = await sortItems({
          collection,
          item,
          to,
          mode: mode || 'before',
          accountability,
        });

        return successResult({
          success: true,
          item: result.item,
          collection: result.collection,
          newSort: result.newSort,
          message: `Item '${item}' moved ${mode || 'before'} '${to}'`,
        });
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  server.tool(
    "baasix_generate_report",
    `Run an aggregate/analytics query on a database table. ALWAYS use this tool (not baasix_list_items) when the user asks for sums, totals, counts, averages, min/max, grouped data, dashboards, reports, or any analytics/summary query.

QUERY OPTIONS:
- fields: Columns to return. Default ["*"]. Use dot notation for relations: ["category.name", "status"].
- filter: Row filter (same operators as baasix_list_items). Applied BEFORE aggregation.
- sort: Sort results, e.g. ["count:desc", "name:asc"].
- limit: Max rows returned. Default -1 (all).
- page: Page number (works with limit).
- aggregate: Aggregation functions. Each key is an alias, value is {function, field}.
    Functions: "count", "sum", "avg", "min", "max"
    Field: column name or "*" for count.
- groupBy: Array of columns to group by. Required when using aggregate.

EXAMPLES:

1. Count orders grouped by status:
   collection: "orders"
   groupBy: ["status"]
   aggregate: {"count": {"function": "count", "field": "*"}}

2. Average price per category, only active products:
   collection: "products"
   groupBy: ["category"]
   aggregate: {"avg_price": {"function": "avg", "field": "price"}, "count": {"function": "count", "field": "*"}}
   filter: {"status": {"eq": "active"}}

3. Total revenue by month (raw data for client-side grouping):
   collection: "orders"
   fields: ["createdAt", "total"]
   filter: {"createdAt": {"gte": "2026-01-01"}}
   sort: ["createdAt:asc"]

4. Sum of amounts per user with relational field:
   collection: "payments"
   groupBy: ["user.name"]
   aggregate: {"total": {"function": "sum", "field": "amount"}}
   fields: ["user.name"]

5. Min/max price:
   collection: "products"
   aggregate: {"min_price": {"function": "min", "field": "price"}, "max_price": {"function": "max", "field": "price"}}`,
    {
      collection: z.string().describe("Table/collection name to report on"),
      fields: z.array(z.string()).optional().describe('Columns to return. Default ["*"]. Use dot notation for relations: ["category.name"].'),
      filter: z.record(z.any()).optional().describe("Row filter applied before aggregation. Same operators as baasix_list_items."),
      sort: z.array(z.string()).optional().describe('Sort results. Format: ["field:direction"]. E.g. ["count:desc", "name:asc"].'),
      limit: z.number().optional().describe("Max rows returned. Default -1 (all). Set to limit grouped results."),
      page: z.number().optional().describe("Page number for pagination (works with limit)."),
      aggregate: z.record(z.object({
        function: z.enum(["count", "sum", "avg", "min", "max"]).describe("Aggregation function"),
        field: z.string().describe('Column to aggregate, or "*" for count'),
      })).optional().describe("Aggregation definitions. Each key is the result alias."),
      groupBy: z.array(z.string()).optional().describe("Columns to group by. Required when using aggregate."),
    },
    async (args: GenerateReportInput, extra: ToolExtra): Promise<ToolResult> => {
      const { collection, fields, filter, sort, limit, page, aggregate, groupBy } = args;
      try {
        const body: Record<string, unknown> = {};
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

        const res = await callRoute('POST', `/reports/${encodeURIComponent(collection)}`, extra, body);
        if (!res.ok) return errorResult(res.error || `Failed to generate report for '${collection}'`);

        return successResult(res.data);
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  // ==================== Collection Stats Tool ====================

  server.tool(
    "baasix_collection_stats",
    `Run multiple aggregate queries across different tables in a single call. Each query uses the full report engine (filter, aggregate, groupBy, etc.).

Each stats entry requires:
- name: A unique label for this stat in the results (e.g. "total_orders", "active_users")
- collection: The table to query
- query: Full report query object with fields, filter, aggregate, groupBy, sort, limit, page

AGGREGATE FUNCTIONS: "count", "sum", "avg", "min", "max"

EXAMPLES:

1. Get total counts for two tables:
   stats: [
     {"name": "total_products", "collection": "products", "query": {"aggregate": {"total": {"function": "count", "field": "*"}}}},
     {"name": "total_orders", "collection": "orders", "query": {"aggregate": {"total": {"function": "count", "field": "*"}}}}
   ]

2. Count active users + total revenue:
   stats: [
     {"name": "active_users", "collection": "users", "query": {"filter": {"status": {"eq": "active"}}, "aggregate": {"count": {"function": "count", "field": "*"}}}},
     {"name": "total_revenue", "collection": "orders", "query": {"aggregate": {"revenue": {"function": "sum", "field": "total"}}}}
   ]

3. Recent signups (last 7 days):
   stats: [
     {"name": "recent_signups", "collection": "users", "query": {"filter": {"createdAt": {"gte": "$NOW-DAYS_7"}}, "aggregate": {"count": {"function": "count", "field": "*"}}}}
   ]`,
    {
      stats: z.array(z.object({
        name: z.string().describe("Unique label for this stat in the results (e.g. 'total_orders')"),
        collection: z.string().describe("Table/collection to query"),
        query: z.record(z.any()).describe("Report query: {fields?, filter?, sort?, limit?, page?, aggregate?, groupBy?}. See baasix_generate_report for full options."),
      })).describe("Array of stat queries to run across tables"),
    },
    async (args: CollectionStatsInput, extra: ToolExtra): Promise<ToolResult> => {
      const { stats } = args;
      try {
        const res = await callRoute('POST', '/reports/stats', extra, { stats });
        if (!res.ok) return errorResult(res.error || 'Failed to generate stats');

        return successResult(res.data);
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  // ==================== Send Notification Tool ====================

  server.tool(
    "baasix_send_notification",
    "Send an in-app notification to one or more users by their user UUIDs. Notifications appear in the user's notification list and can be marked as seen.",
    {
      recipients: z.array(z.string()).describe("Array of user UUIDs to notify"),
      title: z.string().describe("Notification title"),
      message: z.string().describe("Notification message body"),
      type: z.string().optional().default("info").describe("Notification type: 'info', 'warning', 'error', 'success'"),
    },
    async (args: SendNotificationInput, extra: ToolExtra): Promise<ToolResult> => {
      const { recipients, title, message, type } = args;
      try {
        const res = await callRoute('POST', '/notifications/send', extra, {
          type: type || "info",
          title,
          message,
          userIds: recipients,
        });
        if (!res.ok) return errorResult(res.error || 'Failed to send notifications');

        return successResult({
          success: true,
          sent: recipients.length,
          notificationIds: res.data?.notificationIds || res.data,
        });
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  // ==================== Get Permission Tool ====================

  server.tool(
    "baasix_get_permission",
    "Get a specific permission rule by its UUID. Returns the full permission object including role_Id, collection, action, fields, conditions, defaultValues, and relConditions.",
    {
      id: z.string().describe("Permission UUID"),
    },
    async (args: PermissionIdInput, extra: ToolExtra): Promise<ToolResult> => {
      const { id } = args;
      try {
        const res = await callRoute('GET', `/permissions/${encodeURIComponent(id)}`, extra);
        if (!res.ok) return errorResult(res.error || `Permission '${id}' not found`);

        return successResult(res.data?.data || res.data);
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  // ==================== Get Permissions for Role Tool ====================

  server.tool(
    "baasix_get_permissions",
    `Get all permission rules assigned to a specific role. Shows which tables the role can access and what actions (create/read/update/delete) are allowed, including any row-level security conditions, field restrictions, default values, and relationship conditions.

Accepts either the role name (e.g., "editor", "public") or the role UUID.`,
    {
      role: z.string().describe("Role name (e.g., 'editor', 'public') or role UUID"),
    },
    async (args: GetPermissionsInput, extra: ToolExtra): Promise<ToolResult> => {
      const { role } = args;
      try {
        // Find role by name or id
        const roleParams = new URLSearchParams();
        roleParams.append('filter', JSON.stringify({ OR: [{ name: { eq: role } }, { id: { eq: role } }] }));
        roleParams.append('limit', '1');

        const rolesRes = await callRoute('GET', `/items/baasix_Role?${roleParams}`, extra);
        if (!rolesRes.ok) return errorResult(rolesRes.error || `Failed to look up role '${role}'`);

        const rolesData = rolesRes.data?.data || rolesRes.data;
        if (!Array.isArray(rolesData) || !rolesData.length) {
          return errorResult(`Role '${role}' not found`);
        }

        const roleId = rolesData[0].id;

        // Get permissions for this role
        const permParams = new URLSearchParams();
        permParams.append('filter', JSON.stringify({ role_Id: { eq: roleId } }));
        permParams.append('limit', '-1');

        const permRes = await callRoute('GET', `/permissions?${permParams}`, extra);
        if (!permRes.ok) return errorResult(permRes.error || 'Failed to get permissions');

        const permData = permRes.data?.data || permRes.data;

        return successResult({
          role: rolesData[0],
          permissions: Array.isArray(permData) ? permData : [],
          totalCount: Array.isArray(permData) ? permData.length : 0,
        });
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  // ==================== Update Permissions for Role Tool ====================

  server.tool(
    "baasix_update_permissions",
    `Bulk set/update access control permissions for a role — define which tables a role can create, read, update, or delete. Creates new permissions or updates existing ones. Automatically reloads the permission cache.

Accepts role name (e.g., "editor") or role UUID. Each permission in the array specifies a table + action combination.
If a permission for that role+table+action already exists, it is updated. Otherwise, a new one is created.
Fields default to ["*"] (all columns) if omitted.

EXAMPLE — Give "editor" full CRUD on products, read-only on categories:
role: "editor"
permissions: [
  {"collection": "products", "action": "create", "fields": ["*"]},
  {"collection": "products", "action": "read", "fields": ["*"]},
  {"collection": "products", "action": "update", "fields": ["name", "price"]},
  {"collection": "products", "action": "delete"},
  {"collection": "categories", "action": "read", "fields": ["*"]}
]

With row-level security:
permissions: [{"collection": "posts", "action": "read", "conditions": {"author_Id": {"eq": "$CURRENT_USER"}}}]`,
    {
      role: z.string().describe("Role name (e.g., 'editor', 'public') or role UUID"),
      permissions: z
        .array(
          z.object({
            collection: z.string().describe("Table/collection name"),
            action: z.enum(["create", "read", "update", "delete"]).describe("CRUD action to allow"),
            fields: z.array(z.string()).optional().describe("Allowed columns: [\"*\"] for all, or specific names. Defaults to [\"*\"]."),
            conditions: z.record(z.any()).optional().describe("Row-level security conditions (same operators as filter). Supports $CURRENT_USER, $NOW."),
          })
        )
        .describe("Array of permission rules to create or update for this role"),
    },
    async (args: UpdatePermissionsInput, extra: ToolExtra): Promise<ToolResult> => {
      const { role, permissions } = args;
      try {
        // Find role
        const roleParams = new URLSearchParams();
        roleParams.append('filter', JSON.stringify({ OR: [{ name: { eq: role } }, { id: { eq: role } }] }));
        roleParams.append('limit', '1');

        const rolesRes = await callRoute('GET', `/items/baasix_Role?${roleParams}`, extra);
        if (!rolesRes.ok) return errorResult(rolesRes.error || `Failed to look up role '${role}'`);

        const rolesData = rolesRes.data?.data || rolesRes.data;
        if (!Array.isArray(rolesData) || !rolesData.length) {
          return errorResult(`Role '${role}' not found`);
        }

        const roleData = rolesData[0] as { id: string; name: string };
        const roleId = roleData.id;

        // Create/update permissions
        const results = await Promise.all(
          permissions.map(async (perm) => {
            // Check if permission exists for this role+collection+action
            const existParams = new URLSearchParams();
            existParams.append('filter', JSON.stringify({
              AND: [{ role_Id: { eq: roleId } }, { collection: { eq: perm.collection } }, { action: { eq: perm.action } }],
            }));
            existParams.append('limit', '1');

            const existRes = await callRoute('GET', `/permissions?${existParams}`, extra);
            const existData = existRes.data?.data || existRes.data;

            if (Array.isArray(existData) && existData.length) {
              // Update existing via PATCH /permissions/:id (route reloads cache)
              return callRoute('PATCH', `/permissions/${encodeURIComponent(existData[0].id)}`, extra, {
                fields: perm.fields || ["*"],
                conditions: perm.conditions || {},
              });
            } else {
              // Create new via POST /permissions (route reloads cache)
              return callRoute('POST', '/permissions', extra, {
                role_Id: roleId,
                collection: perm.collection,
                action: perm.action,
                fields: perm.fields || ["*"],
                conditions: perm.conditions || {},
              });
            }
          })
        );

        // Reload permissions cache explicitly
        await callRoute('POST', '/permissions/reload', extra);

        return successResult({
          success: true,
          role: roleData.name,
          updated: results.length,
        });
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  // ==================== Auth Tools ====================

  server.tool(
    "baasix_get_current_user",
    `Get the currently authenticated user's profile, role, and permissions.

Use fields to include related data:
- ["*"] → all user fields
- ["*", "role.*"] → user fields + full role object
- ["email", "firstName", "role.name"] → specific fields

Returns authenticated: false if no user is logged in (public/anonymous access).`,
    {
      fields: z.array(z.string()).optional().describe("Fields to return. Default: [\"*\", \"role.*\"]. Use dot notation for relations."),
    },
    async (args: GetCurrentUserInput, extra: ToolExtra): Promise<ToolResult> => {
      const { fields } = args;
      try {
        const accountability = getAccountability(extra);

        if (!accountability.user) {
          return successResult({
            authenticated: false,
            role: accountability.role,
            admin: false,
          });
        }

        // Call /auth/me which returns user, role, permissions, tenant
        const res = await callRoute('GET', '/auth/me', extra);
        if (!res.ok) {
          // If 401, user is not authenticated
          return successResult({
            authenticated: false,
            role: accountability.role,
            admin: false,
          });
        }

        return successResult({
          authenticated: true,
          user: res.data?.user || res.data,
          role: res.data?.role || accountability.role,
          admin: accountability.user?.isAdmin || false,
        });
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  server.tool(
    "baasix_register_user",
    "Register a new user",
    {
      email: z.string().email().describe("User email address"),
      password: z.string().describe("User password"),
      firstName: z.string().optional().describe("User first name"),
      lastName: z.string().optional().describe("User last name"),
      roleName: z.string().optional().describe("Role name to assign"),
    },
    async (args: RegisterUserInput, _extra: ToolExtra): Promise<ToolResult> => {
      const { email, password, firstName, lastName, roleName } = args;
      try {
        const { default: axios } = await import("axios");
        const baseUrl = `http://localhost:${env.get("PORT") || "8056"}`;

        const response = await axios.post(`${baseUrl}/auth/register`, {
          email,
          password,
          firstName,
          lastName,
          roleName,
        });

        return successResult(response.data);
      } catch (error: unknown) {
        const axiosError = error as { response?: { data?: { message?: string } }; message?: string };
        return errorResult(axiosError.response?.data?.message || axiosError.message || "Unknown error");
      }
    }
  );

  server.tool(
    "baasix_send_invite",
    "Send an invitation to a user",
    {
      email: z.string().email().describe("Email address to invite"),
      role_Id: z.string().describe("Role ID to assign"),
      tenant_Id: z.string().optional().describe("Tenant ID"),
      link: z.string().url().describe("Application URL for the invitation link"),
    },
    async (args: SendInviteInput, _extra: ToolExtra): Promise<ToolResult> => {
      const { email, role_Id, tenant_Id, link } = args;
      try {
        const { default: axios } = await import("axios");
        const baseUrl = `http://localhost:${env.get("PORT") || "8056"}`;

        const response = await axios.post(`${baseUrl}/auth/invite`, {
          email,
          role_Id,
          tenant_Id,
          link,
        });

        return successResult(response.data);
      } catch (error: unknown) {
        const axiosError = error as { response?: { data?: { message?: string } }; message?: string };
        return errorResult(axiosError.response?.data?.message || axiosError.message || "Unknown error");
      }
    }
  );

  server.tool(
    "baasix_verify_invite",
    "Verify an invitation token",
    {
      token: z.string().describe("Invitation token"),
      link: z.string().url().optional().describe("Application URL to validate"),
    },
    async (args: VerifyInviteInput, _extra: ToolExtra): Promise<ToolResult> => {
      const { token, link } = args;
      try {
        const { default: axios } = await import("axios");
        const baseUrl = `http://localhost:${env.get("PORT") || "8056"}`;

        const params = new URLSearchParams();
        if (link) params.append("link", link);

        const response = await axios.get(`${baseUrl}/auth/verify-invite/${token}?${params}`);

        return successResult(response.data);
      } catch (error: unknown) {
        const axiosError = error as { response?: { data?: { message?: string } }; message?: string };
        return errorResult(axiosError.response?.data?.message || axiosError.message || "Unknown error");
      }
    }
  );

  server.tool(
    "baasix_send_magic_link",
    "Send magic link or code for authentication",
    {
      email: z.string().email().describe("User email address"),
      link: z.string().url().optional().describe("Application URL for magic link"),
      mode: z.enum(["link", "code"]).optional().default("link").describe("Magic authentication mode"),
    },
    async (args: SendMagicLinkInput, _extra: ToolExtra): Promise<ToolResult> => {
      const { email, link, mode } = args;
      try {
        const { default: axios } = await import("axios");
        const baseUrl = `http://localhost:${env.get("PORT") || "8056"}`;

        const response = await axios.post(`${baseUrl}/auth/magiclink`, {
          email,
          link,
          mode,
        });

        return successResult(response.data);
      } catch (error: unknown) {
        const axiosError = error as { response?: { data?: { message?: string } }; message?: string };
        return errorResult(axiosError.response?.data?.message || axiosError.message || "Unknown error");
      }
    }
  );

  server.tool(
    "baasix_get_user_tenants",
    "Get available tenants for the current user",
    {},
    async (_args: Record<string, never>, _extra: ToolExtra): Promise<ToolResult> => {
      try {
        const { default: axios } = await import("axios");
        const baseUrl = `http://localhost:${env.get("PORT") || "8056"}`;

        const response = await axios.get(`${baseUrl}/auth/tenants`);

        return successResult(response.data);
      } catch (error: unknown) {
        const axiosError = error as { response?: { data?: { message?: string } }; message?: string };
        return errorResult(axiosError.response?.data?.message || axiosError.message || "Unknown error");
      }
    }
  );

  server.tool(
    "baasix_switch_tenant",
    "Switch to a different tenant context",
    {
      tenant_Id: z.string().describe("Tenant ID to switch to"),
    },
    async (args: SwitchTenantInput, _extra: ToolExtra): Promise<ToolResult> => {
      const { tenant_Id } = args;
      try {
        const { default: axios } = await import("axios");
        const baseUrl = `http://localhost:${env.get("PORT") || "8056"}`;

        const response = await axios.post(`${baseUrl}/auth/switch-tenant`, {
          tenant_Id,
        });

        return successResult(response.data);
      } catch (error: unknown) {
        const axiosError = error as { response?: { data?: { message?: string } }; message?: string };
        return errorResult(axiosError.response?.data?.message || axiosError.message || "Unknown error");
      }
    }
  );

  // ==================== Auth Status & Session Tools ====================

  server.tool(
    "baasix_auth_status",
    "Check if the current MCP session is authenticated, and show the current user, role, and admin status.",
    {},
    async (_args: Record<string, never>, extra: ToolExtra): Promise<ToolResult> => {
      try {
        const accountability = getAccountability(extra);

        return successResult({
          authenticated: !!accountability.user,
          userId: accountability.user?.id || null,
          role: accountability.role,
          admin: accountability.user?.isAdmin || false,
          sessionId: extra.sessionId || null,
        });
      } catch (error) {
        return errorResult(error as Error);
      }
    }
  );

  server.tool(
    "baasix_login",
    "Authenticate with email and password to get admin or role-based access. Required before performing write operations if not already authenticated via headers.",
    {
      email: z.string().email().describe("User email address"),
      password: z.string().describe("User password"),
    },
    async (args: LoginInput, extra: ToolExtra): Promise<ToolResult> => {
      const { email, password } = args;
      try {
        const { default: axios } = await import("axios");
        const baseUrl = `http://localhost:${env.get("PORT") || "8056"}`;

        const response = await axios.post(`${baseUrl}/auth/login`, { email, password });
        const data = response.data;

        if (!data || !data.user) {
          return errorResult("Login failed: invalid credentials");
        }

        // Build accountability from login response and store in session
        const isAdmin = data.role?.name === "administrator";
        const accountability: MCPAccountability = {
          user: {
            id: data.user.id,
            email: data.user.email,
            firstName: data.user.firstName,
            lastName: data.user.lastName,
            isAdmin,
            role: data.role?.name || "public",
          },
          role: data.role ? {
            id: data.role.id,
            name: data.role.name,
            isTenantSpecific: data.role.isTenantSpecific,
          } : null,
          permissions: data.permissions || [],
          tenant: data.tenant?.id || null,
          ipaddress: "127.0.0.1",
          token: data.token,
        };

        // Update the MCP session with the new accountability
        if (extra.sessionId) {
          setMCPSession(extra.sessionId, accountability);
        }

        return successResult({
          token: data.token,
          user: data.user,
          role: data.role,
          message: "Login successful. Session accountability updated.",
        });
      } catch (error: unknown) {
        const axiosError = error as { response?: { data?: { message?: string } }; message?: string };
        return errorResult(axiosError.response?.data?.message || axiosError.message || "Login failed");
      }
    }
  );

  server.tool(
    "baasix_logout",
    "Logout and invalidate current session",
    {},
    async (_args: Record<string, never>, extra: ToolExtra): Promise<ToolResult> => {
      try {
        // Remove MCP session if exists
        if (extra.sessionId) {
          removeMCPSession(extra.sessionId);
        }

        return successResult({ success: true, message: "Logged out successfully. Session cleared." });
      } catch (error: unknown) {
        const err = error as Error;
        return errorResult(err.message || "Logout failed");
      }
    }
  );

  server.tool(
    "baasix_refresh_auth",
    "Refresh authentication token",
    {
      refreshToken: z.string().optional().describe("Refresh token (if not using cookies)"),
    },
    async (_args: RefreshAuthInput, extra: ToolExtra): Promise<ToolResult> => {
      try {
        // In MCP context, the session is already maintained via session IDs.
        // Refresh is not needed since accountability is stored per-session.
        const accountability = getAccountability(extra);
        return successResult({
          authenticated: !!accountability.user,
          userId: accountability.user?.id || null,
          role: accountability.role,
          message: "MCP sessions are managed internally. Use baasix_login to re-authenticate if needed.",
        });
      } catch (error: unknown) {
        const err = error as Error;
        return errorResult(err.message || "Refresh failed");
      }
    }
  );

  // ==================== Update Relationship Tool ====================

  server.tool(
    "baasix_update_relationship",
    "Modify an existing foreign key / relationship between two database tables (change delete behavior, alias, etc.).",
    {
      sourceCollection: z.string().describe("Source collection name"),
      relationshipName: z.string().describe("Relationship field name to update"),
      relationshipData: z
        .object({
          alias: z.string().optional().describe("Alias for reverse relationship"),
          onDelete: z.enum(["CASCADE", "RESTRICT", "SET NULL"]).optional().describe("Delete behavior"),
          onUpdate: z.enum(["CASCADE", "RESTRICT", "SET NULL"]).optional().describe("Update behavior"),
          description: z.string().optional().describe("Relationship description"),
        })
        .describe("Updated relationship configuration"),
    },
    async (args: UpdateRelationshipInput, extra: ToolExtra): Promise<ToolResult> => {
      const { sourceCollection, relationshipName, relationshipData } = args;
      const res = await callRoute(
        'PATCH',
        `/schemas/${encodeURIComponent(sourceCollection)}/relationships/${encodeURIComponent(relationshipName)}`,
        extra,
        relationshipData
      );
      if (!res.ok) return errorResult(res.error || `Failed to update relationship '${relationshipName}' on '${sourceCollection}'`);
      return successResult({
        success: true,
        collection: sourceCollection,
        relationship: res.data,
      });
    }
  );

  return server;
}

export default { createMCPServer, setMCPSession, removeMCPSession };
