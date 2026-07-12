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
      { key: "label", label: "Label", kind: "text", help: "Text shown above the dropdown." },
      { key: "placeholder", label: "Placeholder", kind: "text", help: "Hint text shown before a value is chosen, e.g. Select a status." },
      { key: "multiple", label: "Multiple selection", kind: "boolean", help: "Lets admins pick more than one option; $input.<name> becomes a list." },
      { key: "required", label: "Required", kind: "boolean", help: "Consumers stay disabled until a value is chosen." },
    ] },
    { key: "options", label: "Options", fields: [
      { key: "optionsSource", label: "Options source", kind: "select", options: [
        { label: "Static list", value: "static" }, { label: "Collection", value: "collection" },
      ], default: "static", help: "Static: type the choices yourself. Collection: pull choices from a collection's records." },
      { key: "options", label: "Options", kind: "list", showIf: { field: "optionsSource", equals: "static" }, help: "The choices shown in the dropdown.", item: [
        { key: "label", label: "Label", kind: "text", required: true, help: "Text shown to the admin for this choice." },
        { key: "value", label: "Value", kind: "text", required: true, help: "Value published to $input.<name> when this choice is picked." },
      ] },
      { key: "labelField", label: "Label field", kind: "field-picker", showIf: { field: "optionsSource", equals: "collection" }, help: "Field whose value is shown as each option's label." },
      { key: "valueField", label: "Value field", kind: "field-picker", showIf: { field: "optionsSource", equals: "collection" }, help: "Defaults to id." },
    ] },
  ],
  defaults: { optionsSource: "static" },
  configVersion: 1,
};

export default manifest;
