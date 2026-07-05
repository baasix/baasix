/**
 * Providers Index
 * Export all auth providers
 */

import { google } from "./google.js";
import { facebook } from "./facebook.js";
import { apple } from "./apple.js";
import { github } from "./github.js";
import { discord } from "./discord.js";
import type { OAuthProvider } from "../types.js";

export { google } from "./google.js";
export type { GoogleOptions, GoogleProfile } from "./google.js";

export { facebook } from "./facebook.js";
export type { FacebookOptions, FacebookProfile } from "./facebook.js";

export { apple } from "./apple.js";
export type { AppleOptions, AppleProfile } from "./apple.js";

export { github } from "./github.js";
export type { GitHubOptions, GitHubProfile } from "./github.js";

export { discord } from "./discord.js";
export type { DiscordOptions, DiscordProfile } from "./discord.js";

export { credential } from "./credential.js";
export type { CredentialProvider, CredentialProviderOptions } from "./credential.js";

/**
 * All social provider factories, keyed by provider id.
 * Tasks porting new providers append here.
 */
export const providerFactories: Record<string, (options: any) => OAuthProvider> = {
  google,
  facebook,
  apple,
  github,
  discord,
};

export const PROVIDER_IDS = Object.keys(providerFactories);

export type SocialProviderName = keyof typeof providerFactories;
