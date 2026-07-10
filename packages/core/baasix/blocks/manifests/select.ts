import type { BlockManifest } from "../manifest-types.js";

const manifest: BlockManifest = {
  type: "select",
  label: "Select",
  description: "Dropdown that filters sibling blocks via $input.<name>.",
  icon: "chevrons-up-down",
  category: "input",
  needsCollection: "optional",
  settingsMode: "manifest",
  settings: [
    { key: "general", label: "General", fields: [
      { key: "name", label: "Input name", kind: "text", required: true, pattern: "^[a-zA-Z][a-zA-Z0-9_]*$", help: "Reference as $input.<name> in sibling block filters." },
      { key: "label", label: "Label", kind: "text" },
      { key: "placeholder", label: "Placeholder", kind: "text" },
      { key: "multiple", label: "Multiple selection", kind: "boolean" },
      { key: "required", label: "Required", kind: "boolean", help: "Consumers stay disabled until a value is chosen." },
    ] },
    { key: "options", label: "Options", fields: [
      { key: "optionsSource", label: "Options source", kind: "select", options: [
        { label: "Static list", value: "static" }, { label: "Collection", value: "collection" },
      ], default: "static" },
      { key: "options", label: "Options", kind: "list", showIf: { field: "optionsSource", equals: "static" }, item: [
        { key: "label", label: "Label", kind: "text", required: true },
        { key: "value", label: "Value", kind: "text", required: true },
      ] },
      { key: "labelField", label: "Label field", kind: "field-picker", showIf: { field: "optionsSource", equals: "collection" } },
      { key: "valueField", label: "Value field", kind: "field-picker", showIf: { field: "optionsSource", equals: "collection" }, help: "Defaults to id." },
    ] },
  ],
  defaults: { optionsSource: "static" },
  configVersion: 1,
};

export default manifest;
