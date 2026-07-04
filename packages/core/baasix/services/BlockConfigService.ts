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
    "buttons",
    "media",
    "feed",
    "iframe",
    "upload",
    "code",
    "geochart",
    "tabs",
    "container",
    "modal",
    "divider",
    "timeline",
    "progress",
    "repeater",
    "richtext",
    "report",
];

/** Types that can host child blocks (children carry parentBlock_Id + slot). */
const CONTAINER_TYPES = new Set(["tabs", "container", "modal"]);
/** Nesting depth cap (top level = depth 0). */
const MAX_NESTING_DEPTH = 3;

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
    "media",
    "feed",
    "geochart",
    "timeline",
    "progress",
    "repeater",
    "report",
]);

const FORM_MODES = new Set(["create", "edit"]);

const CHART_TYPES = new Set([
    "bar",
    "line",
    "area",
    "pie",
    "doughnut",
    "radar",
    "polar",
    "treemap",
    "stat",
]);

const AGGREGATE_FUNCTIONS = new Set(["count", "sum", "avg", "min", "max"]);

/** Geochart map extents; the config space is kept narrow so it can grow later. */
const GEOCHART_REGIONS = new Set(["world"]);

const CALENDAR_VIEWS = new Set(["month", "week", "day"]);

const BUTTON_ACTION_TYPES = new Set(["link", "workflow", "create", "page", "view", "modal"]);

const MEDIA_VIEWERS = new Set(["image", "video", "audio", "auto"]);

const CODE_LANGUAGES = new Set(["json", "javascript", "sql", "html", "css", "text"]);

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export type GetFieldsFn = (collection: string) => Record<string, any> | null | undefined;

/** First dot-segment of a (possibly nested) field path, e.g. "author.name" -> "author". */
function firstSegment(fieldPath: string): string {
    return String(fieldPath).split(".")[0];
}

/**
 * True when the entry is a computed (virtual) field entry: an object carrying
 * a non-empty string `compute` expression. Computed entries are not backed by
 * schema columns, so schema-existence checks are skipped for them — but
 * `field` must still be a non-empty string (it serves as the entry key and
 * label fallback, e.g. {field: "_total", label, compute}).
 */
function isComputedEntry(entry: any): boolean {
    return (
        entry != null &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        typeof entry.compute === "string" &&
        entry.compute.length > 0
    );
}

function assertComputedEntryKey(entry: any, context: string): void {
    if (typeof entry.field !== "string" || entry.field.length === 0) {
        throw new APIError(
            `Invalid ${context} entry: computed entries require "field" to be a non-empty string`,
            400
        );
    }
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
 *
 * When `allowComputed` is true (field-picker contexts: table columns,
 * details/cardlist fields, kanban cardFields), entries with a non-empty
 * string `compute` are virtual and skip the schema-existence check.
 */
function assertFieldEntries(
    entries: any,
    fieldMap: Record<string, any>,
    context: string,
    allowComputed = false
): void {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
        if (allowComputed && isComputedEntry(entry)) {
            assertComputedEntryKey(entry, context);
            continue;
        }
        const path = typeof entry === "string" ? entry : entry?.field;
        assertFieldExists(path, fieldMap, context);
    }
}

/**
 * Validate config.sheetTitle (table/cardlist/kanban): the record edit/view
 * sheets' title — `{fields, separator?}` where every field must exist on the
 * target collection and the optional separator must be a string. Absent key
 * = generic sheet titles.
 */
function assertSheetTitle(config: any, fieldMap: Record<string, any>): void {
    const sheetTitle = config.sheetTitle;
    if (sheetTitle == null) return;
    if (typeof sheetTitle !== "object" || Array.isArray(sheetTitle)) {
        throw new APIError(
            `Invalid sheetTitle: must be an object {fields, separator?}`,
            400
        );
    }
    if (!Array.isArray(sheetTitle.fields) || sheetTitle.fields.length === 0) {
        throw new APIError(
            `Invalid sheetTitle: "fields" must be a non-empty array of field names`,
            400
        );
    }
    for (const field of sheetTitle.fields) {
        assertFieldExists(field, fieldMap, "config.sheetTitle.fields");
    }
    if (sheetTitle.separator != null && typeof sheetTitle.separator !== "string") {
        throw new APIError(`Invalid sheetTitle: "separator" must be a string`, 400);
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
/**
 * Validate a record-bound block's `source` (details / form edit-mode / code
 * recordField-mode). Accepted: legacy strings "route-param" / "selection",
 * {type:"param"}, or {type:"block", blockId} following a sibling data block's
 * published selection. Like filter.targets, the blockId is validated for
 * shape only (page composition may change after save; renderers handle a
 * missing source block with an empty state).
 */
function assertRecordSource(source: any): void {
    if (source == null) return;
    if (source === "route-param" || source === "selection") return;
    if (typeof source === "object" && !Array.isArray(source)) {
        if (source.type === "param") return;
        if (source.type === "block" && typeof source.blockId === "string" && source.blockId) {
            return;
        }
    }
    throw new APIError(
        `Invalid source: must be {type:"param"} or {type:"block", blockId} (or legacy "route-param")`,
        400
    );
}

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
            assertFieldEntries(config.columns, fieldMap, "config.columns", true);
            assertSheetTitle(config, fieldMap);
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
            assertRecordSource(config.source);
        } else if (type === "details") {
            assertFieldEntries(config.fields, fieldMap, "config.fields", true);
            assertRecordSource(config.source);
        } else if (type === "kanban") {
            requireConfigField(config, "groupByField", fieldMap);
            requireConfigField(config, "cardTitleField", fieldMap);
            assertFieldEntries(config.cardFields, fieldMap, "config.cardFields", true);
            assertSheetTitle(config, fieldMap);
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
            if (config.views != null) {
                if (!Array.isArray(config.views) || config.views.length === 0) {
                    throw new APIError(
                        `config.views must be a non-empty array when present. Omit it to enable all views.`,
                        400
                    );
                }
                for (const v of config.views) {
                    if (!CALENDAR_VIEWS.has(v)) {
                        throw new APIError(
                            `Invalid view "${v}" in config.views. Must be one of: month, week, day`,
                            400
                        );
                    }
                }
                if (config.defaultView != null && !config.views.includes(config.defaultView)) {
                    throw new APIError(
                        `config.defaultView "${config.defaultView}" is not in config.views`,
                        400
                    );
                }
            }
        } else if (type === "chart") {
            if (!CHART_TYPES.has(config.chartType)) {
                throw new APIError(
                    `Invalid chartType "${config.chartType}". Must be one of: ${[...CHART_TYPES].join(", ")}`,
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
            assertFieldEntries(config.fields, fieldMap, "config.fields", true);
            assertSheetTitle(config, fieldMap);
            if (config.columns != null) {
                if (!Number.isInteger(config.columns) || config.columns < 1 || config.columns > 6) {
                    throw new APIError(
                        `Invalid columns "${config.columns}": must be an integer between 1 and 6`,
                        400
                    );
                }
            }
        } else if (type === "geochart") {
            // Choropleth world map: records are grouped by regionField (country
            // codes/names) and shaded by the aggregated value.
            requireConfigField(config, "regionField", fieldMap);
            const aggregate = config.aggregate ?? "count";
            if (!AGGREGATE_FUNCTIONS.has(aggregate)) {
                throw new APIError(
                    `Invalid geochart aggregate "${config.aggregate}". Must be one of: count, sum, avg, min, max`,
                    400
                );
            }
            if (aggregate !== "count" && config.valueField == null) {
                throw new APIError(
                    `Geochart block config requires "valueField" when aggregate is "${aggregate}"`,
                    400
                );
            }
            if (config.valueField != null) {
                assertFieldExists(config.valueField, fieldMap, "config.valueField");
            }
            if (config.region != null && !GEOCHART_REGIONS.has(config.region)) {
                throw new APIError(
                    `Invalid geochart region "${config.region}". Only "world" is supported for now`,
                    400
                );
            }
        } else if (type === "map") {
            requireConfigField(config, "geometryField", fieldMap);
            if (config.titleField != null) {
                assertFieldExists(config.titleField, fieldMap, "config.titleField");
            }
            assertFieldEntries(config.popupFields, fieldMap, "config.popupFields");
        } else if (type === "media") {
            requireConfigField(config, "fileField", fieldMap);
            if (config.titleField != null) {
                assertFieldExists(config.titleField, fieldMap, "config.titleField");
            }
            if (config.viewer != null && !MEDIA_VIEWERS.has(config.viewer)) {
                throw new APIError(
                    `Invalid viewer "${config.viewer}". Must be one of: image, video, audio, auto`,
                    400
                );
            }
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
        } else if (type === "feed") {
            // textField is required when a config is present
            if (config.textField == null) {
                throw new APIError(`Feed block config requires "textField"`, 400);
            }
            assertFieldExists(config.textField, fieldMap, "config.textField");
            // authorField / timestampField are optional but must exist when present
            if (config.authorField != null) {
                assertFieldExists(config.authorField, fieldMap, "config.authorField");
            }
            if (config.timestampField != null) {
                assertFieldExists(config.timestampField, fieldMap, "config.timestampField");
            }
            // fileField (attachments) is optional but must exist when present
            if (config.fileField != null) {
                assertFieldExists(config.fileField, fieldMap, "config.fileField");
            }
            // order must be asc or desc when present
            if (config.order != null && config.order !== "asc" && config.order !== "desc") {
                throw new APIError(
                    `Invalid order "${config.order}" for feed block: must be "asc" or "desc"`,
                    400
                );
            }
        } else if (type === "timeline") {
            requireConfigField(config, "timestampField", fieldMap);
            requireConfigField(config, "titleField", fieldMap);
            if (config.descriptionField != null) {
                assertFieldExists(config.descriptionField, fieldMap, "config.descriptionField");
            }
            if (config.iconField != null) {
                assertFieldExists(config.iconField, fieldMap, "config.iconField");
            }
            if (config.colorField != null) {
                assertFieldExists(config.colorField, fieldMap, "config.colorField");
            }
            if (config.sort != null && config.sort !== "asc" && config.sort !== "desc") {
                throw new APIError(
                    `Invalid timeline sort "${config.sort}": must be "asc" or "desc"`,
                    400
                );
            }
        } else if (type === "progress") {
            const aggregate = config.aggregate;
            if (!aggregate || typeof aggregate !== "object" || Array.isArray(aggregate)) {
                throw new APIError(
                    `Progress block config requires "aggregate" ({function, field})`,
                    400
                );
            }
            if (!AGGREGATE_FUNCTIONS.has(aggregate.function)) {
                throw new APIError(
                    `Invalid progress aggregate function "${aggregate.function}". Must be one of: count, sum, avg, min, max`,
                    400
                );
            }
            if (aggregate.field !== "*") {
                assertFieldExists(aggregate.field, fieldMap, "config.aggregate");
            }
            const target = config.target;
            if (typeof target === "number") {
                if (!Number.isFinite(target)) {
                    throw new APIError(`Invalid progress target: must be a finite number`, 400);
                }
            } else if (target && typeof target === "object" && !Array.isArray(target)) {
                if (!AGGREGATE_FUNCTIONS.has(target.function)) {
                    throw new APIError(
                        `Invalid progress target function "${target.function}". Must be one of: count, sum, avg, min, max`,
                        400
                    );
                }
                if (target.field !== "*") {
                    assertFieldExists(target.field, fieldMap, "config.target");
                }
            } else {
                throw new APIError(
                    `Progress block config requires "target" (a number or {function, field})`,
                    400
                );
            }
            if (config.variant != null && config.variant !== "bar" && config.variant !== "radial") {
                throw new APIError(
                    `Invalid progress variant "${config.variant}": must be "bar" or "radial"`,
                    400
                );
            }
        } else if (type === "repeater") {
            if (typeof config.template !== "string" || config.template.length === 0) {
                throw new APIError(
                    `Repeater block config requires "template" to be a non-empty string`,
                    400
                );
            }
            // Template {{field}} references are NOT schema-validated (dotted
            // relation paths are allowed and resolved client-side).
            if (config.columns != null) {
                if (!Number.isInteger(config.columns) || config.columns < 1 || config.columns > 6) {
                    throw new APIError(
                        `Invalid columns "${config.columns}": must be an integer between 1 and 6`,
                        400
                    );
                }
            }
        } else if (type === "report") {
            const query = config.query;
            if (!query || typeof query !== "object" || Array.isArray(query)) {
                throw new APIError(
                    `Report block config requires a "query" object (fields/aggregate/groupBy/sort/limit)`,
                    400
                );
            }
            if (query.aggregate != null) {
                if (typeof query.aggregate !== "object" || Array.isArray(query.aggregate)) {
                    throw new APIError(`Invalid report aggregate: must be an object`, 400);
                }
                for (const [alias, entry] of Object.entries<any>(query.aggregate)) {
                    if (!entry || typeof entry !== "object" || !AGGREGATE_FUNCTIONS.has(entry.function)) {
                        throw new APIError(
                            `Invalid report aggregate "${alias}": must be {function, field} with a valid function`,
                            400
                        );
                    }
                }
            }
            if (query.groupBy != null) {
                if (!Array.isArray(query.groupBy) || query.groupBy.some((g: any) => typeof g !== "string")) {
                    throw new APIError(`Invalid report groupBy: must be an array of field strings`, 400);
                }
                // "date:"-prefixed entries are virtual buckets; plain names are
                // NOT schema-checked here (dotted relational paths are allowed).
            }
            if (query.fields != null && !Array.isArray(query.fields)) {
                throw new APIError(`Invalid report fields: must be an array`, 400);
            }
            if (query.limit != null && (!Number.isInteger(query.limit) || query.limit < -1)) {
                throw new APIError(`Invalid report limit: must be an integer >= -1`, 400);
            }
            if (config.columns != null) {
                if (!Array.isArray(config.columns) || config.columns.some((c: any) => !c || typeof c.field !== "string")) {
                    throw new APIError(`Invalid report columns: must be an array of {field, label?}`, 400);
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

    // buttons also has no collection — when a config is present, "items" must
    // be a non-empty array of valid button items. No config at all stays
    // lenient (renderers handle configless blocks defensively).
    if (config != null && type === "buttons") {
        validateButtonsConfig(config);
    }

    // iframe also has no collection — when a config is present, "url" is
    // required and must be http(s). No config at all stays lenient
    // (renderers handle configless blocks defensively).
    if (config != null && type === "iframe") {
        validateIframeConfig(config);
    }

    // upload also has no collection — every config key is optional, but each
    // must have the right shape when present. No config at all stays lenient
    // (the renderer applies its defaults).
    if (config != null && type === "upload") {
        validateUploadConfig(config);
    }

    // Layout blocks are collectionless. Shapes: tabs needs a non-empty tab
    // list; container/modal/divider keys are optional but type-checked.
    if (config != null && type === "tabs") {
        if (!Array.isArray(config.tabs) || config.tabs.length === 0) {
            throw new APIError(
                `Tabs block config requires "tabs" to be a non-empty array of {label}`,
                400
            );
        }
        config.tabs.forEach((tab: any, index: number) => {
            if (!tab || typeof tab !== "object" || Array.isArray(tab)) {
                throw new APIError(`Invalid tab at index ${index}: must be an object`, 400);
            }
            if (typeof tab.label !== "string" || tab.label.length === 0) {
                throw new APIError(
                    `Invalid tab at index ${index}: "label" must be a non-empty string`,
                    400
                );
            }
        });
    }
    if (config != null && type === "container") {
        if (config.variant != null && config.variant !== "card" && config.variant !== "plain") {
            throw new APIError(
                `Invalid container variant "${config.variant}": must be "card" or "plain"`,
                400
            );
        }
    }
    if (config != null && type === "modal") {
        if (
            config.width != null &&
            !["sm", "md", "lg", "xl"].includes(config.width)
        ) {
            throw new APIError(
                `Invalid modal width "${config.width}": must be one of sm, md, lg, xl`,
                400
            );
        }
    }
    if (config != null && type === "divider") {
        if (config.label != null && typeof config.label !== "string") {
            throw new APIError(`Invalid divider label: must be a string`, 400);
        }
    }

    // Nesting (shape only — existence/cycles are checked in the DB hook):
    // parentBlock_Id must be a string id and slot a sane string when present.
    if (data.parentBlock_Id != null && typeof data.parentBlock_Id !== "string") {
        throw new APIError(`Invalid parentBlock_Id: must be a block id string`, 400);
    }
    if (data.slot != null) {
        if (typeof data.slot !== "string" || !/^(body|tab:\d+)$/.test(data.slot)) {
            throw new APIError(
                `Invalid slot "${data.slot}": must be "body" or "tab:<index>"`,
                400
            );
        }
        if (data.parentBlock_Id == null) {
            throw new APIError(`slot requires parentBlock_Id`, 400);
        }
    }

    // code has an OPTIONAL collection (like markdown it is not in
    // COLLECTION_REQUIRED, so fieldMap above is null). Validate its config
    // here; recordField additionally requires the block to carry a collection
    // whose field map contains the field, so the collection is resolved on
    // demand. No config at all stays lenient.
    if (config != null && type === "code") {
        validateCodeConfig(config, collection, getFields);
    }

    // richtext mirrors code: OPTIONAL collection, required when recordField
    // is set; content is an HTML string authored with the lexical editor.
    if (config != null && type === "richtext") {
        if (config.content != null && typeof config.content !== "string") {
            throw new APIError(`Invalid richtext content: must be an HTML string`, 400);
        }
        if (config.recordField != null) {
            if (typeof config.recordField !== "string" || config.recordField.length === 0) {
                throw new APIError(`Invalid richtext recordField: must be a non-empty string`, 400);
            }
            if (!collection || typeof collection !== "string") {
                throw new APIError(
                    `Richtext block config "recordField" requires the block to have a collection`,
                    400
                );
            }
            const richFieldMap = getFields(collection);
            if (!richFieldMap) {
                throw new APIError(`Unknown collection "${collection}" for block`, 400);
            }
            assertFieldExists(config.recordField, richFieldMap, "config.recordField");
        }
        assertRecordSource(config.source);
    }
}

/**
 * Validate a code block config. All keys are optional: `content` (static
 * code/JSON string), `language` (one of CODE_LANGUAGES) and `recordField`
 * (renders a live record's field value — requires the block to have a
 * collection and the field to exist on it).
 */
function validateCodeConfig(config: any, collection: any, getFields: GetFieldsFn): void {
    if (config.content != null && typeof config.content !== "string") {
        throw new APIError(`Invalid code content: must be a string`, 400);
    }
    if (config.language != null && !CODE_LANGUAGES.has(config.language)) {
        throw new APIError(
            `Invalid code language "${config.language}". Must be one of: json, javascript, sql, html, css, text`,
            400
        );
    }
    if (config.recordField != null) {
        if (typeof config.recordField !== "string" || config.recordField.length === 0) {
            throw new APIError(`Invalid code recordField: must be a non-empty string`, 400);
        }
        if (!collection || typeof collection !== "string") {
            throw new APIError(
                `Code block config "recordField" requires the block to have a collection`,
                400
            );
        }
        const fieldMap = getFields(collection);
        if (!fieldMap) {
            throw new APIError(`Unknown collection "${collection}" for block`, 400);
        }
        assertFieldExists(config.recordField, fieldMap, "config.recordField");
    }
    assertRecordSource(config.source);
}

/**
 * Validate an upload block config. All keys are optional: `accept` (string
 * passed to the file input's accept attribute, e.g. "image/*,.pdf"),
 * `maxSizeMB` (positive finite number — client-side size cap), `multiple`
 * (boolean) and `folder` (string stored on the created baasix_File rows).
 */
function validateUploadConfig(config: any): void {
    if (config.accept != null && typeof config.accept !== "string") {
        throw new APIError(`Invalid upload accept: must be a string like "image/*,.pdf"`, 400);
    }
    if (config.maxSizeMB != null) {
        if (
            typeof config.maxSizeMB !== "number" ||
            !Number.isFinite(config.maxSizeMB) ||
            config.maxSizeMB <= 0
        ) {
            throw new APIError(`Invalid upload maxSizeMB: must be a positive number`, 400);
        }
    }
    if (config.multiple != null && typeof config.multiple !== "boolean") {
        throw new APIError(`Invalid upload multiple: must be a boolean`, 400);
    }
    if (config.folder != null && typeof config.folder !== "string") {
        throw new APIError(`Invalid upload folder: must be a string`, 400);
    }
}

/**
 * Validate an iframe block config: `url` must be a non-empty http(s) string
 * (javascript:/data:/etc. schemes are rejected); optional `height` (positive
 * number), `allowFullscreen` (boolean) and `sandbox` (string override of the
 * renderer's default sandbox attribute).
 */
function validateIframeConfig(config: any): void {
    const url = typeof config.url === "string" ? config.url.trim() : config.url;
    if (typeof url !== "string" || url.length === 0) {
        throw new APIError(
            `Iframe block config requires "url" to be a non-empty string`,
            400
        );
    }
    if (!/^https?:\/\//i.test(url)) {
        throw new APIError(
            `Invalid iframe url: must start with http:// or https://`,
            400
        );
    }
    if (config.height != null) {
        if (typeof config.height !== "number" || !Number.isFinite(config.height) || config.height <= 0) {
            throw new APIError(`Invalid iframe height: must be a positive number`, 400);
        }
    }
    if (config.allowFullscreen != null && typeof config.allowFullscreen !== "boolean") {
        throw new APIError(`Invalid iframe allowFullscreen: must be a boolean`, 400);
    }
    // sandbox token content is deliberately not validated — config is admin-authored;
    // callers own sandbox semantics and are responsible for the policy they pass.
    if (config.sandbox != null && typeof config.sandbox !== "string") {
        throw new APIError(`Invalid iframe sandbox: must be a string`, 400);
    }
}

/**
 * Validate a buttons block config: `items` must be a non-empty array; each
 * item needs a non-empty `label` and an `action` of type "link" (with a
 * non-empty `url`) or "workflow" (with a non-empty `workflowId`). Extra keys
 * (icon, style, newTab, confirm, …) pass through unvalidated.
 */
function validateButtonsConfig(config: any): void {
    const { items } = config;
    if (!Array.isArray(items) || items.length === 0) {
        throw new APIError(
            `Buttons block config requires "items" to be a non-empty array`,
            400
        );
    }
    items.forEach((item: any, index: number) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            throw new APIError(`Invalid buttons item at index ${index}: must be an object`, 400);
        }
        if (typeof item.label !== "string" || item.label.length === 0) {
            throw new APIError(
                `Invalid buttons item at index ${index}: "label" must be a non-empty string`,
                400
            );
        }
        const action = item.action;
        if (!action || typeof action !== "object" || Array.isArray(action)) {
            throw new APIError(
                `Invalid buttons item at index ${index}: "action" must be an object {type, ...}`,
                400
            );
        }
        if (!BUTTON_ACTION_TYPES.has(action.type)) {
            throw new APIError(
                `Invalid buttons item at index ${index}: action type "${action.type}" must be one of: link, workflow, create, page, view, modal`,
                400
            );
        }
        if (action.type === "link") {
            if (typeof action.url !== "string" || action.url.length === 0) {
                throw new APIError(
                    `Invalid buttons item at index ${index}: link action requires "url" to be a non-empty string`,
                    400
                );
            }
        } else if (action.type === "workflow") {
            if (typeof action.workflowId !== "string" || action.workflowId.length === 0) {
                throw new APIError(
                    `Invalid buttons item at index ${index}: workflow action requires "workflowId" to be a non-empty string`,
                    400
                );
            }
        } else if (action.type === "create") {
            if (typeof action.collection !== "string" || action.collection.length === 0) {
                throw new APIError(
                    `Invalid buttons item at index ${index}: create action requires "collection" to be a non-empty string`,
                    400
                );
            }
        } else if (action.type === "page") {
            if (typeof action.slug !== "string" || action.slug.length === 0) {
                throw new APIError(
                    `Invalid buttons item at index ${index}: page action requires "slug" to be a non-empty string`,
                    400
                );
            }
        } else if (action.type === "modal") {
            if (typeof action.blockId !== "string" || action.blockId.length === 0) {
                throw new APIError(
                    `Invalid buttons item at index ${index}: modal action requires "blockId" to be a non-empty string`,
                    400
                );
            }
        } else if (action.type === "view") {
            // Both keys are optional (collection defaults to the host block's
            // collection, idField defaults to "id") — validate types only when present.
            if (action.collection != null && typeof action.collection !== "string") {
                throw new APIError(
                    `Invalid buttons item at index ${index}: view action "collection" must be a string when present`,
                    400
                );
            }
            if (action.idField != null && typeof action.idField !== "string") {
                throw new APIError(
                    `Invalid buttons item at index ${index}: view action "idField" must be a string when present`,
                    400
                );
            }
        }
    });
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
/** Minimal block row the parent-assignment check needs. */
export interface ParentLookupBlock {
    id: string;
    type: string;
    page_Id: string;
    parentBlock_Id?: string | null;
    config?: any;
}

/**
 * Validate a block's parent assignment against live rows: the parent must
 * exist on the same page, be a container type (tabs/container/modal), the
 * slot must fit the parent (tab:<n> within the tab list for tabs, "body"
 * otherwise), and the ancestor chain must be acyclic and at most
 * MAX_NESTING_DEPTH deep. `getBlock` resolves ids to rows (null = missing).
 */
export async function assertParentAssignment(
    block: { id?: string | null; page_Id: string; parentBlock_Id: string; slot?: string | null },
    getBlock: (id: string) => Promise<ParentLookupBlock | null>
): Promise<void> {
    const parent = await getBlock(block.parentBlock_Id);
    if (!parent) {
        throw new APIError(`parentBlock_Id does not reference an existing block`, 400);
    }
    if (block.id != null && parent.id === block.id) {
        throw new APIError(`A block cannot be its own parent`, 400);
    }
    if (parent.page_Id !== block.page_Id) {
        throw new APIError(`parentBlock_Id must reference a block on the same page`, 400);
    }
    if (!CONTAINER_TYPES.has(parent.type)) {
        throw new APIError(
            `parentBlock_Id must reference a container block (tabs, container or modal); got "${parent.type}"`,
            400
        );
    }
    const slot = block.slot ?? null;
    if (parent.type === "tabs") {
        const match = slot == null ? null : /^tab:(\d+)$/.exec(slot);
        if (!match) {
            throw new APIError(`Blocks inside a tabs block need a slot like "tab:0"`, 400);
        }
        const tabCount = Array.isArray(parent.config?.tabs) ? parent.config.tabs.length : 0;
        const index = Number(match[1]);
        if (index >= tabCount) {
            throw new APIError(
                `slot "${slot}" is out of range: the tabs block has ${tabCount} tab(s)`,
                400
            );
        }
    } else if (slot != null && slot !== "body") {
        throw new APIError(
            `Invalid slot "${slot}" for a ${parent.type} parent: only "body" (or omitted)`,
            400
        );
    }

    // Ancestor walk: reject cycles (the moved block appearing in its own
    // ancestor chain) and chains deeper than MAX_NESTING_DEPTH.
    const seen = new Set<string>(block.id != null ? [block.id] : []);
    let current: ParentLookupBlock | null = parent;
    let depth = 1;
    while (current) {
        if (seen.has(current.id)) {
            throw new APIError(`parentBlock_Id would create a cycle`, 400);
        }
        seen.add(current.id);
        if (depth > MAX_NESTING_DEPTH) {
            throw new APIError(
                `Blocks can be nested at most ${MAX_NESTING_DEPTH} levels deep`,
                400
            );
        }
        if (!current.parentBlock_Id) break;
        current = await getBlock(current.parentBlock_Id);
        depth += 1;
    }
}

export function mergeBlockForUpdate(
    existing: Record<string, any>,
    patch: Record<string, any>
): Record<string, any> {
    return { ...existing, ...patch };
}

/** Build a GetFieldsFn backed by the live schemaManager (columns + relation names). */
export function makeGetFields(schemaManager: any): GetFieldsFn {
    return (collection: string) => {
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

    const getFields = makeGetFields(schemaManager);

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

    /** id → minimal block row for parent-assignment checks (bypass perms). */
    const getBlockForParentCheck = async (id: string) => {
        const { default: ItemsService } = await import("./ItemsService.js");
        const itemsService = new ItemsService("baasix_Block", {
            accountability: undefined,
        });
        const row = await itemsService.readOne(
            id,
            { fields: ["id", "type", "page_Id", "parentBlock_Id", "config"] },
            true // bypassPermissions: internal read
        );
        return row ?? null;
    };

    // ── baasix_Block ──────────────────────────────────────────────────────
    hooksManager.registerHook("baasix_Block", "items.create", async (ctx: any) => {
        validateBlockData(ctx.data, getFields);
        if (ctx.data?.parentBlock_Id != null) {
            await assertParentAssignment(
                {
                    id: ctx.data.id ?? null,
                    page_Id: ctx.data.page_Id,
                    parentBlock_Id: ctx.data.parentBlock_Id,
                    slot: ctx.data.slot ?? null,
                },
                getBlockForParentCheck
            );
        }
        return ctx;
    });

    hooksManager.registerHook("baasix_Block", "items.update", async (ctx: any) => {
        const data = ctx.data;
        if (!data) return ctx;

        // If any of the fields that affect validation are present in the patch,
        // fetch the existing row, merge with the patch, and validate the merged result.
        const validationFields = ["type", "collection", "config", "position", "parentBlock_Id", "slot"];
        const hasPatchedValidationField = validationFields.some((f) => f in data);

        if (hasPatchedValidationField && ctx.id != null) {
            const { default: ItemsService } = await import("./ItemsService.js");
            const itemsService = new ItemsService("baasix_Block", {
                accountability: undefined,
            });
            const existing = await itemsService.readOne(
                ctx.id,
                { fields: ["id", "type", "collection", "config", "position", "page_Id", "parentBlock_Id", "slot"] },
                true // bypassPermissions: internal read
            );
            if (existing) {
                const merged = mergeBlockForUpdate(existing, data);
                validateBlockData(merged, getFields);
                // Effective parent/slot after the patch (explicit null clears).
                const parentBlockId =
                    "parentBlock_Id" in data ? data.parentBlock_Id : existing.parentBlock_Id;
                const slot = "slot" in data ? data.slot : existing.slot;
                if (parentBlockId != null) {
                    await assertParentAssignment(
                        { id: existing.id, page_Id: existing.page_Id, parentBlock_Id: parentBlockId, slot },
                        getBlockForParentCheck
                    );
                }
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
