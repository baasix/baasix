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
      ], default: "auto", help: "Automatic follows the page's parent pages; manual lets you list the trail yourself." },
      { key: "items", label: "Items", kind: "list", showIf: { field: "mode", equals: "manual" }, help: "The crumbs shown in order, left to right.", item: [
        { key: "label", label: "Label", kind: "text", required: true, help: "Text shown for this crumb." },
        { key: "slug", label: "Page slug", kind: "text", help: "Slug of the page this crumb links to. Leave blank for plain text." },
      ] },
    ] },
  ],
  defaults: { mode: "auto" },
  configVersion: 1,
};

export default manifest;
