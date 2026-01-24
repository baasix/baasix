/**
 * Notification Types
 * Shared across core, sdk, and app packages
 */

// ============================================================================
// Notification Types
// ============================================================================

/**
 * Notification type
 */
export type NotificationType = "info" | "success" | "warning" | "error" | string;

/**
 * Notification
 */
export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  seen: boolean;
  user_Id: string;
  tenant_Id?: string;
  createdAt: string;
  updatedAt?: string;
}

/**
 * Notification options (for creating)
 */
export interface NotificationOptions {
  type?: NotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  userIds?: string[];
  tenant_Id?: string;
}

/**
 * Send notification data
 */
export interface SendNotificationData {
  type?: NotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  userIds: string[];
}
