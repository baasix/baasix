/**
 * Markdown reference for the baasix_Block `config` format, served to AI agents
 * via GET /pages/block-config-doc and the MCP resource baasix://docs/block-config.
 * Source of truth: docs/superpowers/specs/2026-06-11-app-builder-contracts-design.md §2
 * and BlockConfigService.ts — update this file when either changes.
 *
 * KEEP IN SYNC with app src/components/pages/editor/help-topics.ts (HELP_TOPICS): the
 * "## Aggregates", "## Record sources", "## Expressions", and "## Filter DSL" sections below
 * are the MCP-facing counterpart of that file's "aggregate", "record-source", "expressions",
 * and "filter-dsl" topics — same facts, same examples where sensible.
 */
export const BLOCK_CONFIG_DOC = `# Baasix page-builder: block config reference

## Model

- **baasix_Page**: { name, slug (unique per tenant, lowercase \`a-z0-9-\`), icon (lucide name),
  description?, parent_Id? (menu nesting), sort, isPublic (public route /p/?slug=),
  enabled, options { menuGroup?: bool, homeFor?: roleId[] }, roles?: roleId[] (menu visibility; null = all) }
- **baasix_Block**: { page_Id, type, collection (bound collection; see per-type rules),
  position { row, col, span }, config (per-type JSON, below), configVersion (default 1),
  parentBlock_Id? (parent container block id), slot? ("tab:<index>" inside tabs, "body" otherwise) }
- Nesting: children of tabs/container/modal blocks carry parentBlock_Id (+ slot) and lay out in a
  nested 12-col grid inside the parent; position is relative to the parent slot. Max depth 3;
  the parent must be a container type on the same page. Deleting a parent cascades to children.
- Authenticated pages render at \`/pages/?slug=<slug>\`; public pages at \`/p/?slug=<slug>\`.

## Grid contract

12-column grid. \`position = { row, col, span }\`: row >= 0; 0 <= col <= 11; 1 <= span <= 12.
Rows stack vertically; blocks within a row share the 12 columns; no overlap. Mobile collapses to stacked.

## Common config envelope

Every config may carry: \`title?\`, \`description?\`,
\`size? { height?, minHeight?, maxHeight?, minWidth?, maxWidth?, innerScroll? }\` (px),
\`density?: "compact"|"default"|"spacious"\`,
\`appearance? { background?, borderColor?, borderWidth?, borderRadius?, shadow?, padding?, hideCard?, titleAlign?, titleSize?, titleColor?, accent? }\`
(object; styled chrome/theming applied to every block type, per the "Appearance" settings group served in block manifests).
Data blocks may also carry \`realtime?: true\` (socket push / 10s poll fallback) and
\`inlineFilters?: [{ field, operator?, label? }]\` (table/cardlist).

## Filter DSL

Every \`filter\` value anywhere in a config uses the items-API filter DSL, shaped as
\`{"field": {"op": value}}\`, e.g. \`{"status":{"eq":"open"},"total":{"gt":100}}\`. The editor's own
filter block (and this doc's block configs) stick to the core comparison set — \`eq, ne, icontains\`
(case-insensitive text contains), \`gt, gte, lt, lte, in\`, plus \`isNull\`/\`isNotNull\` for matching or
excluding empty values; the full items-API/permission-condition operator set (\`like, iLike,
between, arraycontains, arrayoverlap, jsonbContains, dwithin\`, and the other JSONB/geo/vector operators) is also
accepted server-side wherever a \`filter\` value is read directly by ItemsService, plus dynamic
variables \`$CURRENT_USER\`, \`$CURRENT_TENANT\`, \`$NOW±DAYS_N\`. Combine several conditions with an \`"AND"\` or \`"OR"\` array of these same rules — the
keys must be UPPERCASE (lowercase \`"and"\`/\`"or"\` is ignored).
A data-block filter value may also be one of these runtime placeholders (master-detail wiring):
- \`"$param.<name>"\` — resolved from the page URL's query params.
- \`"$selection.<blockId>.<fieldPath>"\` — the record last clicked in the sibling data block with
  that id (table row / cardlist-kanban card / calendar event / map marker). Dotted field paths ok.
- \`"$input.<name>"\` — an input block's current value (see input block).
While a referenced param/selection is absent the condition is stripped and the block shows a
"Select a record" state instead of querying unfiltered; unset non-required inputs strip silently.

## Expressions

Most manifest-driven config fields (text, number, boolean, select, json, markdown) accept a
\`{{ expr }}\` string in place of a literal value: a single JavaScript expression (no statements)
evaluated client-side against a context object:
- \`param\` — the page URL's query params.
- \`input\` — page input values by input block \`name\`.
- \`selection\` — selected record by block id: \`selection.<blockId>.<field>\`.
- \`user\` — \`{ id, firstName, lastName, fullName, email, roleName }\`, best-effort; \`null\` on public pages
  (use optional chaining, e.g. \`{{ user?.firstName }}\`, in any expression that may run on a public page).
- \`now\` — a \`Date\`.
Typing rule: a config value that is ENTIRELY one \`{{ expr }}\` run (nothing before/after, once
trimmed) returns the expression's raw typed result — so a number/boolean/select/json field can
hold a real number/boolean/option-value/object. A value with any surrounding or interposed text
(e.g. \`"Hi {{ user.firstName }}"\`) interpolates each \`{{ }}\` run as a string and concatenates —
always yielding a string. Errors and undefined results resolve to \`undefined\`, so the field falls
back to its normal empty/default handling — an expression can never crash a block.
Same trust model as \`compute\` field-entry expressions: admin-authored, evaluated unsandboxed in
the viewer's browser. Do not put user-provided strings in an expression.
Expressions are FORBIDDEN (rejected server-side) in: any color value (appearance colors,
format-rule \`style\` colors, theme tokens), the \`format-rules\` field itself, and
field-picker/collection-picker fields — those must always be literal.
In filter DSL values, \`{{ }}\` expressions work alongside the existing \`$param\`/\`$input\`/\`$selection\`
placeholders described above.
The in-place UI editor exposes this as an \`fx\` toggle next to eligible fields (text, number,
boolean, select, json, markdown), swapping the native control for a raw expression textarea.

## Aggregates

An aggregate reduces a set of rows down to one number, shaped as \`{"function": ..., "field": ...}\`.
Choose a \`function\` — \`count, sum, avg, min, max\` — and the \`field\` it should measure. \`count\` is
the one exception: it doesn't need a real field, so \`field: "*"\` just counts matching rows. Add an
optional \`filter\` (see Filter DSL) to narrow down which rows get counted or measured before the
function runs, e.g. only "open" orders instead of every order. Used by the \`aggregate\`/\`sparkline\`
custom-slot fields (stat tiles, comparison, leaderboard) and by chart's \`aggregate\` map and
progress's \`aggregate\`/\`target\`.
Example: sum of total → \`{"function":"sum","field":"total"}\`

## Record sources

Record-bound blocks (details, form mode:"edit", code with recordField, and the \`record-source\`
custom-slot fields on badge/carousel/image/keyvalue/pdf/rating/steps/video) take their record id
from \`source\`: \`{type:"param"}\` (default; the ?id= URL param — legacy string "route-param" still
accepted) or \`{type:"block", blockId}\` — following the selection published by a sibling
table/cardlist/kanban/calendar/map block when the user clicks a row/card/event/marker. Use the URL
form for links you share or bookmark, and the sibling-block form for master/detail layouts.

## Block types

Types REQUIRING a collection: table, details, kanban, calendar, chart, cardlist, map, geochart,
media, feed, filter, timeline, progress, repeater, report.
Collectionless types: markdown, buttons, iframe, upload, tabs, container, modal, divider, input.
\`code\` and \`richtext\` take an OPTIONAL collection (required only when \`recordField\` is set);
\`widget\` also takes an optional collection (data binding for \`window.Baasix.onData\`).
\`form\` takes an OPTIONAL collection: required when \`target\` is absent/\`"collection"\`, not used
when \`target\` is \`"workflow"\` — see \`### form\`.
All field names referenced in a config MUST exist on the bound collection (validated server-side).

### table
\`columns: [{ field, label?, width?, format? }]\`, \`filter?\`, \`sort?\`, \`pageSize?\`,
\`actions? { create?, edit?, delete?, view? }\` (boolean | "auto"), \`search?: bool\`, \`inlineEdit?: bool\`,
\`bulkEdit?\`, \`bulkDelete?\`, \`advancedFilter?: bool\`, \`sheetTitle?\`, \`headerActions?\`, \`rowActions?\`.

### form
\`target?: "collection"|"workflow"\` (default \`"collection"\`; omitted = today's byte-identical
behavior). Collection is REQUIRED when target is \`"collection"\` (or absent); collection is
NOT used/required when target is \`"workflow"\`.

**Collection mode** (\`target\` absent or \`"collection"\`):
\`mode: "create"|"edit"\`,
\`fields: [{ field, label?, required?, defaultValue?, hidden?, visibleWhen?, widget?, widgetOptions? }]\`
OR \`steps: [{ title, description?, fields: [entry…] }]\` (wizard: back/next + per-step required
validation, single submit on the last step — mutually exclusive with the flat \`fields\`).
Field entry extras:
- \`visibleWhen: { field, operator: "eq"|"neq"|"in"|"notEmpty"|"empty", value? }\` — show the field
  only while the condition on another field's live value holds; hidden fields don't submit.
- \`widget: "rating"|"slider"|"color"|"phone"|"currency"|"signature"\` +
  \`widgetOptions { min?, max?, step?, currency?, maxRating? }\` — input override
  (rating/slider→Integer-ish, color/phone→String, currency→numeric, signature→String/Text PNG data-url).
\`submitLabel?\`, \`successMessage?\`, \`redirectPageSlug?\`, \`humanCheck?: bool\`,
\`source?\` (edit mode: where the record id comes from; see Record sources).
\`workflowId\` and \`customFields\` are REJECTED in this mode.

**Workflow mode** (\`target: "workflow"\`): submits to a workflow trigger instead of a collection
record — \`fields\` (collection-mode) is REJECTED; use \`customFields\` instead.
- \`workflowId\` (required, non-empty string) — the target workflow.
- \`customFields\` (required, non-empty array) — \`{ name: "^[a-zA-Z][a-zA-Z0-9_]*$" (unique within
  the array), type: <same union as input block's inputType>, required?, label?, ...same
  min/max/step/minLength/maxLength/pattern knobs and coherence rules as the input block (see
  \`### input\`) }\`.
- \`steps?\` still applies for a wizarded workflow form; each step's \`fields[].field\` must
  reference a \`customFields\` name (not a collection field, since there is no collection).
- \`submitLabel?\`, \`successMessage?\`, \`redirectPageSlug?\`, \`humanCheck?: bool\` all still apply.
- Trigger payload shape: \`{ form: { <customFields name>: <value>, ... }, page: <slug>, blockId }\`.
- **Authenticated vs. public**: on an authenticated page the client calls
  \`baasixClient.workflows.execute(workflowId, payload)\` directly. On a public page (\`/p/?slug=\`,
  anonymous session) there is no authenticated API call available, so the client instead POSTs the
  payload to the workflow's own stored \`webhookPath\`/\`webhookMethod\` (configured on the workflow,
  not on this block). If the workflow has no webhook configured, the form's submit button is
  disabled with an explanatory message — it never fires a POST that would 404.

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
\`clickInput?\` (identifier \`^[A-Za-z][A-Za-z0-9_]*$\`; cartesian bar/line/area + pie/doughnut only —
on click, publishes \`"$input.<clickInput>"\` with the clicked category; clicking it again clears it).

### cardlist
\`titleField\` (required), \`subtitleField?\`, \`imageField?\` (file UUID field), \`fields?: []\`,
\`columns?: 1-6\`, \`filter?\`, \`sort?\`, \`pageSize?\`, \`itemAction?: BlockAction\`, \`sheetTitle?\`, \`advancedFilter?\`.

### map
\`geometryField\` (required; GeoJSON/WKT), \`titleField?\`, \`popupFields?: []\`, \`defaultCenter?\`,
\`defaultZoom?\`, \`filter?\`, \`clusterMarkers?: bool\`, \`colorField?\`, \`colorMap? { value: cssColor }\`,
\`itemAction?: BlockAction\`, \`provider?: "leaflet"|"google"\` (default leaflet; google needs a Maps JS API key saved in project
settings as \`metadata.googleMapsApiKey\` — without one the block falls back to leaflet).

### geochart
\`regionField\` (required; values are ISO 3166-1 alpha-2 "IN", alpha-3 "IND" or country names, case-insensitive),
\`aggregate?: "count"|"sum"|"avg"|"min"|"max"\` (default count), \`valueField?\` (numeric; REQUIRED when aggregate != count),
\`region?: "world"\` (only "world" accepted), \`filter?\`. Renders a choropleth world map.
\`clickInput?\` (identifier \`^[A-Za-z][A-Za-z0-9_]*$\`; on country click, publishes
\`"$input.<clickInput>"\` with the clicked region's raw \`regionField\` value; clicking it again clears it).

### input
\`inputType: "text"|"textarea"|"number"|"decimal"|"email"|"url"|"password"|"tel"|"select"|"date"|"toggle"\`
(required), \`name\` (required, \`^[a-zA-Z][a-zA-Z0-9_]*$\`,
unique per page — filters reference \`"$input.<name>"\`), \`label?\`,
\`options?: [{label, value}] | {collection, valueField, labelField}\` (select only),
\`defaultValue?\`, \`debounceMs?\` (text; default 300), \`required?: bool\` (unset value blocks
consumers instead of stripping their condition). No collection.
Knob coherence (server-validated at save time): \`min?/max?/step?\` are only valid when
\`inputType\` is \`"number"\` or \`"decimal"\` (\`number\` additionally requires \`step\` to be a whole
number, default 1; \`min\` must not exceed \`max\`); \`minLength?/maxLength?/pattern?\` are only valid
on text-ish types — text, textarea, email, url, password, tel. \`email\`/\`url\` also run a
built-in format check on top of any \`pattern\`. An invalid value at runtime shows an inline error,
publishes nothing, and clears any previously-published value for that input.

### tabs
\`tabs: [{ label, icon? }]\` (required, non-empty; icon = lucide name). Child blocks carry
\`parentBlock_Id = <this block>\` and \`slot: "tab:<index>"\`. Panels mount lazily. No collection.

### container
\`variant?: "card"|"plain"\` (default card), \`collapsible?: bool\`, \`defaultCollapsed?: bool\`.
Children use slot \`"body"\` (or omit slot). No collection.

### modal
\`width?: "sm"|"md"|"lg"|"xl"\` (default lg), \`title?\`. Hidden at rest; opened by a
\`{type:"modal", blockId}\` action from a buttons block or a data block's header/row actions.
Children use slot \`"body"\`. No collection.

### timeline
\`timestampField\` (required, Date/DateTime), \`titleField\` (required), \`descriptionField?\`,
\`iconField?\` (values are lucide icon names), \`colorField?\` (CSS-color values tint the dot),
\`groupByDay?: bool\` (default true), \`sort?: "asc"|"desc"\` (default desc), \`pageSize?\` (default 20,
"Load more" appends), \`filter?\`, \`itemAction?: BlockAction\`. Vertical event timeline.

### progress
\`aggregate: {function, field}\` (required; "*" allowed for count) — the current value.
\`target: number | {function, field, filter?} | string\` (required) — fixed goal, a second aggregate
(e.g. value = count of done tasks, target = count of all tasks), or a \`{{ expression }}\` string resolving to a number.
\`variant?: "bar"|"radial"\` (default bar), \`label?\`, \`format? {prefix?, suffix?, decimals?}\`,
\`thresholds?: [{upTo, color}]\` (percent-based color), \`filter?\`.

### repeater
\`template\` (required; markdown rendered once per record, \`{{fieldPath}}\` placeholders interpolate
HTML-escaped values, dotted paths ok — placeholders are NOT schema-validated), \`columns?: 1-6\`,
\`pageSize?\`, \`sort?\`, \`filter?\`, \`itemAction?: BlockAction\`, \`emptyText?\`.

### richtext
\`content?\` (HTML string authored with the @baasix/lexical editor) or \`recordField?\` (dotted ok;
renders that field's HTML from a live record — collection REQUIRED when set; \`source?\` picks the
record like the code block). Output is sanitized before render.

### report
\`query\` (required): ItemsService query passed to \`/reports/:collection\` —
\`{ fields? (dotted relations ok), aggregate? {alias: {function, field}}, groupBy? (supports
"date:" virtual buckets like "date:month:createdAt"), sort?, limit? }\`.
\`columns?: [{field, label?}]\` (absent = first result row's keys), \`filter?\` (merged into
query.filter; $param/$selection/$input aware), \`pageSize?\` (client-side pagination).
Read-only aggregate table — no row actions/selection; header \`export-csv\` downloads the result set.

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
\`fileField?\` (attachments), \`itemAction?: BlockAction\`, \`highlightOwn?/allowEditOwn?/allowDeleteOwn?\` (default true).

### upload
\`accept?\` (file-input accept attr), \`maxSizeMB?\`, \`multiple?: bool\`, \`folder?\`,
\`name?\` (\`^[a-zA-Z][a-zA-Z0-9_]*$\`; when set, publishes the server-confirmed created file id as
\`"$input.<name>"\` — a string, or string[] when \`multiple\`, for sibling blocks to filter on;
clearing the uploaded file(s) clears the input. Omitted = today's byte-identical behavior).
No collection.

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
- \`modal { blockId }\` — opens the modal block with that id on the same page
- \`export-csv\` (header actions only)
Used by buttons \`items\`, data-block \`headerActions\`, table/cardlist \`rowActions\`, kanban \`cardActions\`,
and the single-action keys \`cardAction\`/\`itemAction\`/\`eventAction\`.
When a data block's click-action key (\`itemAction\` on tree/leaderboard/avatar/map/feed, \`action\` per-tile on stat)
runs an action, the record selection is still published for consumption by sibling blocks.

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

import { listManifests } from "../blocks/registry.js";
import type { BlockManifest, SettingsField } from "../blocks/manifest-types.js";

/** Shape hint appended for a `custom` field, keyed by its editor slot (see slots/bootstrap.ts). */
const CUSTOM_SLOT_SHAPES: Record<string, string> = {
  aggregate: '{function, field, filter?} — see Aggregates',
  sparkline: '{function, field, filter?} — see Aggregates',
  "record-source": '{type:"param"} | {type:"block", blockId} — see Record source',
  "format-rules-value": "FormatRule[]",
  "single-action": "BlockAction (see Actions)",
};

function fieldLine(f: SettingsField, indent = ""): string {
  const bits: string[] = [f.kind === "list" ? `\`${f.key} (list)\`` : `\`${f.key}\``];
  if (f.kind === "custom") {
    const slot = (f as any).slot;
    bits.push(`custom: ${slot}`);
    const shape = CUSTOM_SLOT_SHAPES[slot];
    if (shape) bits.push(shape);
  } else if (f.kind !== "list") {
    bits.push(f.kind);
  }
  if (f.required) bits.push("**required**");
  if (f.kind === "select") bits.push(`one of: ${(f as any).options.map((o: any) => o.value).join(", ")}`);
  if (f.kind === "number") {
    const { min, max, integer } = f as any;
    if (integer) bits.push("integer");
    if (min != null) bits.push(`min ${min}`);
    if (max != null) bits.push(`max ${max}`);
  }
  if (f.kind === "text" && (f as any).pattern) bits.push(`pattern \`${(f as any).pattern}\``);
  if (f.kind === "list") {
    const min = (f as any).minItems, max = (f as any).maxItems;
    if (min != null) bits.push(`min ${min}`);
    if (max != null) bits.push(`max ${max}`);
  }
  if (f.help) bits.push(`— ${f.help}`);
  const lines = [`${indent}- ${bits.join(" · ")}`];
  if (f.kind === "list") {
    for (const item of (f as any).item as SettingsField[]) lines.push(fieldLine(item, `${indent}  `));
  }
  return lines.join("\n");
}

function manifestSection(m: BlockManifest): string {
  const collection =
    m.needsCollection === true ? "Requires a collection."
    : m.needsCollection === "optional" ? "Collection optional."
    : "No collection.";
  const fields = m.settings.flatMap((g) => g.fields);
  return [`### ${m.type}`, "", `${m.description} ${collection}`, "", ...fields.map((f) => fieldLine(f)), ""].join("\n");
}

export function getBlockConfigDoc(): string {
  const manifestTypes = listManifests().filter((m) => m.settingsMode === "manifest");
  const generated = [
    "## Manifest-defined block types",
    "",
    "These types are validated from their manifest; the common envelope (`title`, `size`, `density`, `appearance`) applies to all.",
    "",
    ...manifestTypes.map(manifestSection),
  ].join("\n");
  return `${BLOCK_CONFIG_DOC}\n\n${generated}`;
}
