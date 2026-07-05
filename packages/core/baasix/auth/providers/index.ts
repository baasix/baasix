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
import { line } from "./line.js";
import { linear } from "./linear.js";
import { linkedin } from "./linkedin.js";
import { microsoft } from "./microsoft-entra-id.js";
import { naver } from "./naver.js";
import { notion } from "./notion.js";
import { paybin } from "./paybin.js";
import { paypal } from "./paypal.js";
import { polar } from "./polar.js";
import { railway } from "./railway.js";
import { reddit } from "./reddit.js";
import { roblox } from "./roblox.js";
import { salesforce } from "./salesforce.js";
import { slack } from "./slack.js";
import { spotify } from "./spotify.js";
import { tiktok } from "./tiktok.js";
import { twitch } from "./twitch.js";
import { twitter } from "./twitter.js";
import { vercel } from "./vercel.js";
import { vk } from "./vk.js";
import { wechat } from "./wechat.js";
import { zoom } from "./zoom.js";
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

export { line } from "./line.js";
export type { LineOptions, LineUserInfo, LineIdTokenPayload } from "./line.js";

export { linear } from "./linear.js";
export type { LinearOptions, LinearUser } from "./linear.js";

export { linkedin } from "./linkedin.js";
export type { LinkedInOptions, LinkedInProfile } from "./linkedin.js";

export { microsoft } from "./microsoft-entra-id.js";
export type { MicrosoftOptions, MicrosoftEntraIDProfile } from "./microsoft-entra-id.js";

export { naver } from "./naver.js";
export type { NaverOptions, NaverProfile } from "./naver.js";

export { notion } from "./notion.js";
export type { NotionOptions, NotionProfile } from "./notion.js";

export { paybin } from "./paybin.js";
export type { PaybinOptions, PaybinProfile } from "./paybin.js";

export { paypal } from "./paypal.js";
export type { PayPalOptions, PayPalProfile } from "./paypal.js";

export { polar } from "./polar.js";
export type { PolarOptions, PolarProfile } from "./polar.js";

export { railway } from "./railway.js";
export type { RailwayOptions, RailwayProfile } from "./railway.js";

export { reddit } from "./reddit.js";
export type { RedditOptions, RedditProfile } from "./reddit.js";

export { roblox } from "./roblox.js";
export type { RobloxOptions, RobloxProfile } from "./roblox.js";

export { salesforce } from "./salesforce.js";
export type { SalesforceOptions, SalesforceProfile } from "./salesforce.js";

export { slack } from "./slack.js";
export type { SlackOptions, SlackProfile } from "./slack.js";

export { spotify } from "./spotify.js";
export type { SpotifyOptions, SpotifyProfile } from "./spotify.js";

export { tiktok } from "./tiktok.js";
export type { TikTokOptions, TikTokProfile } from "./tiktok.js";

export { twitch } from "./twitch.js";
export type { TwitchOptions, TwitchProfile } from "./twitch.js";

export { twitter } from "./twitter.js";
export type { TwitterOption, TwitterProfile } from "./twitter.js";

export { vercel } from "./vercel.js";
export type { VercelOptions, VercelProfile } from "./vercel.js";

export { vk } from "./vk.js";
export type { VkOption, VkProfile } from "./vk.js";

export { wechat } from "./wechat.js";
export type { WeChatOptions, WeChatProfile } from "./wechat.js";

export { zoom } from "./zoom.js";
export type { ZoomOptions, ZoomProfile } from "./zoom.js";

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
  line,
  linear,
  linkedin,
  microsoft,
  naver,
  notion,
  paybin,
  paypal,
  polar,
  railway,
  reddit,
  roblox,
  salesforce,
  slack,
  spotify,
  tiktok,
  twitch,
  twitter,
  vercel,
  vk,
  wechat,
  zoom,
};

export const PROVIDER_IDS = Object.keys(providerFactories);

export type SocialProviderName = keyof typeof providerFactories;
