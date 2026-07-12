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
      { key: "leftLabel", label: "Label", kind: "text", required: true, help: "Title shown above the left-hand number." },
      { key: "leftAggregate", label: "Aggregate", kind: "custom", slot: "aggregate", help: "The number shown on the left — a count or a sum/avg/min/max of a field." },
      { key: "leftFilter", label: "Filter", kind: "filter-dsl", help: "Only records matching this filter are included in the left aggregate." },
    ] },
    { key: "right", label: "Right value", fields: [
      { key: "rightLabel", label: "Label", kind: "text", required: true, help: "Title shown above the right-hand number." },
      { key: "rightAggregate", label: "Aggregate", kind: "custom", slot: "aggregate", help: "The number shown on the right — a count or a sum/avg/min/max of a field." },
      { key: "rightFilter", label: "Filter", kind: "filter-dsl", help: "Only records matching this filter are included in the right aggregate." },
    ] },
    { key: "format", label: "Format", fields: [
      { key: "format", label: "Format", kind: "select", options: [
        { label: "Number", value: "number" }, { label: "Currency", value: "currency" }, { label: "Percent", value: "percent" },
      ], help: "How both numbers are displayed, e.g. Currency adds a currency symbol." },
      { key: "prefix", label: "Prefix", kind: "text", help: "Text shown before both numbers, e.g. $." },
      { key: "suffix", label: "Suffix", kind: "text", help: "Text shown after both numbers, e.g. units or %." },
      { key: "formatting", label: "Format rules", kind: "custom", slot: "format-rules-value", help: "Color or highlight either number when it meets a condition." },
    ] },
  ],
  defaults: {},
  configVersion: 1,
};

export default manifest;
