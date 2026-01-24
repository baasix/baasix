/**
 * Baasix Plugin System Type Definitions
 *
 * This file re-exports all plugin types from @baasix/types.
 * Core package files should import types from here for consistency.
 */

// Re-export all plugin types from @baasix/types
export type {
  // Express types (actual Express types)
  Request,
  Response,
  NextFunction,
  Express,
  Router,
  // Express type aliases
  ExpressRequest,
  ExpressResponse,
  ExpressNextFunction,
  ExpressApp,
  ExpressRouter,
  // Express-compatible types (for plugins that don't want express dependency)
  PluginRequest,
  PluginResponse,
  PluginNextFunction,
  PluginApp,
  PluginRouter,
  // HTTP types
  HttpMethod,
  // Service interfaces
  ServiceOptions,
  IItemsService,
  IPermissionService,
  IMailService,
  IStorageService,
  ISettingsService,
  ISocketService,
  IRealtimeService,
  ITasksService,
  IWorkflowService,
  IMigrationService,
  IHooksManager,
  HookFunction,
  ICacheService,
  IFilesService,
  IAssetsService,
  INotificationService,
  IReportService,
  IStatsService,
  // Plugin types (generic versions)
  PluginType,
  PluginMeta,
  PluginSchemaDefinition,
  PluginRouteContext,
  PluginRouteHandler,
  PluginRoute,
  PluginHookEvent,
  PluginHookContext,
  PluginHookHandler,
  PluginHook,
  PluginContext,
  PluginServiceFactory,
  PluginService,
  AuthProviderType,
  OAuth2Config,
  PluginAuthProvider,
  PluginMiddleware,
  PluginSchedule,
  PluginDefinition,
  PluginFactory,
  BaasixPlugin,
  LoadedPlugin,
  PluginManagerOptions,
  StartServerOptions,
  // Express-typed plugin types (for core package)
  ExpressPluginRouteHandler,
  ExpressPluginRoute,
  ExpressPluginMiddleware,
  ExpressPluginContext,
} from "@baasix/types";

/**
 * Start server options with plugin support (legacy alias)
 * @deprecated Use StartServerOptions from @baasix/types instead
 */
export type StartServerOptionsWithPlugins = import("@baasix/types").StartServerOptions;
