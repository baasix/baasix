/**
 * Stripe Plugin Type Definitions
 *
 * This file contains all type definitions used by the Stripe plugin.
 * It includes both plugin-specific types and the base Baasix plugin types
 * needed for standalone compilation.
 */

// ============================================================================
// Baasix Plugin Types (for standalone compilation)
// These mirror the types from @tspvivek/baasix
// ============================================================================

export type PluginType = "feature" | "auth" | "payment" | "storage" | "ai" | "notification" | "integration";

export interface PluginMeta {
  name: string;
  version: string;
  type: PluginType;
  description?: string;
  author?: string;
  dependencies?: string[];
}

export interface PluginSchemaDefinition {
  collectionName: string;
  schema: {
    name: string;
    timestamps?: boolean;
    paranoid?: boolean;
    usertrack?: boolean;
    fields: Record<string, any>;
    indexes?: Array<{
      fields: string[];
      unique?: boolean;
      name?: string;
    }>;
  };
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";

export interface PluginRouteContext {
  db: any;
  ItemsService: any;
  services: Record<string, any>;
  
  // Singleton services
  permissionService?: any;
  mailService?: any;
  storageService?: any;
  settingsService?: any;
  socketService?: any;
  realtimeService?: any;
  tasksService?: any;
  workflowService?: any;
  migrationService?: any;
  
  // Utility functions
  getCacheService?: () => any;
  
  // Class-based services (instantiate with accountability)
  FilesService?: any;
  AssetsService?: any;
  NotificationService?: any;
  ReportService?: any;
  StatsService?: any;
  
  config: Record<string, any>;
}

export interface PluginRoute {
  path: string;
  method: HttpMethod;
  handler: (req: any, res: any, context: PluginRouteContext) => Promise<any> | any;
  requireAuth?: boolean;
  rawBody?: boolean;
  middleware?: Array<(req: any, res: any, next: any) => void>;
  description?: string;
}

export interface PluginService {
  name: string;
  factory: (context: PluginContext) => any;
}

export interface PluginContext {
  db: any;
  ItemsService: any;
  services: Record<string, any>;
  
  // Singleton services
  permissionService?: any;
  mailService?: any;
  storageService?: any;
  settingsService?: any;
  socketService?: any;
  realtimeService?: any;
  tasksService?: any;
  workflowService?: any;
  migrationService?: any;
  hooksManager?: any;
  
  // Utility functions
  getCacheService?: () => any;
  invalidateCache?: (collection?: string) => Promise<void>;
  
  // Class-based services (instantiate with accountability)
  FilesService?: any;
  AssetsService?: any;
  NotificationService?: any;
  ReportService?: any;
  StatsService?: any;
  
  app?: any;
  config: Record<string, any>;
  getPluginService: (pluginName: string, serviceName: string) => any;
}

export interface PluginDefinition {
  meta: PluginMeta;
  schemas?: PluginSchemaDefinition[];
  routes?: PluginRoute[];
  hooks?: any[];
  services?: PluginService[];
  authProviders?: any[];
  middleware?: any[];
  schedules?: any[];
  onInit?: (context: PluginContext) => Promise<void>;
  onReady?: (context: PluginContext) => Promise<void>;
  onShutdown?: (context: PluginContext) => Promise<void>;
}

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
  getOrCreateCustomer(userId: string): Promise<StripeCustomerRecord>;

  /** Get a Stripe customer by user ID */
  getCustomer(userId: string): Promise<StripeCustomerRecord | null>;

  /** Handle Stripe webhook events */
  handleWebhook(event: any): Promise<void>;

  /** Sync a subscription from Stripe */
  syncSubscription(subscription: any): Promise<void>;

  /** Manage a subscription (cancel, resume) */
  manageSubscription(userId: string, subscriptionId: string, action: "cancel" | "resume"): Promise<{ success: boolean }>;

  /** Get a user's payments */
  getUserPayments(userId: string): Promise<StripePaymentRecord[]>;

  /** Get a user's subscriptions */
  getUserSubscriptions(userId: string): Promise<StripeSubscriptionRecord[]>;

  /** Get all active products */
  getProducts(): Promise<StripeProductRecord[]>;

  /** Sync products from Stripe */
  syncProducts(): Promise<void>;

  /** Create a checkout session for one-time payment */
  createCheckoutSession(options: {
    userId: string;
    priceId: string;
    quantity?: number;
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, string>;
  }): Promise<{ sessionId: string; url: string }>;

  /** Create a checkout session for subscription */
  createSubscriptionCheckout(options: {
    userId: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    trialDays?: number;
    metadata?: Record<string, string>;
  }): Promise<{ sessionId: string; url: string }>;

  /** Create a billing portal session */
  createPortalSession(userId: string, returnUrl: string): Promise<{ url: string }>;
}
