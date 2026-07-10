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
      { key: "groupField", label: "Group field", kind: "field-picker", required: true },
      { key: "metric", label: "Metric", kind: "custom", slot: "aggregate" },
      { key: "filter", label: "Filter", kind: "filter-dsl" },
      { key: "limit", label: "Limit", kind: "number", min: 3, max: 25, integer: true, default: 10 },
      { key: "labelPrefix", label: "Label prefix", kind: "text" },
      { key: "formatting", label: "Format rules", kind: "format-rules" },
    ] },
  ],
  defaults: { limit: 10 },
  configVersion: 1,
};

export default manifest;
