import { APIError } from "../utils/errorHandler.js";
import { adminOnly } from "../utils/auth.js";
import { ItemsService } from "../services/ItemsService.js";
import { schemaManager } from "../utils/schemaManager.js";
import { validateBlockData, makeGetFields } from "../services/BlockConfigService.js";
import {
    buildPageBundle,
    validateBundleShape,
    analyzeImport,
    resolveRoleIds,
    remapTargets,
    suggestSlug,
} from "../services/PageBundleService.js";
import { BLOCK_CONFIG_DOC } from "../utils/blockConfigDoc.js";
import { listManifests } from "../blocks/registry.js";
import env from "../utils/env.js";
import type { Express } from "../types/index.js";

const PAGE_FIELDS = ["id", "name", "slug", "icon", "description", "parent_Id", "sort", "isPublic", "enabled", "options", "roles"];
const BLOCK_FIELDS = ["id", "page_Id", "type", "collection", "position", "config", "configVersion", "parentBlock_Id", "slot"];
const MAX_BUNDLE_PAGES = 500;
const MAX_BUNDLE_BLOCKS = 5000;

const registerEndpoint = (app: Express) => {
    /**
     * GET /pages/export?pages=<id,id,...|all>
     * Bundle contract: docs/superpowers/specs/2026-06-11-app-builder-contracts-design.md §6
     */
    app.get("/pages/export", adminOnly, async (req, res, next) => {
        try {
            const pagesParam = String(req.query.pages || "all");
            const pageService = new ItemsService("baasix_Page", { accountability: req.accountability as any });
            const blockService = new ItemsService("baasix_Block", { accountability: req.accountability as any });
            const roleService = new ItemsService("baasix_Role", { accountability: req.accountability as any });

            const pageQuery: any = { fields: PAGE_FIELDS, sort: ["sort"], limit: -1 };
            if (pagesParam !== "all") {
                const ids = pagesParam.split(",").map((s) => s.trim()).filter(Boolean);
                if (ids.length === 0) throw new APIError("No page ids given", 400);
                pageQuery.filter = { id: { in: ids } };
            }
            const pages = (await pageService.readByQuery(pageQuery, true)).data;
            if (!pages.length) throw new APIError("No pages found to export", 404);

            const blocks = (await blockService.readByQuery({
                fields: BLOCK_FIELDS,
                filter: { page_Id: { in: pages.map((p: any) => p.id) } },
                limit: -1,
            }, true)).data;

            const roles = (await roleService.readByQuery({ fields: ["id", "name"], limit: -1 }, true)).data;
            const roleNames: Record<string, string> = {};
            for (const role of roles) roleNames[String(role.id)] = role.name;

            const bundle = buildPageBundle(pages, blocks, {
                baasixVersion: env.get("npm_package_version") || "unknown",
                exportedAt: new Date().toISOString(),
                roleNames,
            });

            res.setHeader("Content-Type", "application/json");
            res.setHeader("Content-Disposition", `attachment; filename=page-bundle-${Date.now()}.json`);
            res.status(200).send(Buffer.from(JSON.stringify(bundle, null, 2)));
        } catch (error: any) {
            console.error("[pages] export failed:", error);
            next(error instanceof APIError ? error : new APIError("Error exporting pages", 500, error.message));
        }
    });

    /**
     * POST /pages/import[?dryRun=true]
     * Body: { bundle, resolutions?: { [slug]: "skip"|"overwrite"|{rename: string} }, enablePages?: boolean }
     * dryRun → { report } without writing. Otherwise → { results }.
     */
    app.post("/pages/import", adminOnly, async (req, res, next) => {
        try {
            const dryRun = String(req.query.dryRun || "") === "true";
            const { bundle, resolutions = {}, enablePages = false } = req.body || {};

            const shapeErrors = validateBundleShape(bundle);
            if (shapeErrors.length) throw new APIError(`Invalid bundle: ${shapeErrors.join("; ")}`, 400);
            if (bundle.pages.length > MAX_BUNDLE_PAGES || bundle.blocks.length > MAX_BUNDLE_BLOCKS) {
                throw new APIError(`Bundle too large (max ${MAX_BUNDLE_PAGES} pages / ${MAX_BUNDLE_BLOCKS} blocks)`, 400);
            }

            const pageService = new ItemsService("baasix_Page", { accountability: req.accountability as any });
            const blockService = new ItemsService("baasix_Block", { accountability: req.accountability as any });
            const roleService = new ItemsService("baasix_Role", { accountability: req.accountability as any });

            const existing = (await pageService.readByQuery({ fields: ["id", "name", "slug"], limit: -1 }, true)).data;
            const existingPagesBySlug = new Map<string, { id: string; name: string }>(
                existing.map((p: any) => [p.slug, { id: p.id, name: p.name }])
            );
            const roles = (await roleService.readByQuery({ fields: ["id", "name"], limit: -1 }, true)).data;
            const roleIds = new Set(roles.map((r: any) => String(r.id)));
            const roleIdByNameMap = new Map<string, string>(roles.map((r: any) => [r.name, String(r.id)]));

            const getFields = makeGetFields(schemaManager);
            const ctx = {
                existingPagesBySlug,
                getFields,
                roleIdExists: (id: string) => roleIds.has(id),
                roleIdByName: (name: string) => roleIdByNameMap.get(name),
                validateBlock: (data: Record<string, any>) => validateBlockData(data, getFields),
            };
            const report = analyzeImport(bundle, ctx);
            if (dryRun) {
                res.status(200).json({ report });
                return;
            }

            const roleNames: Record<string, string> = bundle.roleNames || {};
            const invalidBlockIds = new Set(report.blockIssues.map((issue: any) => issue.blockId));
            const pageIdMap = new Map<string, string>();   // bundle page id → target page id
            const blockIdMap = new Map<string, string>();  // bundle block id → target block id
            const results: any[] = [];

            // Pass 1: pages
            for (const page of bundle.pages) {
                const analysis = report.pages.find((p: any) => p.slug === page.slug)!;
                let resolution = Object.prototype.hasOwnProperty.call(resolutions, page.slug) ? resolutions[page.slug] : undefined;
                if (analysis.status === "conflict" && !resolution) resolution = "skip";

                try {
                    const mapRoles = (ids: any) =>
                        Array.isArray(ids) && ids.length
                            ? resolveRoleIds(ids.map(String), roleNames, ctx).resolved
                            : [];
                    const mappedRoles = mapRoles(page.roles);
                    const options = { ...(page.options || {}) };
                    const mappedHomeFor = mapRoles(options.homeFor);
                    if (mappedHomeFor.length) options.homeFor = mappedHomeFor;
                    else delete options.homeFor;

                    const payload: Record<string, any> = {
                        name: page.name,
                        icon: page.icon ?? null,
                        description: page.description ?? null,
                        sort: Number.isFinite(page.sort) ? page.sort : 0,
                        isPublic: page.isPublic === true,
                        options,
                        roles: mappedRoles.length ? mappedRoles : null,
                        parent_Id: null, // bundle is source of truth; null clears any existing parent (re-linked in pass 2)
                    };

                    if (resolution === "skip") {
                        // Map to the existing page so children/blocks of OTHER pages can still link to it.
                        if (analysis.existingPage) pageIdMap.set(String(page.id), analysis.existingPage.id);
                        results.push({ slug: page.slug, action: "skipped" });
                        continue;
                    }
                    if (resolution === "overwrite") {
                        if (!analysis.existingPage) {
                            results.push({ slug: page.slug, action: "failed", error: `Cannot overwrite: no existing page with slug "${page.slug}"` });
                            continue;
                        }
                        const target = analysis.existingPage;
                        await pageService.updateOne(target.id, payload); // never touches enabled
                        const oldBlocks = (await blockService.readByQuery({
                            fields: ["id"], filter: { page_Id: { eq: target.id } }, limit: -1,
                        }, true)).data;
                        for (const ob of oldBlocks) await blockService.deleteOne(ob.id);
                        pageIdMap.set(String(page.id), target.id);
                        results.push({ slug: page.slug, action: "overwritten", id: target.id });
                        continue;
                    }
                    // create (new page, or rename resolution)
                    let slug = page.slug;
                    if (resolution && typeof resolution === "object" && resolution.rename) {
                        slug = String(resolution.rename).trim();
                    } else if (analysis.status === "conflict") {
                        slug = analysis.suggestedSlug || suggestSlug(page.slug, new Set(existingPagesBySlug.keys()));
                    }
                    const newId = await pageService.createOne({
                        ...payload,
                        slug,
                        enabled: enablePages === true ? page.enabled !== false : false,
                    });
                    pageIdMap.set(String(page.id), String(newId));
                    results.push({ slug, action: "created", id: newId, originalSlug: page.slug });
                } catch (error: any) {
                    results.push({ slug: page.slug, action: "failed", error: error?.message || String(error) });
                }
            }

            // Pass 1.5: blocks (skip blocks whose page wasn't imported or that failed validation)
            for (const result of results) {
                if (result.action === "created" || result.action === "overwritten") result.blocksCreated = 0;
            }
            const resultBySlug = new Map(results.map((r: any) => [r.originalSlug || r.slug, r]));
            const pageById = new Map<string, any>(bundle.pages.map((p: any) => [String(p.id), p]));
            for (const blk of bundle.blocks) {
                const newPageId = pageIdMap.get(String(blk.page_Id));
                const page = pageById.get(String(blk.page_Id));
                const result = page ? resultBySlug.get(page.slug) : null;
                if (!newPageId || !result || result.action === "skipped" || result.action === "failed") continue;
                if (invalidBlockIds.has(blk.id)) {
                    (result.blocksSkipped ||= []).push({ blockId: blk.id, reason: "failed validation (see dry-run report)" });
                    continue;
                }
                try {
                    const newBlockId = await blockService.createOne({
                        page_Id: newPageId,
                        type: blk.type,
                        collection: blk.collection ?? null,
                        position: blk.position ?? null,
                        config: blk.config ?? null,
                        ...(blk.configVersion != null ? { configVersion: blk.configVersion } : {}),
                    });
                    blockIdMap.set(String(blk.id), String(newBlockId));
                    result.blocksCreated += 1;
                } catch (error: any) {
                    (result.blocksSkipped ||= []).push({ blockId: blk.id, reason: error?.message || String(error) });
                }
            }

            // Pass 2: parent links (parent must be a bundle page that ended up with a target id)
            for (const page of bundle.pages) {
                if (!page.parent_Id) continue;
                const childId = pageIdMap.get(String(page.id));
                const parentId = pageIdMap.get(String(page.parent_Id));
                const result = resultBySlug.get(page.slug);
                if (!childId || !result || result.action === "skipped" || result.action === "failed") continue;
                if (!parentId) {
                    result.parentDropped = true;
                    continue;
                }
                try {
                    await pageService.updateOne(childId, { parent_Id: parentId });
                } catch {
                    result.parentDropped = true;
                }
            }

            // Pass 2.5: parent links between blocks (children were created
            // parentless in pass 1.5 so creation order didn't matter).
            for (const blk of bundle.blocks) {
                if (!blk.parentBlock_Id) continue;
                const newBlockId = blockIdMap.get(String(blk.id));
                if (!newBlockId) continue;
                const newParentId = blockIdMap.get(String(blk.parentBlock_Id));
                const blkPage = pageById.get(String(blk.page_Id));
                const blkResult = blkPage ? resultBySlug.get(blkPage.slug) : null;
                if (!newParentId) {
                    // Parent wasn't imported — the block stays top-level.
                    if (blkResult) blkResult.parentDropped = true;
                    continue;
                }
                try {
                    await blockService.updateOne(newBlockId, {
                        parentBlock_Id: newParentId,
                        slot: blk.slot ?? null,
                    });
                } catch {
                    if (blkResult) blkResult.parentDropped = true;
                }
            }

            // Pass 3: remap filter-block targets + block-id references
            // (record sources, modal actions, $selection placeholders).
            for (const blk of bundle.blocks) {
                const newBlockId = blockIdMap.get(String(blk.id));
                if (!newBlockId) continue;
                const remapped = remapTargets(blk.config, blockIdMap);
                if (!remapped) continue;
                try {
                    await blockService.updateOne(newBlockId, { config: remapped });
                } catch {
                    // non-fatal: filter simply targets nothing until reconfigured
                    const blkPage = pageById.get(String(blk.page_Id));
                    const blkResult = blkPage ? resultBySlug.get(blkPage.slug) : null;
                    if (blkResult) blkResult.targetsRemapFailed = true;
                }
            }

            res.status(200).json({ results });
        } catch (error: any) {
            console.error("[pages] import failed:", error);
            next(error instanceof APIError ? error : new APIError("Error importing pages", 500, error.message));
        }
    });

    /** Validate a block payload without writing. Body: { type, collection?, config?, position? } */
    app.post("/pages/validate-block", adminOnly, async (req, res, next) => {
        try {
            const { type, collection = null, config = null, position = null } = req.body || {};
            if (!type) throw new APIError(`"type" is required`, 400);
            const getFields = makeGetFields(schemaManager);
            try {
                validateBlockData({ type, collection, config, position }, getFields);
                res.status(200).json({ valid: true, errors: [] });
            } catch (error: any) {
                res.status(200).json({ valid: false, errors: [error?.message || String(error)] });
            }
        } catch (error: any) {
            next(error instanceof APIError ? error : new APIError("Error validating block", 500, error.message));
        }
    });

    /** Markdown reference for block configs (consumed by MCP resources). */
    app.get("/pages/block-config-doc", adminOnly, async (_req, res, next) => {
        try {
            res.setHeader("Content-Type", "text/markdown; charset=utf-8");
            res.status(200).send(BLOCK_CONFIG_DOC);
        } catch (error: any) {
            next(error instanceof APIError ? error : new APIError("Error serving block config doc", 500, error.message));
        }
    });

    /** GET /pages/block-manifests: Returns all block manifests. Admin only. */
    app.get("/pages/block-manifests", adminOnly, async (_req: any, res: any, next: any) => {
        try {
            res.status(200).json({ manifests: listManifests() });
        } catch (error: any) {
            next(error instanceof APIError ? error : new APIError("Error serving block manifests", 500, error.message));
        }
    });
};

export default {
    id: "pages",
    handler: registerEndpoint,
};
