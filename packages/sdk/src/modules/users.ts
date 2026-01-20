import type { HttpClient } from "../client";

export interface UsersModuleConfig {
  client: HttpClient;
}

export interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  avatar?: string;
  status?: "active" | "suspended" | "invited";
  role_Id?: string;
  role?: {
    id: string;
    name: string;
  };
  emailVerified?: boolean;
  totpEnabled?: boolean;
  lastAccess?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateUserData {
  email: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  avatar?: string;
  status?: "active" | "suspended" | "invited";
  role_Id?: string;
}

export interface UpdateUserData {
  email?: string;
  firstName?: string;
  lastName?: string;
  avatar?: string;
  status?: "active" | "suspended" | "invited";
  role_Id?: string;
}

export interface UserQueryOptions {
  filter?: Record<string, any>;
  sort?: string;
  limit?: number;
  page?: number;
  fields?: string[];
}

/**
 * Users module for managing users (admin operations).
 * 
 * @example
 * ```typescript
 * // List all users
 * const users = await baasix.users.find();
 * 
 * // Create a new user
 * const user = await baasix.users.create({
 *   email: 'user@example.com',
 *   firstName: 'John',
 *   lastName: 'Doe',
 *   role_Id: 'role-uuid'
 * });
 * ```
 */
export class UsersModule {
  private client: HttpClient;
  private collection = "baasix_User";

  constructor(config: UsersModuleConfig) {
    this.client = config.client;
  }

  /**
   * Get all users with optional filtering
   * 
   * @example
   * ```typescript
   * const { data: users } = await baasix.users.find({
   *   filter: { status: { eq: 'active' } },
   *   limit: 20
   * });
   * ```
   */
  async find(options: UserQueryOptions = {}): Promise<{ data: User[]; totalCount: number }> {
    const params: Record<string, any> = {};
    
    if (options.filter) {
      params.filter = JSON.stringify(options.filter);
    }
    if (options.sort) {
      params.sort = options.sort;
    }
    if (options.limit !== undefined) {
      params.limit = options.limit;
    }
    if (options.page !== undefined) {
      params.page = options.page;
    }
    if (options.fields?.length) {
      params.fields = options.fields.join(",");
    }

    return this.client.get<{ data: User[]; totalCount: number }>(
      `/items/${this.collection}`,
      { params }
    );
  }

  /**
   * Get a user by ID
   * 
   * @example
   * ```typescript
   * const user = await baasix.users.findOne('user-uuid');
   * ```
   */
  async findOne(id: string, fields?: string[]): Promise<User> {
    const params: Record<string, any> = {};
    if (fields?.length) {
      params.fields = fields.join(",");
    }

    const response = await this.client.get<{ data: User }>(
      `/items/${this.collection}/${id}`,
      { params }
    );
    return response.data;
  }

  /**
   * Get a user by email
   * 
   * @example
   * ```typescript
   * const user = await baasix.users.findByEmail('user@example.com');
   * ```
   */
  async findByEmail(email: string): Promise<User | null> {
    const response = await this.client.get<{ data: User[]; totalCount: number }>(
      `/items/${this.collection}`,
      {
        params: {
          filter: JSON.stringify({ email: { eq: email } }),
          limit: 1,
        },
      }
    );
    return response.data[0] || null;
  }

  /**
   * Create a new user
   * 
   * @example
   * ```typescript
   * const id = await baasix.users.create({
   *   email: 'user@example.com',
   *   password: 'securepassword',
   *   firstName: 'John',
   *   lastName: 'Doe',
   *   role_Id: 'role-uuid'
   * });
   * ```
   */
  async create(data: CreateUserData): Promise<string> {
    const response = await this.client.post<{ data: { id: string } }>(
      `/items/${this.collection}`,
      data
    );
    return response.data.id;
  }

  /**
   * Update a user
   * 
   * @example
   * ```typescript
   * await baasix.users.update('user-uuid', {
   *   firstName: 'Jane'
   * });
   * ```
   */
  async update(id: string, data: UpdateUserData): Promise<void> {
    await this.client.patch(`/items/${this.collection}/${id}`, data);
  }

  /**
   * Delete a user
   * 
   * @example
   * ```typescript
   * await baasix.users.delete('user-uuid');
   * ```
   */
  async delete(id: string): Promise<void> {
    await this.client.delete(`/items/${this.collection}/${id}`);
  }

  /**
   * Change a user's password (admin operation)
   * 
   * @example
   * ```typescript
   * await baasix.users.changePassword('user-uuid', 'newpassword');
   * ```
   */
  async changePassword(userId: string, newPassword: string): Promise<void> {
    await this.client.post("/auth/admin/change-password", {
      userId,
      password: newPassword,
    });
  }

  /**
   * Suspend a user
   * 
   * @example
   * ```typescript
   * await baasix.users.suspend('user-uuid');
   * ```
   */
  async suspend(id: string): Promise<void> {
    await this.client.patch(`/items/${this.collection}/${id}`, {
      status: "suspended",
    });
  }

  /**
   * Activate a user
   * 
   * @example
   * ```typescript
   * await baasix.users.activate('user-uuid');
   * ```
   */
  async activate(id: string): Promise<void> {
    await this.client.patch(`/items/${this.collection}/${id}`, {
      status: "active",
    });
  }

  /**
   * Bulk create users
   * 
   * @example
   * ```typescript
   * const ids = await baasix.users.createMany([
   *   { email: 'user1@example.com', firstName: 'User 1' },
   *   { email: 'user2@example.com', firstName: 'User 2' }
   * ]);
   * ```
   */
  async createMany(users: CreateUserData[]): Promise<string[]> {
    const response = await this.client.post<{ data: string[] }>(
      `/items/${this.collection}/bulk`,
      users
    );
    return response.data;
  }

  /**
   * Bulk delete users
   * 
   * @example
   * ```typescript
   * await baasix.users.deleteMany(['user-uuid-1', 'user-uuid-2']);
   * ```
   */
  async deleteMany(ids: string[]): Promise<void> {
    await this.client.delete(`/items/${this.collection}/bulk`, {
      body: JSON.stringify(ids),
    });
  }
}
