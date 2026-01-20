import type { HttpClient } from "../client";
import type {
  Notification,
  PaginatedResponse,
  SendNotificationData,
} from "../types";

export interface NotificationsModuleConfig {
  client: HttpClient;
}

/**
 * Notifications module for managing user notifications.
 *
 * @example
 * ```typescript
 * // Get user notifications
 * const { data } = await baasix.notifications.find();
 *
 * // Mark as seen
 * await baasix.notifications.markAsSeen(['notification-id']);
 *
 * // Send notification (admin)
 * await baasix.notifications.send({
 *   title: 'New Message',
 *   message: 'You have a new message',
 *   userIds: ['user-uuid']
 * });
 * ```
 */
export class NotificationsModule {
  private client: HttpClient;

  constructor(config: NotificationsModuleConfig) {
    this.client = config.client;
  }

  /**
   * List notifications for the current user
   *
   * @example
   * ```typescript
   * const { data } = await baasix.notifications.find({
   *   limit: 20,
   *   filter: { seen: { eq: false } }
   * });
   * ```
   */
  async find(params?: {
    limit?: number;
    page?: number;
    filter?: Record<string, unknown>;
  }): Promise<PaginatedResponse<Notification>> {
    return this.client.get<PaginatedResponse<Notification>>("/notifications", {
      params: params as Record<string, unknown>,
    });
  }

  /**
   * Get unread notification count
   *
   * @example
   * ```typescript
   * const count = await baasix.notifications.getUnreadCount();
   * ```
   */
  async getUnreadCount(): Promise<number> {
    const response = await this.client.get<{ count: number }>(
      "/notifications/unread/count"
    );
    return response.count;
  }

  /**
   * Mark notifications as seen
   *
   * @example
   * ```typescript
   * // Mark specific notifications as seen
   * await baasix.notifications.markAsSeen(['id1', 'id2']);
   * 
   * // Mark all notifications as seen
   * await baasix.notifications.markAsSeen();
   * ```
   */
  async markAsSeen(notificationIds?: string[]): Promise<{ count: number }> {
    const response = await this.client.post<{ message: string; count: number }>(
      "/notifications/mark-seen",
      { notificationIds }
    );
    return { count: response.count };
  }

  /**
   * Delete notifications for the current user
   *
   * @example
   * ```typescript
   * // Delete specific notifications
   * await baasix.notifications.delete(['id1', 'id2']);
   * 
   * // Delete all notifications
   * await baasix.notifications.delete();
   * ```
   */
  async delete(notificationIds?: string[]): Promise<{ count: number }> {
    const response = await this.client.delete<{ message: string; count: number }>(
      "/notifications",
      { params: notificationIds ? { notificationIds } : undefined }
    );
    return { count: response.count };
  }

  /**
   * Send a notification to users (requires admin permissions)
   *
   * @example
   * ```typescript
   * await baasix.notifications.send({
   *   type: 'alert',
   *   title: 'System Update',
   *   message: 'The system will be down for maintenance',
   *   data: { link: '/updates' },
   *   userIds: ['user1-uuid', 'user2-uuid']
   * });
   * ```
   */
  async send(data: SendNotificationData): Promise<{ notificationIds: string[] }> {
    const response = await this.client.post<{ message: string; notificationIds: string[] }>(
      "/notifications/send",
      data
    );
    return { notificationIds: response.notificationIds };
  }

  /**
   * Cleanup old notifications (requires admin permissions)
   *
   * @example
   * ```typescript
   * // Clean up notifications older than 30 days (default)
   * await baasix.notifications.cleanup();
   * 
   * // Clean up notifications older than 7 days
   * await baasix.notifications.cleanup(7);
   * ```
   */
  async cleanup(days: number = 30): Promise<{ count: number }> {
    const response = await this.client.post<{ message: string; count: number }>(
      "/notifications/cleanup",
      { days }
    );
    return { count: response.count };
  }
}

// Re-export types
export type { Notification, SendNotificationData };
