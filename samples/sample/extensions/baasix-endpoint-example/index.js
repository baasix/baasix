/**
 * Example Endpoint Extension
 * 
 * This extension demonstrates how to create custom REST endpoints.
 * Endpoints are Express.js routes that can access Baasix services.
 */

import { APIError, ItemsService } from "@baasix/baasix";

const registerEndpoint = (app, context) => {
  // =========================================================================
  // GET /user-profile - Get current user's profile
  // =========================================================================
  app.get("/user-profile", async (req, res, next) => {
    try {
      // Check authentication
      if (!req.accountability || !req.accountability.user) {
        throw new APIError("Unauthorized", 401);
      }

      const { user, role } = req.accountability;

      res.json({
        success: true,
        data: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: {
            id: role.id,
            name: role.name,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  });

  // =========================================================================
  // GET /stats - Get collection statistics
  // =========================================================================
  app.get("/stats/:collection", async (req, res, next) => {
    try {
      const { collection } = req.params;

      // Check authentication
      if (!req.accountability || !req.accountability.user) {
        throw new APIError("Unauthorized", 401);
      }

      // Only allow admins to view stats
      if (req.accountability.role.name !== "administrator") {
        throw new APIError("Forbidden", 403);
      }

      const itemsService = new ItemsService(collection, {
        accountability: req.accountability,
      });

      // Get total count
      const items = await itemsService.readByQuery({
        aggregate: { count: "*" },
      });

      res.json({
        success: true,
        data: {
          collection,
          totalCount: items[0]?.count || 0,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  // =========================================================================
  // POST /bulk-update - Bulk update items
  // =========================================================================
  app.post("/bulk-update/:collection", async (req, res, next) => {
    try {
      const { collection } = req.params;
      const { ids, data } = req.body;

      // Validate input
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        throw new APIError("ids array is required", 400);
      }

      if (!data || typeof data !== "object") {
        throw new APIError("data object is required", 400);
      }

      // Check authentication
      if (!req.accountability || !req.accountability.user) {
        throw new APIError("Unauthorized", 401);
      }

      const itemsService = new ItemsService(collection, {
        accountability: req.accountability,
      });

      // Update each item
      const results = await Promise.all(
        ids.map(async (id) => {
          try {
            await itemsService.updateOne(id, data);
            return { id, success: true };
          } catch (error) {
            return { id, success: false, error: error.message };
          }
        })
      );

      const successful = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      res.json({
        success: true,
        data: {
          total: ids.length,
          successful,
          failed,
          results,
        },
      });
    } catch (error) {
      next(error);
    }
  });
};

export default {
  id: "custom-endpoints",
  handler: registerEndpoint,
};
