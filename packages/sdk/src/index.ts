import { HttpClient } from "./client";
import { LocalStorageAdapter } from "./storage/localStorage";
import { MemoryStorageAdapter } from "./storage/memoryStorage";
import type { StorageAdapter } from "./storage/types";
import { STORAGE_KEYS } from "./storage/types";
import { AuthModule } from "./modules/auth";
import { ItemsModule } from "./modules/items";
import { FilesModule } from "./modules/files";
import { SchemasModule } from "./modules/schemas";
import { NotificationsModule } from "./modules/notifications";
import { PermissionsModule } from "./modules/permissions";
import { SettingsModule } from "./modules/settings";
import { ReportsModule } from "./modules/reports";
import { WorkflowsModule } from "./modules/workflows";
import { RealtimeModule } from "./modules/realtime";
import { RolesModule } from "./modules/roles";
import { UsersModule } from "./modules/users";
import { MigrationsModule } from "./modules/migrations";
import { ServerModule } from "./modules/server";
import type { AuthMode, BaasixConfig, BaseItem } from "./types";

/**
 * Detect the current environment and return appropriate storage
 */
function getDefaultStorage(): StorageAdapter {
  // Browser environment with localStorage
  if (
    typeof window !== "undefined" &&
    typeof window.localStorage !== "undefined"
  ) {
    return new LocalStorageAdapter();
  }

  // SSR or Node.js environment
  return new MemoryStorageAdapter();
}

/**
 * The main Baasix SDK client.
 *
 * @example
 * ```typescript
 * import { createBaasix } from '@baasix/sdk';
 *
 * // Basic setup
 * const baasix = createBaasix({
 *   url: 'https://api.example.com'
 * });
 *
 * // With custom storage (React Native)
 * import AsyncStorage from '@react-native-async-storage/async-storage';
 * import { AsyncStorageAdapter } from '@baasix/sdk';
 *
 * const baasix = createBaasix({
 *   url: 'https://api.example.com',
 *   storage: new AsyncStorageAdapter(AsyncStorage)
 * });
 *
 * // Cookie mode (for web apps with HTTP-only cookies)
 * const baasix = createBaasix({
 *   url: 'https://api.example.com',
 *   authMode: 'cookie'
 * });
 *
 * // Server-side with static token
 * const baasix = createBaasix({
 *   url: 'https://api.example.com',
 *   token: 'your-api-token'
 * });
 * ```
 */
export class Baasix {
  private config: Required<
    Pick<BaasixConfig, "url" | "authMode" | "timeout" | "autoRefresh">
  > &
    BaasixConfig;
  private httpClient: HttpClient;
  private storage: StorageAdapter;

  // Modules
  public readonly auth: AuthModule;
  public readonly files: FilesModule;
  public readonly schemas: SchemasModule;
  public readonly notifications: NotificationsModule;
  public readonly permissions: PermissionsModule;
  public readonly settings: SettingsModule;
  public readonly reports: ReportsModule;
  public readonly workflows: WorkflowsModule;
  public readonly realtime: RealtimeModule;
  public readonly roles: RolesModule;
  public readonly users: UsersModule;
  public readonly migrations: MigrationsModule;
  public readonly server: ServerModule;

  // Items module factory cache
  private itemsModules: Map<string, ItemsModule<BaseItem>> = new Map();

  constructor(config: BaasixConfig) {
    // Validate required config
    if (!config.url) {
      throw new Error("Baasix SDK: url is required");
    }

    // Normalize URL (remove trailing slash)
    const normalizedUrl = config.url.replace(/\/$/, "");

    // Set defaults
    this.config = {
      ...config,
      url: normalizedUrl,
      authMode: config.authMode || "jwt",
      timeout: config.timeout || 600000, // 10 minutes default
      autoRefresh: config.autoRefresh !== false,
    };

    // Initialize storage
    this.storage = config.storage || getDefaultStorage();

    // Determine credentials mode
    const credentials: RequestCredentials =
      config.credentials ||
      (this.config.authMode === "cookie" ? "include" : "same-origin");

    // Initialize HTTP client
    this.httpClient = new HttpClient({
      baseUrl: normalizedUrl,
      authMode: this.config.authMode,
      storage: this.storage,
      timeout: this.config.timeout,
      autoRefresh: this.config.autoRefresh,
      credentials,
      headers: config.headers || {},
      token: config.token,
      tenantId: config.tenantId,
      onAuthError: () => {
        this.config.onAuthStateChange?.("SIGNED_OUT", null);
      },
      onTokenRefresh: () => {
        // Token refreshed, could emit event if needed
      },
    });

    // Initialize modules
    this.auth = new AuthModule({
      client: this.httpClient,
      storage: this.storage,
      authMode: this.config.authMode,
      onAuthStateChange: config.onAuthStateChange,
    });

    this.files = new FilesModule({ client: this.httpClient });
    this.schemas = new SchemasModule({ client: this.httpClient });
    this.notifications = new NotificationsModule({ client: this.httpClient });
    this.permissions = new PermissionsModule({ client: this.httpClient });
    this.settings = new SettingsModule({ client: this.httpClient });
    this.reports = new ReportsModule({ client: this.httpClient });
    this.workflows = new WorkflowsModule({ client: this.httpClient });
    this.roles = new RolesModule({ client: this.httpClient });
    this.users = new UsersModule({ client: this.httpClient });
    this.migrations = new MigrationsModule({ client: this.httpClient });
    this.server = new ServerModule({ client: this.httpClient });
    
    // Realtime module needs storage for auth token
    this.realtime = new RealtimeModule({
      client: this.httpClient,
      storage: this.storage,
      socketUrl: config.socketUrl,
      socketPath: config.socketPath,
    });
  }

  /**
   * Get an Items module for a specific collection.
   * Returns a cached instance for repeated calls with the same collection.
   *
   * @example
   * ```typescript
   * // Get items module
   * const products = baasix.items('products');
   *
   * // CRUD operations
   * const { data } = await products.find({ filter: { status: { eq: 'active' } } });
   * const product = await products.findOne('product-uuid');
   * const id = await products.create({ name: 'New Product', price: 29.99 });
   * await products.update('product-uuid', { price: 24.99 });
   * await products.delete('product-uuid');
   *
   * // Query builder
   * const results = await baasix.items('posts')
   *   .query()
   *   .select('*', 'author.*')
   *   .filter({ status: { eq: 'published' } })
   *   .sort({ createdAt: 'desc' })
   *   .limit(10)
   *   .get();
   * ```
   */
  items<T extends BaseItem = BaseItem>(collection: string): ItemsModule<T> {
    if (!this.itemsModules.has(collection)) {
      this.itemsModules.set(
        collection,
        new ItemsModule(collection, { client: this.httpClient })
      );
    }
    return this.itemsModules.get(collection) as ItemsModule<T>;
  }

  /**
   * Alias for items() - get a collection
   *
   * @example
   * ```typescript
   * const products = baasix.collection('products');
   * ```
   */
  collection<T extends BaseItem = BaseItem>(collection: string): ItemsModule<T> {
    return this.items<T>(collection);
  }

  /**
   * Alias for items() - from a collection (Supabase-style)
   *
   * @example
   * ```typescript
   * const products = baasix.from('products');
   * ```
   */
  from<T extends BaseItem = BaseItem>(collection: string): ItemsModule<T> {
    return this.items<T>(collection);
  }

  /**
   * Get the underlying HTTP client for custom requests
   *
   * @example
   * ```typescript
   * // Custom GET request
   * const data = await baasix.request.get('/custom-endpoint');
   *
   * // Custom POST request
   * const result = await baasix.request.post('/custom-endpoint', { data: 'value' });
   * ```
   */
  get request(): HttpClient {
    return this.httpClient;
  }

  /**
   * Update SDK configuration
   *
   * @example
   * ```typescript
   * baasix.configure({
   *   headers: { 'X-Custom-Header': 'value' }
   * });
   * ```
   */
  configure(config: Partial<BaasixConfig>): void {
    if (config.headers) {
      this.httpClient.updateConfig({ headers: config.headers });
    }
    if (config.tenantId !== undefined) {
      this.httpClient.updateConfig({ tenantId: config.tenantId });
    }
    if (config.token) {
      this.httpClient.updateConfig({ token: config.token });
    }
    if (config.timeout) {
      this.httpClient.updateConfig({ timeout: config.timeout });
    }
  }

  /**
   * Set the tenant for multi-tenant mode
   *
   * @example
   * ```typescript
   * baasix.setTenant('tenant-uuid');
   * ```
   */
  async setTenant(tenantId: string): Promise<void> {
    this.httpClient.updateConfig({ tenantId });
    await this.storage.set(STORAGE_KEYS.TENANT, tenantId);
  }

  /**
   * Get the current tenant ID
   */
  async getTenant(): Promise<string | null> {
    return await this.storage.get(STORAGE_KEYS.TENANT);
  }

  /**
   * Clear the tenant
   */
  async clearTenant(): Promise<void> {
    this.httpClient.updateConfig({ tenantId: undefined });
    await this.storage.remove(STORAGE_KEYS.TENANT);
  }

  /**
   * Set a static token (convenience method that delegates to auth.setToken)
   *
   * @example
   * ```typescript
   * baasix.setToken('your-api-token');
   * ```
   */
  async setToken(token: string): Promise<void> {
    return this.auth.setToken(token);
  }

  /**
   * Get the current auth token
   */
  async getToken(): Promise<string | null> {
    return this.storage.get(STORAGE_KEYS.ACCESS_TOKEN);
  }

  /**
   * Get the base URL
   */
  getUrl(): string {
    return this.config.url;
  }

  /**
   * Get the current auth mode
   */
  getAuthMode(): AuthMode {
    return this.config.authMode;
  }

  /**
   * Get the storage adapter
   */
  getStorage(): StorageAdapter {
    return this.storage;
  }
}

/**
 * Create a new Baasix SDK instance.
 *
 * @example
 * ```typescript
 * import { createBaasix } from '@baasix/sdk';
 *
 * const baasix = createBaasix({
 *   url: 'https://api.example.com',
 *   authMode: 'jwt', // or 'cookie'
 *   onAuthStateChange: (event, user) => {
 *     console.log('Auth state changed:', event, user);
 *   }
 * });
 *
 * // Initialize on app startup
 * await baasix.auth.initialize();
 *
 * // Check if user is authenticated
 * if (await baasix.auth.isAuthenticated()) {
 *   const user = await baasix.auth.getUser();
 *   console.log('Logged in as:', user?.email);
 * }
 * ```
 */
export function createBaasix(config: BaasixConfig): Baasix {
  return new Baasix(config);
}

// Export everything
export { HttpClient } from "./client";
export type { RequestOptions, HttpClientConfig } from "./client";

// Storage exports
export {
  LocalStorageAdapter,
  MemoryStorageAdapter,
  AsyncStorageAdapter,
  STORAGE_KEYS,
} from "./storage/index";
export type { StorageAdapter, StorageKey } from "./storage/index";

// Module exports
export { AuthModule } from "./modules/auth";
export type { 
  OAuthProvider, 
  OAuthOptions, 
  InviteOptions, 
  VerifyInviteResult 
} from "./modules/auth";
export { ItemsModule, QueryBuilder } from "./modules/items";
export type { ImportResult } from "./modules/items";
export { FilesModule } from "./modules/files";
export { SchemasModule } from "./modules/schemas";
export { NotificationsModule } from "./modules/notifications";
export { PermissionsModule } from "./modules/permissions";
export { SettingsModule } from "./modules/settings";
export { ReportsModule } from "./modules/reports";
export type { StatsQuery, StatsResult } from "./modules/reports";
export { WorkflowsModule } from "./modules/workflows";
export { RealtimeModule, RealtimeChannel } from "./modules/realtime";
export type { 
  RealtimeConfig, 
  SubscriptionEvent, 
  SubscriptionPayload, 
  WorkflowExecutionUpdate,
  SubscriptionCallback 
} from "./modules/realtime";
export { RolesModule } from "./modules/roles";
export type { Role, CreateRoleData } from "./modules/roles";
export { UsersModule } from "./modules/users";
export type { CreateUserData, UpdateUserData, UserQueryOptions } from "./modules/users";
export { MigrationsModule } from "./modules/migrations";
export type { 
  MigrationStatus, 
  Migration, 
  PendingMigration, 
  MigrationRunOptions,
  MigrationRunResult, 
  RollbackResult,
  CreateMigrationOptions 
} from "./modules/migrations";

// Type exports
export * from "./types";
