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
      { key: "tiles", label: "Tiles", kind: "list", minItems: 1, maxItems: 6, help: "One entry per KPI tile, up to 6.", item: [
        { key: "label", label: "Label", kind: "text", required: true, help: "Title shown above the number on this tile." },
        { key: "aggregate", label: "Aggregate", kind: "custom", slot: "aggregate", help: "The number this tile shows — a count or a sum/avg/min/max of a field." },
        { key: "filter", label: "Filter", kind: "filter-dsl", help: "Only records matching this filter are included in the aggregate." },
        { key: "compareFilter", label: "Compare against (filter)", kind: "filter-dsl", help: "Second row set to compare against — the delta badge shows the change vs. this filter's aggregate." },
        { key: "format", label: "Format", kind: "select", options: [
          { label: "Number", value: "number" }, { label: "Currency", value: "currency" }, { label: "Percent", value: "percent" },
        ], help: "How the number is displayed, e.g. Currency adds a currency symbol." },
        { key: "prefix", label: "Prefix", kind: "text", help: "Text shown before the number, e.g. $." },
        { key: "suffix", label: "Suffix", kind: "text", help: "Text shown after the number, e.g. units or %." },
        { key: "sparkline", label: "Sparkline", kind: "custom", slot: "sparkline", help: "Small trend line drawn behind the number, based on the same aggregate over time." },
        { key: "formatting", label: "Value formatting", kind: "custom", slot: "format-rules-value", help: "Color or highlight the number when it meets a condition, e.g. red when over 100." },
        { key: "action", label: "On tile click", kind: "custom", slot: "single-action", help: "Action to run when this tile is clicked, e.g. navigate to a filtered list." },
      ] },
      { key: "columns", label: "Columns", kind: "number", min: 1, max: 4, integer: true, help: "How many tiles are shown per row." },
    ] },
  ],
  defaults: { tiles: [] },
  configVersion: 2,
};

export default manifest;
