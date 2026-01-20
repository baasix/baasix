/**
 * Webhook Route
 *
 * Handles incoming Stripe webhook events.
 * This route requires raw body access for signature verification.
 */

import type { PluginRoute, StripePluginConfig, StripeServiceInterface } from "../types.js";

/**
 * Creates the webhook route with access to config and stripe getter
 *
 * @param config - Plugin configuration (for webhook secret)
 * @param getStripe - Function to get Stripe instance
 */
export function createWebhookRoute(
  config: StripePluginConfig,
  getStripe: () => Promise<any>
): PluginRoute {
  return {
    path: "/payments/stripe/webhook",
    method: "POST",
    rawBody: true, // Required for signature verification
    description: "Handle Stripe webhook events",
    handler: async (req, res, context) => {
      const sig = req.headers["stripe-signature"] as string;
      const rawBody = req.rawBody;

      // Validate required headers and body
      if (!sig) {
        return res.status(400).json({ error: "Missing stripe-signature header" });
      }

      if (!rawBody) {
        return res.status(400).json({ error: "Missing raw body" });
      }

      // Verify webhook signature
      let event: any;
      try {
        const stripeClient = await getStripe();
        event = stripeClient.webhooks.constructEvent(rawBody, sig, config.webhookSecret);
      } catch (err: any) {
        console.error("[Stripe Plugin] Webhook signature verification failed:", err.message);
        return res.status(400).json({ error: "Webhook signature verification failed" });
      }

      // Process the event
      try {
        const stripeService = context.services.stripeService as StripeServiceInterface;
        await stripeService.handleWebhook(event);
        res.json({ received: true });
      } catch (error: any) {
        console.error("[Stripe Plugin] Webhook processing error:", error);
        res.status(500).json({ error: "Webhook processing failed" });
      }
    },
  };
}
