import type { BlockManifest } from "../manifest-types.js";

const manifest: BlockManifest = {
  type: "keyvalue",
  label: "Key-value pairs",
  description: "Display record fields as labeled rows.",
  icon: "rows-3",
  category: "display",
  needsCollection: true,
  settingsMode: "manifest",
  settings: [
    { key: "fields", label: "Fields", fields: [
      { key: "fields", label: "Fields", kind: "list", minItems: 1, item: [
        { key: "field", label: "Field", kind: "field-picker", required: true },
        { key: "label", label: "Label", kind: "text" },
      ] },
      { key: "columns", label: "Columns", kind: "number", min: 1, max: 3, integer: true, default: 2 },
      { key: "source", label: "Record source", kind: "custom", slot: "record-source" },
      { key: "formatting", label: "Format rules", kind: "format-rules" },
    ] },
  ],
  defaults: { columns: 2 },
  configVersion: 1,
};

export default manifest;
