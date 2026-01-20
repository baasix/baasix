import type { HttpClient } from "../client";
import type {
  BaseItem,
  BulkResponse,
  DeleteResponse,
  Filter,
  MutationResponse,
  PaginatedResponse,
  QueryParams,
  SingleResponse,
  Sort,
} from "../types";

export interface ItemsModuleConfig {
  client: HttpClient;
}

/**
 * Query builder for constructing type-safe queries
 */
export class QueryBuilder<T extends BaseItem = BaseItem> {
  private collection: string;
  private client: HttpClient;
  private queryParams: QueryParams = {};

  constructor(collection: string, client: HttpClient) {
    this.collection = collection;
    this.client = client;
  }

  /**
   * Select specific fields to return
   *
   * @example
   * ```typescript
   * items.select(['id', 'name', 'author.*'])
   * items.select('*', 'category.name')
   * ```
   */
  select(...fields: string[] | [string[]]): this {
    const flatFields = fields.length === 1 && Array.isArray(fields[0])
      ? fields[0]
      : (fields as string[]);
    this.queryParams.fields = flatFields;
    return this;
  }

  /**
   * Alias for select()
   */
  fields(...fields: string[] | [string[]]): this {
    return this.select(...fields);
  }

  /**
   * Add filter conditions
   *
   * @example
   * ```typescript
   * // Simple equality
   * items.filter({ status: { eq: 'active' } })
   *
   * // Multiple conditions
   * items.filter({
   *   AND: [
   *     { status: { eq: 'active' } },
   *     { price: { gte: 100 } }
   *   ]
   * })
   *
   * // Relation filtering
   * items.filter({ 'author.name': { like: 'John' } })
   * ```
   */
  filter(filter: Filter): this {
    this.queryParams.filter = filter;
    return this;
  }

  /**
   * Alias for filter()
   */
  where(filter: Filter): this {
    return this.filter(filter);
  }

  /**
   * Sort results
   *
   * @example
   * ```typescript
   * // Object notation
   * items.sort({ createdAt: 'desc', name: 'asc' })
   *
   * // Array notation with prefix
   * items.sort(['-createdAt', 'name'])
   *
   * // String shorthand
   * items.sort('createdAt:desc')
   * ```
   */
  sort(sort: Sort): this {
    this.queryParams.sort = sort;
    return this;
  }

  /**
   * Alias for sort()
   */
  orderBy(sort: Sort): this {
    return this.sort(sort);
  }

  /**
   * Limit number of results
   *
   * @example
   * ```typescript
   * items.limit(20)
   * items.limit(-1) // All results
   * ```
   */
  limit(limit: number): this {
    this.queryParams.limit = limit;
    return this;
  }

  /**
   * Set page number (1-indexed)
   *
   * @example
   * ```typescript
   * items.page(2).limit(20)
   * ```
   */
  page(page: number): this {
    this.queryParams.page = page;
    return this;
  }

  /**
   * Skip a number of results
   *
   * @example
   * ```typescript
   * items.offset(20)
   * ```
   */
  offset(offset: number): this {
    this.queryParams.offset = offset;
    return this;
  }

  /**
   * Full-text search
   *
   * @example
   * ```typescript
   * items.search('keyword', ['title', 'description'])
   * ```
   */
  search(query: string, fields?: string[]): this {
    this.queryParams.search = query;
    if (fields) {
      this.queryParams.searchFields = fields;
    }
    return this;
  }

  /**
   * Include soft-deleted items
   *
   * @example
   * ```typescript
   * items.withDeleted()
   * ```
   */
  withDeleted(): this {
    this.queryParams.paranoid = false;
    return this;
  }

  /**
   * Filter related items in O2M/M2M relations
   *
   * @example
   * ```typescript
   * // Only show approved comments
   * items.relFilter({
   *   comments: { approved: { eq: true } }
   * })
   * ```
   */
  relFilter(conditions: Record<string, Filter>): this {
    this.queryParams.relConditions = conditions;
    return this;
  }

  /**
   * Get the built query parameters
   */
  getQuery(): QueryParams {
    return { ...this.queryParams };
  }

  /**
   * Execute the query and return results
   *
   * @example
   * ```typescript
   * const { data, totalCount } = await items
   *   .filter({ status: { eq: 'active' } })
   *   .sort({ createdAt: 'desc' })
   *   .limit(10)
   *   .get();
   * ```
   */
  async get(): Promise<PaginatedResponse<T>> {
    return this.client.get<PaginatedResponse<T>>(`/items/${this.collection}`, {
      params: this.buildParams(),
    });
  }

  /**
   * Execute the query and return the first result
   *
   * @example
   * ```typescript
   * const item = await items
   *   .filter({ slug: { eq: 'my-post' } })
   *   .first();
   * ```
   */
  async first(): Promise<T | null> {
    const result = await this.limit(1).get();
    return result.data[0] || null;
  }

  /**
   * Count matching items
   *
   * @example
   * ```typescript
   * const count = await items.filter({ status: { eq: 'active' } }).count();
   * ```
   */
  async count(): Promise<number> {
    const result = await this.client.get<PaginatedResponse<T>>(
      `/items/${this.collection}`,
      {
        params: {
          ...this.buildParams(),
          limit: 0,
        },
      }
    );
    return result.totalCount || 0;
  }

  /**
   * Build query parameters for the request
   */
  private buildParams(): Record<string, unknown> {
    const params: Record<string, unknown> = {};

    if (this.queryParams.fields) {
      params.fields = this.queryParams.fields;
    }
    if (this.queryParams.filter) {
      params.filter = this.queryParams.filter;
    }
    if (this.queryParams.sort) {
      params.sort = this.queryParams.sort;
    }
    if (this.queryParams.limit !== undefined) {
      params.limit = this.queryParams.limit;
    }
    if (this.queryParams.page !== undefined) {
      params.page = this.queryParams.page;
    }
    if (this.queryParams.offset !== undefined) {
      params.offset = this.queryParams.offset;
    }
    if (this.queryParams.search) {
      params.search = this.queryParams.search;
    }
    if (this.queryParams.searchFields) {
      params.searchFields = this.queryParams.searchFields;
    }
    if (this.queryParams.paranoid !== undefined) {
      params.paranoid = this.queryParams.paranoid;
    }
    if (this.queryParams.relConditions) {
      params.relConditions = this.queryParams.relConditions;
    }
    if (this.queryParams.aggregate) {
      params.aggregate = this.queryParams.aggregate;
    }
    if (this.queryParams.groupBy) {
      params.groupBy = this.queryParams.groupBy;
    }

    return params;
  }
}

/**
 * Items module for CRUD operations on collections.
 *
 * @example
 * ```typescript
 * const items = baasix.items('products');
 *
 * // List items
 * const products = await items.find({ filter: { status: { eq: 'active' } } });
 *
 * // Get single item
 * const product = await items.findOne('product-id');
 *
 * // Create item
 * const newProduct = await items.create({ name: 'Widget', price: 29.99 });
 *
 * // Update item
 * await items.update('product-id', { price: 24.99 });
 *
 * // Delete item
 * await items.delete('product-id');
 * ```
 */
export class ItemsModule<T extends BaseItem = BaseItem> {
  private collection: string;
  private client: HttpClient;

  constructor(collection: string, config: ItemsModuleConfig) {
    this.collection = collection;
    this.client = config.client;
  }

  /**
   * Create a query builder for fluent query construction
   *
   * @example
   * ```typescript
   * const results = await baasix.items('posts')
   *   .query()
   *   .select('*', 'author.*')
   *   .filter({ status: { eq: 'published' } })
   *   .sort({ createdAt: 'desc' })
   *   .limit(10)
   *   .get();
   * ```
   */
  query(): QueryBuilder<T> {
    return new QueryBuilder<T>(this.collection, this.client);
  }

  /**
   * Find items with optional query parameters
   *
   * @example
   * ```typescript
   * // Simple query
   * const { data } = await items.find();
   *
   * // With parameters
   * const { data, totalCount } = await items.find({
   *   filter: { status: { eq: 'active' } },
   *   sort: { createdAt: 'desc' },
   *   limit: 20,
   *   page: 1,
   *   fields: ['id', 'name', 'price']
   * });
   * ```
   */
  async find(params?: QueryParams): Promise<PaginatedResponse<T>> {
    return this.client.get<PaginatedResponse<T>>(`/items/${this.collection}`, {
      params: params as Record<string, unknown>,
    });
  }

  /**
   * Alias for find()
   */
  async findMany(params?: QueryParams): Promise<PaginatedResponse<T>> {
    return this.find(params);
  }

  /**
   * Find a single item by ID
   *
   * @example
   * ```typescript
   * const product = await items.findOne('product-uuid');
   *
   * // With specific fields
   * const product = await items.findOne('product-uuid', {
   *   fields: ['id', 'name', 'category.*']
   * });
   * ```
   */
  async findOne(
    id: string,
    params?: Pick<QueryParams, "fields">
  ): Promise<T> {
    const response = await this.client.get<SingleResponse<T>>(
      `/items/${this.collection}/${id}`,
      { params: params as Record<string, unknown> }
    );
    return response.data;
  }

  /**
   * Alias for findOne()
   */
  async get(id: string, params?: Pick<QueryParams, "fields">): Promise<T> {
    return this.findOne(id, params);
  }

  /**
   * Create a new item
   *
   * @example
   * ```typescript
   * const id = await items.create({
   *   name: 'New Product',
   *   price: 29.99,
   *   status: 'draft'
   * });
   * ```
   */
  async create(data: Partial<T>): Promise<string> {
    const response = await this.client.post<MutationResponse<string>>(
      `/items/${this.collection}`,
      data
    );
    return response.data;
  }

  /**
   * Alias for create()
   */
  async insert(data: Partial<T>): Promise<string> {
    return this.create(data);
  }

  /**
   * Create multiple items at once
   *
   * @example
   * ```typescript
   * const ids = await items.createMany([
   *   { name: 'Product 1', price: 10 },
   *   { name: 'Product 2', price: 20 }
   * ]);
   * ```
   */
  async createMany(data: Partial<T>[]): Promise<string[]> {
    const response = await this.client.post<BulkResponse<string[]>>(
      `/items/${this.collection}/bulk`,
      data
    );
    return response.data;
  }

  /**
   * Alias for createMany()
   */
  async insertMany(data: Partial<T>[]): Promise<string[]> {
    return this.createMany(data);
  }

  /**
   * Update an existing item
   *
   * @example
   * ```typescript
   * await items.update('product-uuid', {
   *   price: 24.99,
   *   status: 'published'
   * });
   * ```
   */
  async update(id: string, data: Partial<T>): Promise<string> {
    const response = await this.client.patch<MutationResponse<string>>(
      `/items/${this.collection}/${id}`,
      data
    );
    return response.data;
  }

  /**
   * Update multiple items at once
   *
   * @example
   * ```typescript
   * // Update by IDs with same data
   * await items.updateMany(['id1', 'id2'], { status: 'archived' });
   * ```
   */
  async updateMany(ids: string[], data: Partial<T>): Promise<string[]> {
    // Transform to array format expected by API: [{id, data}, {id, data}, ...]
    const updates = ids.map(id => ({ id, data }));
    const response = await this.client.patch<BulkResponse<string[]>>(
      `/items/${this.collection}/bulk`,
      updates
    );
    return response.data;
  }

  /**
   * Upsert an item (create if not exists, update if exists)
   *
   * @example
   * ```typescript
   * const id = await items.upsert(
   *   { sku: 'WIDGET-001' },
   *   { name: 'Widget', price: 29.99, sku: 'WIDGET-001' }
   * );
   * ```
   */
  async upsert(
    filter: Filter,
    data: Partial<T>
  ): Promise<string> {
    // Try to find existing
    const existing = await this.find({ filter, limit: 1 });
    if (existing.data.length > 0) {
      return this.update(existing.data[0].id, data);
    }
    return this.create(data);
  }

  /**
   * Delete an item by ID
   *
   * @example
   * ```typescript
   * await items.delete('product-uuid');
   * ```
   */
  async delete(id: string): Promise<void> {
    await this.client.delete<DeleteResponse>(`/items/${this.collection}/${id}`);
  }

  /**
   * Delete multiple items
   *
   * @example
   * ```typescript
   * await items.deleteMany(['id1', 'id2', 'id3']);
   * ```
   */
  async deleteMany(ids: string[]): Promise<void> {
    await this.client.delete<DeleteResponse>(`/items/${this.collection}/bulk`, {
      body: JSON.stringify(ids),
    });
  }

  /**
   * Soft delete an item (if paranoid mode is enabled)
   *
   * @example
   * ```typescript
   * await items.softDelete('product-uuid');
   * ```
   */
  async softDelete(id: string): Promise<void> {
    await this.update(id, { deletedAt: new Date().toISOString() } as unknown as Partial<T>);
  }

  /**
   * Restore a soft-deleted item
   *
   * @example
   * ```typescript
   * await items.restore('product-uuid');
   * ```
   */
  async restore(id: string): Promise<void> {
    await this.update(id, { deletedAt: null } as unknown as Partial<T>);
  }

  /**
   * Aggregate data with grouping
   *
   * @example
   * ```typescript
   * const results = await items.aggregate({
   *   aggregate: {
   *     total: { function: 'sum', field: 'amount' },
   *     count: { function: 'count', field: 'id' },
   *     avgPrice: { function: 'avg', field: 'price' }
   *   },
   *   groupBy: ['category', 'status'],
   *   filter: { createdAt: { gte: '$NOW-DAYS_30' } }
   * });
   * ```
   */
  async aggregate(
    params: Pick<QueryParams, "aggregate" | "groupBy" | "filter">
  ): Promise<Record<string, unknown>[]> {
    const response = await this.client.get<PaginatedResponse<Record<string, unknown>>>(
      `/items/${this.collection}`,
      { params: params as Record<string, unknown> }
    );
    return response.data;
  }

  // ===================
  // Import Operations
  // ===================

  /**
   * Import items from a CSV file
   *
   * @example
   * ```typescript
   * // Browser
   * const fileInput = document.querySelector('input[type="file"]');
   * const file = fileInput.files[0];
   * 
   * const result = await baasix.items('products').importCSV(file);
   * 
   * console.log(`Imported ${result.imported} items`);
   * ```
   */
  async importCSV(
    file: File | { uri: string; name: string; type: string }
  ): Promise<ImportResult> {
    const formData = new FormData();
    
    if (file instanceof File) {
      formData.append("csvFile", file);
    } else {
      // React Native style file
      formData.append("csvFile", file as any);
    }

    const response = await this.client.post<{ results: ImportResult }>(
      `/items/${this.collection}/import-csv`,
      formData
    );
    return response.results;
  }

  /**
   * Import items from a JSON file
   *
   * @example
   * ```typescript
   * const file = fileInput.files[0]; // JSON file
   * const result = await baasix.items('products').importJSON(file);
   * 
   * console.log(`Imported ${result.imported} items`);
   * ```
   */
  async importJSON(
    file: File | { uri: string; name: string; type: string }
  ): Promise<ImportResult> {
    const formData = new FormData();
    
    if (file instanceof File) {
      formData.append("jsonFile", file);
    } else {
      formData.append("jsonFile", file as any);
    }

    const response = await this.client.post<{ results: ImportResult }>(
      `/items/${this.collection}/import-json`,
      formData
    );
    return response.results;
  }

  /**
   * Import items from an array of objects
   *
   * @example
   * ```typescript
   * const data = [
   *   { name: 'Product 1', price: 29.99 },
   *   { name: 'Product 2', price: 39.99 }
   * ];
   * 
   * const result = await baasix.items('products').importData(data);
   * ```
   */
  async importData(data: Partial<T>[]): Promise<BulkResponse> {
    const response = await this.client.post<BulkResponse>(
      `/items/${this.collection}/bulk`,
      data
    );
    return response;
  }

  // ===================
  // Sort Operations
  // ===================

  /**
   * Sort/reorder items (move item before or after another)
   *
   * @example
   * ```typescript
   * // Move item1 before item2
   * await baasix.items('products').sortItem('item1-uuid', 'item2-uuid');
   * 
   * // Move item1 after item2
   * await baasix.items('products').sortItem('item1-uuid', 'item2-uuid', 'after');
   * ```
   */
  async sortItem(
    itemId: string,
    targetItemId: string,
    mode: "before" | "after" = "before"
  ): Promise<void> {
    await this.client.post(`/utils/sort/${this.collection}`, {
      item: itemId,
      to: targetItemId,
      mode,
    });
  }

  /**
   * Reorder multiple items
   *
   * @example
   * ```typescript
   * // Set explicit order
   * await baasix.items('products').reorder([
   *   'item3-uuid',
   *   'item1-uuid',
   *   'item2-uuid'
   * ]);
   * ```
   */
  async reorder(orderedIds: string[]): Promise<void> {
    // Sort items one by one to achieve the desired order
    for (let i = 1; i < orderedIds.length; i++) {
      await this.client.post(`/utils/sort/${this.collection}`, {
        item: orderedIds[i],
        to: orderedIds[i - 1],
        mode: "after",
      });
    }
  }
}

export interface ImportResult {
  imported: number;
  failed: number;
  errors: Array<{ row: number; data: Record<string, unknown>; error: string }>;
}

// Re-export types from types.ts
export type {
  BaseItem,
  BulkResponse,
  DeleteResponse,
  Filter,
  MutationResponse,
  PaginatedResponse,
  QueryParams,
  SingleResponse,
  Sort,
};
