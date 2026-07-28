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
        /** Full active baasix_UserRole row (assignment) — custom columns included. */
        userRole?: Record<string, any>;
        tenant?: string;
        permissions?: any[];
        ipaddress?: string;
      };
    }
  }
}
