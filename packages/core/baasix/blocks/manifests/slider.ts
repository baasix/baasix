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
      { key: "name", label: "Input name", kind: "text", required: true, pattern: "^[a-zA-Z][a-zA-Z0-9_]*$" },
      { key: "label", label: "Label", kind: "text" },
      { key: "min", label: "Min", kind: "number", required: true },
      { key: "max", label: "Max", kind: "number", required: true },
      { key: "step", label: "Step", kind: "number" },
      { key: "range", label: "Range (two thumbs)", kind: "boolean", help: "Publishes $input.<name>_min and $input.<name>_max." },
      { key: "showValue", label: "Show value", kind: "boolean", default: true },
    ] },
  ],
  defaults: { showValue: true },
  configVersion: 1,
};

export default manifest;
