/**
 * Stripe Plugin Type Definitions
 *
 * This file contains all type definitions used by the Stripe plugin.
 * Shared plugin types are imported from @baasix/types.
 */

// ============================================================================
// Re-export Baasix Plugin Types from @baasix/types
// ============================================================================
export type {
  PluginType,
  PluginMeta,
  PluginSchemaDefinition,
  HttpMethod,
  PluginRouteContext,
  PluginRoute,
  PluginService,
  PluginContext,
  PluginDefinition,
} from "@baasix/types";

// ============================================================================
// Stripe Plugin Specific Types
// ============================================================================

/**
 * Stripe plugin configuration
 */
export interface StripePluginConfig {
  /** Stripe secret key */
  secretKey: string;
  /** Stripe webhook secret */
  webhookSecret: string;
  /** Default currency (default: 'usd') */
  currency?: string;
  /** Whether to sync products on startup (default: false) */
  syncProductsOnStartup?: boolean;
  /** API version to use (optional) */
  apiVersion?: string;
}

/**
 * Stripe customer record stored in database
 */
export interface StripeCustomerRecord {
  id: string;
  user_Id: string;
  stripeCustomerId: string;
  email?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Stripe payment record stored in database
 */
export interface StripePaymentRecord {
  id: string;
  customer_Id: string;
  stripePaymentIntentId: string;
  stripeCheckoutSessionId?: string;
  amount: number;
  currency: string;
  status: "pending" | "processing" | "succeeded" | "failed" | "canceled" | "refunded";
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Stripe subscription record stored in database
 */
export interface StripeSubscriptionRecord {
  id: string;
  customer_Id: string;
  stripeSubscriptionId: string;
  stripePriceId: string;
  status: "active" | "canceled" | "incomplete" | "past_due" | "trialing" | "unpaid" | "incomplete_expired" | "paused";
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd: boolean;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Stripe product/price record stored in database
 */
export interface StripeProductRecord {
  id: string;
  stripeProductId: string;
  stripePriceId: string;
  name: string;
  description?: string;
  amount?: number;
  currency: string;
  interval: "one_time" | "day" | "week" | "month" | "year";
  intervalCount?: number;
  active: boolean;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Stripe service interface - available via context.services.stripeService
 */
export interface StripeServiceInterface {
  /** The Stripe SDK instance (available after initialization) */
  stripe: any;

  /** Get or create a Stripe customer for a user */
  getOrCreateCustomer(userId: string | number): Promise<StripeCustomerRecord>;

  /** Get a Stripe customer by user ID */
  getCustomer(userId: string | number): Promise<StripeCustomerRecord | null>;

  /** Handle Stripe webhook events */
  handleWebhook(event: any): Promise<void>;

  /** Sync a subscription from Stripe */
  syncSubscription(subscription: any): Promise<void>;

  /** Manage a subscription (cancel, resume) */
  manageSubscription(userId: string | number, subscriptionId: string, action: "cancel" | "resume"): Promise<{ success: boolean }>;

  /** Get a user's payments */
  getUserPayments(userId: string | number): Promise<StripePaymentRecord[]>;

  /** Get a user's subscriptions */
  getUserSubscriptions(userId: string | number): Promise<StripeSubscriptionRecord[]>;

  /** Get all active products */
  getProducts(): Promise<StripeProductRecord[]>;

  /** Sync products from Stripe */
  syncProducts(): Promise<void>;

  /** Create a checkout session for one-time payment */
  createCheckoutSession(options: {
    userId: string | number;
    priceId: string;
    quantity?: number;
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, string>;
  }): Promise<{ sessionId: string; url: string }>;

  /** Create a checkout session for subscription */
  createSubscriptionCheckout(options: {
    userId: string | number;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    trialDays?: number;
    metadata?: Record<string, string>;
  }): Promise<{ sessionId: string; url: string }>;

  /** Create a billing portal session */
  createPortalSession(userId: string | number, returnUrl: string): Promise<{ url: string }>;
}
