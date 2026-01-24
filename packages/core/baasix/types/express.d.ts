/**
 * Express Request Augmentation
 * Adds accountability property to Express Request for auth middleware
 */

// Empty export to make this a module (required for global augmentation)
export {};

declare global {
  namespace Express {
    interface Request {
      accountability?: {
        user?: {
          id: string;
          email?: string;
          role?: string;
          isAdmin?: boolean;
          [key: string]: any;
        };
        role?: string;
        tenant?: string;
        permissions?: any[];
        ipaddress?: string;
      };
    }
  }
}
