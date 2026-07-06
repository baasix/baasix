import type { Express } from "../types/index.js";
import permissionService from "../services/PermissionService.js";
import ItemsService from "../services/ItemsService.js";
import { adminOnly } from "../utils/auth.js";
import { APIError } from "../utils/errorHandler.js";
import { invalidateAuthCache } from "../utils/common.js";
import { parseQueryParams } from "../utils/router.js";

/**
 * Validate the shape of an ACL create/update payload.
 * Conditions use the same filter DSL as queries; deep validation happens when
 * they are applied — here we guard the payload types.
 */
const validateACLPayload = (data: Record<string, any>, isCreate: boolean): void => {
    if (isCreate && (typeof data.name !== "string" || data.name.trim() === "")) {
        throw new APIError("ACL entry requires a non-empty name", 400);
    }
    for (const key of ["conditions", "relConditions", "defaultValues"]) {
        if (data[key] != null && (typeof data[key] !== "object" || Array.isArray(data[key]))) {
            throw new APIError(`ACL ${key} must be a JSON object`, 400);
        }
    }
    if (data.fields != null) {
        if (!Array.isArray(data.fields) || !data.fields.every((f: any) => typeof f === "string")) {
            throw new APIError("ACL fields must be an array of strings", 400);
        }
    }
};

const reloadAndInvalidate = async (): Promise<void> => {
    await permissionService.loadPermissions();
    await invalidateAuthCache();
};

const registerEndpoint = (app: Express) => {
    // List ACL entries
    app.get("/acls", async (req, res, next) => {
        try {
            const query = parseQueryParams(req.query);
            const itemsService = new ItemsService("baasix_ACL", {
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

    // Get single ACL entry
    app.get("/acls/:id", async (req, res, next) => {
        try {
            const itemsService = new ItemsService("baasix_ACL", {
                accountability: req.accountability as any,
            });
            const entry = await itemsService.readOne(req.params.id);
            res.json({ data: entry });
        } catch (error) {
            next(error);
        }
    });

    // Create ACL entry
    app.post("/acls", adminOnly, async (req, res, next) => {
        try {
            const data = { ...req.body };
            validateACLPayload(data, true);
            delete data.system; // system entries are created only by seeding

            const itemsService = new ItemsService("baasix_ACL", {
                accountability: req.accountability as any,
            });
            const newId = await itemsService.createOne(data);
            const created = await itemsService.readOne(newId);

            await reloadAndInvalidate();
            res.status(201).json(created);
        } catch (error) {
            next(error);
        }
    });

    // Update ACL entry
    app.patch("/acls/:id", adminOnly, async (req, res, next) => {
        try {
            const { id } = req.params;
            const data = { ...req.body };
            validateACLPayload(data, false);
            delete data.system;

            const itemsService = new ItemsService("baasix_ACL", {
                accountability: req.accountability as any,
            });
            const existing = await itemsService.readOne(id);
            if (existing.system) {
                throw new APIError("System ACL entries cannot be modified", 403);
            }

            await itemsService.updateOne(id, data);
            const updated = await itemsService.readOne(id);

            await reloadAndInvalidate();
            res.json(updated);
        } catch (error) {
            next(error);
        }
    });

    // Delete ACL entry
    app.delete("/acls/:id", adminOnly, async (req, res, next) => {
        try {
            const { id } = req.params;

            const itemsService = new ItemsService("baasix_ACL", {
                accountability: req.accountability as any,
            });
            const existing = await itemsService.readOne(id);
            if (existing.system) {
                throw new APIError("System ACL entries cannot be deleted", 403);
            }

            // Guard: block deletion while any permission references this entry
            const permissionsService = new ItemsService("baasix_Permission", {
                accountability: req.accountability as any,
            });
            const usage = await permissionsService.readByQuery({
                filter: { acl_Ids: { jsonbContains: [id] } },
                fields: ["id", "collection", "action", "role_Id"],
                limit: -1,
            });
            if (usage.data.length > 0) {
                throw new APIError(
                    `ACL entry '${existing.name}' is assigned to ${usage.data.length} permission(s). Detach it first.`,
                    409,
                    {
                        usedBy: usage.data.map((p: any) => ({
                            permission_Id: p.id,
                            collection: p.collection,
                            action: p.action,
                            role_Id: p.role_Id,
                        })),
                    }
                );
            }

            await itemsService.deleteOne(id);
            await reloadAndInvalidate();
            res.status(204).end();
        } catch (error) {
            next(error);
        }
    });
};

export default {
    id: "acls",
    handler: registerEndpoint,
};
