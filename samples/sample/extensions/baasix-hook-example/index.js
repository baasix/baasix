/**
 * Example Hook Extension
 * 
 * This extension demonstrates how to create hooks for collections.
 * Hooks allow you to intercept and modify data during CRUD operations.
 * 
 * Hook Types:
 * - items.create - Before creating an item
 * - items.read - Before reading items
 * - items.update - Before updating an item
 * - items.delete - Before deleting an item
 */

import { ItemsService } from "@baasix/baasix";

export default (hooksService, context) => {
  // =========================================================================
  // CREATE Hook - Add timestamps and user tracking
  // =========================================================================
  hooksService.registerHook(
    "posts",  // Collection name
    "items.create",
    async ({ data, accountability, collection, schema }) => {
      console.log(`Creating item in ${collection}:`, data);
      
      // Add created_by field
      if (accountability?.user?.id) {
        data.created_by = accountability.user.id;
      }
      
      // Add created_at timestamp
      data.created_at = new Date();
      
      return { data };
    }
  );

  // =========================================================================
  // READ Hook - Filter data based on user role
  // =========================================================================
  hooksService.registerHook(
    "posts",
    "items.read",
    async ({ query, data, accountability, collection, schema }) => {
      // Only show published posts to non-admin users
      if (accountability?.role?.name !== "administrator") {
        const existingFilter = query.filter ? JSON.parse(query.filter) : {};
        query.filter = JSON.stringify({
          ...existingFilter,
          status: "published"
        });
      }
      
      return { query };
    }
  );

  // =========================================================================
  // UPDATE Hook - Track modifications
  // =========================================================================
  hooksService.registerHook(
    "posts",
    "items.update",
    async ({ id, data, accountability, schema }) => {
      console.log(`Updating item ${id}:`, data);
      
      // Add updated_by field
      if (accountability?.user?.id) {
        data.updated_by = accountability.user.id;
      }
      
      // Add updated_at timestamp
      data.updated_at = new Date();
      
      return { id, data };
    }
  );

  // =========================================================================
  // DELETE Hook - Soft delete instead of hard delete
  // =========================================================================
  hooksService.registerHook(
    "posts",
    "items.delete",
    async ({ id, accountability }) => {
      console.log(`Delete requested for item ${id}`);
      
      // Perform soft delete instead
      const postsService = new ItemsService("posts", {
        accountability: accountability,
      });

      await postsService.updateOne(
        id,
        {
          archived: true,
          archived_by: accountability?.user?.id,
          archived_at: new Date(),
        },
        { bypassPermissions: true }
      );

      // Prevent actual deletion by throwing error
      throw new Error("Post archived instead of deleted");
    }
  );
};
