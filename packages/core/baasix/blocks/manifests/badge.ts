import type { BlockManifest } from "../manifest-types.js";

const manifest: BlockManifest = {
  type: "badge",
  label: "Badges",
  description: "Record field values as colored chips via a value→color map.",
  icon: "tags",
  category: "display",
  needsCollection: true,
  settingsMode: "manifest",
  settings: [
    { key: "general", label: "General", fields: [
      { key: "mode", label: "Mode", kind: "select", options: [
        { label: "Bound record", value: "record" }, { label: "Distinct values (counts)", value: "distinct" },
      ], default: "record" },
      { key: "field", label: "Field", kind: "field-picker", required: true },
      { key: "source", label: "Record source", kind: "custom", slot: "record-source", showIf: { field: "mode", equals: "record" } },
      { key: "colorMap", label: "Colors", kind: "list", item: [
        { key: "value", label: "Value", kind: "text", required: true },
        { key: "color", label: "Color", kind: "color", required: true },
        { key: "label", label: "Display label", kind: "text" },
      ] },
    ] },
  ],
  defaults: { mode: "record" },
  configVersion: 2,
};

export default manifest;
