import type { Express } from "../types/index.js";
import permissionService from "../services/PermissionService.js";
import ItemsService from "../services/ItemsService.js";
import { adminOnly } from "../utils/auth.js";
import { APIError } from "../utils/errorHandler.js";
import { invalidateAuthCache, invalidateCollectionCache } from "../utils/common.js";
import { parseQueryParams } from "../utils/router.js";

/**
 * Validate acl_Ids on permission writes:
 * - must be an array of existing baasix_ACL UUIDs
 * - cannot be combined with inline conditions/relConditions/fields/defaultValues
 *   (assigned ACL entries fully replace inline values — one source of truth)
 */
const validateAclIds = async (data: Record<string, any>, accountability: any): Promise<void> => {
    if (data.acl_Ids == null) return;

    if (!Array.isArray(data.acl_Ids) || !data.acl_Ids.every((id: any) => typeof id === "string")) {
        throw new APIError("acl_Ids must be an array of ACL entry UUIDs", 400);
    }

    if (data.acl_Ids.length > 0) {
        const inlineKeys = ["conditions", "relConditions", "fields", "defaultValues"].filter(
            (key) => data[key] != null
        );
        if (inlineKeys.length > 0) {
            throw new APIError(
                `A permission cannot set both acl_Ids and inline ${inlineKeys.join("/")}. Assigned ACL entries replace inline values.`,
                400
            );
        }

        const aclService = new ItemsService("baasix_ACL", { accountability });
        const found = await aclService.readByQuery({
            filter: { id: { in: data.acl_Ids } },
            fields: ["id"],
            limit: -1,
        });
        const foundIds = new Set(found.data.map((e: any) => String(e.id)));
        const unknown = data.acl_Ids.filter((id: string) => !foundIds.has(String(id)));
        if (unknown.length > 0) {
            throw new APIError(`Unknown ACL entry id(s): ${unknown.join(", ")}`, 400);
        }
    }
};

const registerEndpoint = (app: Express) => {
  // Get all permissions
  app.get("/permissions", async (req, res, next) => {
    try {
      const query = parseQueryParams(req.query);

      const itemsService = new ItemsService("baasix_Permission", {
        accountability: req.accountability as any,
      });

      const result = await itemsService.readByQuery({
        ...query,
        limit: query.limit ?? -1,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  // Get single permission
  app.get("/permissions/:id", async (req, res, next) => {
    try {
      const { id } = req.params;

      const itemsService = new ItemsService("baasix_Permission", {
        accountability: req.accountability as any,
      });

      const permission = await itemsService.readOne(id);

      res.json({ data: permission });
    } catch (error) {
      next(error);
    }
  });

  // Create permission
  // `conditions` filters EXISTING rows (read/update/delete). A create has no
  // rows to filter — accepting conditions there would create a decorative,
  // never-enforced grant. Write-scoping for creates lives in `checkConditions`.
  const assertNoCreateConditions = (action: string | undefined, conditions: any) => {
    if (action === "create" && conditions && Object.keys(conditions).length > 0) {
      throw new APIError(
        "`conditions` does not apply to create grants (there are no existing rows to filter). Use `checkConditions` to scope what may be created.",
        400
      );
    }
  };

  app.post("/permissions", adminOnly, async (req, res, next) => {
    try {
      const data = req.body;

      assertNoCreateConditions(data.action, data.conditions);
      await validateAclIds(data, req.accountability);

      const itemsService = new ItemsService("baasix_Permission", {
        accountability: req.accountability as any,
      });

      const newId = await itemsService.createOne(data);

      // Read the created permission to return full object
      const newPermission = await itemsService.readOne(newId);

      // Reload permissions
      await permissionService.loadPermissions();

      // Invalidate auth and collection caches in parallel
      await Promise.all([
        data.role_Id ? invalidateAuthCache(data.role_Id) : Promise.resolve(),
        data.collection ? invalidateCollectionCache(data.collection) : Promise.resolve(),
      ]);

      res.status(201).json(newPermission);
    } catch (error) {
      next(error);
    }
  });

  // Update permission
  app.patch("/permissions/:id", adminOnly, async (req, res, next) => {
    try {
      const { id } = req.params;
      const data = req.body;

      await validateAclIds(data, req.accountability);

      const itemsService = new ItemsService("baasix_Permission", {
        accountability: req.accountability as any,
      });

      // Get old permission to check which collection and role to invalidate
      const oldPermission = await itemsService.readOne(id);

      assertNoCreateConditions(data.action ?? oldPermission.action, data.conditions);

      await itemsService.updateOne(id, data);

      // Read the updated permission to return full object
      const updatedPermission = await itemsService.readOne(id);

      // Reload permissions
      await permissionService.loadPermissions();

      // Invalidate auth cache for both old and new roles (if role changed)
      const rolesToInvalidate = new Set<string>();
      if (oldPermission.role_Id) {
        rolesToInvalidate.add(oldPermission.role_Id);
      }
      if (data.role_Id) {
        rolesToInvalidate.add(data.role_Id);
      }
      // Invalidate cache for both old and new collections (if collection changed)
      const collectionsToInvalidate = new Set<string>();
      if (oldPermission.collection) {
        collectionsToInvalidate.add(oldPermission.collection);
      }
      if (data.collection) {
        collectionsToInvalidate.add(data.collection);
      }

      // Batch all invalidations in parallel
      await Promise.all([
        ...Array.from(rolesToInvalidate).map(roleId => invalidateAuthCache(roleId)),
        ...Array.from(collectionsToInvalidate).map(collection => invalidateCollectionCache(collection)),
      ]);

      res.json(updatedPermission);
    } catch (error) {
      next(error);
    }
  });

  // Delete permission
  app.delete("/permissions/:id", adminOnly, async (req, res, next) => {
    try {
      const { id } = req.params;

      const itemsService = new ItemsService("baasix_Permission", {
        accountability: req.accountability as any,
      });

      // Get permission before deleting to know which collection and role to invalidate
      const permission = await itemsService.readOne(id);

      await itemsService.deleteOne(id);

      // Reload permissions
      await permissionService.loadPermissions();

      // Invalidate auth and collection caches in parallel
      await Promise.all([
        permission.role_Id ? invalidateAuthCache(permission.role_Id) : Promise.resolve(),
        permission.collection ? invalidateCollectionCache(permission.collection) : Promise.resolve(),
      ]);

      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  // Manually reload permission cache
  app.post("/permissions/reload", adminOnly, async (req, res, next) => {
    try {
      await permissionService.loadPermissions();

      // Invalidate all auth role caches since permissions affect all roles
      await invalidateAuthCache();

      // Note: We no longer call cache.invalidateCollection() here because
      // getCacheService() returns the DrizzleCache which uses the same Redis
      // database as the permission cache. Calling invalidateCollection() without
      // a collection parameter calls clear() which flushes the ENTIRE Redis database,
      // including the permission cache that was just populated by loadPermissions().
      // This was causing a race condition where permissions would be loaded,
      // then immediately deleted, then the next request would find no permissions.
      // 
      // Query caches will naturally expire based on their TTL, or they will be
      // invalidated when items are created/updated/deleted in their collections.

      res.status(200).json({ message: "Permission cache reloaded successfully" });
    } catch (error) {
      next(new APIError("Error reloading permissions", 500, error.message));
    }
  });
};

export default {
  id: "permissions",
  handler: registerEndpoint,
};
