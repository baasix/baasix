/**
 * Baasix Plugin System Type Definitions
 *
 * This file contains all type definitions for the plugin system.
 * Plugins can extend Baasix with schemas, routes, hooks, services, and more.
 */

import type { Request, Response, NextFunction, Express } from "express";
import type { HooksManager } from "../services/HooksManager.js";

/**
 * Plugin types categorize plugins by their primary function
 */
export type PluginType =
  | "feature"       // E-commerce, CMS, Blog, etc.
  | "auth"          // OAuth providers, OTP, Passkey, etc.
  | "payment"       // Stripe, PayPal, Razorpay, etc.
  | "storage"       // S3, GCS, Cloudinary, etc.
  | "ai"            // RAG, Embeddings, LLM providers, etc.
  | "notification"  // Email, SMS, Push, etc.
  | "integration";  // Third-party integrations

/**
 * Plugin metadata - information about the plugin
 */
export interface PluginMeta {
  /** Unique plugin name (used as identifier) */
  name: string;
  /** Plugin version (semver) */
  version: string;
  /** Plugin type/category */
  type: PluginType;
  /** Human-readable description */
  description?: string;
  /** Plugin author */
  author?: string;
  /** Plugin dependencies (names of other plugins that must be loaded first) */
  dependencies?: string[];
}

/**
 * Schema definition for plugin collections
 * Matches the existing Baasix schema format
 */
export interface PluginSchemaDefinition {
  collectionName: string;
  schema: {
    name: string;
    timestamps?: boolean;
    paranoid?: boolean;
    usertrack?: boolean;
    fields: Record<string, any>;
    indexes?: Array<{
      fields: string[];
      unique?: boolean;
      name?: string;
    }>;
  };
}

/**
 * HTTP methods for plugin routes
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";

/**
 * Plugin route handler context
 */
export interface PluginRouteContext {
  /** Database connection */
  db: any;
  /** ItemsService class for CRUD operations */
  ItemsService: any;
  /** Registered plugin services */
  services: Record<string, any>;
  /** Permission service (singleton) - role-based access control */
  permissionService?: any;
  /** Mail service (singleton) - email sending via SMTP */
  mailService?: any;
  /** Storage service (singleton) - file storage (LOCAL/S3) */
  storageService?: any;
  /** Settings service (singleton) - application settings management */
  settingsService?: any;
  /** Socket service (singleton) - WebSocket/Socket.IO management */
  socketService?: any;
  /** Realtime service (singleton) - PostgreSQL WAL-based change data capture */
  realtimeService?: any;
  /** Tasks service (singleton) - scheduled task execution */
  tasksService?: any;
  /** Workflow service (singleton) - workflow engine */
  workflowService?: any;
  /** Migration service (singleton) - database migrations */
  migrationService?: any;
  /** Cache service - get cache instance for caching operations */
  getCacheService?: () => any;
  /** FilesService class - file upload/download operations */
  FilesService?: any;
  /** AssetsService class - image/asset processing with transformations */
  AssetsService?: any;
  /** NotificationService class - in-app notifications */
  NotificationService?: any;
  /** ReportService class - report generation with aggregation */
  ReportService?: any;
  /** StatsService class - statistics generation from multiple collections */
  StatsService?: any;
  /** Plugin configuration */
  config: Record<string, any>;
}

/**
 * Plugin route handler function
 */
export type PluginRouteHandler = (
  req: Request,
  res: Response,
  context: PluginRouteContext
) => Promise<any> | any;

/**
 * Plugin route definition
 */
export interface PluginRoute {
  /** Route path (e.g., '/payments/stripe/checkout') */
  path: string;
  /** HTTP method */
  method: HttpMethod;
  /** Route handler */
  handler: PluginRouteHandler;
  /** Whether authentication is required */
  requireAuth?: boolean;
  /** Whether to parse raw body (for webhooks) */
  rawBody?: boolean;
  /** Custom middleware for this route */
  middleware?: Array<(req: Request, res: Response, next: NextFunction) => void>;
  /** Route description for documentation */
  description?: string;
}

/**
 * Plugin hook event types
 */
export type PluginHookEvent =
  | "items.create"
  | "items.read"
  | "items.update"
  | "items.delete"
  | "items.create.after"
  | "items.read.after"
  | "items.update.after"
  | "items.delete.after";

/**
 * Plugin hook context
 */
export interface PluginHookContext {
  collection: string;
  accountability: any;
  db: any;
  data?: any;
  id?: string;
  query?: any;
  schema?: any;
  [key: string]: any;
}

/**
 * Plugin hook handler function
 */
export type PluginHookHandler = (
  context: PluginHookContext
) => Promise<PluginHookContext> | PluginHookContext;

/**
 * Plugin hook definition
 */
export interface PluginHook {
  /** Collection name (use '*' for all collections) */
  collection: string;
  /** Hook event */
  event: PluginHookEvent;
  /** Hook handler */
  handler: PluginHookHandler;
  /** Hook priority (lower runs first) */
  priority?: number;
}

/**
 * Plugin service factory function
 */
export type PluginServiceFactory = (context: PluginContext) => any;

/**
 * Plugin service definition
 */
export interface PluginService {
  /** Service name (used to access via context.services.name) */
  name: string;
  /** Service factory function */
  factory: PluginServiceFactory;
}

/**
 * Plugin auth provider type
 */
export type AuthProviderType = "oauth2" | "otp" | "passkey" | "custom";

/**
 * Plugin auth provider definition
 */
export interface PluginAuthProvider {
  /** Provider identifier (e.g., 'github', 'otp') */
  id: string;
  /** Display name */
  name: string;
  /** Provider type */
  type: AuthProviderType;
  /** OAuth2 configuration (for oauth2 type) */
  oauth2Config?: {
    authorizationUrl: string;
    tokenUrl: string;
    userInfoUrl: string;
    clientId: string;
    clientSecret: string;
    scope?: string[];
  };
  /** Custom authentication handler */
  authenticate?: (
    credentials: Record<string, any>,
    context: PluginContext
  ) => Promise<{
    user: any;
    account?: any;
  } | null>;
  /** Custom routes for this provider */
  routes?: PluginRoute[];
}

/**
 * Plugin middleware definition
 */
export interface PluginMiddleware {
  /** Middleware name (for debugging) */
  name: string;
  /** Path pattern (optional, defaults to all routes) */
  path?: string;
  /** Middleware handler */
  handler: (req: Request, res: Response, next: NextFunction) => void;
  /** Priority (lower runs first) */
  priority?: number;
}

/**
 * Plugin schedule definition
 */
export interface PluginSchedule {
  /** Schedule name */
  name: string;
  /** Cron expression */
  cron: string;
  /** Schedule handler */
  handler: (context: PluginContext) => Promise<void> | void;
  /** Whether to run immediately on startup */
  runOnStart?: boolean;
}

/**
 * Plugin context - passed to lifecycle hooks and service factories
 */
export interface PluginContext {
  /** Database connection (Drizzle ORM instance) */
  db: any;
  /** ItemsService class for CRUD operations on collections */
  ItemsService: any;
  /** Registered plugin services (your plugin's services and other plugins) */
  services: Record<string, any>;
  
  // ============================================================================
  // SINGLETON SERVICES (pre-initialized, ready to use directly)
  // ============================================================================
  
  /** Permission service (singleton) - role-based access control, field-level security */
  permissionService?: any;
  /** Mail service (singleton) - email sending via SMTP with Liquid templates */
  mailService?: any;
  /** Storage service (singleton) - file storage abstraction (LOCAL/S3 drivers) */
  storageService?: any;
  /** Settings service (singleton) - global and tenant-specific application settings */
  settingsService?: any;
  /** Socket service (singleton) - WebSocket/Socket.IO management, rooms, custom handlers */
  socketService?: any;
  /** Realtime service (singleton) - PostgreSQL WAL-based realtime change data capture */
  realtimeService?: any;
  /** Tasks service (singleton) - scheduled task execution with Redis distributed locking */
  tasksService?: any;
  /** Workflow service (singleton) - comprehensive workflow engine with multiple node types */
  workflowService?: any;
  /** Migration service (singleton) - database migration execution and tracking */
  migrationService?: any;
  /** Hooks manager (singleton) - lifecycle hooks for collections */
  hooksManager?: HooksManager;
  
  // ============================================================================
  // UTILITY FUNCTIONS
  // ============================================================================
  
  /** Get cache service instance for caching operations */
  getCacheService?: () => any;
  /** Invalidate cache for a collection */
  invalidateCache?: (collection?: string) => Promise<void>;
  
  // ============================================================================
  // CLASS-BASED SERVICES (instantiate per-request with accountability)
  // Usage: new context.FilesService({ accountability })
  // ============================================================================
  
  /** FilesService class - file upload/download with metadata extraction */
  FilesService?: any;
  /** AssetsService class - image processing with transformation (resize, crop, format) */
  AssetsService?: any;
  /** NotificationService class - in-app notifications to multiple users */
  NotificationService?: any;
  /** ReportService class - report generation with grouping and aggregation */
  ReportService?: any;
  /** StatsService class - statistics generation from multiple collections */
  StatsService?: any;
  
  // ============================================================================
  // FRAMEWORK & CONFIGURATION
  // ============================================================================
  
  /** Express app instance */
  app?: Express;
  /** Plugin's own configuration (passed when registering the plugin) */
  config: Record<string, any>;
  /** Get another plugin's service for cross-plugin communication */
  getPluginService: (pluginName: string, serviceName: string) => any;
}

/**
 * Plugin definition - what a plugin provides
 */
export interface PluginDefinition {
  /** Plugin metadata */
  meta: PluginMeta;

  /** Schema extensions - new collections/tables */
  schemas?: PluginSchemaDefinition[];

  /** Route extensions - new API endpoints */
  routes?: PluginRoute[];

  /** Hook extensions - lifecycle hooks */
  hooks?: PluginHook[];

  /** Service extensions - new services */
  services?: PluginService[];

  /** Auth provider extensions */
  authProviders?: PluginAuthProvider[];

  /** Middleware extensions */
  middleware?: PluginMiddleware[];

  /** Scheduled tasks */
  schedules?: PluginSchedule[];

  /**
   * Called when the plugin is initialized (before routes are registered)
   * Use this for setup that doesn't depend on other plugins
   */
  onInit?: (context: PluginContext) => Promise<void>;

  /**
   * Called when all plugins are loaded and server is ready
   * Use this for setup that may depend on other plugins
   */
  onReady?: (context: PluginContext) => Promise<void>;

  /**
   * Called when the server is shutting down
   * Use this for cleanup
   */
  onShutdown?: (context: PluginContext) => Promise<void>;
}

/**
 * Plugin factory function - creates a plugin with configuration
 */
export type PluginFactory<TConfig = Record<string, any>> = (
  config: TConfig
) => PluginDefinition;

/**
 * Baasix plugin - either a definition or a factory result
 */
export type BaasixPlugin = PluginDefinition;

/**
 * Loaded plugin - plugin with runtime state
 */
export interface LoadedPlugin {
  /** Plugin definition */
  definition: PluginDefinition;
  /** Plugin configuration */
  config: Record<string, any>;
  /** Plugin services (instantiated) */
  services: Record<string, any>;
  /** Whether the plugin has been initialized */
  initialized: boolean;
  /** Whether the plugin is ready */
  ready: boolean;
}

/**
 * Plugin manager options
 */
export interface PluginManagerOptions {
  /** Whether to log plugin loading */
  verbose?: boolean;
}

/**
 * Start server options with plugin support
 */
export interface StartServerOptionsWithPlugins {
  /** Server port */
  port?: number;
  /** Plugins to load */
  plugins?: BaasixPlugin[];
  /** Plugin manager options */
  pluginOptions?: PluginManagerOptions;
}
