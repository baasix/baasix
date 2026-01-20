/**
 * Checkout Routes
 *
 * Handles one-time payment checkout sessions via Stripe Checkout.
 */

import type { PluginRoute, StripeServiceInterface } from "../types.js";

/**
 * POST /payments/stripe/checkout
 *
 * Creates a Stripe Checkout session for one-time payment.
 *
 * Request body:
 * - priceId: string - The Stripe price ID to charge
 * - quantity?: number - Quantity of items (default: 1)
 * - successUrl: string - URL to redirect after successful payment
 * - cancelUrl: string - URL to redirect if payment is canceled
 * - metadata?: object - Additional metadata to attach to the session
 *
 * Response:
 * - sessionId: string - The Stripe checkout session ID
 * - url: string - The checkout URL to redirect the user to
 */
export const checkoutRoute: PluginRoute = {
  path: "/payments/stripe/checkout",
  method: "POST",
  requireAuth: true,
  description: "Create a Stripe checkout session for one-time payment",
  handler: async (req, res, context) => {
    try {
      const { priceId, quantity, successUrl, cancelUrl, metadata } = req.body;
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
      const result = await stripeService.createCheckoutSession({
        userId,
        priceId,
        quantity,
        successUrl,
        cancelUrl,
        metadata,
      });

      res.json(result);
    } catch (error: any) {
      console.error("[Stripe Plugin] Checkout error:", error);
      res.status(500).json({
        error: error.message || "Failed to create checkout session",
      });
    }
  },
};
