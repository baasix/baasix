/**
 * Baasix Plugin Manager Service
 *
 * Manages the lifecycle of plugins including:
 * - Plugin registration and validation
 * - Dependency resolution and loading order
 * - Schema, route, hook, and service registration
 * - Lifecycle management (init, ready, shutdown)
 */

import type { Express, Request, Response, NextFunction } from "express";
import type {
  BaasixPlugin,
  LoadedPlugin,
  PluginContext,
  PluginDefinition,
  PluginManagerOptions,
  PluginRoute,
  PluginType,
  PluginSchemaDefinition,
} from "../types/plugin.js";
import type { HooksManager } from "./HooksManager.js";

/**
 * PluginManager singleton class
 */
export class PluginManager {
  private static instance: PluginManager;

  /** Registered plugins by name */
  private plugins: Map<string, LoadedPlugin> = new Map();

  /** Plugins grouped by type */
  private pluginsByType: Map<PluginType, LoadedPlugin[]> = new Map();

  /** Plugin services registry */
  private services: Record<string, any> = {};

  /** Plugin context */
  private context: PluginContext | null = null;

  /** Options */
  private options: PluginManagerOptions = { verbose: false };

  /** Whether plugins have been initialized */
  private initialized: boolean = false;

  /** Whether plugins are ready */
  private ready: boolean = false;

  private constructor() {
    // Initialize type groups
    const types: PluginType[] = [
      "feature",
      "auth",
      "payment",
      "storage",
      "ai",
      "notification",
      "integration",
    ];
    for (const type of types) {
      this.pluginsByType.set(type, []);
    }
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): PluginManager {
    if (!PluginManager.instance) {
      PluginManager.instance = new PluginManager();
    }
    return PluginManager.instance;
  }

  /**
   * Reset the singleton (for testing)
   */
  public static resetInstance(): void {
    PluginManager.instance = new PluginManager();
  }

  /**
   * Set plugin manager options
   */
  public setOptions(options: PluginManagerOptions): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Log a message if verbose mode is enabled
   */
  private log(message: string): void {
    if (this.options.verbose) {
      console.log(`[PluginManager] ${message}`);
    }
  }

  /**
   * Register plugins from the startServer options
   */
  public registerPlugins(plugins: BaasixPlugin[]): void {
    for (const plugin of plugins) {
      this.registerPlugin(plugin);
    }

    // Validate dependencies after all plugins are registered
    this.validateDependencies();

    // Sort plugins by dependencies
    this.sortByDependencies();

    this.log(`Registered ${this.plugins.size} plugins`);
  }

  /**
   * Register a single plugin
   */
  private registerPlugin(definition: PluginDefinition): void {
    const name = definition.meta.name;

    if (this.plugins.has(name)) {
      throw new Error(`Plugin '${name}' is already registered`);
    }

    const loadedPlugin: LoadedPlugin = {
      definition,
      config: {},
      services: {},
      initialized: false,
      ready: false,
    };

    this.plugins.set(name, loadedPlugin);

    // Add to type group
    const typeGroup = this.pluginsByType.get(definition.meta.type);
    if (typeGroup) {
      typeGroup.push(loadedPlugin);
    }

    this.log(`Registered plugin: ${name} (${definition.meta.type})`);
  }

  /**
   * Validate plugin dependencies
   */
  private validateDependencies(): void {
    for (const [name, plugin] of this.plugins) {
      const deps = plugin.definition.meta.dependencies || [];
      for (const dep of deps) {
        if (!this.plugins.has(dep)) {
          throw new Error(`Plugin '${name}' depends on '${dep}' which is not registered`);
        }
      }
    }
  }

  /**
   * Sort plugins by dependencies (topological sort)
   */
  private sortByDependencies(): void {
    const sorted: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (name: string) => {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        throw new Error(`Circular dependency detected involving plugin '${name}'`);
      }

      visiting.add(name);

      const plugin = this.plugins.get(name);
      if (plugin) {
        const deps = plugin.definition.meta.dependencies || [];
        for (const dep of deps) {
          visit(dep);
        }
      }

      visiting.delete(name);
      visited.add(name);
      sorted.push(name);
    };

    for (const name of this.plugins.keys()) {
      visit(name);
    }

    // Reorder the plugins map
    const orderedPlugins = new Map<string, LoadedPlugin>();
    for (const name of sorted) {
      const plugin = this.plugins.get(name);
      if (plugin) {
        orderedPlugins.set(name, plugin);
      }
    }
    this.plugins = orderedPlugins;
  }

  /**
   * Get all schemas from plugins
   */
  public getPluginSchemas(): PluginSchemaDefinition[] {
    const schemas: PluginSchemaDefinition[] = [];

    for (const plugin of this.plugins.values()) {
      if (plugin.definition.schemas) {
        schemas.push(...plugin.definition.schemas);
      }
    }

    return schemas;
  }

  /**
   * Initialize plugin context
   */
  public setContext(context: Omit<PluginContext, "services" | "config" | "getPluginService">): void {
    this.context = {
      ...context,
      services: this.services,
      config: {},
      getPluginService: (pluginName: string, serviceName: string) => {
        const plugin = this.plugins.get(pluginName);
        if (!plugin) {
          throw new Error(`Plugin '${pluginName}' not found`);
        }
        return plugin.services[serviceName];
      },
    };
  }

  /**
   * Initialize plugin services
   */
  public async initializeServices(): Promise<void> {
    if (!this.context) {
      throw new Error("Plugin context not set. Call setContext() first.");
    }

    for (const [name, plugin] of this.plugins) {
      if (plugin.definition.services) {
        for (const serviceDef of plugin.definition.services) {
          this.log(`Initializing service: ${name}.${serviceDef.name}`);

          // Create plugin-specific context
          const pluginContext: PluginContext = {
            ...this.context,
            config: plugin.config,
            services: this.services,
          };

          // Create service instance
          const service = serviceDef.factory(pluginContext);
          plugin.services[serviceDef.name] = service;

          // Also register globally for cross-plugin access
          this.services[serviceDef.name] = service;
        }
      }
    }
  }

  /**
   * Register plugin routes with Express app
   */
  public registerRoutes(app: Express, authMiddleware: any): void {
    if (!this.context) {
      throw new Error("Plugin context not set. Call setContext() first.");
    }

    for (const [name, plugin] of this.plugins) {
      if (plugin.definition.routes) {
        for (const route of plugin.definition.routes) {
          this.registerRoute(app, name, route, authMiddleware);
        }
      }
    }
  }

  /**
   * Register a single route
   */
  private registerRoute(
    app: Express,
    pluginName: string,
    route: PluginRoute,
    authMiddleware: any
  ): void {
    const method = route.method.toLowerCase() as
      | "get"
      | "post"
      | "put"
      | "patch"
      | "delete"
      | "options"
      | "head";

    const middlewares: Array<(req: Request, res: Response, next: NextFunction) => void> = [];

    // Add raw body parser for webhook routes
    if (route.rawBody) {
      middlewares.push((req: Request, res: Response, next: NextFunction) => {
        let data = "";
        req.setEncoding("utf8");
        req.on("data", (chunk) => {
          data += chunk;
        });
        req.on("end", () => {
          (req as any).rawBody = data;
          next();
        });
      });
    }

    // Add auth middleware if required
    if (route.requireAuth) {
      middlewares.push(authMiddleware);
    }

    // Add custom route middleware
    if (route.middleware) {
      middlewares.push(...route.middleware);
    }

    // Create the route handler
    const handler = async (req: Request, res: Response, next: NextFunction) => {
      try {
        const routeContext: any = {
          ...this.context,
          services: this.services,
        };
        await route.handler(req, res, routeContext);
      } catch (error: any) {
        this.log(`Error in route ${route.path}: ${error.message}`);
        if (!res.headersSent) {
          res.status(500).json({ error: error.message || "Internal server error" });
        }
      }
    };

    // Register the route
    app[method](route.path, ...middlewares, handler);
    this.log(`Registered route: ${route.method} ${route.path} (${pluginName})`);
  }

  /**
   * Register plugin hooks with HooksManager
   */
  public registerHooks(hooksManager: HooksManager): void {
    for (const [name, plugin] of this.plugins) {
      if (plugin.definition.hooks) {
        for (const hook of plugin.definition.hooks) {
          this.log(`Registering hook: ${name} -> ${hook.collection}:${hook.event}`);
          hooksManager.registerHook(hook.collection, hook.event, hook.handler);
        }
      }
    }
  }

  /**
   * Register plugin middleware with Express app
   */
  public registerMiddleware(app: Express): void {
    // Collect all middleware and sort by priority
    const allMiddleware: Array<{
      pluginName: string;
      name: string;
      path?: string;
      handler: (req: Request, res: Response, next: NextFunction) => void;
      priority: number;
    }> = [];

    for (const [pluginName, plugin] of this.plugins) {
      if (plugin.definition.middleware) {
        for (const mw of plugin.definition.middleware) {
          allMiddleware.push({
            pluginName,
            name: mw.name,
            path: mw.path,
            handler: mw.handler,
            priority: mw.priority ?? 100,
          });
        }
      }
    }

    // Sort by priority (lower first)
    allMiddleware.sort((a, b) => a.priority - b.priority);

    // Register middleware
    for (const mw of allMiddleware) {
      if (mw.path) {
        app.use(mw.path, mw.handler);
      } else {
        app.use(mw.handler);
      }
      this.log(`Registered middleware: ${mw.name} (${mw.pluginName})`);
    }
  }

  /**
   * Call onInit for all plugins
   */
  public async initPlugins(): Promise<void> {
    if (!this.context) {
      throw new Error("Plugin context not set. Call setContext() first.");
    }

    if (this.initialized) {
      this.log("Plugins already initialized");
      return;
    }

    for (const [name, plugin] of this.plugins) {
      if (plugin.definition.onInit) {
        this.log(`Initializing plugin: ${name}`);
        const pluginContext: PluginContext = {
          ...this.context,
          config: plugin.config,
          services: this.services,
        };
        await plugin.definition.onInit(pluginContext);
        plugin.initialized = true;
      }
    }

    this.initialized = true;
    this.log("All plugins initialized");
  }

  /**
   * Call onReady for all plugins
   */
  public async readyPlugins(): Promise<void> {
    if (!this.context) {
      throw new Error("Plugin context not set. Call setContext() first.");
    }

    if (this.ready) {
      this.log("Plugins already ready");
      return;
    }

    for (const [name, plugin] of this.plugins) {
      if (plugin.definition.onReady) {
        this.log(`Plugin ready: ${name}`);
        const pluginContext: PluginContext = {
          ...this.context,
          config: plugin.config,
          services: this.services,
        };
        await plugin.definition.onReady(pluginContext);
        plugin.ready = true;
      }
    }

    this.ready = true;
    this.log("All plugins ready");
  }

  /**
   * Call onShutdown for all plugins (in reverse order)
   */
  public async shutdownPlugins(): Promise<void> {
    if (!this.context) {
      return;
    }

    const pluginNames = Array.from(this.plugins.keys()).reverse();

    for (const name of pluginNames) {
      const plugin = this.plugins.get(name);
      if (plugin?.definition.onShutdown) {
        this.log(`Shutting down plugin: ${name}`);
        const pluginContext: PluginContext = {
          ...this.context,
          config: plugin.config,
          services: this.services,
        };
        try {
          await plugin.definition.onShutdown(pluginContext);
        } catch (error: any) {
          console.error(`Error shutting down plugin '${name}':`, error.message);
        }
      }
    }

    this.ready = false;
    this.initialized = false;
    this.log("All plugins shut down");
  }

  /**
   * Get a plugin by name
   */
  public getPlugin(name: string): LoadedPlugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * Get all plugins of a specific type
   */
  public getPluginsByType(type: PluginType): LoadedPlugin[] {
    return this.pluginsByType.get(type) || [];
  }

  /**
   * Get all loaded plugins
   */
  public getAllPlugins(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get a plugin service
   */
  public getService(serviceName: string): any {
    return this.services[serviceName];
  }

  /**
   * Check if a plugin is registered
   */
  public hasPlugin(name: string): boolean {
    return this.plugins.has(name);
  }

  /**
   * Get plugin count
   */
  public getPluginCount(): number {
    return this.plugins.size;
  }

  /**
   * Get a summary of loaded plugins
   */
  public getSummary(): { total: number; byType: Record<PluginType, number> } {
    const byType: Record<PluginType, number> = {
      feature: 0,
      auth: 0,
      payment: 0,
      storage: 0,
      ai: 0,
      notification: 0,
      integration: 0,
    };

    for (const plugin of this.plugins.values()) {
      byType[plugin.definition.meta.type]++;
    }

    return {
      total: this.plugins.size,
      byType,
    };
  }
}

export default PluginManager;
