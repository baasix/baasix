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
      ], default: "grid", help: "Grid arranges links in a card grid; list stacks them in a single column." },
      { key: "columns", label: "Columns", kind: "number", min: 2, max: 4, integer: true, showIf: { field: "layout", equals: "grid" }, help: "How many link cards are shown per row." },
      { key: "items", label: "Links", kind: "actions", required: true, help: "Each entry is a button — set its label, icon, and where it navigates or what it runs." },
    ] },
  ],
  defaults: { layout: "grid" },
  configVersion: 1,
};

export default manifest;
