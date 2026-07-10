import type { BlockManifest, BlockCategory } from "../manifest-types.js";

function legacy(
  type: string,
  label: string,
  description: string,
  icon: string,
  category: BlockCategory,
  needsCollection: boolean | "optional"
): BlockManifest {
  return { type, label, description, icon, category, needsCollection, settingsMode: "legacy", settings: [], defaults: {}, configVersion: 1 };
}

export const LEGACY_MANIFESTS: BlockManifest[] = [
  legacy("table", "Table", "Paginated data table with filters, sorting, search, and row/bulk actions.", "table", "data", true),
  legacy("form", "Form", "Create or edit a record with per-field widgets and wizard steps.", "clipboard-list", "data", true),
  legacy("details", "Details", "Read-only field list for a single record.", "list", "data", true),
  legacy("kanban", "Kanban", "Drag-and-drop board grouped by a field.", "trello", "data", true),
  legacy("calendar", "Calendar", "Month/week/day event calendar from date fields.", "calendar", "data", true),
  legacy("chart", "Chart", "Bar, line, pie, and more with server-side aggregation.", "bar-chart-3", "data", true),
  legacy("geochart", "Geo chart", "World map shaded by an aggregate per country.", "globe-2", "data", true),
  legacy("cardlist", "Card list", "Card grid with title, subtitle, image, and actions.", "layout-grid", "data", true),
  legacy("map", "Map", "Markers on a map from a geometry field.", "map", "data", true),
  legacy("media", "Media gallery", "Image/video/audio gallery from a file field.", "image", "data", true),
  legacy("feed", "Feed", "Chat or activity stream with composer and attachments.", "messages-square", "data", true),
  legacy("timeline", "Timeline", "Chronological entries with icons and day grouping.", "history", "data", true),
  legacy("progress", "Progress", "Bar or radial gauge: aggregate value vs. a target.", "gauge", "data", true),
  legacy("repeater", "Repeater", "Markdown template rendered once per record.", "repeat", "data", true),
  legacy("report", "Report", "Read-only aggregate table from the reports endpoint.", "file-bar-chart", "data", true),
  legacy("filter", "Filter bar", "Filter controls that drive sibling data blocks.", "filter", "input", true),
  legacy("input", "Input", "Standalone input publishing a value for sibling filters.", "text-cursor", "input", false),
  legacy("buttons", "Buttons", "Row of action buttons.", "mouse-pointer-click", "input", false),
  legacy("upload", "Upload", "Standalone file-upload widget.", "upload", "input", false),
  legacy("code", "Code", "JSON/code viewer, static or record-bound.", "code-2", "content", "optional"),
  legacy("richtext", "Rich text", "Formatted HTML content, static or record-bound.", "type", "content", "optional"),
  legacy("tabs", "Tabs", "Tab strip containing child blocks per tab.", "panels-top-left", "layout", false),
  legacy("container", "Container", "Card or plain group of child blocks, collapsible.", "box", "layout", false),
  legacy("modal", "Modal", "Dialog of child blocks opened by an action.", "app-window", "layout", false),
];
