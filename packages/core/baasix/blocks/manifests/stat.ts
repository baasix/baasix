import type { BlockManifest } from "../manifest-types.js";

const manifest: BlockManifest = {
  type: "stat",
  label: "Stat tiles",
  description: "KPI tiles: an aggregate per tile with optional comparison delta.",
  icon: "trending-up",
  category: "display",
  needsCollection: true,
  settingsMode: "manifest",
  settings: [
    { key: "tiles", label: "Tiles", fields: [
      { key: "tiles", label: "Tiles", kind: "list", minItems: 1, maxItems: 6, item: [
        { key: "label", label: "Label", kind: "text", required: true },
        { key: "aggregate", label: "Aggregate", kind: "custom", slot: "aggregate" },
        { key: "filter", label: "Filter", kind: "filter-dsl" },
        { key: "compareFilter", label: "Compare against (filter)", kind: "filter-dsl" },
        { key: "format", label: "Format", kind: "select", options: [
          { label: "Number", value: "number" }, { label: "Currency", value: "currency" }, { label: "Percent", value: "percent" },
        ] },
        { key: "prefix", label: "Prefix", kind: "text" },
        { key: "suffix", label: "Suffix", kind: "text" },
        { key: "sparkline", label: "Sparkline", kind: "custom", slot: "sparkline" },
      ] },
      { key: "columns", label: "Columns", kind: "number", min: 1, max: 4, integer: true },
    ] },
  ],
  defaults: { tiles: [] },
  configVersion: 2,
};

export default manifest;
