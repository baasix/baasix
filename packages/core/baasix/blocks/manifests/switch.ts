import type { BlockManifest } from "../manifest-types.js";

const manifest: BlockManifest = {
  type: "switch",
  label: "Switch",
  description: "Toggle or segmented control publishing $input.<name>.",
  icon: "toggle-left",
  category: "input",
  needsCollection: false,
  settingsMode: "manifest",
  settings: [
    { key: "general", label: "General", fields: [
      { key: "name", label: "Input name", kind: "text", required: true, pattern: "^[a-zA-Z][a-zA-Z0-9_]*$" },
      { key: "label", label: "Label", kind: "text" },
      { key: "variant", label: "Variant", kind: "select", options: [
        { label: "Toggle (boolean)", value: "toggle" }, { label: "Segmented (options)", value: "segmented" },
      ], default: "toggle" },
      { key: "options", label: "Options", kind: "list", showIf: { field: "variant", equals: "segmented" }, item: [
        { key: "label", label: "Label", kind: "text", required: true },
        { key: "value", label: "Value", kind: "text", required: true },
      ] },
    ] },
  ],
  defaults: { variant: "toggle" },
  configVersion: 1,
};

export default manifest;
