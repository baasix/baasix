# @baasix/plugin-stripe

Stripe payment integration plugin for Baasix. Supports one-time payments and subscriptions with Stripe Checkout.

## Features

- One-time payments via Stripe Checkout
- Subscription management with recurring billing
- Customer portal for self-service billing management
- Webhook handling for payment events
- Product/price synchronization from Stripe
- Automatic customer creation and mapping
- **Singleton service** - use anywhere in your extensions

## Installation

```bash
npm install @baasix/plugin-stripe stripe
```

## Quick Start

```typescript
import { startServer } from '@baasix/baasix';
import { stripePlugin } from '@baasix/plugin-stripe';

startServer({
  port: 8055,
  plugins: [
    stripePlugin({
      secretKey: process.env.STRIPE_SECRET_KEY!,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
      currency: 'usd',
      syncProductsOnStartup: true,
    })
  ]
});
```

## Configuration Options

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `secretKey` | string | Yes | - | Your Stripe secret key |
| `webhookSecret` | string | Yes | - | Webhook signing secret from Stripe |
| `currency` | string | No | 'usd' | Default currency for payments |
| `syncProductsOnStartup` | boolean | No | false | Sync products from Stripe on server start |
| `apiVersion` | string | No | '2025-01-27.acacia' | Stripe API version |

## Using the Service in Extensions

The Stripe service is available as a **singleton** after plugin initialization. You can use it anywhere in your code without needing to reinitialize.

### In Custom Endpoints

```typescript
// extensions/endpoints/custom-payment.ts
import { getStripeService } from '@baasix/plugin-stripe';

export default (router) => {
  router.post('/custom-checkout', async (req, res) => {
    const stripeService = getStripeService();
    const userId = req.accountability?.user?.id;

    // Create a custom checkout session
    const session = await stripeService.createCheckoutSession({
      userId,
      priceId: req.body.priceId,
      successUrl: req.body.successUrl,
      cancelUrl: req.body.cancelUrl,
      metadata: { orderId: req.body.orderId },
    });

    res.json(session);
  });

  router.get('/my-subscriptions', async (req, res) => {
    const stripeService = getStripeService();
    const userId = req.accountability?.user?.id;

    const subscriptions = await stripeService.getUserSubscriptions(userId);
    res.json(subscriptions);
  });
};
```

### In Hooks

```typescript
// extensions/hooks/stripe-hooks.ts
import { getStripeService } from '@baasix/plugin-stripe';

export default {
  // Pre-create Stripe customer when a user registers
  'items.create.after': async (context) => {
    if (context.collection === 'baasix_User') {
      const stripeService = getStripeService();
      await stripeService.getOrCreateCustomer(context.data.id);
      console.log('Stripe customer created for new user');
    }
    return context;
  },

  // Clean up when user is deleted (optional)
  'items.delete': async (context) => {
    if (context.collection === 'baasix_User') {
      // Handle Stripe customer cleanup if needed
      const stripeService = getStripeService();
      const customer = await stripeService.getCustomer(context.id);
      if (customer) {
        // Cancel active subscriptions, etc.
        const subscriptions = await stripeService.getUserSubscriptions(context.id);
        for (const sub of subscriptions) {
          if (sub.status === 'active') {
            await stripeService.manageSubscription(context.id, sub.id, 'cancel');
          }
        }
      }
    }
    return context;
  }
};
```

### In Other Services or Utilities

```typescript
// services/billing.ts
import { getStripeService, isStripeServiceInitialized } from '@baasix/plugin-stripe';

export async function checkUserSubscription(userId: string) {
  // Optionally check if service is ready
  if (!isStripeServiceInitialized()) {
    throw new Error('Stripe plugin not loaded');
  }

  const stripeService = getStripeService();
  const subscriptions = await stripeService.getUserSubscriptions(userId);

  return subscriptions.some(sub =>
    sub.status === 'active' || sub.status === 'trialing'
  );
}

export async function getActiveSubscriptionTier(userId: string) {
  const stripeService = getStripeService();
  const subscriptions = await stripeService.getUserSubscriptions(userId);

  const active = subscriptions.find(sub => sub.status === 'active');
  if (!active) return null;

  // Get the product details
  const products = await stripeService.getProducts();
  return products.find(p => p.stripePriceId === active.stripePriceId);
}
```

### Accessing the Stripe SDK Directly

```typescript
import { getStripeService } from '@baasix/plugin-stripe';

async function createCustomPaymentIntent() {
  const stripeService = getStripeService();

  // Access the Stripe SDK directly for advanced operations
  const stripe = stripeService.stripe;

  const paymentIntent = await stripe.paymentIntents.create({
    amount: 2000,
    currency: 'usd',
    automatic_payment_methods: { enabled: true },
  });

  return paymentIntent;
}
```

## Database Tables

The plugin creates the following tables:

### baasix_StripeCustomer

Maps Baasix users to Stripe customers.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| user_Id | UUID | Reference to baasix_User |
| stripeCustomerId | String | Stripe customer ID |
| email | String | Customer email |
| metadata | JSON | Additional metadata |
| createdAt | DateTime | Created timestamp |
| updatedAt | DateTime | Updated timestamp |

### baasix_StripePayment

Records one-time payments.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| customer_Id | UUID | Reference to StripeCustomer |
| stripePaymentIntentId | String | Stripe payment intent ID |
| stripeCheckoutSessionId | String | Stripe checkout session ID |
| amount | Integer | Amount in cents |
| currency | String | Currency code |
| status | Enum | Payment status |
| metadata | JSON | Additional metadata |

### baasix_StripeSubscription

Tracks subscriptions.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| customer_Id | UUID | Reference to StripeCustomer |
| stripeSubscriptionId | String | Stripe subscription ID |
| stripePriceId | String | Stripe price ID |
| status | Enum | Subscription status |
| currentPeriodStart | DateTime | Current billing period start |
| currentPeriodEnd | DateTime | Current billing period end |
| cancelAtPeriodEnd | Boolean | Whether subscription cancels at period end |

### baasix_StripeProduct

Cached products and prices from Stripe.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| stripeProductId | String | Stripe product ID |
| stripePriceId | String | Stripe price ID |
| name | String | Product name |
| description | Text | Product description |
| amount | Integer | Price in cents |
| currency | String | Currency code |
| interval | Enum | Billing interval |
| active | Boolean | Whether product is active |

## API Endpoints

### One-Time Payments

#### Create Checkout Session
```http
POST /payments/stripe/checkout
Authorization: Bearer <token>
Content-Type: application/json

{
  "priceId": "price_xxx",
  "quantity": 1,
  "successUrl": "https://example.com/success",
  "cancelUrl": "https://example.com/cancel",
  "metadata": { "orderId": "123" }
}
```

**Response:**
```json
{
  "sessionId": "cs_xxx",
  "url": "https://checkout.stripe.com/..."
}
```

### Subscriptions

#### Create Subscription Checkout
```http
POST /payments/stripe/subscribe
Authorization: Bearer <token>
Content-Type: application/json

{
  "priceId": "price_xxx",
  "successUrl": "https://example.com/success",
  "cancelUrl": "https://example.com/cancel",
  "trialDays": 14,
  "metadata": { "plan": "pro" }
}
```

#### Manage Subscription
```http
PATCH /payments/stripe/subscription/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "action": "cancel" | "resume"
}
```

#### Get User's Subscriptions
```http
GET /payments/stripe/subscriptions
Authorization: Bearer <token>
```

### Customer Portal

#### Create Portal Session
```http
POST /payments/stripe/portal
Authorization: Bearer <token>
Content-Type: application/json

{
  "returnUrl": "https://example.com/account"
}
```

**Response:**
```json
{
  "url": "https://billing.stripe.com/..."
}
```

### User Data

#### Get User's Payments
```http
GET /payments/stripe/payments
Authorization: Bearer <token>
```

### Products

#### Get Available Products
```http
GET /payments/stripe/products
```

#### Sync Products (Admin Only)
```http
POST /payments/stripe/sync-products
Authorization: Bearer <admin-token>
```

### Webhook

#### Handle Stripe Events
```http
POST /payments/stripe/webhook
Stripe-Signature: <signature>
```

Configure this URL in your Stripe Dashboard under Developers > Webhooks.

**Handled Events:**
- `checkout.session.completed` - Records completed payments
- `payment_intent.succeeded` - Updates payment status
- `payment_intent.payment_failed` - Marks payment as failed
- `customer.subscription.created` - Creates subscription record
- `customer.subscription.updated` - Updates subscription
- `customer.subscription.deleted` - Marks subscription as canceled
- `invoice.payment_succeeded` - Updates subscription after renewal
- `invoice.payment_failed` - Marks subscription as past_due

## Testing Webhooks Locally

Use the Stripe CLI to forward webhooks to your local server:

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login to your Stripe account
stripe login

# Forward webhooks to your local server
stripe listen --forward-to localhost:8055/payments/stripe/webhook
```

This will output a webhook signing secret to use in your configuration.

## Service API Reference

### getStripeService()

Returns the Stripe service singleton. Throws an error if the plugin hasn't been initialized.

```typescript
import { getStripeService } from '@baasix/plugin-stripe';

const stripeService = getStripeService();
```

### isStripeServiceInitialized()

Check if the Stripe service has been initialized.

```typescript
import { isStripeServiceInitialized } from '@baasix/plugin-stripe';

if (isStripeServiceInitialized()) {
  // Safe to use getStripeService()
}
```

### Service Methods

| Method | Description |
|--------|-------------|
| `getOrCreateCustomer(userId)` | Get or create a Stripe customer for a user |
| `getCustomer(userId)` | Get a Stripe customer by user ID |
| `createCheckoutSession(options)` | Create a checkout session for one-time payment |
| `createSubscriptionCheckout(options)` | Create a checkout session for subscription |
| `createPortalSession(userId, returnUrl)` | Create a billing portal session |
| `manageSubscription(userId, subscriptionId, action)` | Cancel or resume a subscription |
| `getUserPayments(userId)` | Get a user's payment history |
| `getUserSubscriptions(userId)` | Get a user's subscriptions |
| `getProducts()` | Get all active products |
| `syncProducts()` | Sync products from Stripe |
| `handleWebhook(event)` | Handle a Stripe webhook event |
| `syncSubscription(subscription)` | Sync a subscription from Stripe |
| `stripe` | Access the Stripe SDK instance directly |

## Type Definitions

Import types for TypeScript support:

```typescript
import type {
  StripePluginConfig,
  StripeCustomerRecord,
  StripePaymentRecord,
  StripeSubscriptionRecord,
  StripeProductRecord,
  StripeServiceInterface
} from '@baasix/plugin-stripe';
```

## Plugin Structure

```
src/
├── index.ts              # Main entry point & exports
├── types.ts              # All type definitions
├── schemas/
│   └── index.ts          # Database schema definitions
├── services/
│   └── stripeService.ts  # Service implementation & singleton
├── routes/
│   ├── index.ts          # Routes aggregator
│   ├── checkout.ts       # One-time payment checkout
│   ├── subscription.ts   # Subscription management
│   ├── portal.ts         # Customer portal & payments
│   ├── products.ts       # Product listing & sync
│   └── webhook.ts        # Webhook handler
└── utils/
    └── loadStripe.ts     # Dynamic Stripe SDK loading
```

## Creating Your Own Plugin

This plugin serves as an example for creating Baasix plugins. Key patterns:

1. **Types** - Define all types in `types.ts`
2. **Schemas** - Define database schemas in `schemas/`
3. **Services** - Implement business logic in `services/`
4. **Routes** - Define API endpoints in `routes/`
5. **Singleton** - Use `globalThis` for services that should be accessible everywhere
6. **Lifecycle** - Use `onInit`, `onReady`, `onShutdown` for setup/teardown

## License

MIT
