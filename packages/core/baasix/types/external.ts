/**
 * External Library Types
 * Types that depend on external libraries (AWS SDK, Socket.IO, Nodemailer)
 */

import type { S3Client } from '@aws-sdk/client-s3';
import type { Socket } from 'socket.io';
import type nodemailer from 'nodemailer';

// ============================================================================
// Storage Types (AWS SDK)
// ============================================================================

/**
 * Storage provider interface
 */
export interface StorageProvider {
  driver: string;
  basePath?: string;
  s3Client?: S3Client;
  bucketName?: string;
  saveFile: (filePath: string, fileContent: Buffer | Uint8Array) => Promise<string>;
  getFile: (filePath: string) => Promise<any>;
  deleteFile: (filePath: string) => Promise<void>;
  getPublicUrl: (filePath: string) => Promise<string> | string;
}

// ============================================================================
// Socket Types (Socket.IO)
// ============================================================================

/**
 * User information for socket connections
 */
export interface UserInfo {
  user: { id: string | number };
  role: any;
  permissions: any;
  tenant: any;
}

/**
 * Socket with authentication data
 */
export interface SocketWithAuth extends Socket {
  userId?: string | number;
  userRole?: any;
  userPermissions?: any;
  userTenant?: any;
}

// ============================================================================
// Mail Types (Nodemailer)
// ============================================================================

/**
 * Mail options for sending emails
 */
export interface MailOptions {
  to: string;
  subject?: string; // Optional - if not provided, template subject will be used
  templateName: string;
  context: Record<string, any>;
  from?: string;
  sender?: string;
  attachments?: any[];
  tenantId?: string | number;
}

/**
 * Sender configuration
 */
export interface SenderConfig {
  transporter: nodemailer.Transporter;
  from: string;
}

/**
 * Tenant-specific transporter configuration
 */
export interface TenantTransporter {
  transporter: nodemailer.Transporter;
  from: string;
  fromName?: string;
}
