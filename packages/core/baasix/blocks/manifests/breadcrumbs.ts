import type { BlockManifest } from "../manifest-types.js";

const manifest: BlockManifest = {
  type: "breadcrumbs",
  label: "Breadcrumbs",
  description: "Trail of parent pages, automatic from the page hierarchy or manual.",
  icon: "chevrons-right",
  category: "navigation",
  needsCollection: false,
  settingsMode: "manifest",
  settings: [
    { key: "general", label: "General", fields: [
      { key: "mode", label: "Mode", kind: "select", options: [
        { label: "Automatic (page hierarchy)", value: "auto" }, { label: "Manual", value: "manual" },
      ], default: "auto" },
      { key: "items", label: "Items", kind: "list", showIf: { field: "mode", equals: "manual" }, item: [
        { key: "label", label: "Label", kind: "text", required: true },
        { key: "slug", label: "Page slug", kind: "text" },
      ] },
    ] },
  ],
  defaults: { mode: "auto" },
  configVersion: 1,
};

export default manifest;
