/**
 * Stripe SDK Dynamic Loader
 *
 * Provides lazy loading of the Stripe SDK to avoid requiring
 * the package at compile time. This allows the plugin to be
 * compiled without having Stripe installed.
 */

import type { StripePluginConfig } from "../types.js";

/**
 * Load Stripe SDK dynamically
 *
 * Uses a dynamic import trick to prevent TypeScript from trying
 * to resolve the module at compile time.
 *
 * @throws Error if stripe package is not installed
 */
export async function loadStripeSDK(): Promise<any> {
  try {
    // Use dynamic import with a variable to prevent TypeScript from resolving it
    const moduleName = "stripe";
    const stripeModule = await (Function('moduleName', 'return import(moduleName)')(moduleName));
    return stripeModule.default || stripeModule;
  } catch {
    throw new Error(
      "Stripe plugin requires the 'stripe' package. Install it with: npm install stripe"
    );
  }
}

/**
 * Creates a lazy Stripe instance getter
 *
 * Returns a function that initializes Stripe on first call and
 * returns the cached instance on subsequent calls.
 *
 * @param config - Stripe plugin configuration
 * @returns Function that returns a Promise resolving to Stripe instance
 */
export function createStripeGetter(config: StripePluginConfig): () => Promise<any> {
  let stripeInstance: any = null;
  let initPromise: Promise<any> | null = null;

  return async (): Promise<any> => {
    // Return cached instance if available
    if (stripeInstance) {
      return stripeInstance;
    }

    // Return existing promise if initialization is in progress
    if (initPromise) {
      return initPromise;
    }

    // Initialize Stripe
    initPromise = (async () => {
      const StripeSDK = await loadStripeSDK();
      stripeInstance = new StripeSDK(config.secretKey, {
        apiVersion: config.apiVersion || "2025-01-27.acacia",
      });
      return stripeInstance;
    })();

    return initPromise;
  };
}
