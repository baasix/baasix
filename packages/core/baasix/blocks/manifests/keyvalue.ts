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
      { key: "fields", label: "Fields", kind: "list", minItems: 1, help: "The record fields shown, one row each, in order.", item: [
        { key: "field", label: "Field", kind: "field-picker", required: true, help: "Record field whose value is shown as this row." },
        { key: "label", label: "Label", kind: "text", help: "Row label shown instead of the field's default name." },
      ] },
      { key: "columns", label: "Columns", kind: "number", min: 1, max: 3, integer: true, default: 2, help: "How many label/value pairs are shown per row." },
      { key: "source", label: "Record source", kind: "custom", slot: "record-source", help: "Which record on the page supplies the fields above." },
      { key: "formatting", label: "Format rules", kind: "format-rules", help: "Color or highlight a row's value when it meets a condition." },
    ] },
  ],
  defaults: { columns: 2 },
  configVersion: 1,
};

export default manifest;
