/**
 * Common/Utility Types
 * Shared across all packages
 */

// ============================================================================
// Base Types
// ============================================================================

/**
 * Generic record type with ID
 */
export interface BaseItem {
  id: string;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string;
  [key: string]: unknown;
}

/**
 * Timestamped item
 */
export interface TimestampedItem {
  createdAt: string;
  updatedAt?: string;
}

/**
 * Soft deletable item
 */
export interface SoftDeletableItem {
  deletedAt?: string | null;
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Make all properties of T optional recursively
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * Extract the item type from a collection
 */
export type CollectionItem<T> = T extends Array<infer U> ? U : T;

/**
 * Make specific properties required
 */
export type WithRequired<T, K extends keyof T> = T & { [P in K]-?: T[P] };

/**
 * Make specific properties optional
 */
export type WithOptional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/**
 * Extract keys of T that have values of type V
 */
export type KeysOfType<T, V> = { [K in keyof T]: T[K] extends V ? K : never }[keyof T];

/**
 * Record with string keys and unknown values
 */
export type AnyRecord = Record<string, unknown>;

// ============================================================================
// Settings Types
// ============================================================================

/**
 * Generic settings
 */
export interface Settings {
  [key: string]: unknown;
}

/**
 * Tenant settings
 */
export interface TenantSettings {
  tenant_Id?: string | number | null;
  project_name?: string;
  title?: string;
  project_url?: string | null;
  app_url?: string | null;
  project_color?: string;
  secondary_color?: string;
  description?: string;
  keywords?: string;
  from_email_name?: string;
  smtp_enabled?: boolean;
  smtp_host?: string;
  smtp_port?: number;
  smtp_secure?: boolean;
  smtp_user?: string;
  smtp_pass?: string;
  smtp_from_address?: string;
  timezone?: string;
  language?: string;
  date_format?: string;
  currency?: string;
  email_signature?: string;
  email_icon?: any;
  metadata?: Record<string, any>;
  modules?: Record<string, any>;
  [key: string]: any;
}

// ============================================================================
// Task Types
// ============================================================================

/**
 * Background task
 */
export interface BackgroundTask {
  id: string | number;
  task_status: string;
  scheduled_time: Date;
  [key: string]: unknown;
}

// ============================================================================
// Hook Types
// ============================================================================

/**
 * Hook events
 */
export type HookEvent =
  | "items.create"
  | "items.read"
  | "items.update"
  | "items.delete"
  | "auth.login"
  | "auth.logout"
  | "auth.register";

/**
 * Hook handler context
 */
export interface HookContext {
  event: HookEvent;
  collection?: string;
  payload?: unknown;
  keys?: string[];
  accountability?: {
    user?: { id: string };
    role?: { id: string; name: string };
    tenant?: { id: string };
  };
}

/**
 * Hook handler function
 */
export type HookHandler = (context: HookContext) => void | Promise<void>;

/**
 * Hook definition
 */
export interface Hook {
  event: HookEvent;
  collection?: string;
  handler: HookHandler;
}

// ============================================================================
// HTTP Types
// ============================================================================

/**
 * HTTP methods
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";

// ============================================================================
// Mail Types
// ============================================================================

/**
 * Mail options for sending emails
 */
export interface MailOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content?: string | Buffer;
    path?: string;
    contentType?: string;
  }>;
}

/**
 * Sender configuration for email
 */
export interface SenderConfig {
  from: string;
  name?: string;
  replyTo?: string;
}

// ============================================================================
// Seed Types
// ============================================================================

/**
 * Seed data configuration
 */
export interface SeedData {
  collection: string;
  data: Record<string, unknown> | Record<string, unknown>[];
  /** Whether to clear existing data before seeding */
  clearBefore?: boolean;
  /** Whether to skip if data already exists (check by unique fields) */
  skipDuplicates?: boolean;
}

/**
 * Seed operation result
 */
export interface SeedResult {
  collection: string;
  created: number;
  skipped: number;
  errors: number;
  errorDetails?: Array<{ item: unknown; error: string }>;
}
