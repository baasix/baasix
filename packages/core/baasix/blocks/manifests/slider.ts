import type { BlockManifest } from "../manifest-types.js";

const manifest: BlockManifest = {
  type: "slider",
  label: "Slider",
  description: "Numeric slider publishing $input.<name> (or _min/_max in range mode).",
  icon: "sliders-horizontal",
  category: "input",
  needsCollection: false,
  settingsMode: "manifest",
  settings: [
    { key: "general", label: "General", fields: [
      { key: "name", label: "Input name", kind: "text", required: true, pattern: "^[a-zA-Z][a-zA-Z0-9_]*$", help: "Reference as $input.<name> in sibling block filters." },
      { key: "label", label: "Label", kind: "text", help: "Text shown above the slider." },
      { key: "min", label: "Min", kind: "number", required: true, help: "Smallest value the slider can be dragged to." },
      { key: "max", label: "Max", kind: "number", required: true, help: "Largest value the slider can be dragged to." },
      { key: "step", label: "Step", kind: "number", help: "Amount the value jumps by per drag increment, e.g. 5." },
      { key: "range", label: "Range (two thumbs)", kind: "boolean", help: "Publishes $input.<name>_min and $input.<name>_max." },
      { key: "showValue", label: "Show value", kind: "boolean", default: true, help: "Shows the current numeric value next to the slider." },
    ] },
  ],
  defaults: { showValue: true },
  configVersion: 1,
};

export default manifest;
