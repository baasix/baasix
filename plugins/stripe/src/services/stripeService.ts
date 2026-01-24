/**
 * Stripe Service Implementation
 *
 * Provides all Stripe-related business logic including:
 * - Customer management
 * - Payment processing
 * - Subscription management
 * - Webhook handling
 * - Product synchronization
 *
 * This service is available as a singleton after plugin initialization.
 * You can access it via:
 * - `getStripeService()` - from anywhere in your code
 * - `context.services.stripeService` - in plugin routes/hooks
 */

import type {
  PluginContext,
  StripePluginConfig,
  StripeServiceInterface,
  StripeCustomerRecord,
  StripePaymentRecord,
  StripeSubscriptionRecord,
  StripeProductRecord,
} from "../types.js";

// ============================================================================
// Singleton Pattern
// ============================================================================

// Use globalThis to ensure singleton across different module loading paths
declare global {
  // eslint-disable-next-line no-var
  var __baasix_stripeService: StripeServiceInterface | undefined;
  // eslint-disable-next-line no-var
  var __baasix_stripeServiceInitialized: boolean | undefined;
}

/**
 * Get the Stripe service singleton instance
 *
 * @throws Error if the service hasn't been initialized yet
 *
 * @example
 * ```typescript
 * import { getStripeService } from '@baasix/plugin-stripe';
 *
 * // In an endpoint or hook
 * const stripeService = getStripeService();
 * const customer = await stripeService.getOrCreateCustomer(userId);
 * ```
 */
export function getStripeService(): StripeServiceInterface {
  if (!globalThis.__baasix_stripeService) {
    throw new Error(
      "Stripe service not initialized. Make sure the Stripe plugin is loaded in startServer()."
    );
  }
  return globalThis.__baasix_stripeService;
}

/**
 * Check if the Stripe service has been initialized
 */
export function isStripeServiceInitialized(): boolean {
  return globalThis.__baasix_stripeServiceInitialized === true;
}

/**
 * Initialize the Stripe service singleton (called internally by the plugin)
 * @internal
 */
export function initializeStripeService(service: StripeServiceInterface): void {
  globalThis.__baasix_stripeService = service;
  globalThis.__baasix_stripeServiceInitialized = true;
}

/**
 * Reset the Stripe service singleton (for testing)
 * @internal
 */
export function resetStripeService(): void {
  globalThis.__baasix_stripeService = undefined;
  globalThis.__baasix_stripeServiceInitialized = false;
}

// ============================================================================
// Service Factory
// ============================================================================

/**
 * Creates the Stripe service instance
 *
 * @param getStripe - Function to get the Stripe SDK instance
 * @param config - Plugin configuration
 * @param context - Plugin context with database access
 */
export function createStripeService(
  getStripe: () => Promise<any>,
  config: StripePluginConfig,
  context: PluginContext
): StripeServiceInterface {
  // Cache the stripe instance after first call
  let cachedStripe: any = null;

  const stripe = async () => {
    if (!cachedStripe) {
      cachedStripe = await getStripe();
    }
    return cachedStripe;
  };

  const service: StripeServiceInterface = {
    /**
     * Get the Stripe SDK instance (synchronous, returns cached value)
     */
    get stripe() {
      return cachedStripe;
    },

    /**
     * Get or create a Stripe customer for a user
     */
    async getOrCreateCustomer(userId: string): Promise<StripeCustomerRecord> {
      const stripeClient = await stripe();
      const ItemsService = context.ItemsService;
      const customerService = new ItemsService("baasix_StripeCustomer");

      // Check for existing customer
      const existing = await customerService.readByQuery({
        filter: { user_Id: { _eq: userId } },
      });

      if (existing.length > 0) {
        return existing[0];
      }

      // Get user details
      const userService = new ItemsService("baasix_User");
      const user = await userService.readOne(userId);

      if (!user) {
        throw new Error("User not found");
      }

      // Create Stripe customer
      const stripeCustomer = await stripeClient.customers.create({
        email: user.email,
        name: [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined,
        metadata: { userId },
      });

      // Save mapping to database
      const customerId = await customerService.createOne({
        user_Id: userId,
        stripeCustomerId: stripeCustomer.id,
        email: user.email,
      });

      // Fetch and return the created record
      return customerService.readOne(customerId);
    },

    /**
     * Get a Stripe customer by user ID
     */
    async getCustomer(userId: string): Promise<StripeCustomerRecord | null> {
      const ItemsService = context.ItemsService;
      const customerService = new ItemsService("baasix_StripeCustomer");
      const results = await customerService.readByQuery({
        filter: { user_Id: { _eq: userId } },
      });
      return results[0] || null;
    },

    /**
     * Handle incoming Stripe webhook events
     */
    async handleWebhook(event: any): Promise<void> {
      const stripeClient = await stripe();
      const ItemsService = context.ItemsService;

      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object;

          if (session.mode === "payment" && session.payment_intent) {
            // Record the completed payment
            const paymentService = new ItemsService("baasix_StripePayment");
            const customerService = new ItemsService("baasix_StripeCustomer");

            const customers = await customerService.readByQuery({
              filter: { stripeCustomerId: { _eq: session.customer as string } },
            });

            if (customers.length > 0) {
              await paymentService.createOne({
                customer_Id: customers[0].id,
                stripePaymentIntentId: session.payment_intent as string,
                stripeCheckoutSessionId: session.id,
                amount: session.amount_total || 0,
                currency: session.currency || config.currency || "usd",
                status: "succeeded",
                metadata: session.metadata,
              });
            }
          }
          break;
        }

        case "payment_intent.succeeded": {
          const paymentIntent = event.data.object;
          const paymentService = new ItemsService("baasix_StripePayment");

          // Update existing payment record if it exists
          const existing = await paymentService.readByQuery({
            filter: { stripePaymentIntentId: { _eq: paymentIntent.id } },
          });

          if (existing.length > 0) {
            await paymentService.updateOne(existing[0].id, { status: "succeeded" });
          }
          break;
        }

        case "payment_intent.payment_failed": {
          const paymentIntent = event.data.object;
          const paymentService = new ItemsService("baasix_StripePayment");

          const existing = await paymentService.readByQuery({
            filter: { stripePaymentIntentId: { _eq: paymentIntent.id } },
          });

          if (existing.length > 0) {
            await paymentService.updateOne(existing[0].id, { status: "failed" });
          }
          break;
        }

        case "customer.subscription.created":
        case "customer.subscription.updated": {
          const subscription = event.data.object;
          await this.syncSubscription(subscription);
          break;
        }

        case "customer.subscription.deleted": {
          const subscription = event.data.object;
          const subService = new ItemsService("baasix_StripeSubscription");

          const existing = await subService.readByQuery({
            filter: { stripeSubscriptionId: { _eq: subscription.id } },
          });

          if (existing.length > 0) {
            await subService.updateOne(existing[0].id, { status: "canceled" });
          }
          break;
        }

        case "invoice.payment_succeeded": {
          // Handle subscription renewal
          const invoice = event.data.object;
          if (invoice.subscription) {
            const subscription = await stripeClient.subscriptions.retrieve(
              invoice.subscription as string
            );
            await this.syncSubscription(subscription);
          }
          break;
        }

        case "invoice.payment_failed": {
          // Handle failed subscription payment
          const invoice = event.data.object;
          if (invoice.subscription) {
            const subService = new ItemsService("baasix_StripeSubscription");
            const existing = await subService.readByQuery({
              filter: { stripeSubscriptionId: { _eq: invoice.subscription as string } },
            });

            if (existing.length > 0) {
              await subService.updateOne(existing[0].id, { status: "past_due" });
            }
          }
          break;
        }

        default:
          console.log(`[Stripe Plugin] Unhandled webhook event: ${event.type}`);
      }
    },

    /**
     * Sync a subscription from Stripe to the database
     */
    async syncSubscription(subscription: any): Promise<void> {
      const ItemsService = context.ItemsService;
      const subService = new ItemsService("baasix_StripeSubscription");
      const customerService = new ItemsService("baasix_StripeCustomer");

      // Find the customer
      const customers = await customerService.readByQuery({
        filter: { stripeCustomerId: { _eq: subscription.customer as string } },
      });

      if (customers.length === 0) {
        console.warn(`[Stripe Plugin] Customer not found for subscription: ${subscription.id}`);
        return;
      }

      const priceId = subscription.items.data[0]?.price?.id;
      if (!priceId) {
        console.warn(`[Stripe Plugin] No price ID found for subscription: ${subscription.id}`);
        return;
      }

      const data = {
        customer_Id: customers[0].id,
        stripeSubscriptionId: subscription.id,
        stripePriceId: priceId,
        status: subscription.status,
        currentPeriodStart: new Date(subscription.current_period_start * 1000),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        metadata: subscription.metadata,
      };

      // Upsert the subscription
      const existing = await subService.readByQuery({
        filter: { stripeSubscriptionId: { _eq: subscription.id } },
      });

      if (existing.length > 0) {
        await subService.updateOne(existing[0].id, data);
      } else {
        await subService.createOne(data);
      }
    },

    /**
     * Manage a subscription (cancel or resume)
     */
    async manageSubscription(
      userId: string,
      subscriptionId: string,
      action: "cancel" | "resume"
    ): Promise<{ success: boolean }> {
      const stripeClient = await stripe();
      const ItemsService = context.ItemsService;
      const subService = new ItemsService("baasix_StripeSubscription");

      // Get customer to verify ownership
      const customer = await this.getCustomer(userId);
      if (!customer) {
        throw new Error("Customer not found");
      }

      // Verify subscription belongs to user
      const subs = await subService.readByQuery({
        filter: {
          id: { _eq: subscriptionId },
          customer_Id: { _eq: customer.id },
        },
      });

      if (subs.length === 0) {
        throw new Error("Subscription not found");
      }

      const stripeSubId = subs[0].stripeSubscriptionId;

      if (action === "cancel") {
        await stripeClient.subscriptions.update(stripeSubId, { cancel_at_period_end: true });
        await subService.updateOne(subscriptionId, { cancelAtPeriodEnd: true });
      } else if (action === "resume") {
        await stripeClient.subscriptions.update(stripeSubId, { cancel_at_period_end: false });
        await subService.updateOne(subscriptionId, { cancelAtPeriodEnd: false });
      }

      return { success: true };
    },

    /**
     * Get a user's payment history
     */
    async getUserPayments(userId: string): Promise<StripePaymentRecord[]> {
      const customer = await this.getCustomer(userId);
      if (!customer) return [];

      const ItemsService = context.ItemsService;
      const paymentService = new ItemsService("baasix_StripePayment");
      return paymentService.readByQuery({
        filter: { customer_Id: { _eq: customer.id } },
        sort: ["-createdAt"],
      });
    },

    /**
     * Get a user's subscriptions
     */
    async getUserSubscriptions(userId: string): Promise<StripeSubscriptionRecord[]> {
      const customer = await this.getCustomer(userId);
      if (!customer) return [];

      const ItemsService = context.ItemsService;
      const subService = new ItemsService("baasix_StripeSubscription");
      return subService.readByQuery({
        filter: { customer_Id: { _eq: customer.id } },
        sort: ["-createdAt"],
      });
    },

    /**
     * Get all active products
     */
    async getProducts(): Promise<StripeProductRecord[]> {
      const ItemsService = context.ItemsService;
      const productService = new ItemsService("baasix_StripeProduct");
      return productService.readByQuery({
        filter: { active: { _eq: true } },
        sort: ["name"],
      });
    },

    /**
     * Sync products and prices from Stripe
     */
    async syncProducts(): Promise<void> {
      const stripeClient = await stripe();
      const products = await stripeClient.products.list({ active: true, limit: 100 });
      const prices = await stripeClient.prices.list({ active: true, limit: 100 });

      const ItemsService = context.ItemsService;
      const productService = new ItemsService("baasix_StripeProduct");

      for (const price of prices.data) {
        const product = products.data.find((p: any) => p.id === price.product);
        if (!product) continue;

        const data = {
          stripeProductId: product.id,
          stripePriceId: price.id,
          name: product.name,
          description: product.description || null,
          amount: price.unit_amount,
          currency: price.currency,
          interval: price.recurring?.interval || "one_time",
          intervalCount: price.recurring?.interval_count || 1,
          active: price.active && product.active,
          metadata: product.metadata,
        };

        // Upsert by price ID
        const existing = await productService.readByQuery({
          filter: { stripePriceId: { _eq: price.id } },
        });

        if (existing.length > 0) {
          await productService.updateOne(existing[0].id, data);
        } else {
          await productService.createOne(data);
        }
      }

      console.log(`[Stripe Plugin] Synced ${prices.data.length} products/prices`);
    },

    /**
     * Create a checkout session for one-time payment
     */
    async createCheckoutSession(options: {
      userId: string;
      priceId: string;
      quantity?: number;
      successUrl: string;
      cancelUrl: string;
      metadata?: Record<string, string>;
    }): Promise<{ sessionId: string; url: string }> {
      const stripeClient = await stripe();
      const customer = await this.getOrCreateCustomer(options.userId);

      const session = await stripeClient.checkout.sessions.create({
        customer: customer.stripeCustomerId,
        mode: "payment",
        line_items: [{ price: options.priceId, quantity: options.quantity || 1 }],
        success_url: options.successUrl,
        cancel_url: options.cancelUrl,
        metadata: { userId: options.userId, ...options.metadata },
      });

      return { sessionId: session.id, url: session.url! };
    },

    /**
     * Create a checkout session for subscription
     */
    async createSubscriptionCheckout(options: {
      userId: string;
      priceId: string;
      successUrl: string;
      cancelUrl: string;
      trialDays?: number;
      metadata?: Record<string, string>;
    }): Promise<{ sessionId: string; url: string }> {
      const stripeClient = await stripe();
      const customer = await this.getOrCreateCustomer(options.userId);

      const session = await stripeClient.checkout.sessions.create({
        customer: customer.stripeCustomerId,
        mode: "subscription",
        line_items: [{ price: options.priceId, quantity: 1 }],
        success_url: options.successUrl,
        cancel_url: options.cancelUrl,
        subscription_data: options.trialDays
          ? { trial_period_days: options.trialDays }
          : undefined,
        metadata: { userId: options.userId, ...options.metadata },
      });

      return { sessionId: session.id, url: session.url! };
    },

    /**
     * Create a billing portal session for customer self-service
     */
    async createPortalSession(
      userId: string,
      returnUrl: string
    ): Promise<{ url: string }> {
      const stripeClient = await stripe();
      const customer = await this.getCustomer(userId);

      if (!customer) {
        throw new Error("Customer not found");
      }

      const session = await stripeClient.billingPortal.sessions.create({
        customer: customer.stripeCustomerId,
        return_url: returnUrl,
      });

      return { url: session.url };
    },
  };

  // Initialize the singleton
  initializeStripeService(service);

  return service;
}
