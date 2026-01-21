/**
 * Baasix Stripe Plugin
 *
 * A comprehensive Stripe payment integration plugin for Baasix that provides:
 * - One-time payments via Stripe Checkout
 * - Subscription management with recurring billing
 * - Customer portal for self-service billing
 * - Webhook handling for payment events
 * - Product/price synchronization from Stripe
 *
 * @packageDocumentation
 *
 * @example
 * ```typescript
 * import { startServer } from '@baasix/baasix';
 * import { stripePlugin } from '@baasix/plugin-stripe';
 *
 * startServer({
 *   port: 8055,
 *   plugins: [
 *     stripePlugin({
 *       secretKey: process.env.STRIPE_SECRET_KEY!,
 *       webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
 *       currency: 'usd',
 *       syncProductsOnStartup: true,
 *     })
 *   ]
 * });
 * ```
 */

// Types
import type {
  PluginContext,
  PluginDefinition,
  StripePluginConfig,
  StripeServiceInterface,
} from "./types.js";

// Schemas
import { stripeSchemas } from "./schemas/index.js";

// Services
import { createStripeService } from "./services/stripeService.js";

// Routes
import { createStripeRoutes } from "./routes/index.js";

// Utils
import { createStripeGetter } from "./utils/loadStripe.js";

/**
 * Helper function to define a plugin with validation
 */
function definePlugin(definition: PluginDefinition): PluginDefinition {
  if (!definition.meta?.name) {
    throw new Error("Plugin must have a name");
  }
  if (!definition.meta?.version) {
    throw new Error("Plugin must have a version");
  }
  if (!definition.meta?.type) {
    throw new Error("Plugin must have a type");
  }
  return definition;
}

/**
 * Creates the Stripe plugin
 *
 * @param config - Plugin configuration
 * @returns The plugin definition
 *
 * @example
 * ```typescript
 * const plugin = stripePlugin({
 *   secretKey: 'sk_test_...',
 *   webhookSecret: 'whsec_...',
 * });
 * ```
 */
export function stripePlugin(config: StripePluginConfig): PluginDefinition {
  // Validate required configuration
  if (!config.secretKey) {
    throw new Error("Stripe plugin requires 'secretKey' configuration");
  }
  if (!config.webhookSecret) {
    throw new Error("Stripe plugin requires 'webhookSecret' configuration");
  }

  // Create lazy Stripe instance getter
  const getStripe = createStripeGetter(config);

  return definePlugin({
    meta: {
      name: "baasix-plugin-stripe",
      version: "1.0.0",
      type: "payment",
      description: "Stripe payment integration with one-time and subscription support",
    },

    // Database schemas
    schemas: stripeSchemas,

    // API routes
    routes: createStripeRoutes(config, getStripe),

    // Services
    services: [
      {
        name: "stripeService",
        factory: (context: PluginContext) => {
          return createStripeService(getStripe, config, context);
        },
      },
    ],

    // Lifecycle: Initialize
    onInit: async (context: PluginContext) => {
      console.log("[Stripe Plugin] Initializing...");

      // Pre-load Stripe SDK to catch errors early
      try {
        await getStripe();
        console.log("[Stripe Plugin] Stripe SDK loaded successfully");
      } catch (error) {
        console.error("[Stripe Plugin] Failed to load Stripe SDK:", error);
        throw error;
      }

      // Optionally sync products on startup
      if (config.syncProductsOnStartup) {
        try {
          const stripeService = context.services.stripeService as StripeServiceInterface;
          await stripeService.syncProducts();
        } catch (error) {
          console.error("[Stripe Plugin] Failed to sync products on startup:", error);
        }
      }
    },

    // Lifecycle: Ready
    onReady: async () => {
      console.log("[Stripe Plugin] Ready!");
      console.log("[Stripe Plugin] Webhook URL: POST /payments/stripe/webhook");
      console.log("[Stripe Plugin] Available endpoints:");
      console.log("  - POST /payments/stripe/checkout (one-time payment)");
      console.log("  - POST /payments/stripe/subscribe (subscription)");
      console.log("  - PATCH /payments/stripe/subscription/:id (manage subscription)");
      console.log("  - POST /payments/stripe/portal (billing portal)");
      console.log("  - GET /payments/stripe/payments (user payments)");
      console.log("  - GET /payments/stripe/subscriptions (user subscriptions)");
      console.log("  - GET /payments/stripe/products (available products)");
      console.log("  - POST /payments/stripe/sync-products (admin: sync from Stripe)");
    },

    // Lifecycle: Shutdown
    onShutdown: async () => {
      console.log("[Stripe Plugin] Shutting down...");
    },
  });
}

// Re-export types for consumers
export type {
  StripePluginConfig,
  StripeCustomerRecord,
  StripePaymentRecord,
  StripeSubscriptionRecord,
  StripeProductRecord,
  StripeServiceInterface,
} from "./types.js";

// Re-export schemas for customization
export { stripeSchemas } from "./schemas/index.js";

// Re-export service and singleton getter
export {
  createStripeService,
  getStripeService,
  isStripeServiceInitialized,
} from "./services/stripeService.js";

// Re-export routes for customization
export {
  createStripeRoutes,
  checkoutRoute,
  subscribeRoute,
  manageSubscriptionRoute,
  getUserSubscriptionsRoute,
  portalRoute,
  getPaymentsRoute,
  getProductsRoute,
  syncProductsRoute,
  createWebhookRoute,
} from "./routes/index.js";

// Re-export utilities
export { loadStripeSDK, createStripeGetter } from "./utils/loadStripe.js";
