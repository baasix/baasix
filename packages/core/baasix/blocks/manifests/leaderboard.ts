import type { BlockManifest } from "../manifest-types.js";

const manifest: BlockManifest = {
  type: "leaderboard",
  label: "Leaderboard",
  description: "Ranked list of grouped records with a metric per group.",
  icon: "trophy",
  category: "display",
  needsCollection: true,
  settingsMode: "manifest",
  settings: [
    { key: "general", label: "General", fields: [
      { key: "groupField", label: "Group field", kind: "field-picker", required: true, help: "Field records are grouped by — one leaderboard row per unique value." },
      { key: "metric", label: "Metric", kind: "custom", slot: "aggregate", help: "The number each group is ranked by — a count or a sum/avg/min/max of a field." },
      { key: "filter", label: "Filter", kind: "filter-dsl", help: "Only records matching this filter are included before grouping." },
      { key: "limit", label: "Limit", kind: "number", min: 3, max: 25, integer: true, default: 10, help: "Maximum number of ranked rows shown." },
      { key: "labelPrefix", label: "Label prefix", kind: "text", help: "Text shown before each group's rank, e.g. #." },
      { key: "formatting", label: "Format rules", kind: "custom", slot: "format-rules-value", help: "Color or highlight a row's metric when it meets a condition." },
      { key: "itemAction", label: "On item click", kind: "custom", slot: "single-action", help: "Runs when a row is clicked." },
    ] },
  ],
  defaults: { limit: 10 },
  configVersion: 1,
};

export default manifest;
