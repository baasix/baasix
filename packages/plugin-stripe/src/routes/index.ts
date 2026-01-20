/**
 * Stripe Plugin Routes
 *
 * Exports all route definitions for the Stripe plugin.
 * Routes are organized by functionality:
 * - checkout: One-time payment checkout
 * - subscription: Subscription management
 * - portal: Customer portal and payment history
 * - products: Product listing and sync
 * - webhook: Stripe webhook handler
 */

import type { PluginRoute, StripePluginConfig } from "../types.js";
import { checkoutRoute } from "./checkout.js";
import { subscriptionRoutes } from "./subscription.js";
import { portalRoutes } from "./portal.js";
import { productRoutes } from "./products.js";
import { createWebhookRoute } from "./webhook.js";

// Re-export individual routes for customization
export { checkoutRoute } from "./checkout.js";
export { subscribeRoute, manageSubscriptionRoute, getUserSubscriptionsRoute, subscriptionRoutes } from "./subscription.js";
export { portalRoute, getPaymentsRoute, portalRoutes } from "./portal.js";
export { getProductsRoute, syncProductsRoute, productRoutes } from "./products.js";
export { createWebhookRoute } from "./webhook.js";

/**
 * Creates all Stripe plugin routes
 *
 * @param config - Plugin configuration
 * @param getStripe - Function to get Stripe instance
 * @returns Array of all plugin routes
 */
export function createStripeRoutes(
  config: StripePluginConfig,
  getStripe: () => Promise<any>
): PluginRoute[] {
  return [
    // Checkout
    checkoutRoute,
    // Subscriptions
    ...subscriptionRoutes,
    // Portal & Payments
    ...portalRoutes,
    // Products
    ...productRoutes,
    // Webhook (needs config and stripe getter)
    createWebhookRoute(config, getStripe),
  ];
}
