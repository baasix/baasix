/**
 * Portal Routes
 *
 * Handles Stripe Customer Portal sessions for self-service billing management.
 */

import type { PluginRoute, StripeServiceInterface } from "../types.js";

/**
 * POST /payments/stripe/portal
 *
 * Creates a Stripe billing portal session.
 * The portal allows customers to manage their subscriptions,
 * update payment methods, and view invoices.
 *
 * Request body:
 * - returnUrl: string - URL to redirect after leaving the portal
 *
 * Response:
 * - url: string - The portal URL to redirect the user to
 */
export const portalRoute: PluginRoute = {
  path: "/payments/stripe/portal",
  method: "POST",
  requireAuth: true,
  description: "Create a Stripe billing portal session",
  handler: async (req, res, context) => {
    try {
      const { returnUrl } = req.body;
      const userId = req.accountability?.user?.id;

      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      if (!returnUrl) {
        return res.status(400).json({ error: "Missing required field: returnUrl" });
      }

      const stripeService = context.services.stripeService as StripeServiceInterface;
      const result = await stripeService.createPortalSession(userId, returnUrl);

      res.json(result);
    } catch (error: any) {
      console.error("[Stripe Plugin] Portal error:", error);
      res.status(500).json({
        error: error.message || "Failed to create portal session",
      });
    }
  },
};

/**
 * GET /payments/stripe/payments
 *
 * Get the current user's payment history.
 */
export const getPaymentsRoute: PluginRoute = {
  path: "/payments/stripe/payments",
  method: "GET",
  requireAuth: true,
  description: "Get current user's payment history",
  handler: async (req, res, context) => {
    try {
      const userId = req.accountability?.user?.id;

      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const stripeService = context.services.stripeService as StripeServiceInterface;
      const payments = await stripeService.getUserPayments(userId);

      res.json(payments);
    } catch (error: any) {
      console.error("[Stripe Plugin] Get payments error:", error);
      res.status(500).json({
        error: error.message || "Failed to get payments",
      });
    }
  },
};

/**
 * Portal and payment history routes
 */
export const portalRoutes: PluginRoute[] = [portalRoute, getPaymentsRoute];
