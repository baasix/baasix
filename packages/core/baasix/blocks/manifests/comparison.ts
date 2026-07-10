import type { BlockManifest } from "../manifest-types.js";

const manifest: BlockManifest = {
  type: "comparison",
  label: "Comparison",
  description: "Side-by-side comparison of two aggregated metrics.",
  icon: "git-compare",
  category: "display",
  needsCollection: true,
  settingsMode: "manifest",
  settings: [
    { key: "left", label: "Left value", fields: [
      { key: "leftLabel", label: "Label", kind: "text", required: true },
      { key: "leftAggregate", label: "Aggregate", kind: "custom", slot: "aggregate" },
      { key: "leftFilter", label: "Filter", kind: "filter-dsl" },
    ] },
    { key: "right", label: "Right value", fields: [
      { key: "rightLabel", label: "Label", kind: "text", required: true },
      { key: "rightAggregate", label: "Aggregate", kind: "custom", slot: "aggregate" },
      { key: "rightFilter", label: "Filter", kind: "filter-dsl" },
    ] },
    { key: "format", label: "Format", fields: [
      { key: "format", label: "Format", kind: "select", options: [
        { label: "Number", value: "number" }, { label: "Currency", value: "currency" }, { label: "Percent", value: "percent" },
      ] },
      { key: "prefix", label: "Prefix", kind: "text" },
      { key: "suffix", label: "Suffix", kind: "text" },
      { key: "formatting", label: "Format rules", kind: "format-rules" },
    ] },
  ],
  defaults: {},
  configVersion: 1,
};

export default manifest;
