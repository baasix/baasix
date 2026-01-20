import type { HttpClient } from "../client";
import type { BaseItem } from "../types";

export interface RolesModuleConfig {
  client: HttpClient;
}

export interface Role extends BaseItem {
  name: string;
  description?: string;
  icon?: string;
  ipWhitelist?: string;
  enforceTotp?: boolean;
  adminAccess?: boolean;
  appAccess?: boolean;
}

export interface CreateRoleData {
  name: string;
  description?: string;
  icon?: string;
  ipWhitelist?: string;
  enforceTotp?: boolean;
  adminAccess?: boolean;
  appAccess?: boolean;
}

/**
 * Roles module for managing user roles.
 * 
 * @example
 * ```typescript
 * // List all roles
 * const roles = await baasix.roles.find();
 * 
 * // Create a new role
 * const role = await baasix.roles.create({
 *   name: 'Editor',
 *   description: 'Can edit content'
 * });
 * ```
 */
export class RolesModule {
  private client: HttpClient;
  private collection = "baasix_Role";

  constructor(config: RolesModuleConfig) {
    this.client = config.client;
  }

  /**
   * Get all roles
   * 
   * @example
   * ```typescript
   * const { data: roles } = await baasix.roles.find();
   * ```
   */
  async find(): Promise<{ data: Role[]; totalCount: number }> {
    return this.client.get<{ data: Role[]; totalCount: number }>(
      `/items/${this.collection}`,
      {
        params: { limit: -1 },
      }
    );
  }

  /**
   * Get a role by ID
   * 
   * @example
   * ```typescript
   * const role = await baasix.roles.findOne('role-uuid');
   * ```
   */
  async findOne(id: string): Promise<Role> {
    const response = await this.client.get<{ data: Role }>(
      `/items/${this.collection}/${id}`
    );
    return response.data;
  }

  /**
   * Get a role by name
   * 
   * @example
   * ```typescript
   * const role = await baasix.roles.findByName('Administrator');
   * ```
   */
  async findByName(name: string): Promise<Role | null> {
    const response = await this.client.get<{ data: Role[]; totalCount: number }>(
      `/items/${this.collection}`,
      {
        params: {
          filter: JSON.stringify({ name: { eq: name } }),
          limit: 1,
        },
      }
    );
    return response.data[0] || null;
  }

  /**
   * Create a new role
   * 
   * @example
   * ```typescript
   * const id = await baasix.roles.create({
   *   name: 'Editor',
   *   description: 'Content editor role',
   *   appAccess: true
   * });
   * ```
   */
  async create(data: CreateRoleData): Promise<string> {
    const response = await this.client.post<{ data: { id: string } }>(
      `/items/${this.collection}`,
      data
    );
    return response.data.id;
  }

  /**
   * Update a role
   * 
   * @example
   * ```typescript
   * await baasix.roles.update('role-uuid', {
   *   description: 'Updated description'
   * });
   * ```
   */
  async update(id: string, data: Partial<CreateRoleData>): Promise<void> {
    await this.client.patch(`/items/${this.collection}/${id}`, data);
  }

  /**
   * Delete a role
   * 
   * @example
   * ```typescript
   * await baasix.roles.delete('role-uuid');
   * ```
   */
  async delete(id: string): Promise<void> {
    await this.client.delete(`/items/${this.collection}/${id}`);
  }
}
