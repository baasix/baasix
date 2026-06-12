/**
 * PageBundleService — pure functions for the page-bundle export/import contract
 * (docs/superpowers/specs/2026-06-11-app-builder-contracts-design.md §6).
 * No DB access here: routes inject data and validators so everything is jest-testable.
 */

export const PAGE_BUNDLE_VERSION = 1;

const PAGE_EXPORT_FIELDS = [
    "id", "name", "slug", "icon", "description", "parent_Id", "sort",
    "isPublic", "enabled", "options", "roles",
] as const;
const BLOCK_EXPORT_FIELDS = [
    "id", "page_Id", "type", "collection", "position", "config", "configVersion",
] as const;

/** Keys inside block configs whose value is a single field name. */
const SCALAR_FIELD_KEYS = [
    "groupByField", "cardTitleField", "titleField", "subtitleField", "imageField",
    "startField", "endField", "colorField", "geometryField", "regionField",
    "valueField", "timeField", "fileField", "textField", "authorField",
    "timestampField", "recordField",
];
/** Keys whose value is an array of {field} entries. */
const ENTRY_ARRAY_KEYS = ["columns", "fields", "cardFields", "popupFields", "inlineFilters"];
/** Keys holding a single ActionItem-like object / arrays of them. */
const ACTION_OBJECT_KEYS = ["cardAction", "itemAction", "eventAction"];
const ACTION_ARRAY_KEYS = ["headerActions", "rowActions", "cardActions", "items"];

function pick(row: Record<string, any>, keys: readonly string[]): Record<string, any> {
    const out: Record<string, any> = {};
    for (const key of keys) out[key] = row[key] === undefined ? null : row[key];
    return out;
}

function firstSegment(field: unknown): string {
    return String(field).split(".")[0];
}

/** Add a field reference to a set, silently ignoring wildcards and empty strings. */
const addField = (set: Set<string>, field: unknown) => {
    const segment = firstSegment(field);
    if (segment && segment !== "*") set.add(segment);
};

const MAX_FILTER_DEPTH = 50;

/** Collect field names referenced by an items-API filter object ({and:[...]}/{or:[...]} recurse). */
function collectFilterFields(filter: any, into: Set<string>, depth = 0): void {
    if (depth > MAX_FILTER_DEPTH) return;
    if (!filter || typeof filter !== "object" || Array.isArray(filter)) return;
    for (const [key, value] of Object.entries(filter)) {
        if (key === "and" || key === "or") {
            if (Array.isArray(value)) for (const sub of value) collectFilterFields(sub, into, depth + 1);
            continue;
        }
        if (key.startsWith("$")) continue;
        addField(into, key);
    }
}

function addActionRefs(action: any, addCollection: (name: string, field?: string) => void, blockFields: Set<string>): void {
    if (!action || typeof action !== "object") return;
    const inner = action.action && typeof action.action === "object" ? action.action : action;
    if (inner.type === "view") {
        if (typeof inner.idField === "string" && inner.idField) addField(blockFields, inner.idField);
        if (typeof inner.collection === "string" && inner.collection) addCollection(inner.collection);
    } else if (inner.type === "create" && typeof inner.collection === "string" && inner.collection) {
        addCollection(inner.collection);
        if (inner.defaults && typeof inner.defaults === "object") {
            for (const key of Object.keys(inner.defaults)) {
                const segment = firstSegment(key);
                if (segment && segment !== "*") addCollection(inner.collection, segment);
            }
        }
    }
}

/** Compute the `requires` map: every referenced collection → referenced field names. */
export function collectRequires(blocks: Record<string, any>[]): { collections: Record<string, string[]> } {
    const map = new Map<string, Set<string>>();
    const ensure = (name: string) => {
        if (!map.has(name)) map.set(name, new Set());
        return map.get(name)!;
    };
    const addCollection = (name: string, field?: string) => {
        const set = ensure(name);
        if (field) set.add(field);
    };

    for (const block of blocks) {
        const config = block.config && typeof block.config === "object" ? block.config : {};
        if (!block.collection || typeof block.collection !== "string") continue;
        const fields = ensure(block.collection);

        for (const key of SCALAR_FIELD_KEYS) {
            if (typeof config[key] === "string" && config[key]) addField(fields, config[key]);
        }
        for (const key of ENTRY_ARRAY_KEYS) {
            if (!Array.isArray(config[key])) continue;
            for (const entry of config[key]) {
                if (!entry || typeof entry !== "object") continue;
                if (entry.compute) continue; // computed columns skip schema validation
                if (typeof entry.field === "string" && entry.field) addField(fields, entry.field);
            }
        }
        if (Array.isArray(config.groupBy)) {
            for (const g of config.groupBy) if (typeof g === "string" && g) addField(fields, g);
        }
        if (config.aggregate && typeof config.aggregate === "object") {
            for (const agg of Object.values<any>(config.aggregate)) {
                if (agg && typeof agg.field === "string" && agg.field) addField(fields, agg.field);
            }
        }
        if (config.compare && typeof config.compare.timeField === "string") addField(fields, config.compare.timeField);
        if (config.sheetTitle && Array.isArray(config.sheetTitle.fields)) {
            for (const f of config.sheetTitle.fields) if (typeof f === "string" && f) addField(fields, f);
        }
        collectFilterFields(config.filter, fields);

        for (const key of ACTION_OBJECT_KEYS) addActionRefs(config[key], addCollection, fields);
        for (const key of ACTION_ARRAY_KEYS) {
            if (!Array.isArray(config[key])) continue;
            for (const item of config[key]) addActionRefs(item, addCollection, fields);
        }
        if (config.actions && typeof config.actions === "object" && !Array.isArray(config.actions)) {
            for (const value of Object.values<any>(config.actions)) {
                if (value && typeof value === "object") addActionRefs(value, addCollection, fields);
            }
        }
    }

    const collections: Record<string, string[]> = {};
    for (const [name, fields] of map) collections[name] = [...fields];
    return { collections };
}

export function buildPageBundle(
    pages: Record<string, any>[],
    blocks: Record<string, any>[],
    meta: { baasixVersion: string; exportedAt: string; roleNames: Record<string, string> }
) {
    const exportPages = pages.map((p) => pick(p, PAGE_EXPORT_FIELDS));
    const exportBlocks = blocks.map((b) => pick(b, BLOCK_EXPORT_FIELDS));

    // Only ship role names actually referenced by roles/options.homeFor.
    const referenced = new Set<string>();
    for (const p of exportPages) {
        if (Array.isArray(p.roles)) for (const id of p.roles) referenced.add(String(id));
        const homeFor = p.options?.homeFor;
        if (Array.isArray(homeFor)) for (const id of homeFor) referenced.add(String(id));
    }
    const roleNames: Record<string, string> = {};
    for (const id of referenced) {
        if (meta.roleNames[id]) roleNames[id] = meta.roleNames[id];
    }

    return {
        bundleVersion: PAGE_BUNDLE_VERSION,
        baasixVersion: meta.baasixVersion,
        exportedAt: meta.exportedAt,
        pages: exportPages,
        blocks: exportBlocks,
        roleNames,
        requires: collectRequires(exportBlocks),
    };
}

const isNonEmptyString = (v: any): boolean => typeof v === "string" && v.length > 0;

/** Structural validation of an uploaded bundle. Returns [] when OK. */
export function validateBundleShape(raw: any): string[] {
    const errors: string[] = [];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return ["Bundle must be a JSON object"];
    if (raw.bundleVersion !== PAGE_BUNDLE_VERSION) {
        errors.push(`Unsupported bundleVersion "${raw.bundleVersion}" (expected ${PAGE_BUNDLE_VERSION})`);
    }
    if (!Array.isArray(raw.pages)) errors.push(`"pages" must be an array`);
    if (!Array.isArray(raw.blocks)) errors.push(`"blocks" must be an array`);
    if (Array.isArray(raw.pages)) {
        raw.pages.forEach((p: any, i: number) => {
            if (!p || typeof p !== "object") errors.push(`pages[${i}] must be an object`);
            else {
                if (!isNonEmptyString(p.id)) errors.push(`pages[${i}] is missing "id"`);
                if (!isNonEmptyString(p.name)) errors.push(`pages[${i}] is missing "name"`);
                if (!isNonEmptyString(p.slug)) errors.push(`pages[${i}] is missing "slug"`);
            }
        });
        const slugs = raw.pages.map((p: any) => p?.slug).filter(Boolean);
        if (new Set(slugs).size !== slugs.length) errors.push("Bundle contains duplicate page slugs");
        const ids = raw.pages.map((p: any) => p?.id).filter(Boolean);
        if (new Set(ids).size !== ids.length) errors.push("Bundle contains duplicate page ids");
    }
    if (Array.isArray(raw.blocks)) {
        raw.blocks.forEach((b: any, i: number) => {
            if (!b || typeof b !== "object") errors.push(`blocks[${i}] must be an object`);
            else {
                if (!isNonEmptyString(b.id)) errors.push(`blocks[${i}] is missing "id"`);
                if (!isNonEmptyString(b.page_Id)) errors.push(`blocks[${i}] is missing "page_Id"`);
                if (!isNonEmptyString(b.type)) errors.push(`blocks[${i}] is missing "type"`);
            }
        });
    }
    if (Array.isArray(raw.pages) && Array.isArray(raw.blocks)) {
        const pageIds = new Set(raw.pages.map((p: any) => String(p?.id)));
        raw.blocks.forEach((b: any, i: number) => {
            if (b && typeof b === "object" && b.page_Id && !pageIds.has(String(b.page_Id))) {
                errors.push(`blocks[${i}] references page_Id "${b.page_Id}" which is not in the bundle`);
            }
        });
    }
    if (raw.requires !== undefined) {
        const collections = (raw.requires && typeof raw.requires === "object" && !Array.isArray(raw.requires))
            ? raw.requires.collections
            : undefined;
        if (!collections || typeof collections !== "object" || Array.isArray(collections)) {
            errors.push(`"requires.collections" must be an object mapping collection names to field arrays`);
        } else {
            for (const [name, fields] of Object.entries(collections)) {
                if (!Array.isArray(fields) || fields.some((f) => typeof f !== "string")) {
                    errors.push(`requires.collections["${name}"] must be an array of field-name strings`);
                }
            }
        }
    }
    return errors;
}

/** "tasks" + taken {"tasks"} → "tasks-2", then "tasks-3", … */
export function suggestSlug(base: string, taken: Set<string>): string {
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n += 1;
    return `${base}-${n}`;
}

/**
 * Remap a filter block's config.targets (old block ids → new). Returns the new
 * config when something changed, null when no update is needed.
 */
export function remapTargets(config: any, blockIdMap: Map<string, string>): any | null {
    if (!config || !Array.isArray(config.targets)) return null;
    const remapped = config.targets
        .map((id: any) => blockIdMap.get(String(id)))
        .filter((id: any): id is string => typeof id === "string");
    const unchanged =
        remapped.length === config.targets.length &&
        remapped.every((id: string, i: number) => id === config.targets[i]);
    if (unchanged) return null;
    return { ...config, targets: remapped };
}

export interface ImportContext {
    existingPagesBySlug: Map<string, { id: string; name: string }>;
    getFields: (collection: string) => Record<string, any> | null | undefined;
    roleIdExists: (id: string) => boolean;
    roleIdByName: (name: string) => string | undefined;
    /** Inject validateBlockData bound to the target instance's getFields. */
    validateBlock: (data: Record<string, any>) => void;
}

/** Resolve bundle role ids against the target instance (id match, then name via roleNames). */
export function resolveRoleIds(
    ids: string[],
    roleNames: Record<string, string>,
    ctx: Pick<ImportContext, "roleIdExists" | "roleIdByName">
): { resolved: string[]; unknown: string[] } {
    const resolved: string[] = [];
    const unknown: string[] = [];
    for (const id of ids) {
        if (ctx.roleIdExists(id)) {
            resolved.push(id);
            continue;
        }
        const name = roleNames[id];
        const byName = name ? ctx.roleIdByName(name) : undefined;
        if (byName) resolved.push(byName);
        else unknown.push(name || id);
    }
    return { resolved, unknown };
}

export function analyzeImport(bundle: any, ctx: ImportContext) {
    const bundleSlugs = new Set<string>(bundle.pages.map((p: any) => p.slug));
    const bundlePageIds = new Set<string>(bundle.pages.map((p: any) => String(p.id)));
    const roleNames: Record<string, string> = bundle.roleNames || {};
    const taken = new Set<string>([...ctx.existingPagesBySlug.keys(), ...bundleSlugs]);

    const blockCounts = new Map<string, number>();
    for (const b of bundle.blocks) {
        const key = String(b.page_Id);
        blockCounts.set(key, (blockCounts.get(key) || 0) + 1);
    }

    const pages = bundle.pages.map((page: any) => {
        const existing = ctx.existingPagesBySlug.get(page.slug) || null;
        const referencedRoles: string[] = [
            ...(Array.isArray(page.roles) ? page.roles : []),
            ...(Array.isArray(page.options?.homeFor) ? page.options.homeFor : []),
        ].map(String);
        const { unknown } = resolveRoleIds(referencedRoles, roleNames, ctx);
        return {
            id: page.id,
            slug: page.slug,
            name: page.name,
            blockCount: blockCounts.get(String(page.id)) || 0,
            status: existing ? ("conflict" as const) : ("new" as const),
            existingPage: existing,
            suggestedSlug: existing ? suggestSlug(page.slug, taken) : null,
            unknownRoles: [...new Set(unknown)],
            unresolvedParent: !!page.parent_Id && !bundlePageIds.has(String(page.parent_Id)),
        };
    });

    const collections: Record<string, { exists: boolean; missingFields: string[] }> = {};
    const required = bundle.requires?.collections || {};
    for (const [name, fields] of Object.entries<any>(required)) {
        const known = ctx.getFields(name);
        if (!known) {
            collections[name] = { exists: false, missingFields: [] };
            continue;
        }
        const missing = (Array.isArray(fields) ? fields : []).filter((f: string) => !(f in known));
        collections[name] = { exists: true, missingFields: missing };
    }

    const pageSlugById = new Map<string, string>(bundle.pages.map((p: any) => [String(p.id), p.slug]));
    const blockIssues: { blockId: string; pageSlug: string; type: string; collection: string | null; error: string }[] = [];
    for (const blk of bundle.blocks) {
        try {
            ctx.validateBlock({
                type: blk.type,
                collection: blk.collection ?? null,
                config: blk.config ?? null,
                position: blk.position ?? null,
            });
        } catch (error: any) {
            blockIssues.push({
                blockId: blk.id,
                pageSlug: pageSlugById.get(String(blk.page_Id)) || "<unknown page>",
                type: blk.type,
                collection: blk.collection ?? null,
                error: error?.message || String(error),
            });
        }
    }

    return { pages, collections, blockIssues };
}
