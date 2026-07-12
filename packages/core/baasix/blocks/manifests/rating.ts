import type { BlockManifest } from "../manifest-types.js";

const manifest: BlockManifest = {
  type: "rating",
  label: "Rating",
  description: "Star rating — an input publishing $input.<name>, or a record-bound display.",
  icon: "star",
  category: "input",
  needsCollection: "optional",
  settingsMode: "manifest",
  settings: [
    { key: "general", label: "General", fields: [
      { key: "mode", label: "Mode", kind: "select", options: [
        { label: "Input", value: "input" }, { label: "Record display", value: "display" },
      ], default: "input", help: "Input lets visitors pick a rating; record display shows a stored value read-only." },
      { key: "name", label: "Input name", kind: "text", pattern: "^[a-zA-Z][a-zA-Z0-9_]*$", showIf: { field: "mode", equals: "input" }, help: "Reference as $input.<name> in sibling block filters." },
      { key: "label", label: "Label", kind: "text", help: "Text shown above the stars." },
      { key: "max", label: "Stars", kind: "number", min: 2, max: 10, integer: true, default: 5, help: "Number of stars shown, from 2 to 10." },
      { key: "field", label: "Value field", kind: "field-picker", showIf: { field: "mode", equals: "display" }, help: "Numeric field on the bound record." },
      { key: "source", label: "Record source", kind: "custom", slot: "record-source", showIf: { field: "mode", equals: "display" }, help: "Which record on the page supplies the value field above." },
    ] },
  ],
  defaults: { mode: "input", max: 5 },
  configVersion: 1,
};

export default manifest;
