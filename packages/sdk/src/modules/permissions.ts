import type { HttpClient } from "../client";
import type {
  CreatePermissionData,
  PaginatedResponse,
  Permission,
  PermissionAction,
  Role,
} from "../types";

export interface PermissionsModuleConfig {
  client: HttpClient;
}

/**
 * Permissions module for managing role-based access control.
 *
 * @example
 * ```typescript
 * // Create a permission
 * await baasix.permissions.create({
 *   role_Id: 'role-uuid',
 *   collection: 'products',
 *   action: 'read',
 *   fields: ['*'],
 *   conditions: { published: { eq: true } }
 * });
 *
 * // Get permissions for a role
 * const { data } = await baasix.permissions.findByRole('role-uuid');
 * ```
 */
export class PermissionsModule {
  private client: HttpClient;

  constructor(config: PermissionsModuleConfig) {
    this.client = config.client;
  }

  /**
   * List all permissions
   *
   * @example
   * ```typescript
   * const { data } = await baasix.permissions.find();
   * ```
   */
  async find(params?: {
    limit?: number;
    page?: number;
    filter?: Record<string, unknown>;
  }): Promise<PaginatedResponse<Permission>> {
    return this.client.get<PaginatedResponse<Permission>>("/permissions", {
      params: params as Record<string, unknown>,
    });
  }

  /**
   * Get a permission by ID
   */
  async findOne(id: string): Promise<Permission> {
    const response = await this.client.get<{ data: Permission }>(
      `/permissions/${id}`
    );
    return response.data;
  }

  /**
   * Get permissions for a specific role
   *
   * @example
   * ```typescript
   * const { data } = await baasix.permissions.findByRole('role-uuid');
   * ```
   */
  async findByRole(roleId: string): Promise<PaginatedResponse<Permission>> {
    return this.client.get<PaginatedResponse<Permission>>("/permissions", {
      params: {
        filter: { role_Id: { eq: roleId } },
        limit: -1,
      },
    });
  }

  /**
   * Get permissions for a specific collection
   *
   * @example
   * ```typescript
   * const { data } = await baasix.permissions.findByCollection('products');
   * ```
   */
  async findByCollection(
    collection: string
  ): Promise<PaginatedResponse<Permission>> {
    return this.client.get<PaginatedResponse<Permission>>("/permissions", {
      params: {
        filter: { collection: { eq: collection } },
        limit: -1,
      },
    });
  }

  /**
   * Create a new permission
   *
   * @example
   * ```typescript
   * await baasix.permissions.create({
   *   role_Id: 'editor-role-uuid',
   *   collection: 'posts',
   *   action: 'update',
   *   fields: ['title', 'content', 'status'],
   *   conditions: {
   *     author_Id: { eq: '$CURRENT_USER' }
   *   }
   * });
   * ```
   */
  async create(data: CreatePermissionData): Promise<Permission> {
    const response = await this.client.post<{ data: Permission }>(
      "/permissions",
      data
    );
    return response.data;
  }

  /**
   * Update a permission
   *
   * @example
   * ```typescript
   * await baasix.permissions.update('permission-uuid', {
   *   fields: ['*'],
   *   conditions: null
   * });
   * ```
   */
  async update(
    id: string,
    data: Partial<CreatePermissionData>
  ): Promise<Permission> {
    const response = await this.client.patch<{ data: Permission }>(
      `/permissions/${id}`,
      data
    );
    return response.data;
  }

  /**
   * Delete a permission
   *
   * @example
   * ```typescript
   * await baasix.permissions.delete('permission-uuid');
   * ```
   */
  async delete(id: string): Promise<void> {
    await this.client.delete(`/permissions/${id}`);
  }

  /**
   * List all roles
   *
   * @example
   * ```typescript
   * const { data } = await baasix.permissions.getRoles();
   * ```
   */
  async getRoles(): Promise<PaginatedResponse<Role>> {
    return this.client.get<PaginatedResponse<Role>>("/items/baasix_Role", {
      params: { limit: -1 },
    });
  }

  /**
   * Create CRUD permissions for a collection
   *
   * @example
   * ```typescript
   * await baasix.permissions.createCrudPermissions('role-uuid', 'products', {
   *   create: { fields: ['name', 'price', 'description'] },
   *   read: { fields: ['*'] },
   *   update: { fields: ['name', 'price', 'description'] },
   *   delete: false
   * });
   * ```
   */
  async createCrudPermissions(
    roleId: string,
    collection: string,
    config: {
      create?: { fields?: string[]; conditions?: Permission["conditions"] } | false;
      read?: { fields?: string[]; conditions?: Permission["conditions"] } | false;
      update?: { fields?: string[]; conditions?: Permission["conditions"] } | false;
      delete?: { conditions?: Permission["conditions"] } | false;
    }
  ): Promise<Permission[]> {
    const permissions: Permission[] = [];
    const actions: PermissionAction[] = ["create", "read", "update", "delete"];

    for (const action of actions) {
      const actionConfig = config[action];
      if (actionConfig === false) continue;

      const permission = await this.create({
        role_Id: roleId,
        collection,
        action,
        fields: (actionConfig as { fields?: string[] })?.fields || ["*"],
        conditions: (actionConfig as { conditions?: Permission["conditions"] })?.conditions,
      });

      permissions.push(permission);
    }

    return permissions;
  }

  /**
   * Reload permissions cache (admin only)
   *
   * @example
   * ```typescript
   * await baasix.permissions.reloadCache();
   * ```
   */
  async reloadCache(): Promise<void> {
    await this.client.post("/permissions/reload");
  }
}

// Re-export types
export type {
  CreatePermissionData,
  Permission,
  PermissionAction,
  Role,
};
