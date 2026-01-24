/**
 * File & Asset Types
 * Shared across core, sdk, and app packages
 */

// ============================================================================
// File Types
// ============================================================================

/**
 * File metadata
 */
export interface FileMetadata {
  id: string;
  title?: string;
  description?: string;
  filename: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  storage: string;
  path: string;
  isPublic?: boolean;
  uploadedBy?: string;
  tenant_Id?: string;
  createdAt: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/**
 * File data (internal use)
 */
export interface FileData {
  buffer: Buffer;
  filename: string;
  mimetype: string;
  size: number;
}

/**
 * Upload options
 */
export interface UploadOptions {
  title?: string;
  description?: string;
  folder?: string;
  storage?: "local" | "s3";
  isPublic?: boolean;
  metadata?: Record<string, unknown>;
  onProgress?: (progress: number) => void;
  /** Request timeout in milliseconds (default: 30000). Set to 0 for no timeout. */
  timeout?: number;
}

/**
 * Internal uploaded file (from express-fileupload)
 */
export interface InternalUploadedFile {
  name: string;
  data: Buffer;
  size: number;
  encoding: string;
  tempFilePath: string;
  truncated: boolean;
  mimetype: string;
  md5: string;
  mv: (path: string) => Promise<void>;
}

// ============================================================================
// Asset Transform Types
// ============================================================================

/**
 * Asset transform options
 */
export interface AssetTransformOptions {
  width?: number;
  height?: number;
  fit?: "cover" | "contain" | "fill" | "inside" | "outside";
  quality?: number;
  format?: "jpeg" | "png" | "webp" | "avif";
}

/**
 * Asset query parameters (from HTTP query string)
 * Values can be string | number since they come from query params
 */
export interface AssetQuery {
  width?: string | number;
  height?: string | number;
  fit?: "cover" | "contain" | "fill" | "inside" | "outside" | string;
  quality?: string | number;
  format?: string;
  withoutEnlargement?: string | boolean;
}

/**
 * Processed image result
 */
export interface ProcessedImage {
  buffer: Buffer;
  /** Content type (e.g., 'image/jpeg') or format (e.g., 'jpeg') */
  contentType?: string;
  format?: string;
  width?: number;
  height?: number;
}

// ============================================================================
// Storage Types
// ============================================================================

/**
 * Storage provider type
 */
export type StorageProvider = "local" | "s3" | "gcs" | "azure";

/**
 * Storage adapter interface
 */
export interface StorageAdapter {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

// ============================================================================
// Import/Export Types
// ============================================================================

/**
 * Uploaded file interface (from multipart form)
 */
export interface UploadedFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

/**
 * Import options
 */
export interface ImportOptions {
  collection: string;
  file?: UploadedFile;
  data?: unknown[];
  format?: "csv" | "json";
  mapping?: Record<string, string>;
  skipValidation?: boolean;
  batchSize?: number;
  onProgress?: (processed: number, total: number) => void;
  onError?: (error: Error, row: unknown, index: number) => void;
}

/**
 * Export options
 */
export interface ExportOptions {
  collection: string;
  format?: "csv" | "json";
  fields?: string[];
  filter?: Record<string, unknown>;
  limit?: number;
  offset?: number;
}

/**
 * Import result
 */
export interface ImportResult {
  success: boolean;
  imported: number;
  failed: number;
  errors: Array<{ row: number; error: string; data?: unknown }>;
  duration: number;
}

/**
 * Export result
 */
export interface ExportResult {
  success: boolean;
  data: string | unknown[];
  count: number;
  format: string;
}
