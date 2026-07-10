import type { BlockManifest } from "../manifest-types.js";

const manifest: BlockManifest = {
  type: "subpage",
  label: "Subpage",
  description: "Embed another page at one level of nesting.",
  icon: "layout-panel-top",
  category: "layout",
  needsCollection: false,
  settingsMode: "manifest",
  settings: [
    { key: "general", label: "General", fields: [
      { key: "slug", label: "Page slug", kind: "text", required: true, help: "Slug of the page to embed. Renders one level deep." },
    ] },
  ],
  defaults: {},
  configVersion: 1,
};

export default manifest;
