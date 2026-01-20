import type { HttpClient } from "../client";
import type {
  IndexDefinition,
  PaginatedResponse,
  RelationshipDefinition,
  SchemaDefinition,
  SchemaInfo,
  Sort,
} from "../types";
import { normalizeSort } from "../utils/sort";

export interface SchemasModuleConfig {
  client: HttpClient;
}

/**
 * Schemas module for managing database schemas, relationships, and indexes.
 *
 * @example
 * ```typescript
 * // Create a new collection
 * await baasix.schemas.create({
 *   collectionName: 'products',
 *   schema: {
 *     name: 'Product',
 *     timestamps: true,
 *     fields: {
 *       id: { type: 'UUID', primaryKey: true, defaultValue: { type: 'UUIDV4' } },
 *       name: { type: 'String', allowNull: false },
 *       price: { type: 'Decimal', values: { precision: 10, scale: 2 } }
 *     }
 *   }
 * });
 *
 * // Add a relationship
 * await baasix.schemas.createRelationship('products', {
 *   type: 'M2O',
 *   target: 'categories',
 *   name: 'category',
 *   alias: 'products'
 * });
 * ```
 */
export class SchemasModule {
  private client: HttpClient;

  constructor(config: SchemasModuleConfig) {
    this.client = config.client;
  }

  /**
   * List all schemas
   *
   * @example
   * ```typescript
   * const { data } = await baasix.schemas.find();
   * console.log(data.map(s => s.collectionName));
   * 
   * // With pagination
   * const { data } = await baasix.schemas.find({ page: 1, limit: 50 });
   * ```
   */
  async find(params?: {
    page?: number;
    limit?: number;
    sort?: Sort;
    search?: string;
    filter?: Record<string, unknown>;
  }): Promise<PaginatedResponse<SchemaInfo>> {
    const normalizedParams = params ? {
      ...params,
      sort: normalizeSort(params.sort),
    } : undefined;
    return this.client.get<PaginatedResponse<SchemaInfo>>("/schemas", { params: normalizedParams });
  }

  /**
   * Get schema for a specific collection
   *
   * @example
   * ```typescript
   * const schema = await baasix.schemas.findOne('products');
   * console.log(schema.fields);
   * ```
   */
  async findOne(collection: string): Promise<SchemaInfo> {
    const response = await this.client.get<{ data: SchemaInfo }>(
      `/schemas/${collection}`
    );
    return response.data;
  }

  /**
   * Create a new collection/schema
   *
   * @example
   * ```typescript
   * await baasix.schemas.create({
   *   collectionName: 'orders',
   *   schema: {
   *     name: 'Order',
   *     timestamps: true,
   *     paranoid: true,
   *     fields: {
   *       id: {
   *         type: 'UUID',
   *         primaryKey: true,
   *         defaultValue: { type: 'UUIDV4' }
   *       },
   *       orderNumber: {
   *         type: 'String',
   *         allowNull: false,
   *         unique: true
   *       },
   *       total: {
   *         type: 'Decimal',
   *         values: { precision: 10, scale: 2 },
   *         allowNull: false,
   *         defaultValue: 0
   *       },
   *       status: {
   *         type: 'String',
   *         allowNull: false,
   *         defaultValue: 'pending'
   *       },
   *       items: {
   *         type: 'JSONB',
   *         allowNull: true,
   *         defaultValue: []
   *       }
   *     }
   *   }
   * });
   * ```
   */
  async create(data: {
    collectionName: string;
    schema: SchemaDefinition;
  }): Promise<SchemaInfo> {
    const response = await this.client.post<{ data: SchemaInfo }>(
      "/schemas",
      data
    );
    return response.data;
  }

  /**
   * Update an existing schema
   *
   * @example
   * ```typescript
   * await baasix.schemas.update('products', {
   *   schema: {
   *     name: 'Product',
   *     timestamps: true,
   *     fields: {
   *       // Updated fields
   *       description: { type: 'Text', allowNull: true }
   *     }
   *   }
   * });
   * ```
   */
  async update(
    collection: string,
    data: { schema: Partial<SchemaDefinition> }
  ): Promise<SchemaInfo> {
    const response = await this.client.patch<{ data: SchemaInfo }>(
      `/schemas/${collection}`,
      data
    );
    return response.data;
  }

  /**
   * Delete a schema (drops the table)
   *
   * @example
   * ```typescript
   * await baasix.schemas.delete('old_collection');
   * ```
   */
  async delete(collection: string): Promise<void> {
    await this.client.delete(`/schemas/${collection}`);
  }

  /**
   * Create a relationship between collections
   *
   * @example
   * ```typescript
   * // Many-to-One (BelongsTo)
   * await baasix.schemas.createRelationship('posts', {
   *   type: 'M2O',
   *   target: 'baasix_User',
   *   name: 'author',
   *   alias: 'posts'
   * });
   *
   * // Many-to-Many
   * await baasix.schemas.createRelationship('posts', {
   *   type: 'M2M',
   *   target: 'tags',
   *   name: 'tags',
   *   alias: 'posts'
   * });
   * ```
   */
  async createRelationship(
    collection: string,
    relationship: RelationshipDefinition
  ): Promise<void> {
    await this.client.post(
      `/schemas/${collection}/relationships`,
      relationship
    );
  }

  /**
   * Delete a relationship
   *
   * @example
   * ```typescript
   * await baasix.schemas.deleteRelationship('posts', 'author');
   * ```
   */
  async deleteRelationship(
    collection: string,
    relationshipName: string
  ): Promise<void> {
    await this.client.delete(
      `/schemas/${collection}/relationships/${relationshipName}`
    );
  }

  /**
   * Update a relationship
   *
   * @example
   * ```typescript
   * await baasix.schemas.updateRelationship('posts', 'author', {
   *   alias: 'authoredPosts',
   *   onDelete: 'CASCADE'
   * });
   * ```
   */
  async updateRelationship(
    collection: string,
    relationshipName: string,
    data: Partial<RelationshipDefinition>
  ): Promise<void> {
    await this.client.patch(
      `/schemas/${collection}/relationships/${relationshipName}`,
      data
    );
  }

  /**
   * Create an index on a collection
   *
   * @example
   * ```typescript
   * // Unique index
   * await baasix.schemas.createIndex('users', {
   *   name: 'idx_users_email',
   *   fields: ['email'],
   *   unique: true
   * });
   *
   * // Composite index
   * await baasix.schemas.createIndex('orders', {
   *   name: 'idx_orders_status_created',
   *   fields: ['status', 'createdAt']
   * });
   * ```
   */
  async createIndex(
    collection: string,
    index: IndexDefinition
  ): Promise<void> {
    await this.client.post(`/schemas/${collection}/indexes`, index);
  }

  /**
   * Delete an index
   *
   * @example
   * ```typescript
   * await baasix.schemas.deleteIndex('users', 'idx_users_email');
   * ```
   */
  async deleteIndex(collection: string, indexName: string): Promise<void> {
    await this.client.delete(`/schemas/${collection}/indexes/${indexName}`);
  }

  /**
   * Add a field to an existing schema
   *
   * @example
   * ```typescript
   * await baasix.schemas.addField('products', 'rating', {
   *   type: 'Decimal',
   *   values: { precision: 3, scale: 2 },
   *   allowNull: true,
   *   defaultValue: 0
   * });
   * ```
   */
  async addField(
    collection: string,
    fieldName: string,
    fieldDefinition: SchemaDefinition["fields"][string]
  ): Promise<SchemaInfo> {
    const currentSchema = await this.findOne(collection);
    const updatedFields = {
      ...currentSchema.schema.fields,
      [fieldName]: fieldDefinition,
    };

    return this.update(collection, {
      schema: {
        ...currentSchema.schema,
        fields: updatedFields,
      },
    });
  }

  /**
   * Remove a field from a schema
   *
   * @example
   * ```typescript
   * await baasix.schemas.removeField('products', 'deprecated_field');
   * ```
   */
  async removeField(
    collection: string,
    fieldName: string
  ): Promise<SchemaInfo> {
    const currentSchema = await this.findOne(collection);
    const { [fieldName]: _, ...remainingFields } = currentSchema.schema.fields;

    return this.update(collection, {
      schema: {
        ...currentSchema.schema,
        fields: remainingFields,
      },
    });
  }

  /**
   * Export all schemas as JSON
   *
   * @example
   * ```typescript
   * const schemas = await baasix.schemas.export();
   * // Save to file for backup
   * ```
   */
  async export(): Promise<SchemaInfo[]> {
    const response = await this.client.get<{ data: SchemaInfo[] }>(
      "/schemas/export"
    );
    return response.data;
  }

  /**
   * Import schemas from JSON
   *
   * @example
   * ```typescript
   * await baasix.schemas.import(savedSchemas);
   * ```
   */
  async import(schemas: SchemaInfo[]): Promise<void> {
    await this.client.post("/schemas/import", { schemas });
  }
}

// Re-export types
export type {
  IndexDefinition,
  RelationshipDefinition,
  SchemaDefinition,
  SchemaInfo,
};
