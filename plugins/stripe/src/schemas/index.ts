/**
 * Stripe Plugin Database Schemas
 *
 * Defines the database tables created by the Stripe plugin:
 * - baasix_StripeCustomer: Maps users to Stripe customers
 * - baasix_StripePayment: Records one-time payments
 * - baasix_StripeSubscription: Tracks subscriptions
 * - baasix_StripeProduct: Caches products/prices from Stripe
 */

import type { PluginSchemaDefinition } from "../types.js";

/**
 * Stripe Customer schema - maps Baasix users to Stripe customers
 */
export const stripeCustomerSchema: PluginSchemaDefinition = {
  collectionName: "baasix_StripeCustomer",
  schema: {
    name: "StripeCustomer",
    timestamps: true,
    fields: {
      id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
      user_Id: { type: "UUID", allowNull: false },
      stripeCustomerId: { type: "String", allowNull: false },
      email: { type: "String", allowNull: true },
      metadata: { type: "JSON", allowNull: true },
      user: {
        relType: "BelongsTo",
        target: "baasix_User",
        foreignKey: "user_Id",
        as: "user",
      },
    },
    indexes: [
      { fields: ["stripeCustomerId"], unique: true },
      { fields: ["user_Id"], unique: true },
    ],
  },
};

/**
 * Stripe Payment schema - records one-time payments
 */
export const stripePaymentSchema: PluginSchemaDefinition = {
  collectionName: "baasix_StripePayment",
  schema: {
    name: "StripePayment",
    timestamps: true,
    fields: {
      id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
      customer_Id: { type: "UUID", allowNull: false },
      stripePaymentIntentId: { type: "String", allowNull: false },
      stripeCheckoutSessionId: { type: "String", allowNull: true },
      amount: { type: "Integer", allowNull: false },
      currency: { type: "String", defaultValue: "usd" },
      status: {
        type: "ENUM",
        values: ["pending", "processing", "succeeded", "failed", "canceled", "refunded"],
        defaultValue: "pending",
      },
      metadata: { type: "JSON", allowNull: true },
      customer: {
        relType: "BelongsTo",
        target: "baasix_StripeCustomer",
        foreignKey: "customer_Id",
        as: "customer",
      },
    },
    indexes: [{ fields: ["stripePaymentIntentId"], unique: true }],
  },
};

/**
 * Stripe Subscription schema - tracks active and past subscriptions
 */
export const stripeSubscriptionSchema: PluginSchemaDefinition = {
  collectionName: "baasix_StripeSubscription",
  schema: {
    name: "StripeSubscription",
    timestamps: true,
    fields: {
      id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
      customer_Id: { type: "UUID", allowNull: false },
      stripeSubscriptionId: { type: "String", allowNull: false },
      stripePriceId: { type: "String", allowNull: false },
      status: {
        type: "ENUM",
        values: ["active", "canceled", "incomplete", "past_due", "trialing", "unpaid", "incomplete_expired", "paused"],
        defaultValue: "incomplete",
      },
      currentPeriodStart: { type: "DateTime", allowNull: true },
      currentPeriodEnd: { type: "DateTime", allowNull: true },
      cancelAtPeriodEnd: { type: "Boolean", defaultValue: false },
      metadata: { type: "JSON", allowNull: true },
      customer: {
        relType: "BelongsTo",
        target: "baasix_StripeCustomer",
        foreignKey: "customer_Id",
        as: "customer",
      },
    },
    indexes: [{ fields: ["stripeSubscriptionId"], unique: true }],
  },
};

/**
 * Stripe Product schema - caches products and prices from Stripe
 */
export const stripeProductSchema: PluginSchemaDefinition = {
  collectionName: "baasix_StripeProduct",
  schema: {
    name: "StripeProduct",
    timestamps: true,
    fields: {
      id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
      stripeProductId: { type: "String", allowNull: false },
      stripePriceId: { type: "String", allowNull: false },
      name: { type: "String", allowNull: false },
      description: { type: "Text", allowNull: true },
      amount: { type: "Integer", allowNull: true },
      currency: { type: "String", defaultValue: "usd" },
      interval: {
        type: "ENUM",
        values: ["one_time", "day", "week", "month", "year"],
        defaultValue: "one_time",
      },
      intervalCount: { type: "Integer", defaultValue: 1 },
      active: { type: "Boolean", defaultValue: true },
      metadata: { type: "JSON", allowNull: true },
    },
    indexes: [
      { fields: ["stripeProductId"] },
      { fields: ["stripePriceId"], unique: true },
    ],
  },
};

/**
 * All Stripe plugin schemas
 */
export const stripeSchemas: PluginSchemaDefinition[] = [
  stripeCustomerSchema,
  stripePaymentSchema,
  stripeSubscriptionSchema,
  stripeProductSchema,
];
