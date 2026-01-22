/**
 * MCPService - Model Context Protocol Server for Baasix
 * 
 * This service provides MCP tools that directly call Baasix services,
 * eliminating HTTP round-trips and providing better performance.
 * 
 * Enable via environment variable: MCP_ENABLED=true
 * Access at: http://localhost:8056/mcp (or custom MCP_PATH)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { schemaManager } from "../utils/schemaManager.js";
import { ItemsService } from "./ItemsService.js";
import permissionService from "./PermissionService.js";
import realtimeService from "./RealtimeService.js";
import settingsService from "./SettingsService.js";
import env from "../utils/env.js";

// Authentication state for MCP requests
interface MCPAccountability {
  user: string | null;
  role: string | null;
  admin: boolean;
  ip: string;
}

/**
 * Create and configure the MCP server with all Baasix tools
 */
export function createMCPServer() {
  const server = new McpServer({
    name: "baasix-mcp-server",
    version: "0.1.0",
  });

  // ==================== Schema Management Tools ====================

  server.tool(
    "baasix_list_schemas",
    "Get all available collections/schemas in Baasix with optional search and pagination",
    {
      search: z.string().optional().describe("Search term to filter schemas by collection name"),
      page: z.number().optional().default(1).describe("Page number for pagination"),
      limit: z.number().optional().default(10).describe("Number of schemas per page"),
      sort: z.string().optional().default("collectionName:asc").describe("Sort field and direction"),
    },
    async ({ search, page, limit, sort }, _extra) => {
      const accountability = extra.sessionId ? getAccountabilityFromSession(extra.sessionId) : getDefaultAccountability();
      
      const schemaService = new ItemsService('baasix_SchemaDefinition', { accountability });
      
      const query: any = {
        fields: ['collectionName', 'schema'],
        page,
        limit,
      };

      if (sort && sort.includes(':')) {
        const [field, direction] = sort.split(':');
        query.sort = [direction?.toLowerCase() === 'desc' ? `-${field}` : field];
      }

      if (search) {
        query.search = search;
        query.searchFields = ['collectionName'];
      }

      const result = await schemaService.readByQuery(query, true);
      
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            data: result.data,
            totalCount: result.totalCount,
            page,
            limit
          }, null, 2)
        }]
      };
    }
  );

  server.tool(
    "baasix_get_schema",
    "Get detailed schema information for a specific collection",
    {
      collection: z.string().describe("Collection name"),
    },
    async ({ collection }, _extra) => {
      const schemaDef = schemaManager.getSchemaDefinition(collection);
      
      if (!schemaDef) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: `Schema '${collection}' not found` }, null, 2)
          }],
          isError: true
        };
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            collectionName: collection,
            schema: schemaDef
          }, null, 2)
        }]
      };
    }
  );

  server.tool(
    "baasix_create_schema",
    `Create a new collection schema in Baasix.

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
- Enum: values.values array

DEFAULT VALUE TYPES:
- { type: "UUIDV4" } - Random UUID v4
- { type: "SUID" } - Short unique ID
- { type: "NOW" } - Current timestamp
- { type: "AUTOINCREMENT" } - Auto-incrementing integer
- { type: "SQL", value: "..." } - Custom SQL expression`,
    {
      collection: z.string().describe("Collection name"),
      schema: z.object({
        fields: z.record(z.any()).describe("Field definitions"),
      }).passthrough().describe("Schema definition"),
    },
    async ({ collection, schema }, _extra) => {
      try {
        await schemaManager.createCollection(collection, schema);
        
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              message: `Collection '${collection}' created successfully`,
              collectionName: collection
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "baasix_update_schema",
    "Update an existing collection schema (add/modify/remove fields)",
    {
      collection: z.string().describe("Collection name"),
      schema: z.object({
        fields: z.record(z.any()).optional().describe("Updated field definitions"),
      }).passthrough().describe("Schema updates"),
    },
    async ({ collection, schema }, _extra) => {
      try {
        await schemaManager.updateCollection(collection, schema);
        
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              message: `Collection '${collection}' updated successfully`
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "baasix_delete_schema",
    "Delete a collection and all its data",
    {
      collection: z.string().describe("Collection name to delete"),
    },
    async ({ collection }, _extra) => {
      try {
        await schemaManager.deleteCollection(collection);
        
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              message: `Collection '${collection}' deleted successfully`
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "baasix_add_index",
    "Add an index to a collection for better query performance",
    {
      collection: z.string().describe("Collection name"),
      indexDefinition: z.object({
        name: z.string().optional().describe("Index name (auto-generated if not provided)"),
        fields: z.array(z.string()).describe("Fields to index"),
        unique: z.boolean().optional().describe("Whether the index should be unique"),
        type: z.enum(["btree", "hash", "gin", "gist"]).optional().describe("Index type"),
      }).describe("Index definition"),
    },
    async ({ collection, indexDefinition }, _extra) => {
      try {
        await schemaManager.addIndex(collection, indexDefinition);
        
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              message: `Index added to '${collection}' successfully`
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "baasix_remove_index",
    "Remove an index from a collection",
    {
      collection: z.string().describe("Collection name"),
      indexName: z.string().describe("Name of the index to remove"),
    },
    async ({ collection, indexName }, _extra) => {
      try {
        await schemaManager.removeIndex(collection, indexName);
        
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              message: `Index '${indexName}' removed from '${collection}'`
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "baasix_create_relationship",
    `Create a relationship between collections.

RELATIONSHIP TYPES:
- M2O (Many-to-One): Creates foreign key with auto-index. products.category → categories
- O2M (One-to-Many): Virtual reverse of M2O. categories.products → products
- O2O (One-to-One): Creates foreign key with auto-index. user.profile → profiles
- M2M (Many-to-Many): Creates junction table with auto-indexed FKs. products ↔ tags
- M2A (Many-to-Any): Polymorphic junction table. comments → posts OR products

EXAMPLE M2O:
{
  "name": "category",
  "type": "M2O",
  "target": "categories",
  "alias": "products",
  "onDelete": "CASCADE"
}`,
    {
      sourceCollection: z.string().describe("Source collection name"),
      relationshipData: z.object({
        name: z.string().describe("Relationship field name"),
        type: z.enum(["M2O", "O2M", "O2O", "M2M", "M2A"]).describe("Relationship type"),
        target: z.string().optional().describe("Target collection name"),
        alias: z.string().optional().describe("Alias for reverse relationship"),
        onDelete: z.enum(["CASCADE", "RESTRICT", "SET NULL"]).optional().describe("Delete behavior"),
        onUpdate: z.enum(["CASCADE", "RESTRICT", "SET NULL"]).optional().describe("Update behavior"),
        tables: z.array(z.string()).optional().describe("Target tables for M2A relationships"),
        through: z.string().optional().describe("Custom junction table name for M2M/M2A"),
      }).describe("Relationship configuration"),
    },
    async ({ sourceCollection, relationshipData }, _extra) => {
      try {
        await schemaManager.addRelationship(sourceCollection, relationshipData);
        
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              message: `Relationship '${relationshipData.name}' created on '${sourceCollection}'`
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "baasix_delete_relationship",
    "Delete a relationship from a collection",
    {
      sourceCollection: z.string().describe("Source collection name"),
      fieldName: z.string().describe("Relationship field name"),
    },
    async ({ sourceCollection, fieldName }, _extra) => {
      try {
        await schemaManager.removeRelationship(sourceCollection, fieldName);
        
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              message: `Relationship '${fieldName}' removed from '${sourceCollection}'`
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "baasix_export_schemas",
    "Export all schemas as JSON for backup or migration",
    {},
    async (_, _extra) => {
      try {
        const schemas = schemaManager.exportSchemas();
        
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(schemas, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "baasix_import_schemas",
    "Import schemas from JSON data",
    {
      schemas: z.record(z.any()).describe("Schema data to import"),
    },
    async ({ schemas }, _extra) => {
      try {
        await schemaManager.importSchemas(schemas);
        
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              message: "Schemas imported successfully"
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  // ==================== Item Management Tools ====================

  server.tool(
    "baasix_list_items",
    `Query items from a collection with powerful filtering, sorting, pagination, relations, and aggregation.

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
- {"tags": {"arraycontains": ["featured"]}}`,
    {
      collection: z.string().describe("Collection name"),
      filter: z.record(z.any()).optional().describe("Filter criteria"),
      fields: z.array(z.string()).optional().describe("Fields to return"),
      sort: z.string().optional().describe("Sort field and direction (e.g., 'createdAt:desc')"),
      page: z.number().optional().default(1).describe("Page number"),
      limit: z.number().optional().default(10).describe("Items per page (-1 for all)"),
      search: z.string().optional().describe("Full-text search query"),
      searchFields: z.array(z.string()).optional().describe("Fields to search in"),
      aggregate: z.record(z.any()).optional().describe("Aggregation functions"),
      groupBy: z.array(z.string()).optional().describe("Fields to group by"),
      relConditions: z.record(z.any()).optional().describe("Filter conditions for related records"),
    },
    async ({ collection, filter, fields, sort, page, limit, search, searchFields, aggregate, groupBy, relConditions }, _extra) => {
      try {
        const accountability = extra.sessionId ? getAccountabilityFromSession(extra.sessionId) : getDefaultAccountability();
        const itemsService = new ItemsService(collection, { accountability });

        const query: any = { page, limit };
        
        if (filter) query.filter = filter;
        if (fields) query.fields = fields;
        if (sort) {
          const [field, direction] = sort.split(':');
          query.sort = [direction?.toLowerCase() === 'desc' ? `-${field}` : field];
        }
        if (search) query.search = search;
        if (searchFields) query.searchFields = searchFields;
        if (aggregate) query.aggregate = aggregate;
        if (groupBy) query.groupBy = groupBy;
        if (relConditions) query.relConditions = relConditions;

        const result = await itemsService.readByQuery(query);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              data: result.data,
              totalCount: result.totalCount,
              page,
              limit
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "baasix_get_item",
    "Get a specific item by ID from a collection, optionally including related data",
    {
      collection: z.string().describe("Collection name"),
      id: z.string().describe("Item ID (UUID)"),
      fields: z.array(z.string()).optional().describe("Fields to return"),
    },
    async ({ collection, id, fields }, _extra) => {
      try {
        const accountability = extra.sessionId ? getAccountabilityFromSession(extra.sessionId) : getDefaultAccountability();
        const itemsService = new ItemsService(collection, { accountability });

        const query: any = {};
        if (fields) query.fields = fields;

        const result = await itemsService.readOne(id, query);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ data: result }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "baasix_create_item",
    "Create a new item in a collection",
    {
      collection: z.string().describe("Collection name"),
      data: z.record(z.any()).describe("Item data"),
    },
    async ({ collection, data }, _extra) => {
      try {
        const accountability = extra.sessionId ? getAccountabilityFromSession(extra.sessionId) : getDefaultAccountability();
        const itemsService = new ItemsService(collection, { accountability });

        const result = await itemsService.createOne(data);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ data: result }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "baasix_update_item",
    "Update an existing item in a collection",
    {
      collection: z.string().describe("Collection name"),
      id: z.string().describe("Item ID"),
      data: z.record(z.any()).describe("Updated item data"),
    },
    async ({ collection, id, data }, _extra) => {
      try {
        const accountability = extra.sessionId ? getAccountabilityFromSession(extra.sessionId) : getDefaultAccountability();
        const itemsService = new ItemsService(collection, { accountability });

        const result = await itemsService.updateOne(id, data);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ data: result }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "baasix_delete_item",
    "Delete an item from a collection",
    {
      collection: z.string().describe("Collection name"),
      id: z.string().describe("Item ID"),
    },
    async ({ collection, id }, _extra) => {
      try {
        const accountability = extra.sessionId ? getAccountabilityFromSession(extra.sessionId) : getDefaultAccountability();
        const itemsService = new ItemsService(collection, { accountability });

        await itemsService.deleteOne(id);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ success: true, message: `Item '${id}' deleted` }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  // ==================== File Management Tools ====================

  server.tool(
    "baasix_list_files",
    "List files with metadata and optional filtering",
    {
      filter: z.record(z.any()).optional().describe("Filter criteria"),
      page: z.number().optional().default(1).describe("Page number"),
      limit: z.number().optional().default(10).describe("Files per page"),
    },
    async ({ filter, page, limit }, _extra) => {
      try {
        const accountability = extra.sessionId ? getAccountabilityFromSession(extra.sessionId) : getDefaultAccountability();
        const filesService = new ItemsService('baasix_File', { accountability });

        const query: any = { page, limit };
        if (filter) query.filter = filter;

        const result = await filesService.readByQuery(query);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              data: result.data,
              totalCount: result.totalCount,
              page,
              limit
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "baasix_get_file_info",
    "Get detailed information about a specific file",
    {
      id: z.string().describe("File ID"),
    },
    async ({ id }, _extra) => {
      try {
        const accountability = extra.sessionId ? getAccountabilityFromSession(extra.sessionId) : getDefaultAccountability();
        const filesService = new ItemsService('baasix_File', { accountability });

        const result = await filesService.readOne(id);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ data: result }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "baasix_delete_file",
    "Delete a file",
    {
      id: z.string().describe("File ID"),
    },
    async ({ id }, _extra) => {
      try {
        const accountability = extra.sessionId ? getAccountabilityFromSession(extra.sessionId) : getDefaultAccountability();
        const filesService = new ItemsService('baasix_File', { accountability });

        await filesService.deleteOne(id);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ success: true, message: `File '${id}' deleted` }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  // ==================== Permission Tools ====================

  server.tool(
    "baasix_list_roles",
    "List all available roles",
    {},
    async (_, _extra) => {
      try {
        const accountability = extra.sessionId ? getAccountabilityFromSession(extra.sessionId) : getDefaultAccountability();
        const rolesService = new ItemsService('baasix_Role', { accountability });

        const result = await rolesService.readByQuery({ limit: -1 }, true);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ data: result.data }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "baasix_list_permissions",
    "List all permissions with optional filtering",
    {
      filter: z.record(z.any()).optional().describe("Filter criteria"),
      sort: z.string().optional().describe("Sort field and direction"),
      page: z.number().optional().default(1).describe("Page number"),
      limit: z.number().optional().default(10).describe("Permissions per page"),
    },
    async ({ filter, sort, page, limit }, _extra) => {
      try {
        const accountability = extra.sessionId ? getAccountabilityFromSession(extra.sessionId) : getDefaultAccountability();
        const permService = new ItemsService('baasix_Permission', { accountability });

        const query: any = { page, limit };
        if (filter) query.filter = filter;
        if (sort) {
          const [field, direction] = sort.split(':');
          query.sort = [direction?.toLowerCase() === 'desc' ? `-${field}` : field];
        }

        const result = await permService.readByQuery(query, true);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              data: result.data,
              totalCount: result.totalCount,
              page,
              limit
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "baasix_create_permission",
    `Create a new permission for role-based access control.

ACTIONS: create, read, update, delete

FIELDS:
- ["*"] for all fields
- ["name", "price"] for specific fields

CONDITIONS (Row-level security):
- Uses same filter operators as queries
- {"published": {"eq": true}} - only published records
- {"author_Id": {"eq": "$CURRENT_USER"}} - only own records`,
    {
      role_Id: z.string().describe("Role ID (UUID)"),
      collection: z.string().describe("Collection name"),
      action: z.enum(["create", "read", "update", "delete"]).describe("Permission action"),
      fields: z.array(z.string()).optional().describe("Allowed fields"),
      conditions: z.record(z.any()).optional().describe("Row-level security conditions"),
      defaultValues: z.record(z.any()).optional().describe("Default values for creation"),
      relConditions: z.record(z.any()).optional().describe("Relationship conditions"),
    },
    async ({ role_Id, collection, action, fields, conditions, defaultValues, relConditions }, _extra) => {
      try {
        const accountability = extra.sessionId ? getAccountabilityFromSession(extra.sessionId) : getDefaultAccountability();
        const permService = new ItemsService('baasix_Permission', { accountability });

        const data: any = { role_Id, collection, action };
        if (fields) data.fields = fields;
        if (conditions) data.conditions = conditions;
        if (defaultValues) data.defaultValues = defaultValues;
        if (relConditions) data.relConditions = relConditions;

        const result = await permService.createOne(data);

        // Reload permissions cache
        await permissionService.loadPermissions();

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ data: result }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "baasix_update_permission",
    "Update an existing permission",
    {
      id: z.string().describe("Permission ID"),
      role_Id: z.string().optional().describe("Role ID"),
      collection: z.string().optional().describe("Collection name"),
      action: z.enum(["create", "read", "update", "delete"]).optional().describe("Permission action"),
      fields: z.array(z.string()).optional().describe("Allowed fields"),
      conditions: z.record(z.any()).optional().describe("Permission conditions"),
      defaultValues: z.record(z.any()).optional().describe("Default values"),
      relConditions: z.record(z.any()).optional().describe("Relationship conditions"),
    },
    async ({ id, ...updateData }, _extra) => {
      try {
        const accountability = extra.sessionId ? getAccountabilityFromSession(extra.sessionId) : getDefaultAccountability();
        const permService = new ItemsService('baasix_Permission', { accountability });

        const result = await permService.updateOne(id, updateData);

        // Reload permissions cache
        await permissionService.loadPermissions();

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ data: result }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "baasix_delete_permission",
    "Delete a permission",
    {
      id: z.string().describe("Permission ID"),
    },
    async ({ id }, _extra) => {
      try {
        const accountability = extra.sessionId ? getAccountabilityFromSession(extra.sessionId) : getDefaultAccountability();
        const permService = new ItemsService('baasix_Permission', { accountability });

        await permService.deleteOne(id);

        // Reload permissions cache
        await permissionService.loadPermissions();

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ success: true, message: `Permission '${id}' deleted` }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "baasix_reload_permissions",
    "Reload the permission cache",
    {},
    async (_, _extra) => {
      try {
        await permissionService.loadPermissions();

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ success: true, message: "Permissions reloaded" }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  // ==================== Realtime Tools ====================

  server.tool(
    "baasix_realtime_status",
    "Get the status of the realtime service including WAL configuration",
    {},
    async (_, _extra) => {
      try {
        const status = await realtimeService.getStatus();

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(status, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "baasix_realtime_config",
    "Check PostgreSQL replication configuration for WAL-based realtime",
    {},
    async (_, _extra) => {
      try {
        const config = await realtimeService.getConfig();

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(config, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "baasix_realtime_collections",
    "Get list of collections with realtime enabled",
    {},
    async (_, _extra) => {
      try {
        const collections = realtimeService.getRealtimeCollections();

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ collections }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "baasix_realtime_enable",
    "Enable realtime for a collection",
    {
      collection: z.string().describe("Collection name"),
      actions: z.array(z.enum(["insert", "update", "delete"])).optional().describe("Actions to broadcast"),
      replicaIdentityFull: z.boolean().optional().describe("Set REPLICA IDENTITY FULL for old values"),
    },
    async ({ collection, actions, replicaIdentityFull }, _extra) => {
      try {
        await realtimeService.enableRealtime(collection, {
          actions: actions || ['insert', 'update', 'delete'],
          replicaIdentityFull: replicaIdentityFull || false
        });

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              message: `Realtime enabled for '${collection}'`
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "baasix_realtime_disable",
    "Disable realtime for a collection",
    {
      collection: z.string().describe("Collection name"),
    },
    async ({ collection }, _extra) => {
      try {
        await realtimeService.disableRealtime(collection);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              message: `Realtime disabled for '${collection}'`
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  // ==================== Settings Tools ====================

  server.tool(
    "baasix_get_settings",
    "Get application settings",
    {
      key: z.string().optional().describe("Specific setting key to retrieve"),
    },
    async ({ key }, _extra) => {
      try {
        const settings = key 
          ? await settingsService.getSetting(key)
          : await settingsService.getAllSettings();

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ data: settings }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "baasix_update_settings",
    "Update application settings",
    {
      settings: z.record(z.any()).describe("Settings object to update"),
    },
    async ({ settings }, _extra) => {
      try {
        await settingsService.updateSettings(settings);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              message: "Settings updated"
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  // ==================== Email Template Tools ====================

  server.tool(
    "baasix_list_templates",
    "List all email templates with optional filtering",
    {
      filter: z.record(z.any()).optional().describe("Filter criteria"),
      page: z.number().optional().default(1).describe("Page number"),
      limit: z.number().optional().default(10).describe("Templates per page"),
    },
    async ({ filter, page, limit }, _extra) => {
      try {
        const accountability = extra.sessionId ? getAccountabilityFromSession(extra.sessionId) : getDefaultAccountability();
        const templateService = new ItemsService('baasix_Template', { accountability });

        const query: any = { page, limit };
        if (filter) query.filter = filter;

        const result = await templateService.readByQuery(query, true);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              data: result.data,
              totalCount: result.totalCount,
              page,
              limit
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "baasix_get_template",
    "Get a specific email template by ID",
    {
      id: z.string().describe("Template ID (UUID)"),
    },
    async ({ id }, _extra) => {
      try {
        const accountability = extra.sessionId ? getAccountabilityFromSession(extra.sessionId) : getDefaultAccountability();
        const templateService = new ItemsService('baasix_Template', { accountability });

        const result = await templateService.readOne(id);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ data: result }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
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
    async ({ id, ...updateData }, _extra) => {
      try {
        const accountability = extra.sessionId ? getAccountabilityFromSession(extra.sessionId) : getDefaultAccountability();
        const templateService = new ItemsService('baasix_Template', { accountability });

        const result = await templateService.updateOne(id, updateData);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ data: result }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  // ==================== Notification Tools ====================

  server.tool(
    "baasix_list_notifications",
    "List notifications for the authenticated user",
    {
      page: z.number().optional().default(1).describe("Page number"),
      limit: z.number().optional().default(10).describe("Notifications per page"),
      seen: z.boolean().optional().describe("Filter by seen status"),
    },
    async ({ page, limit, seen }, _extra) => {
      try {
        const accountability = extra.sessionId ? getAccountabilityFromSession(extra.sessionId) : getDefaultAccountability();
        const notifService = new ItemsService('baasix_Notification', { accountability });

        const query: any = { page, limit };
        if (seen !== undefined) {
          query.filter = { seen: { eq: seen } };
        }

        const result = await notifService.readByQuery(query);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              data: result.data,
              totalCount: result.totalCount,
              page,
              limit
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "baasix_mark_notification_seen",
    "Mark a notification as seen",
    {
      id: z.string().describe("Notification ID"),
    },
    async ({ id }, _extra) => {
      try {
        const accountability = extra.sessionId ? getAccountabilityFromSession(extra.sessionId) : getDefaultAccountability();
        const notifService = new ItemsService('baasix_Notification', { accountability });

        const result = await notifService.updateOne(id, { seen: true });

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ data: result }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  // ==================== Utility Tools ====================

  server.tool(
    "baasix_server_info",
    "Get Baasix server information and health status",
    {},
    async (_, _extra) => {
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
            version: "0.1.0"
          }
        };

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(info, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "baasix_sort_items",
    "Sort items within a collection (move item before/after another)",
    {
      collection: z.string().describe("Collection name"),
      item: z.string().describe("ID of item to move"),
      to: z.string().describe("ID of target item to move before"),
    },
    async ({ collection, item, to }, _extra) => {
      try {
        const accountability = extra.sessionId ? getAccountabilityFromSession(extra.sessionId) : getDefaultAccountability();
        const itemsService = new ItemsService(collection, { accountability });

        // Get schema to check if sortEnabled
        const schemaDef = schemaManager.getSchemaDefinition(collection);
        if (!schemaDef?.sortEnabled) {
          throw new Error(`Collection '${collection}' does not have sorting enabled`);
        }

        // Get both items to swap sort values
        const [sourceItem, targetItem] = await Promise.all([
          itemsService.readOne(item),
          itemsService.readOne(to)
        ]);

        // Swap sort values
        await Promise.all([
          itemsService.updateOne(item, { sort: targetItem.sort }),
          itemsService.updateOne(to, { sort: sourceItem.sort })
        ]);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              message: `Item '${item}' moved before '${to}'`
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "baasix_generate_report",
    "Generate reports with grouping and aggregation for a collection",
    {
      collection: z.string().describe("Collection name"),
      groupBy: z.string().optional().describe("Field to group by"),
      filter: z.record(z.any()).optional().describe("Filter criteria"),
      dateRange: z.object({
        start: z.string().optional(),
        end: z.string().optional(),
      }).optional().describe("Date range filter"),
    },
    async ({ collection, groupBy, filter, dateRange }, _extra) => {
      try {
        const accountability = extra.sessionId ? getAccountabilityFromSession(extra.sessionId) : getDefaultAccountability();
        const itemsService = new ItemsService(collection, { accountability });

        const query: any = { limit: -1 };
        
        // Build filter with date range
        const filters: any[] = [];
        if (filter) filters.push(filter);
        if (dateRange) {
          if (dateRange.start) {
            filters.push({ createdAt: { gte: dateRange.start } });
          }
          if (dateRange.end) {
            filters.push({ createdAt: { lte: dateRange.end } });
          }
        }
        
        if (filters.length > 0) {
          query.filter = filters.length === 1 ? filters[0] : { AND: filters };
        }

        // Add aggregation if groupBy is specified
        if (groupBy) {
          query.groupBy = [groupBy];
          query.aggregate = {
            count: { function: 'count', field: '*' }
          };
        }

        const result = await itemsService.readByQuery(query);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              data: result.data,
              totalCount: result.totalCount,
              groupBy,
              dateRange
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  // ==================== Collection Stats Tool ====================

  server.tool(
    "baasix_collection_stats",
    "Get collection statistics and analytics",
    {
      collections: z.array(z.string()).optional().describe("Specific collections to get stats for"),
      timeframe: z.string().optional().describe('Timeframe for stats (e.g., "24h", "7d", "30d")'),
    },
    async ({ collections, timeframe }, _extra) => {
      try {
        const accountability = _extra.sessionId ? getAccountabilityFromSession(_extra.sessionId) : getDefaultAccountability();
        
        // Get all schemas if no specific collections provided
        const allSchemas = schemaManager.getSchemas();
        const targetCollections = collections || Object.keys(allSchemas).filter(name => !name.startsWith('baasix_'));
        
        const stats: any = {};
        
        for (const collection of targetCollections) {
          try {
            const itemsService = new ItemsService(collection, { accountability });
            
            // Get total count
            const countResult = await itemsService.readByQuery({
              aggregate: { total: { function: 'count', field: '*' } },
              limit: 1
            });
            
            // Get recent count if timeframe specified
            let recentCount = null;
            if (timeframe) {
              const now = new Date();
              let startDate = new Date();
              
              if (timeframe === '24h') startDate.setHours(now.getHours() - 24);
              else if (timeframe === '7d') startDate.setDate(now.getDate() - 7);
              else if (timeframe === '30d') startDate.setDate(now.getDate() - 30);
              
              const recentResult = await itemsService.readByQuery({
                filter: { createdAt: { gte: startDate.toISOString() } },
                aggregate: { recent: { function: 'count', field: '*' } },
                limit: 1
              });
              
              recentCount = recentResult.data?.[0]?.recent || 0;
            }
            
            stats[collection] = {
              totalCount: countResult.data?.[0]?.total || 0,
              ...(recentCount !== null && { recentCount, timeframe })
            };
          } catch (e) {
            stats[collection] = { error: 'Could not fetch stats' };
          }
        }
        
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(stats, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  // ==================== Send Notification Tool ====================

  server.tool(
    "baasix_send_notification",
    "Send a notification to specified users",
    {
      recipients: z.array(z.string()).describe("Array of user IDs to send notification to"),
      title: z.string().describe("Notification title"),
      message: z.string().describe("Notification message"),
      type: z.string().optional().default("info").describe("Notification type"),
    },
    async ({ recipients, title, message, type }, _extra) => {
      try {
        const accountability = _extra.sessionId ? getAccountabilityFromSession(_extra.sessionId) : getDefaultAccountability();
        const itemsService = new ItemsService('baasix_Notification', { accountability });
        
        const notifications = await Promise.all(
          recipients.map(userId => 
            itemsService.createOne({
              user_Id: userId,
              title,
              message,
              type: type || 'info',
              seen: false
            })
          )
        );
        
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ 
              success: true, 
              sent: notifications.length,
              notifications 
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  // ==================== Get Permission Tool ====================

  server.tool(
    "baasix_get_permission",
    "Get a specific permission by ID",
    {
      id: z.string().describe("Permission ID"),
    },
    async ({ id }, _extra) => {
      try {
        const accountability = _extra.sessionId ? getAccountabilityFromSession(_extra.sessionId) : getDefaultAccountability();
        const itemsService = new ItemsService('baasix_Permission', { accountability });
        const permission = await itemsService.readOne(id);
        
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(permission, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  // ==================== Get Permissions for Role Tool ====================

  server.tool(
    "baasix_get_permissions",
    "Get permissions for a specific role",
    {
      role: z.string().describe("Role name or ID"),
    },
    async ({ role }, _extra) => {
      try {
        const accountability = _extra.sessionId ? getAccountabilityFromSession(_extra.sessionId) : getDefaultAccountability();
        
        // First try to find role by name
        const rolesService = new ItemsService('baasix_Roles', { accountability });
        const rolesResult = await rolesService.readByQuery({
          filter: { OR: [{ name: { eq: role } }, { id: { eq: role } }] },
          limit: 1
        });
        
        if (!rolesResult.data?.length) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ error: `Role '${role}' not found` }, null, 2)
            }],
            isError: true
          };
        }
        
        const roleId = rolesResult.data[0].id;
        
        // Get permissions for this role
        const permissionsService = new ItemsService('baasix_Permission', { accountability });
        const permissions = await permissionsService.readByQuery({
          filter: { role_Id: { eq: roleId } },
          limit: -1
        });
        
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              role: rolesResult.data[0],
              permissions: permissions.data,
              totalCount: permissions.totalCount
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  // ==================== Update Permissions for Role Tool ====================

  server.tool(
    "baasix_update_permissions",
    "Update permissions for a role (bulk update)",
    {
      role: z.string().describe("Role name or ID"),
      permissions: z.array(z.object({
        collection: z.string(),
        action: z.enum(["create", "read", "update", "delete"]),
        fields: z.array(z.string()).optional(),
        conditions: z.record(z.any()).optional(),
      })).describe("Array of permission objects to set for the role"),
    },
    async ({ role, permissions }, _extra) => {
      try {
        const accountability = _extra.sessionId ? getAccountabilityFromSession(_extra.sessionId) : getDefaultAccountability();
        
        // Find role
        const rolesService = new ItemsService('baasix_Roles', { accountability });
        const rolesResult = await rolesService.readByQuery({
          filter: { OR: [{ name: { eq: role } }, { id: { eq: role } }] },
          limit: 1
        });
        
        if (!rolesResult.data?.length) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ error: `Role '${role}' not found` }, null, 2)
            }],
            isError: true
          };
        }
        
        const roleId = rolesResult.data[0].id;
        const permissionsService = new ItemsService('baasix_Permission', { accountability });
        
        // Create/update permissions
        const results = await Promise.all(
          permissions.map(async (perm) => {
            // Check if permission exists
            const existing = await permissionsService.readByQuery({
              filter: {
                AND: [
                  { role_Id: { eq: roleId } },
                  { collection: { eq: perm.collection } },
                  { action: { eq: perm.action } }
                ]
              },
              limit: 1
            });
            
            if (existing.data?.length) {
              // Update existing
              return permissionsService.updateOne(existing.data[0].id, {
                fields: perm.fields || ['*'],
                conditions: perm.conditions || {}
              });
            } else {
              // Create new
              return permissionsService.createOne({
                role_Id: roleId,
                collection: perm.collection,
                action: perm.action,
                fields: perm.fields || ['*'],
                conditions: perm.conditions || {}
              });
            }
          })
        );
        
        // Reload permissions cache
        await permissionService.reloadCache();
        
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              role: rolesResult.data[0].name,
              updated: results.length
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  // ==================== Auth Tools ====================

  server.tool(
    "baasix_get_current_user",
    "Get current user information with role and permissions",
    {
      fields: z.array(z.string()).optional().describe("Specific fields to retrieve"),
    },
    async ({ fields }, _extra) => {
      try {
        const accountability = _extra.sessionId ? getAccountabilityFromSession(_extra.sessionId) : getDefaultAccountability();
        
        if (!accountability.user) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                authenticated: false,
                role: accountability.role,
                admin: accountability.admin
              }, null, 2)
            }]
          };
        }
        
        const usersService = new ItemsService('baasix_User', { accountability });
        const user = await usersService.readOne(accountability.user, {
          fields: fields || ['*', 'role.*']
        });
        
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              authenticated: true,
              user,
              role: accountability.role,
              admin: accountability.admin
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
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
    async ({ email, password, firstName, lastName, roleName }, _extra) => {
      try {
        // Use axios to call the auth endpoint
        const { default: axios } = await import("axios");
        const baseUrl = `http://localhost:${env.get("PORT") || "8056"}`;
        
        const response = await axios.post(`${baseUrl}/auth/register`, {
          email,
          password,
          firstName,
          lastName,
          roleName
        });
        
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(response.data, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.response?.data?.message || error.message }, null, 2)
          }],
          isError: true
        };
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
    async ({ email, role_Id, tenant_Id, link }, _extra) => {
      try {
        const { default: axios } = await import("axios");
        const baseUrl = `http://localhost:${env.get("PORT") || "8056"}`;
        
        // Get auth token from session if available
        const accountability = _extra.sessionId ? getAccountabilityFromSession(_extra.sessionId) : null;
        
        const response = await axios.post(`${baseUrl}/auth/invite`, {
          email,
          role_Id,
          tenant_Id,
          link
        });
        
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(response.data, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.response?.data?.message || error.message }, null, 2)
          }],
          isError: true
        };
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
    async ({ token, link }, _extra) => {
      try {
        const { default: axios } = await import("axios");
        const baseUrl = `http://localhost:${env.get("PORT") || "8056"}`;
        
        const params = new URLSearchParams();
        if (link) params.append("link", link);
        
        const response = await axios.get(`${baseUrl}/auth/verify-invite/${token}?${params}`);
        
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(response.data, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.response?.data?.message || error.message }, null, 2)
          }],
          isError: true
        };
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
    async ({ email, link, mode }, _extra) => {
      try {
        const { default: axios } = await import("axios");
        const baseUrl = `http://localhost:${env.get("PORT") || "8056"}`;
        
        const response = await axios.post(`${baseUrl}/auth/magiclink`, {
          email,
          link,
          mode
        });
        
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(response.data, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.response?.data?.message || error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "baasix_get_user_tenants",
    "Get available tenants for the current user",
    {},
    async (_args, _extra) => {
      try {
        const { default: axios } = await import("axios");
        const baseUrl = `http://localhost:${env.get("PORT") || "8056"}`;
        
        const response = await axios.get(`${baseUrl}/auth/tenants`);
        
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(response.data, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.response?.data?.message || error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "baasix_switch_tenant",
    "Switch to a different tenant context",
    {
      tenant_Id: z.string().describe("Tenant ID to switch to"),
    },
    async ({ tenant_Id }, _extra) => {
      try {
        const { default: axios } = await import("axios");
        const baseUrl = `http://localhost:${env.get("PORT") || "8056"}`;
        
        const response = await axios.post(`${baseUrl}/auth/switch-tenant`, {
          tenant_Id
        });
        
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(response.data, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.response?.data?.message || error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  // ==================== Auth Status & Session Tools ====================

  server.tool(
    "baasix_auth_status",
    "Check authentication status and session validity",
    {},
    async (_args, _extra) => {
      try {
        const accountability = _extra.sessionId ? getAccountabilityFromSession(_extra.sessionId) : getDefaultAccountability();
        
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              authenticated: !!accountability.user,
              userId: accountability.user,
              role: accountability.role,
              admin: accountability.admin,
              sessionId: _extra.sessionId || null
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "baasix_login",
    "Login with email and password",
    {
      email: z.string().email().describe("User email address"),
      password: z.string().describe("User password"),
    },
    async ({ email, password }, _extra) => {
      try {
        const { default: axios } = await import("axios");
        const baseUrl = `http://localhost:${env.get("PORT") || "8056"}`;
        
        const response = await axios.post(`${baseUrl}/auth/login`, {
          email,
          password
        });
        
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(response.data, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.response?.data?.message || error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "baasix_logout",
    "Logout and invalidate current session",
    {},
    async (_args, _extra) => {
      try {
        const { default: axios } = await import("axios");
        const baseUrl = `http://localhost:${env.get("PORT") || "8056"}`;
        
        const response = await axios.post(`${baseUrl}/auth/logout`);
        
        // Remove MCP session if exists
        if (_extra.sessionId) {
          removeMCPSession(_extra.sessionId);
        }
        
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ success: true, message: "Logged out successfully" }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.response?.data?.message || error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "baasix_refresh_auth",
    "Refresh authentication token",
    {
      refreshToken: z.string().optional().describe("Refresh token (if not using cookies)"),
    },
    async ({ refreshToken }, _extra) => {
      try {
        const { default: axios } = await import("axios");
        const baseUrl = `http://localhost:${env.get("PORT") || "8056"}`;
        
        const response = await axios.post(`${baseUrl}/auth/refresh`, {
          refreshToken
        });
        
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(response.data, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.response?.data?.message || error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  // ==================== Update Relationship Tool ====================

  server.tool(
    "baasix_update_relationship",
    "Update an existing relationship between collections",
    {
      sourceCollection: z.string().describe("Source collection name"),
      relationshipName: z.string().describe("Relationship field name to update"),
      relationshipData: z.object({
        alias: z.string().optional().describe("Alias for reverse relationship"),
        onDelete: z.enum(["CASCADE", "RESTRICT", "SET NULL"]).optional().describe("Delete behavior"),
        onUpdate: z.enum(["CASCADE", "RESTRICT", "SET NULL"]).optional().describe("Update behavior"),
        description: z.string().optional().describe("Relationship description"),
      }).describe("Updated relationship configuration"),
    },
    async ({ sourceCollection, relationshipName, relationshipData }, _extra) => {
      try {
        const schema = schemaManager.getSchema(sourceCollection);
        if (!schema) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ error: `Collection '${sourceCollection}' not found` }, null, 2)
            }],
            isError: true
          };
        }
        
        const relationship = schema.relationships?.find((r: any) => r.name === relationshipName);
        if (!relationship) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ error: `Relationship '${relationshipName}' not found in collection '${sourceCollection}'` }, null, 2)
            }],
            isError: true
          };
        }
        
        // Update the relationship
        const updatedRelationship = { ...relationship, ...relationshipData };
        const relationships = schema.relationships?.map((r: any) => 
          r.name === relationshipName ? updatedRelationship : r
        ) || [];
        
        await schemaManager.updateSchema(sourceCollection, {
          ...schema,
          relationships
        });
        
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              collection: sourceCollection,
              relationship: updatedRelationship
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  return server;
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
    role: 'administrator',
    admin: true,
    ip: '127.0.0.1'
  };
}

/**
 * Remove an MCP session
 */
export function removeMCPSession(sessionId: string): void {
  mcpSessions.delete(sessionId);
}

export default { createMCPServer, setMCPSession, removeMCPSession };
