/**
 * Plugin System Types
 * Shared types for Baasix plugin development
 */

import type { SchemaDefinition } from "./schema";
import type { Accountability } from "./auth";
import type { MailOptions, HttpMethod } from "./common";
import type { ReportConfig, ReportResult, StatsQuery, StatsResult } from "./query";
import type { FileMetadata } from "./files";
import type { Notification, NotificationOptions } from "./notification";

// ============================================================================
// Express Types (actual Express types from @types/express)
// Core packages should import Express types from here for consistency.
// ============================================================================

import type {
  Request as ExpressRequestType,
  Response as ExpressResponseType,
  NextFunction as ExpressNextFunctionType,
  Express as ExpressType,
  Router as RouterType,
} from "express";

/** Express Request type */
export type Request = ExpressRequestType;
/** Express Response type */
export type Response = ExpressResponseType;
/** Express NextFunction type */
export type NextFunction = ExpressNextFunctionType;
/** Express Application type */
export type Express = ExpressType;
/** Express Router type */
export type Router = RouterType;

/** Type aliases for clarity */
export type ExpressRequest = ExpressRequestType;
export type ExpressResponse = ExpressResponseType;
export type ExpressNextFunction = ExpressNextFunctionType;
export type ExpressApp = ExpressType;
export type ExpressRouter = RouterType;

// ============================================================================
// Express-Compatible Types (for plugins that don't want express dependency)
// These types are compatible with Express but don't require express as a dependency.
// They can be used directly in plugins or overridden with actual Express types.
// ============================================================================

/**
 * Generic request type (compatible with Express Request)
 */
export interface PluginRequest {
  params: Record<string, string>;
  query: Record<string, any>;
  body: any;
  headers: Record<string, string | string[] | undefined>;
  method: string;
  path: string;
  url: string;
  originalUrl: string;
  baseUrl: string;
  cookies?: Record<string, string>;
  signedCookies?: Record<string, string>;
  ip?: string;
  ips?: string[];
  hostname?: string;
  protocol?: string;
  secure?: boolean;
  xhr?: boolean;
  accountability?: Accountability;
  get(header: string): string | undefined;
  header(header: string): string | undefined;
  accepts(...types: string[]): string | false;
  is(type: string): string | false | null;
  [key: string]: any;
}

/**
 * Generic response type (compatible with Express Response)
 */
export interface PluginResponse {
  status(code: number): PluginResponse;
  sendStatus(code: number): PluginResponse;
  json(data: any): PluginResponse;
  send(data: any): PluginResponse;
  end(data?: any): PluginResponse;
  set(header: string, value: string | string[]): PluginResponse;
  set(headers: Record<string, string | string[]>): PluginResponse;
  header(header: string, value: string | string[]): PluginResponse;
  get(header: string): string | undefined;
  type(type: string): PluginResponse;
  contentType(type: string): PluginResponse;
  redirect(url: string): void;
  redirect(status: number, url: string): void;
  cookie(name: string, value: string, options?: Record<string, any>): PluginResponse;
  clearCookie(name: string, options?: Record<string, any>): PluginResponse;
  attachment(filename?: string): PluginResponse;
  download(path: string, filename?: string): void;
  locals: Record<string, any>;
  headersSent: boolean;
  statusCode: number;
  [key: string]: any;
}

/**
 * Generic next function type (compatible with Express NextFunction)
 */
export type PluginNextFunction = (error?: any) => void;

/**
 * Generic Express application type
 */
export interface PluginApp {
  use(...handlers: any[]): PluginApp;
  get(path: string, ...handlers: any[]): PluginApp;
  post(path: string, ...handlers: any[]): PluginApp;
  put(path: string, ...handlers: any[]): PluginApp;
  patch(path: string, ...handlers: any[]): PluginApp;
  delete(path: string, ...handlers: any[]): PluginApp;
  options(path: string, ...handlers: any[]): PluginApp;
  all(path: string, ...handlers: any[]): PluginApp;
  listen(port: number, callback?: () => void): any;
  set(setting: string, value: any): PluginApp;
  get(setting: string): any;
  locals: Record<string, any>;
  [key: string]: any;
}

/**
 * Generic Router type (compatible with Express Router)
 */
export interface PluginRouter {
  use(...handlers: any[]): PluginRouter;
  get(path: string, ...handlers: any[]): PluginRouter;
  post(path: string, ...handlers: any[]): PluginRouter;
  put(path: string, ...handlers: any[]): PluginRouter;
  patch(path: string, ...handlers: any[]): PluginRouter;
  delete(path: string, ...handlers: any[]): PluginRouter;
  options(path: string, ...handlers: any[]): PluginRouter;
  all(path: string, ...handlers: any[]): PluginRouter;
  [key: string]: any;
}

// ============================================================================
// Service Interfaces
// ============================================================================

/**
 * Base service options with accountability
 */
export interface ServiceOptions {
  accountability?: Accountability;
  [key: string]: any;
}

/**
 * Items service interface for CRUD operations
 * Note: Actual implementations may have additional methods and different signatures.
 * The index signature provides flexibility for all implementations.
 */
export interface IItemsService {
  [key: string]: any;
}

/**
 * Permission service interface
 */
export interface IPermissionService {
  [key: string]: any;
}

/**
 * Mail service interface
 */
export interface IMailService {
  [key: string]: any;
}

/**
 * Storage service interface
 */
export interface IStorageService {
  [key: string]: any;
}

/**
 * Settings service interface
 */
export interface ISettingsService {
  [key: string]: any;
}

/**
 * Socket service interface
 */
export interface ISocketService {
  [key: string]: any;
}

/**
 * Realtime service interface
 */
export interface IRealtimeService {
  [key: string]: any;
}

/**
 * Tasks service interface
 */
export interface ITasksService {
  [key: string]: any;
}

/**
 * Workflow service interface
 */
export interface IWorkflowService {
  [key: string]: any;
}

/**
 * Migration service interface
 */
export interface IMigrationService {
  [key: string]: any;
}

/**
 * Hook function type - called during lifecycle events
 */
export type HookFunction = (context: PluginHookContext) => Promise<PluginHookContext> | PluginHookContext;

/**
 * Hooks manager interface - manages lifecycle hooks for collections
 */
export interface IHooksManager {
  /**
   * Register a hook for a collection and event
   * @param collection - Collection name (use '*' for all collections)
   * @param event - Event name (e.g., 'items.create', 'items.update')
   * @param hookFunction - Function to execute
   */
  registerHook(collection: string, event: string, hookFunction: HookFunction): void;

  /**
   * Get hooks for a collection and event
   * @param collection - Collection name
   * @param event - Event name
   * @returns Array of registered hook functions
   */
  getHooks(collection: string, event: string): HookFunction[];

  /**
   * Execute hooks for a collection and event
   * @param collection - Collection name
   * @param event - Event name
   * @param accountability - User/role accountability info
   * @param context - Hook context with data
   * @returns Modified context after all hooks execute
   */
  executeHooks(
    collection: string,
    event: string,
    accountability: Accountability | undefined,
    context: PluginHookContext
  ): Promise<PluginHookContext>;

  /**
   * Load hooks from extensions directory
   * @param context - Plugin context
   * @param directory - Optional directory path
   */
  loadHooksFromDirectory?(context: any, directory?: string): Promise<void>;

  /**
   * Load schedules from extensions directory
   * @param context - Plugin context
   * @param schedule - Schedule manager
   * @param directory - Optional directory path
   */
  loadSchedulesFromDirectory?(context: any, schedule: any, directory?: string): Promise<void>;

  /** Allow additional methods/properties */
  [key: string]: any;
}

/**
 * Cache service interface
 */
export interface ICacheService {
  [key: string]: any;
}

/**
 * Files service interface
 */
export interface IFilesService {
  [key: string]: any;
}

/**
 * Assets service interface
 */
export interface IAssetsService {
  [key: string]: any;
}

/**
 * Notification service interface
 */
export interface INotificationService {
  [key: string]: any;
}

/**
 * Report service interface
 */
export interface IReportService {
  [key: string]: any;
}

/**
 * Stats service interface
 */
export interface IStatsService {
  [key: string]: any;
}

// ============================================================================
// Plugin Types
// ============================================================================

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
 */
export interface PluginSchemaDefinition {
  collectionName: string;
  schema: SchemaDefinition;
}

/**
 * Plugin route handler context - available in route handlers
 */
export interface PluginRouteContext {
  /** Database connection */
  db: any;
  /** ItemsService class for CRUD operations */
  ItemsService: new (...args: any[]) => IItemsService;
  /** Registered plugin services */
  services: Record<string, any>;
  /** Permission service (singleton) */
  permissionService?: IPermissionService;
  /** Mail service (singleton) */
  mailService?: IMailService;
  /** Storage service (singleton) */
  storageService?: IStorageService;
  /** Settings service (singleton) */
  settingsService?: ISettingsService;
  /** Socket service (singleton) */
  socketService?: ISocketService;
  /** Realtime service (singleton) */
  realtimeService?: IRealtimeService;
  /** Tasks service (singleton) */
  tasksService?: ITasksService;
  /** Workflow service (singleton) */
  workflowService?: IWorkflowService;
  /** Migration service (singleton) */
  migrationService?: IMigrationService;
  /** Get cache service instance */
  getCacheService?: () => ICacheService;
  /** FilesService class */
  FilesService?: new (...args: any[]) => IFilesService;
  /** AssetsService class */
  AssetsService?: new (...args: any[]) => IAssetsService;
  /** NotificationService class */
  NotificationService?: new (...args: any[]) => INotificationService;
  /** ReportService class */
  ReportService?: new (...args: any[]) => IReportService;
  /** StatsService class */
  StatsService?: new (...args: any[]) => IStatsService;
  /** Plugin configuration */
  config: Record<string, any>;
}

/**
 * Plugin route handler function
 */
export type PluginRouteHandler<TReq = PluginRequest, TRes = PluginResponse> = (
  req: TReq,
  res: TRes,
  context: PluginRouteContext
) => Promise<any> | any;

/**
 * Plugin route definition
 */
export interface PluginRoute<TReq = PluginRequest, TRes = PluginResponse> {
  /** Route path (e.g., '/payments/stripe/checkout') */
  path: string;
  /** HTTP method */
  method: HttpMethod;
  /** Route handler */
  handler: PluginRouteHandler<TReq, TRes>;
  /** Whether authentication is required */
  requireAuth?: boolean;
  /** Whether to parse raw body (for webhooks) */
  rawBody?: boolean;
  /** Custom middleware for this route */
  middleware?: Array<(req: TReq, res: TRes, next: PluginNextFunction) => void>;
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
 * Plugin hook context - passed to hook handlers
 * All properties are optional to allow flexibility in different contexts
 */
export interface PluginHookContext {
  collection?: string;
  accountability?: Accountability;
  db?: any;
  data?: any;
  id?: string | number;
  query?: any;
  schema?: any;
  transaction?: any;
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
 * Plugin context - passed to lifecycle hooks and service factories
 */
export interface PluginContext extends PluginRouteContext {
  /** Hooks manager (singleton) */
  hooksManager?: IHooksManager;
  /** Invalidate cache for a collection */
  invalidateCache?: (collection?: string) => Promise<void>;
  /** Express app instance (when available) */
  app?: PluginApp;
  /** Get another plugin's service */
  getPluginService: (pluginName: string, serviceName: string) => any;
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
 * OAuth2 configuration
 */
export interface OAuth2Config {
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string[];
}

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
  oauth2Config?: OAuth2Config;
  /** Custom authentication handler */
  authenticate?: (
    credentials: Record<string, any>,
    context: PluginContext
  ) => Promise<{ user: any; account?: any } | null>;
  /** Custom routes for this provider */
  routes?: PluginRoute[];
}

/**
 * Plugin middleware definition
 */
export interface PluginMiddleware<TReq = PluginRequest, TRes = PluginResponse> {
  /** Middleware name (for debugging) */
  name: string;
  /** Path pattern (optional, defaults to all routes) */
  path?: string;
  /** Middleware handler */
  handler: (req: TReq, res: TRes, next: PluginNextFunction) => void;
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
  /** Called when the plugin is initialized */
  onInit?: (context: PluginContext) => Promise<void>;
  /** Called when all plugins are loaded and server is ready */
  onReady?: (context: PluginContext) => Promise<void>;
  /** Called when the server is shutting down */
  onShutdown?: (context: PluginContext) => Promise<void>;
}

/**
 * Plugin factory function - creates a plugin with configuration
 */
export type PluginFactory<TConfig = Record<string, any>> = (
  config: TConfig
) => PluginDefinition;

/**
 * Baasix plugin type
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
export interface StartServerOptions {
  /** Server port */
  port?: number;
  /** Plugins to load */
  plugins?: BaasixPlugin[];
  /** Plugin manager options */
  pluginOptions?: PluginManagerOptions;
}

// ============================================================================
// Express-Typed Plugin Types
// These types use actual Express types for core package usage.
// Plugins that don't want express dependency should use the generic versions above.
// ============================================================================

/**
 * Plugin route handler function with Express types
 */
export type ExpressPluginRouteHandler = (
  req: Request,
  res: Response,
  context: PluginRouteContext
) => Promise<any> | any;

/**
 * Plugin route definition with Express types
 */
export interface ExpressPluginRoute extends Omit<PluginRoute, 'handler' | 'middleware'> {
  /** Route handler */
  handler: ExpressPluginRouteHandler;
  /** Custom middleware for this route */
  middleware?: Array<(req: Request, res: Response, next: NextFunction) => void>;
}

/**
 * Plugin middleware definition with Express types
 */
export interface ExpressPluginMiddleware extends Omit<PluginMiddleware, 'handler'> {
  /** Middleware handler */
  handler: (req: Request, res: Response, next: NextFunction) => void;
}

/**
 * Plugin context with Express types
 */
export interface ExpressPluginContext extends PluginRouteContext {
  /** Hooks manager (singleton) - lifecycle hooks for collections */
  hooksManager?: IHooksManager;
  /** Invalidate cache for a collection */
  invalidateCache?: (collection?: string) => Promise<void>;
  /** Express app instance */
  app?: Express;
  /** Get another plugin's service */
  getPluginService: (pluginName: string, serviceName: string) => any;
}
