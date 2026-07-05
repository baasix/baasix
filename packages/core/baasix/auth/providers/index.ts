/**
 * Providers Index
 * Export all auth providers
 */

import { google } from "./google.js";
import { facebook } from "./facebook.js";
import { apple } from "./apple.js";
import { github } from "./github.js";
import { discord } from "./discord.js";
import { atlassian } from "./atlassian.js";
import { cognito } from "./cognito.js";
import { dropbox } from "./dropbox.js";
import { figma } from "./figma.js";
import { gitlab } from "./gitlab.js";
import { huggingface } from "./huggingface.js";
import { kakao } from "./kakao.js";
import { kick } from "./kick.js";
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

export { atlassian } from "./atlassian.js";
export type { AtlassianOptions, AtlassianProfile } from "./atlassian.js";

export { cognito } from "./cognito.js";
export type { CognitoOptions, CognitoProfile } from "./cognito.js";

export { dropbox } from "./dropbox.js";
export type { DropboxOptions, DropboxProfile } from "./dropbox.js";

export { figma } from "./figma.js";
export type { FigmaOptions, FigmaProfile } from "./figma.js";

export { gitlab } from "./gitlab.js";
export type { GitlabOptions, GitlabProfile } from "./gitlab.js";

export { huggingface } from "./huggingface.js";
export type { HuggingFaceOptions, HuggingFaceProfile } from "./huggingface.js";

export { kakao } from "./kakao.js";
export type { KakaoOptions, KakaoProfile } from "./kakao.js";

export { kick } from "./kick.js";
export type { KickOptions, KickProfile } from "./kick.js";

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
  atlassian,
  cognito,
  dropbox,
  figma,
  gitlab,
  huggingface,
  kakao,
  kick,
};

export const PROVIDER_IDS = Object.keys(providerFactories);

export type SocialProviderName = keyof typeof providerFactories;
