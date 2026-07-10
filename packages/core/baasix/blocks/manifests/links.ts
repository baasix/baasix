import type { BlockManifest } from "../manifest-types.js";

const manifest: BlockManifest = {
  type: "links",
  label: "Quick links",
  description: "Grid or list of shortcut buttons using the block action system.",
  icon: "link",
  category: "navigation",
  needsCollection: false,
  settingsMode: "manifest",
  settings: [
    { key: "general", label: "General", fields: [
      { key: "layout", label: "Layout", kind: "select", options: [
        { label: "Grid", value: "grid" }, { label: "List", value: "list" },
      ], default: "grid" },
      { key: "columns", label: "Columns", kind: "number", min: 2, max: 4, integer: true, showIf: { field: "layout", equals: "grid" } },
      { key: "items", label: "Links", kind: "actions", required: true },
    ] },
  ],
  defaults: { layout: "grid" },
  configVersion: 1,
};

export default manifest;
