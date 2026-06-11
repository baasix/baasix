import { APIError } from "../utils/errorHandler.js";

/**
 * BlockConfigService — server-side validation for the page-builder collections
 * (baasix_Page / baasix_Block).
 *
 * The validation logic lives in pure functions (validateBlockData,
 * validatePageData) so it can be unit-tested without a database. Everything
 * that touches runtime singletons (hooksManager, schemaManager, ItemsService)
 * is lazily imported inside registerPageBuilderHooks / the hook bodies so that
 * importing this module from tests has no side effects.
 */

const BLOCK_TYPES = [
    "table",
    "form",
    "details",
    "kanban",
    "calendar",
    "chart",
    "cardlist",
    "map",
    "markdown",
    "filter",
];

const COLLECTION_REQUIRED = new Set([
    "table",
    "form",
    "details",
    "kanban",
    "calendar",
    "chart",
    "cardlist",
    "map",
    "filter",
]);

const FORM_MODES = new Set(["create", "edit"]);

const CHART_TYPES = new Set(["bar", "line", "pie", "stat"]);

const AGGREGATE_FUNCTIONS = new Set(["count", "sum", "avg", "min", "max"]);

const CALENDAR_VIEWS = new Set(["month", "week", "day"]);

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export type GetFieldsFn = (collection: string) => Record<string, any> | null | undefined;

/** First dot-segment of a (possibly nested) field path, e.g. "author.name" -> "author". */
function firstSegment(fieldPath: string): string {
    return String(fieldPath).split(".")[0];
}

function assertFieldExists(
    fieldPath: any,
    fieldMap: Record<string, any>,
    context: string
): void {
    if (typeof fieldPath !== "string" || fieldPath.length === 0) {
        throw new APIError(`Invalid ${context} entry: "field" must be a non-empty string`, 400);
    }
    const root = firstSegment(fieldPath);
    if (!(root in fieldMap)) {
        throw new APIError(
            `Unknown field "${fieldPath}" in block ${context}: "${root}" does not exist on the target collection`,
            400
        );
    }
}

/**
 * Require config[key] to be present and reference an existing field.
 * Used by Phase-2 types (kanban groupByField etc.): a block of these types
 * created WITH a config that is missing the key must 400. A block created
 * with NO config at all keeps the lenient Phase-1 behavior (config validation
 * is skipped entirely) — renderers handle configless blocks defensively.
 */
function requireConfigField(config: any, key: string, fieldMap: Record<string, any>): void {
    if (config[key] == null) {
        throw new APIError(`Block config requires "${key}"`, 400);
    }
    assertFieldExists(config[key], fieldMap, `config.${key}`);
}

/**
 * Validate an array of field entries. Entries may be `{field}` objects
 * (ConfigFieldsPicker output, e.g. cardFields/fields/popupFields) or plain
 * field-name strings (e.g. chart groupBy). Non-arrays are ignored.
 */
function assertFieldEntries(
    entries: any,
    fieldMap: Record<string, any>,
    context: string
): void {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
        const path = typeof entry === "string" ? entry : entry?.field;
        assertFieldExists(path, fieldMap, context);
    }
}

function validatePosition(position: any): void {
    if (position == null) return;
    if (typeof position !== "object" || Array.isArray(position)) {
        throw new APIError(`Invalid position: must be an object {row, col, span}`, 400);
    }
    const { row, col, span } = position;
    const isInt = (v: any) => Number.isInteger(v);
    if (!isInt(row) || !isInt(col) || !isInt(span)) {
        throw new APIError(`Invalid position: row, col and span must be integers`, 400);
    }
    if (row < 0) {
        throw new APIError(`Invalid position: row must be >= 0`, 400);
    }
    if (col < 0 || col > 11) {
        throw new APIError(`Invalid position: col must be between 0 and 11`, 400);
    }
    if (span < 1 || span > 12) {
        throw new APIError(`Invalid position: span must be between 1 and 12`, 400);
    }
}

/**
 * Validate a baasix_Block payload.
 *
 * @param data       the (partial) block payload
 * @param getFields  resolver returning the field map of a collection, or null
 *                   when the collection does not exist
 */
export function validateBlockData(data: any, getFields: GetFieldsFn): void {
    if (!data || typeof data !== "object") {
        throw new APIError("Invalid block payload", 400);
    }

    const { type, collection, position, config } = data;

    if (!BLOCK_TYPES.includes(type)) {
        throw new APIError(
            `Invalid block type "${type}". Must be one of: ${BLOCK_TYPES.join(", ")}`,
            400
        );
    }

    let fieldMap: Record<string, any> | null = null;

    if (COLLECTION_REQUIRED.has(type)) {
        if (!collection || typeof collection !== "string") {
            throw new APIError(`Block type "${type}" requires a collection`, 400);
        }
        const resolved = getFields(collection);
        if (!resolved) {
            throw new APIError(`Unknown collection "${collection}" for block`, 400);
        }
        fieldMap = resolved;
    }

    validatePosition(position);

    if (config != null && fieldMap) {
        if (type === "table") {
            if (Array.isArray(config.columns)) {
                for (const column of config.columns) {
                    assertFieldExists(column?.field, fieldMap, "config.columns");
                }
            }
        } else if (type === "form") {
            if (config.mode != null && !FORM_MODES.has(config.mode)) {
                throw new APIError(
                    `Invalid form mode "${config.mode}". Must be one of: create, edit`,
                    400
                );
            }
            if (Array.isArray(config.fields)) {
                for (const entry of config.fields) {
                    assertFieldExists(entry?.field, fieldMap, "config.fields");
                }
            }
        } else if (type === "details") {
            if (Array.isArray(config.fields)) {
                for (const entry of config.fields) {
                    assertFieldExists(entry?.field, fieldMap, "config.fields");
                }
            }
        } else if (type === "kanban") {
            requireConfigField(config, "groupByField", fieldMap);
            requireConfigField(config, "cardTitleField", fieldMap);
            assertFieldEntries(config.cardFields, fieldMap, "config.cardFields");
        } else if (type === "calendar") {
            requireConfigField(config, "startField", fieldMap);
            requireConfigField(config, "titleField", fieldMap);
            if (config.endField != null) {
                assertFieldExists(config.endField, fieldMap, "config.endField");
            }
            if (config.colorField != null) {
                assertFieldExists(config.colorField, fieldMap, "config.colorField");
            }
            if (config.defaultView != null && !CALENDAR_VIEWS.has(config.defaultView)) {
                throw new APIError(
                    `Invalid defaultView "${config.defaultView}". Must be one of: month, week, day`,
                    400
                );
            }
        } else if (type === "chart") {
            if (!CHART_TYPES.has(config.chartType)) {
                throw new APIError(
                    `Invalid chartType "${config.chartType}". Must be one of: bar, line, pie, stat`,
                    400
                );
            }
            const aggregate = config.aggregate;
            if (
                aggregate == null ||
                typeof aggregate !== "object" ||
                Array.isArray(aggregate) ||
                Object.keys(aggregate).length === 0
            ) {
                throw new APIError(
                    `Chart block config requires a non-empty "aggregate" object ({alias: {function, field}})`,
                    400
                );
            }
            for (const [alias, entry] of Object.entries<any>(aggregate)) {
                if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
                    throw new APIError(
                        `Invalid aggregate "${alias}": must be an object {function, field}`,
                        400
                    );
                }
                if (!AGGREGATE_FUNCTIONS.has(entry.function)) {
                    throw new APIError(
                        `Invalid aggregate function "${entry.function}" for "${alias}". Must be one of: count, sum, avg, min, max`,
                        400
                    );
                }
                // "*" is allowed (count over all rows); otherwise the field must exist.
                if (entry.field !== "*") {
                    assertFieldExists(entry.field, fieldMap, `config.aggregate.${alias}`);
                }
            }
            assertFieldEntries(config.groupBy, fieldMap, "config.groupBy");
        } else if (type === "cardlist") {
            requireConfigField(config, "titleField", fieldMap);
            if (config.subtitleField != null) {
                assertFieldExists(config.subtitleField, fieldMap, "config.subtitleField");
            }
            if (config.imageField != null) {
                assertFieldExists(config.imageField, fieldMap, "config.imageField");
            }
            assertFieldEntries(config.fields, fieldMap, "config.fields");
            if (config.columns != null) {
                if (!Number.isInteger(config.columns) || config.columns < 1 || config.columns > 6) {
                    throw new APIError(
                        `Invalid columns "${config.columns}": must be an integer between 1 and 6`,
                        400
                    );
                }
            }
        } else if (type === "map") {
            requireConfigField(config, "geometryField", fieldMap);
            if (config.titleField != null) {
                assertFieldExists(config.titleField, fieldMap, "config.titleField");
            }
            assertFieldEntries(config.popupFields, fieldMap, "config.popupFields");
        } else if (type === "filter") {
            assertFieldEntries(config.fields, fieldMap, "config.fields");
            if (config.targets != null && config.targets !== "all") {
                const isStringArray =
                    Array.isArray(config.targets) &&
                    config.targets.every((t: any) => typeof t === "string");
                if (!isStringArray) {
                    throw new APIError(
                        `Invalid targets: must be "all" or an array of block id strings`,
                        400
                    );
                }
            }
        }
    }

    // markdown has no collection (and therefore no fieldMap) — validate its
    // config independently of the fieldMap guard above.
    if (config != null && type === "markdown") {
        if (typeof config.content !== "string") {
            throw new APIError(
                `Markdown block config requires "content" to be a string`,
                400
            );
        }
    }
}

/**
 * Validate a baasix_Page payload.
 */
export function validatePageData(data: any, isCreate: boolean): void {
    if (!data || typeof data !== "object") {
        throw new APIError("Invalid page payload", 400);
    }

    if (isCreate) {
        if (!data.name || typeof data.name !== "string") {
            throw new APIError("Page name is required", 400);
        }
        if (!data.slug || typeof data.slug !== "string") {
            throw new APIError("Page slug is required", 400);
        }
    }

    if (data.slug != null) {
        if (typeof data.slug !== "string" || !SLUG_RE.test(data.slug)) {
            throw new APIError(
                `Invalid slug "${data.slug}": slug must contain only lowercase letters, numbers and hyphens, and start with a letter or number`,
                400
            );
        }
    }

    if (data.roles !== undefined && data.roles !== null) {
        if (
            !Array.isArray(data.roles) ||
            !data.roles.every((r: any) => typeof r === "string")
        ) {
            throw new APIError("roles must be an array of role ids", 400);
        }
    }
}

/**
 * Merge an existing block row with an incoming patch to produce a full object
 * that can be passed to validateBlockData.
 *
 * The patch wins on every key it provides; existing fills gaps.
 */
export function mergeBlockForUpdate(
    existing: Record<string, any>,
    patch: Record<string, any>
): Record<string, any> {
    return { ...existing, ...patch };
}

/**
 * Register lifecycle hooks for baasix_Page and baasix_Block.
 *
 * Uses dynamic imports for hooksManager/schemaManager/ItemsService so this
 * module stays side-effect free when only the pure validators are imported
 * (e.g. from unit tests).
 */
export async function registerPageBuilderHooks(): Promise<void> {
    const { hooksManager } = await import("./HooksManager.js");
    const { schemaManager } = await import("../utils/schemaManager.js");

    /** Resolve a collection's field map (columns + relation names). Unknown collection -> null. */
    const getFields: GetFieldsFn = (collection: string) => {
        const table = schemaManager.getSchema(collection);
        if (!table || typeof table !== "object") return null;
        const map: Record<string, any> = {};
        for (const key of Object.keys(table)) {
            map[key] = true;
        }
        try {
            for (const relation of schemaManager.getRelationNames(collection)) {
                map[relation] = true;
            }
        } catch {
            // no relations registered for this collection
        }
        return map;
    };

    /**
     * Duplicate-slug check: the schema manager emits NULLS NOT DISTINCT on PG15+
     * (see schemaManager.ts:1153-1157), but this hook provides a friendly 400
     * error message and ensures uniqueness on pre-PG15 databases where
     * NULLS NOT DISTINCT is not supported.
     */
    const assertSlugUnique = async (
        slug: string,
        tenantId: string | null,
        excludeId?: string | number
    ): Promise<void> => {
        const { default: ItemsService } = await import("./ItemsService.js");
        const itemsService = new ItemsService("baasix_Page", {
            accountability: undefined,
        });

        const filter: Record<string, any> = {
            slug: { eq: slug },
            tenant_Id: tenantId === null ? { isNull: true } : { eq: tenantId },
        };
        if (excludeId !== undefined && excludeId !== null) {
            filter.id = { ne: excludeId };
        }

        const result = await itemsService.readByQuery(
            { filter, limit: 1, fields: ["id"] },
            true // bypassPermissions: internal duplicate check
        );

        if (result?.data?.length > 0) {
            throw new APIError("A page with this slug already exists", 400);
        }
    };

    // ── baasix_Block ──────────────────────────────────────────────────────
    hooksManager.registerHook("baasix_Block", "items.create", async (ctx: any) => {
        validateBlockData(ctx.data, getFields);
        return ctx;
    });

    hooksManager.registerHook("baasix_Block", "items.update", async (ctx: any) => {
        const data = ctx.data;
        if (!data) return ctx;

        // If any of the fields that affect validation are present in the patch,
        // fetch the existing row, merge with the patch, and validate the merged result.
        const validationFields = ["type", "collection", "config", "position"];
        const hasPatchedValidationField = validationFields.some((f) => f in data);

        if (hasPatchedValidationField && ctx.id != null) {
            const { default: ItemsService } = await import("./ItemsService.js");
            const itemsService = new ItemsService("baasix_Block", {
                accountability: undefined,
            });
            const existing = await itemsService.readOne(
                ctx.id,
                { fields: ["id", "type", "collection", "config", "position"] },
                true // bypassPermissions: internal read
            );
            if (existing) {
                const merged = mergeBlockForUpdate(existing, data);
                validateBlockData(merged, getFields);
            } else {
                // Row not found — still validate the patch as-is
                validateBlockData(data, getFields);
            }
        }

        return ctx;
    });

    // ── baasix_Page ───────────────────────────────────────────────────────
    hooksManager.registerHook("baasix_Page", "items.create", async (ctx: any) => {
        validatePageData(ctx.data, true);
        // Derive tenant scope the same way validateAndEnforceTenantContext does:
        // accountability.tenant is the raw tenant ID (string | null).
        const tenantId: string | null =
            ctx.data.tenant_Id ?? ctx.accountability?.tenant ?? null;
        await assertSlugUnique(ctx.data.slug, tenantId);
        return ctx;
    });

    hooksManager.registerHook("baasix_Page", "items.update", async (ctx: any) => {
        if (!ctx.data) return ctx;
        validatePageData(ctx.data, false);

        if (ctx.data.slug != null && ctx.id != null) {
            // Fetch the existing row so we can:
            //  1. Skip the uniqueness query when the slug isn't actually changing.
            //  2. Derive the correct tenant scope even when ctx.data doesn't include tenant_Id.
            const { default: ItemsService } = await import("./ItemsService.js");
            const itemsService = new ItemsService("baasix_Page", {
                accountability: undefined,
            });
            const existing = await itemsService.readOne(
                ctx.id,
                { fields: ["id", "slug", "tenant_Id"] },
                true // bypassPermissions: internal read
            );

            // Skip uniqueness check when the slug is unchanged.
            if (existing && ctx.data.slug === existing.slug) {
                return ctx;
            }

            // Use the patched tenant_Id if supplied, else fall back to the
            // existing row's tenant (matches what validateAndEnforceTenantContext
            // will inject after the hook).
            const tenantId: string | null =
                ctx.data.tenant_Id ?? existing?.tenant_Id ?? ctx.accountability?.tenant ?? null;

            await assertSlugUnique(ctx.data.slug, tenantId, ctx.id);
        }

        return ctx;
    });
}

export default {
    validateBlockData,
    validatePageData,
    mergeBlockForUpdate,
    registerPageBuilderHooks,
};
