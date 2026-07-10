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
    resolveThemeId,
    remapTargets,
    suggestSlug,
} from "../services/PageBundleService.js";
import { getBlockConfigDoc } from "../utils/blockConfigDoc.js";
import { listManifests } from "../blocks/registry.js";
import { APPEARANCE_GROUP } from "../blocks/appearance-fragment.js";
import env from "../utils/env.js";
import settingsService from "../services/SettingsService.js";
import type { Express } from "../types/index.js";

const PAGE_FIELDS = ["id", "name", "slug", "icon", "description", "parent_Id", "sort", "isPublic", "enabled", "options", "roles"];
const BLOCK_FIELDS = ["id", "page_Id", "type", "collection", "position", "config", "configVersion", "parentBlock_Id", "slot"];
// Field allowlist for the anonymous /pages/public/:slug endpoint. Deliberately
// excludes `roles` (internal role UUIDs) and usertrack/timestamp columns
// (userCreated_Id, userUpdated_Id, createdAt, updatedAt). tenant_Id is fetched
// for internal branding/theme scoping but stripped from the response.
const PUBLIC_PAGE_FIELDS = ["id", "name", "slug", "icon", "description", "parent_Id", "sort", "isPublic", "enabled", "options", "tenant_Id"];
const PUBLIC_BLOCK_FIELDS = BLOCK_FIELDS.map((f) => `blocks.${f}`);
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
            const themeService = new ItemsService("baasix_Theme", { accountability: req.accountability as any });

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

            // Only themes referenced by an exported page's options.theme.themeId matter to
            // buildPageBundle (it dedupes/filters), so it's safe to read every theme visible
            // to this accountability (tenant-scoped by ItemsService like /pages/themes).
            const themes = (await themeService.readByQuery({ fields: ["id", "name", "tokens", "isDefault"], limit: -1 }, true)).data;
            const themesById: Record<string, { name: string; tokens: any; isDefault: boolean }> = {};
            for (const theme of themes) {
                themesById[String(theme.id)] = { name: theme.name, tokens: theme.tokens, isDefault: !!theme.isDefault };
            }

            const bundle = buildPageBundle(pages, blocks, {
                baasixVersion: env.get("npm_package_version") || "unknown",
                exportedAt: new Date().toISOString(),
                roleNames,
                themesById,
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
            const themeService = new ItemsService("baasix_Theme", { accountability: req.accountability as any });

            const existing = (await pageService.readByQuery({ fields: ["id", "name", "slug"], limit: -1 }, true)).data;
            const existingPagesBySlug = new Map<string, { id: string; name: string }>(
                existing.map((p: any) => [p.slug, { id: p.id, name: p.name }])
            );
            const roles = (await roleService.readByQuery({ fields: ["id", "name"], limit: -1 }, true)).data;
            const roleIds = new Set(roles.map((r: any) => String(r.id)));
            const roleIdByNameMap = new Map<string, string>(roles.map((r: any) => [r.name, String(r.id)]));

            // Existing themes scoped to the importing tenant (ItemsService applies tenant
            // scoping from req.accountability the same way it does for pages/roles above).
            // NOTE (PG12): baasix_Theme's unique (tenant_Id, name) index is NOT enforced by
            // the DB for null-tenant rows on PG12, so more than one row can share a name.
            // Sort by createdAt then id so "the first match" is deterministic and stable
            // across repeated imports, and note it here rather than silently picking a
            // random duplicate each run.
            const existingThemes = (await themeService.readByQuery(
                { fields: ["id", "name", "tokens", "isDefault"], sort: ["createdAt", "id"], limit: -1 },
                true
            )).data;
            const themeIds = new Set(existingThemes.map((t: any) => String(t.id)));
            const themeIdByNameMap = new Map<string, string>();
            for (const t of existingThemes) {
                // First (earliest-created) row wins when duplicate names exist — see NOTE above.
                if (!themeIdByNameMap.has(t.name)) themeIdByNameMap.set(t.name, String(t.id));
            }

            const getFields = makeGetFields(schemaManager);
            const ctx = {
                existingPagesBySlug,
                getFields,
                roleIdExists: (id: string) => roleIds.has(id),
                roleIdByName: (name: string) => roleIdByNameMap.get(name),
                themeIdExists: (id: string) => themeIds.has(id),
                themeIdByName: (name: string) => themeIdByNameMap.get(name),
                validateBlock: (data: Record<string, any>) => validateBlockData(data, getFields),
            };
            const report = analyzeImport(bundle, ctx);
            if (dryRun) {
                res.status(200).json({ report });
                return;
            }

            const roleNames: Record<string, string> = bundle.roleNames || {};
            const bundleThemeNames: Record<string, string> = bundle.themeNames || {};
            const bundleThemesByName = new Map<string, { name: string; tokens: any; isDefault: boolean }>(
                (bundle.themes || []).map((t: any) => [t.name, t])
            );
            const invalidBlockIds = new Set(report.blockIssues.map((issue: any) => issue.blockId));
            const pageIdMap = new Map<string, string>();   // bundle page id → target page id
            const blockIdMap = new Map<string, string>();  // bundle block id → target block id
            const themeIdMap = new Map<string, string>();  // bundle theme id → target theme id
            const results: any[] = [];

            // Pass 0: themes — find-or-create every theme referenced by the bundle, scoped
            // to the importing tenant, then remap bundle theme id → target theme id (mirrors
            // the role id-remap pattern above, except unresolved themes are CREATED rather
            // than dropped since a page's theme is not optional the way a role grant is).
            for (const [bundleThemeId, name] of Object.entries(bundleThemeNames)) {
                const { resolved } = resolveThemeId(bundleThemeId, bundleThemeNames, ctx);
                if (resolved) {
                    themeIdMap.set(bundleThemeId, resolved);
                    continue;
                }
                const themeDef = bundleThemesByName.get(name);
                if (!themeDef) continue; // shouldn't happen: themeNames and themes are built together on export
                try {
                    const newThemeId = await themeService.createOne({
                        name: themeDef.name,
                        tokens: themeDef.tokens ?? {},
                        isDefault: false, // never let an import silently flip the tenant's default theme
                    });
                    themeIdMap.set(bundleThemeId, String(newThemeId));
                    // Keep the by-name map current in case multiple bundle ids somehow share a name.
                    themeIdByNameMap.set(name, String(newThemeId));
                } catch {
                    // Non-fatal: pages referencing this theme keep their (unresolvable) bundle
                    // themeId, which is handled like any other bad value by the page-render path.
                }
            }

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

                    // Remap every imported page's options.theme.themeId to the target-instance
                    // theme resolved/created in pass 0. An unresolvable bundle themeId (create
                    // failed) is left as-is rather than silently dropped.
                    const bundleThemeId = options.theme?.themeId;
                    if (bundleThemeId != null) {
                        const mappedThemeId = themeIdMap.get(String(bundleThemeId));
                        if (mappedThemeId) options.theme = { ...options.theme, themeId: mappedThemeId };
                    }

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
            res.status(200).send(getBlockConfigDoc());
        } catch (error: any) {
            next(error instanceof APIError ? error : new APIError("Error serving block config doc", 500, error.message));
        }
    });

    /** GET /pages/block-manifests: Returns all block manifests. Admin only. */
    app.get("/pages/block-manifests", adminOnly, async (_req: any, res: any, next: any) => {
        try {
            const manifests = listManifests().map((m) => ({ ...m, settings: [...m.settings, APPEARANCE_GROUP] }));
            res.status(200).json({ manifests });
        } catch (error: any) {
            next(error instanceof APIError ? error : new APIError("Error serving block manifests", 500, error.message));
        }
    });

    /**
     * GET /pages/themes: List themes visible to the caller's tenant (tenant_Id
     * match OR global/null). Any authenticated user — not admin-only, since the
     * page builder's theme picker is used by any editor.
     *
     * NOTE: this is a static path and must stay registered before any future
     * /pages/:param route (see Task 4) so Express doesn't shadow it.
     */
    app.get("/pages/themes", async (req: any, res: any, next: any) => {
        try {
            if (!req.accountability?.user?.id) throw new APIError("Authentication required", 401);
            const service = new ItemsService("baasix_Theme", { accountability: undefined }); // system read; themes hold no sensitive data
            const tenantId = req.accountability?.tenant ?? null;
            const filter = tenantId
                ? { OR: [{ tenant_Id: { eq: tenantId } }, { tenant_Id: { isNull: true } }] }
                : { tenant_Id: { isNull: true } };
            const result = await service.readByQuery({ filter, sort: ["name"], limit: -1 }, true);
            res.status(200).json({ themes: result?.data ?? [] });
        } catch (error: any) {
            next(error instanceof APIError ? error : new APIError("Error listing themes", 500, error.message));
        }
    });

    /**
     * GET /pages/public/:slug[?tenant_id=<uuid>]: Unauthenticated page fetch for
     * public sites. Security boundary: the explicit isPublic+enabled filter below
     * IS what makes this endpoint safe to leave unauthenticated — any change to
     * that filter is a critical regression. Returns a uniform 404 for all three
     * miss reasons (no such slug / !isPublic / !enabled) so the response never
     * leaks whether a private/disabled page exists at a given slug.
     *
     * MUST stay registered after every static /pages/* route above (see the
     * NOTE on /pages/themes) so this param route can't shadow them.
     */
    app.get("/pages/public/:slug", async (req: any, res: any, next: any) => {
        try {
            const slug = String(req.params.slug || "");
            const tenantParam = typeof req.query.tenant_id === "string" ? req.query.tenant_id : null;
            const service = new ItemsService("baasix_Page", { accountability: undefined }); // system read; filter below is the security boundary
            const filter: Record<string, unknown> = { slug: { eq: slug }, isPublic: { eq: true }, enabled: { eq: true } };
            if (tenantParam) filter.tenant_Id = { eq: tenantParam };
            const result = await service.readByQuery(
                { filter, fields: [...PUBLIC_PAGE_FIELDS, ...PUBLIC_BLOCK_FIELDS], limit: 10 },
                true
            );
            const rows = result?.data ?? [];
            if (!rows.length) throw new APIError("Page not found", 404);
            const page = rows.find((p: any) => p.tenant_Id == null) ?? rows[0];

            const settings = await settingsService.getTenantSettings(page.tenant_Id ?? undefined);
            const themeService = new ItemsService("baasix_Theme", { accountability: undefined });
            const themeId = page?.options?.theme?.themeId ?? null;
            let theme: any = null;
            if (themeId) {
                theme = await themeService.readOne(themeId, {}, true).catch(() => null);
            }
            if (!theme) {
                // Intentionally strict tenant scoping: a tenant page falls back ONLY to
                // that tenant's default theme (no cross-fallback to a global default).
                const defaultFilter: Record<string, unknown> = {
                    isDefault: { eq: true },
                    tenant_Id: page.tenant_Id ? { eq: page.tenant_Id } : { isNull: true },
                };
                const defaults = await themeService.readByQuery({ filter: defaultFilter, limit: 1 }, true);
                theme = defaults?.data?.[0] ?? null;
            }

            // tenant_Id was fetched for the scoping logic above; keep it out of the payload.
            const { tenant_Id: _tenantId, ...publicPage } = page;
            res.status(200).json({
                page: publicPage,
                branding: {
                    projectName: settings?.project_name ?? null,
                    logoLightId: settings?.project_logo_light_Id ?? null,
                    logoDarkId: settings?.project_logo_dark_Id ?? null,
                    iconId: settings?.project_icon_Id ?? null,
                    color: settings?.project_color ?? null,
                    secondaryColor: settings?.secondary_color ?? null,
                    theme: theme ? { id: theme.id, name: theme.name, tokens: theme.tokens } : null,
                },
            });
        } catch (error: any) {
            if (error instanceof APIError && error.statusCode === 404) return next(error);
            next(error instanceof APIError ? error : new APIError("Error serving public page", 500, error.message));
        }
    });
};

export default {
    id: "pages",
    handler: registerEndpoint,
};
