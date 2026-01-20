/**
 * Product Routes
 *
 * Handles product listing and synchronization from Stripe.
 */

import type { PluginRoute, StripeServiceInterface } from "../types.js";

/**
 * GET /payments/stripe/products
 *
 * Get all available products and prices.
 * This endpoint is public (no auth required).
 */
export const getProductsRoute: PluginRoute = {
  path: "/payments/stripe/products",
  method: "GET",
  requireAuth: false,
  description: "Get all available products and prices",
  handler: async (_req, res, context) => {
    try {
      const stripeService = context.services.stripeService as StripeServiceInterface;
      const products = await stripeService.getProducts();

      res.json(products);
    } catch (error: any) {
      console.error("[Stripe Plugin] Get products error:", error);
      res.status(500).json({
        error: error.message || "Failed to get products",
      });
    }
  },
};

/**
 * POST /payments/stripe/sync-products
 *
 * Sync products and prices from Stripe (admin only).
 * This fetches all active products and prices from Stripe
 * and updates the local database cache.
 */
export const syncProductsRoute: PluginRoute = {
  path: "/payments/stripe/sync-products",
  method: "POST",
  requireAuth: true,
  description: "Sync products and prices from Stripe (admin only)",
  handler: async (req, res, context) => {
    try {
      const isAdmin = req.accountability?.user?.isAdmin;

      if (!isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const stripeService = context.services.stripeService as StripeServiceInterface;
      await stripeService.syncProducts();

      res.json({ success: true, message: "Products synced successfully" });
    } catch (error: any) {
      console.error("[Stripe Plugin] Sync products error:", error);
      res.status(500).json({
        error: error.message || "Failed to sync products",
      });
    }
  },
};

/**
 * Product-related routes
 */
export const productRoutes: PluginRoute[] = [getProductsRoute, syncProductsRoute];
