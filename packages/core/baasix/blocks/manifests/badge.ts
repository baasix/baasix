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
      ], default: "record", help: "Bound record: one badge for the current record. Distinct: one badge per unique value, with a count." },
      { key: "field", label: "Field", kind: "field-picker", required: true, help: "Field whose value picks the badge's color and text." },
      { key: "source", label: "Record source", kind: "custom", slot: "record-source", showIf: { field: "mode", equals: "record" }, help: "Which record on the page supplies the field above." },
      { key: "colorMap", label: "Colors", kind: "list", help: "Maps each field value to a badge color and optional display label.", item: [
        { key: "value", label: "Value", kind: "text", required: true, help: "Raw field value to match, e.g. open." },
        { key: "color", label: "Color", kind: "color", required: true, help: "Badge color for this value — a theme token (e.g. primary) or hex (#22c55e)." },
        { key: "label", label: "Display label", kind: "text", help: "Text shown on the badge instead of the raw value." },
      ] },
    ] },
  ],
  defaults: { mode: "record" },
  configVersion: 2,
};

export default manifest;
