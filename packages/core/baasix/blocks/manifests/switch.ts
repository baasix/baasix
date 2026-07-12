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
      { key: "name", label: "Input name", kind: "text", required: true, pattern: "^[a-zA-Z][a-zA-Z0-9_]*$", help: "Reference as $input.<name> in sibling block filters." },
      { key: "label", label: "Label", kind: "text", help: "Text shown next to the switch." },
      { key: "variant", label: "Variant", kind: "select", options: [
        { label: "Toggle (boolean)", value: "toggle" }, { label: "Segmented (options)", value: "segmented" },
      ], default: "toggle", help: "Toggle publishes true when on and clears the value when off; segmented publishes one of the option values below." },
      { key: "explicitFalse", label: "Publish false explicitly", kind: "boolean", showIf: { field: "variant", equals: "toggle" }, help: "Off publishes the literal value false instead of clearing $input.<name> — use when sibling filters need to distinguish off from unset." },
      { key: "options", label: "Options", kind: "list", showIf: { field: "variant", equals: "segmented" }, help: "The segments shown in the control.", item: [
        { key: "label", label: "Label", kind: "text", required: true, help: "Text shown on this segment's button." },
        { key: "value", label: "Value", kind: "text", required: true, help: "Value published to $input.<name> when this segment is picked." },
      ] },
    ] },
  ],
  defaults: { variant: "toggle" },
  configVersion: 1,
};

export default manifest;
