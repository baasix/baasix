/**
 * Subscription Routes
 *
 * Handles subscription checkout and management via Stripe.
 */

import type { PluginRoute, StripeServiceInterface } from "../types.js";

/**
 * POST /payments/stripe/subscribe
 *
 * Creates a Stripe Checkout session for subscription.
 */
export const subscribeRoute: PluginRoute = {
  path: "/payments/stripe/subscribe",
  method: "POST",
  requireAuth: true,
  description: "Create a Stripe checkout session for subscription",
  handler: async (req, res, context) => {
    try {
      const { priceId, successUrl, cancelUrl, trialDays, metadata } = req.body;
      const userId = req.accountability?.user?.id;

      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      if (!priceId || !successUrl || !cancelUrl) {
        return res.status(400).json({
          error: "Missing required fields: priceId, successUrl, cancelUrl",
        });
      }

      const stripeService = context.services.stripeService as StripeServiceInterface;
      const result = await stripeService.createSubscriptionCheckout({
        userId,
        priceId,
        successUrl,
        cancelUrl,
        trialDays,
        metadata,
      });

      res.json(result);
    } catch (error: any) {
      console.error("[Stripe Plugin] Subscribe error:", error);
      res.status(500).json({
        error: error.message || "Failed to create subscription checkout",
      });
    }
  },
};

/**
 * PATCH /payments/stripe/subscription/:id
 *
 * Manage a subscription (cancel or resume).
 *
 * Request body:
 * - action: "cancel" | "resume"
 */
export const manageSubscriptionRoute: PluginRoute = {
  path: "/payments/stripe/subscription/:id",
  method: "PATCH",
  requireAuth: true,
  description: "Cancel or resume a subscription",
  handler: async (req, res, context) => {
    try {
      const { id } = req.params;
      const { action } = req.body;
      const userId = req.accountability?.user?.id;

      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      if (!action || !["cancel", "resume"].includes(action)) {
        return res.status(400).json({
          error: "Invalid action. Must be 'cancel' or 'resume'",
        });
      }

      const stripeService = context.services.stripeService as StripeServiceInterface;
      const result = await stripeService.manageSubscription(userId, id, action);

      res.json(result);
    } catch (error: any) {
      console.error("[Stripe Plugin] Subscription management error:", error);
      res.status(500).json({
        error: error.message || "Failed to manage subscription",
      });
    }
  },
};

/**
 * GET /payments/stripe/subscriptions
 *
 * Get the current user's subscriptions.
 */
export const getUserSubscriptionsRoute: PluginRoute = {
  path: "/payments/stripe/subscriptions",
  method: "GET",
  requireAuth: true,
  description: "Get current user's subscriptions",
  handler: async (req, res, context) => {
    try {
      const userId = req.accountability?.user?.id;

      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const stripeService = context.services.stripeService as StripeServiceInterface;
      const subscriptions = await stripeService.getUserSubscriptions(userId);

      res.json(subscriptions);
    } catch (error: any) {
      console.error("[Stripe Plugin] Get subscriptions error:", error);
      res.status(500).json({
        error: error.message || "Failed to get subscriptions",
      });
    }
  },
};

/**
 * All subscription-related routes
 */
export const subscriptionRoutes: PluginRoute[] = [
  subscribeRoute,
  manageSubscriptionRoute,
  getUserSubscriptionsRoute,
];
