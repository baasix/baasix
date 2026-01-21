/**
 * Baasix Plugin Helper
 *
 * This file provides helper functions for creating plugins.
 * Similar to Payload CMS's buildConfig pattern.
 */

import type { PluginDefinition, PluginMeta, PluginType } from "../types/plugin.js";

/**
 * Define a Baasix plugin with type safety
 *
 * @example
 * ```typescript
 * import { definePlugin } from '@baasix/baasix';
 *
 * export function myPlugin(config: MyPluginConfig) {
 *   return definePlugin({
 *     meta: {
 *       name: 'my-plugin',
 *       version: '1.0.0',
 *       type: 'feature'
 *     },
 *     schemas: [...],
 *     routes: [...],
 *     onInit: async (context) => {
 *       console.log('Plugin initialized!');
 *     }
 *   });
 * }
 * ```
 */
export function definePlugin(definition: PluginDefinition): PluginDefinition {
  // Validate required fields
  if (!definition.meta) {
    throw new Error("Plugin must have a 'meta' property");
  }

  if (!definition.meta.name) {
    throw new Error("Plugin must have a 'meta.name' property");
  }

  if (!definition.meta.version) {
    throw new Error("Plugin must have a 'meta.version' property");
  }

  if (!definition.meta.type) {
    throw new Error("Plugin must have a 'meta.type' property");
  }

  // Validate plugin type
  const validTypes: PluginType[] = [
    "feature",
    "auth",
    "payment",
    "storage",
    "ai",
    "notification",
    "integration",
  ];

  if (!validTypes.includes(definition.meta.type)) {
    throw new Error(
      `Invalid plugin type '${definition.meta.type}'. Must be one of: ${validTypes.join(", ")}`
    );
  }

  // Validate schemas if provided
  if (definition.schemas) {
    for (const schema of definition.schemas) {
      if (!schema.collectionName) {
        throw new Error(
          `Plugin '${definition.meta.name}': Schema must have a 'collectionName' property`
        );
      }
      if (!schema.schema) {
        throw new Error(
          `Plugin '${definition.meta.name}': Schema '${schema.collectionName}' must have a 'schema' property`
        );
      }
      if (!schema.schema.fields) {
        throw new Error(
          `Plugin '${definition.meta.name}': Schema '${schema.collectionName}' must have 'fields' property`
        );
      }
    }
  }

  // Validate routes if provided
  if (definition.routes) {
    for (const route of definition.routes) {
      if (!route.path) {
        throw new Error(`Plugin '${definition.meta.name}': Route must have a 'path' property`);
      }
      if (!route.method) {
        throw new Error(
          `Plugin '${definition.meta.name}': Route '${route.path}' must have a 'method' property`
        );
      }
      if (!route.handler) {
        throw new Error(
          `Plugin '${definition.meta.name}': Route '${route.path}' must have a 'handler' property`
        );
      }
    }
  }

  // Validate hooks if provided
  if (definition.hooks) {
    for (const hook of definition.hooks) {
      if (!hook.collection) {
        throw new Error(`Plugin '${definition.meta.name}': Hook must have a 'collection' property`);
      }
      if (!hook.event) {
        throw new Error(`Plugin '${definition.meta.name}': Hook must have an 'event' property`);
      }
      if (!hook.handler) {
        throw new Error(`Plugin '${definition.meta.name}': Hook must have a 'handler' property`);
      }
    }
  }

  // Validate services if provided
  if (definition.services) {
    for (const service of definition.services) {
      if (!service.name) {
        throw new Error(`Plugin '${definition.meta.name}': Service must have a 'name' property`);
      }
      if (!service.factory) {
        throw new Error(
          `Plugin '${definition.meta.name}': Service '${service.name}' must have a 'factory' property`
        );
      }
    }
  }

  return definition;
}

/**
 * Create plugin metadata with defaults
 *
 * @example
 * ```typescript
 * const meta = createPluginMeta({
 *   name: 'my-plugin',
 *   type: 'feature'
 * });
 * // { name: 'my-plugin', version: '1.0.0', type: 'feature' }
 * ```
 */
export function createPluginMeta(
  meta: Partial<PluginMeta> & { name: string; type: PluginType }
): PluginMeta {
  return {
    version: "1.0.0",
    ...meta,
  };
}

export default definePlugin;
