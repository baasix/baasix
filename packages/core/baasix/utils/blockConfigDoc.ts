/**
 * Markdown reference for the baasix_Block `config` format, served to AI agents
 * via GET /pages/block-config-doc and the MCP resource baasix://docs/block-config.
 * Source of truth: docs/superpowers/specs/2026-06-11-app-builder-contracts-design.md §2
 * and BlockConfigService.ts — update this file when either changes.
 */
export const BLOCK_CONFIG_DOC = `# Baasix page-builder: block config reference

## Model

- **baasix_Page**: { name, slug (unique per tenant, lowercase \`a-z0-9-\`), icon (lucide name),
  description?, parent_Id? (menu nesting), sort, isPublic (public route /p/?slug=),
  enabled, options { menuGroup?: bool, homeFor?: roleId[] }, roles?: roleId[] (menu visibility; null = all) }
- **baasix_Block**: { page_Id, type, collection (bound collection; see per-type rules),
  position { row, col, span }, config (per-type JSON, below), configVersion (default 1) }
- Authenticated pages render at \`/pages/?slug=<slug>\`; public pages at \`/p/?slug=<slug>\`.

## Grid contract

12-column grid. \`position = { row, col, span }\`: row >= 0; 0 <= col <= 11; 1 <= span <= 12.
Rows stack vertically; blocks within a row share the 12 columns; no overlap. Mobile collapses to stacked.

## Common config envelope

Every config may carry: \`title?\`, \`description?\`,
\`size? { height?, minHeight?, maxHeight?, minWidth?, maxWidth?, innerScroll? }\` (px),
\`density?: "compact"|"default"|"spacious"\`.
Data blocks may also carry \`realtime?: true\` (socket push / 10s poll fallback) and
\`inlineFilters?: [{ field, operator?, label? }]\` (table/cardlist).

## Filter DSL

Every \`filter\` value anywhere in a config uses the items-API filter DSL — the same operators
(\`eq, neq, gt, gte, lt, lte, in, contains, between, dwithin\`, …) and dynamic variables
(\`$CURRENT_USER\`, \`$CURRENT_TENANT\`, \`$NOW±DAYS_N\`) as baasix_Permission conditions and GET /items.
A data-block filter value may also be one of these runtime placeholders (master-detail wiring):
- \`"$param.<name>"\` — resolved from the page URL's query params.
- \`"$selection.<blockId>.<fieldPath>"\` — the record last clicked in the sibling data block with
  that id (table row / cardlist-kanban card / calendar event / map marker). Dotted field paths ok.
- \`"$input.<name>"\` — an input block's current value (see input block).
While a referenced param/selection is absent the condition is stripped and the block shows a
"Select a record" state instead of querying unfiltered; unset non-required inputs strip silently.

## Record sources

Record-bound blocks (details, form mode:"edit", code with recordField) take their record id from
\`source\`: \`{type:"param"}\` (default; the ?id= URL param — legacy string "route-param" still
accepted) or \`{type:"block", blockId}\` — following the selection published by a sibling
table/cardlist/kanban/calendar/map block when the user clicks a row/card/event/marker.

## Block types

Types REQUIRING a collection: table, form, details, kanban, calendar, chart, cardlist, map, geochart, media, feed, filter.
Collectionless types: markdown, buttons, iframe, upload. \`code\` takes an OPTIONAL collection
(required only when \`recordField\` is set).
All field names referenced in a config MUST exist on the bound collection (validated server-side).

### table
\`columns: [{ field, label?, width?, format? }]\`, \`filter?\`, \`sort?\`, \`pageSize?\`,
\`actions? { create?, edit?, delete?, view? }\` (boolean | "auto"), \`search?: bool\`, \`inlineEdit?: bool\`,
\`bulkEdit?\`, \`bulkDelete?\`, \`advancedFilter?: bool\`, \`sheetTitle?\`, \`headerActions?\`, \`rowActions?\`.

### form
\`mode: "create"|"edit"\`, \`fields: [{ field, label?, required?, defaultValue?, hidden?, section? }]\`,
\`sections?: [{ key, label }]\`, \`submitLabel?\`, \`successMessage?\`, \`redirectPageSlug?\`, \`humanCheck?: bool\`,
\`source?\` (edit mode: where the record id comes from; see Record sources).

### details
\`fields: [{ field, label?, format? }]\`, \`source?: {type:"param"} | {type:"block", blockId}\`
(record id from ?id= — the default — or a sibling block's selection; see Record sources).

### kanban
\`groupByField\` (required; drag updates it), \`columnOrder?: []\`, \`cardTitleField\` (required),
\`cardFields?: []\`, \`allowDrag?: bool\`, \`cardAction?: BlockAction\`, \`actions? { edit?, delete? }\`, \`sheetTitle?\`.

### calendar
\`startField\` (required, DateTime), \`endField?\`, \`titleField\` (required), \`colorField?\`,
\`defaultView?: "month"|"week"|"day"\`, \`views?: ["month"|"week"|"day"]\` (must be NON-EMPTY when present —
omit to enable all views; defaultView must be a member), \`eventAction?: BlockAction\`, \`filter?\`.

### chart
\`chartType\`: one of \`bar|line|area|pie|doughnut|radar|polar|treemap|stat\`.
\`aggregate: { <alias>: { function: "count"|"sum"|"avg"|"min"|"max", field } }\` (required, non-empty;
multi-alias = multi-series; \`field\` may be \`"*"\` for count over all rows),
\`groupBy?: []\`, \`filter?\`, \`stacked?\` (bar/area), \`seriesColors?/seriesLabels?/statFormats?\` per alias.
Time mode (series family bar/line/area only): \`xType: "time"\` + \`timeField\` + \`interval: "hour"|"day"|"week"|"month"\`
+ \`fillEmpty?\` + \`range?: { preset, amount?, unit?, from?, to? }\` (preset "custom" + amount + unit of
hours/days/weeks/months/years, max amount 1000).
Pie family (pie/doughnut/polar/treemap) uses groupBy + the FIRST aggregate alias.
\`stat\` renders metric cards; \`compare? { timeField, range }\` adds previous-period delta badges.

### cardlist
\`titleField\` (required), \`subtitleField?\`, \`imageField?\` (file UUID field), \`fields?: []\`,
\`columns?: 1-6\`, \`filter?\`, \`sort?\`, \`pageSize?\`, \`itemAction?: BlockAction\`, \`sheetTitle?\`, \`advancedFilter?\`.

### map
\`geometryField\` (required; GeoJSON/WKT), \`titleField?\`, \`popupFields?: []\`, \`defaultCenter?\`,
\`defaultZoom?\`, \`filter?\`, \`clusterMarkers?: bool\`, \`colorField?\`, \`colorMap? { value: cssColor }\`.

### geochart
\`regionField\` (required; values are ISO 3166-1 alpha-2 "IN", alpha-3 "IND" or country names, case-insensitive),
\`aggregate?: "count"|"sum"|"avg"|"min"|"max"\` (default count), \`valueField?\` (numeric; REQUIRED when aggregate != count),
\`region?: "world"\` (only "world" accepted), \`filter?\`. Renders a choropleth world map.

### markdown
\`content\` (markdown string). No collection.

### filter
\`targets: blockId[] | "all"\`, \`fields: [{ field, operator?, label? }]\` — publishes filter state to sibling
data blocks (merged AND into each target's filter).

### buttons
\`items: [{ label, icon?, variant?, action }]\` (required, non-empty) where \`action.type\` is one of
\`link\` (requires \`url\`), \`workflow\` (requires \`workflowId\`), \`create\` (requires \`collection\`),
\`page\` (requires \`slug\`), \`view\` (\`collection?\`/\`idField?\` optional) — see Actions section.
\`export-csv\` is header-actions-only and NOT valid here. No collection.

### media
\`fileField\` (required; UUID field referencing baasix_File), \`titleField?\`,
\`viewer?: "image"|"video"|"audio"|"auto"\`, \`columns?: 1-6\`, \`filter?\`.

### feed
\`textField\` (required), \`authorField?\` (usertrack \`userCreated\` recommended), \`timestampField?\`
(default createdAt), \`order?: "asc"|"desc"\`, \`composer?\`, \`composerDefaults?\` (values support \`$param.<name>\`),
\`fileField?\` (attachments), \`highlightOwn?/allowEditOwn?/allowDeleteOwn?\` (default true).

### iframe
\`url\` (required; http/https only), \`height?\` (px, default 480), \`allowFullscreen?: bool\`, \`sandbox?\`. No collection.

### upload
\`accept?\` (file-input accept attr), \`maxSizeMB?\`, \`multiple?: bool\`, \`folder?\`. No collection.

### code
\`content?\` (static text), \`language?: "json"|"javascript"|"sql"|"html"|"css"|"text"\` (default "text"),
\`recordField?\` (dotted path ok; renders that field from a live record — collection REQUIRED when set),
\`source?\` (recordField mode: where the record id comes from; see Record sources).

## Actions (BlockAction / ActionItem)

\`ActionItem { label, icon?, variant?, size?, iconOnly?, action }\` with \`action.type\`:
- \`view { collection?, idField? }\` — read-only record sheet (collection defaults to the block's)
- \`link { url, newTab? }\` — \`{{field}}\` templates resolve from the row, URL-encoded
- \`workflow { workflowId, confirm? }\` — sends { recordId, record } as triggerData
- \`create { collection, defaults? }\` — opens the record drawer
- \`page { slug, carryId? }\`
- \`export-csv\` (header actions only)
Used by buttons \`items\`, data-block \`headerActions\`, table/cardlist \`rowActions\`, kanban \`cardActions\`,
and the single-action keys \`cardAction\`/\`itemAction\`/\`eventAction\`.

## Misc

- \`sheetTitle: { fields: string[], separator?: string }\` (default " – ") titles record sheets; fields must exist.
- Computed entries in table columns / cardlist/kanban/details fields: \`{ field: "_key", label, compute: "<JS expr with row>" }\`
  — schema validation is skipped for them.
- Validation happens server-side on every block create/update; use baasix_validate_block_config to pre-check.

## Recommended agent workflow

1. \`baasix_get_schema\` for each collection you'll bind (field names/types).
2. \`baasix_create_page\` { name, slug, icon } (pages start enabled by default; pass enabled:false to stage).
3. \`baasix_validate_block_config\` for each planned block, then \`baasix_create_block\` with position {row,col,span}.
4. \`baasix_get_page\` { slug } to review the result; \`baasix_update_block\` to refine.
5. Page renders at /pages/?slug=<slug> (admin app); non-admins need read permissions on baasix_Page
   (fields ["*","blocks.*"]) and on the bound collections.
`;
