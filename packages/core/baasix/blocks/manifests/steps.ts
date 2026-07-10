import type { BlockManifest } from "../manifest-types.js";

const manifest: BlockManifest = {
  type: "steps",
  label: "Progress steps",
  description: "Step indicator driven by a status field of a bound record.",
  icon: "list-checks",
  category: "display",
  needsCollection: true,
  settingsMode: "manifest",
  settings: [
    { key: "general", label: "General", fields: [
      { key: "statusField", label: "Status field", kind: "field-picker", required: true },
      { key: "steps", label: "Steps", kind: "list", minItems: 2, item: [
        { key: "label", label: "Label", kind: "text", required: true },
        { key: "value", label: "Field value", kind: "text", required: true },
        { key: "icon", label: "Icon", kind: "text", help: "lucide icon name" },
      ] },
      { key: "source", label: "Record source", kind: "custom", slot: "record-source" },
      { key: "orientation", label: "Orientation", kind: "select", options: [
        { label: "Horizontal", value: "horizontal" }, { label: "Vertical", value: "vertical" },
      ], default: "horizontal" },
    ] },
  ],
  defaults: { orientation: "horizontal", steps: [] },
  configVersion: 1,
};

export default manifest;
