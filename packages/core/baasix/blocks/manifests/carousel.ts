import type { BlockManifest } from "../manifest-types.js";

const manifest: BlockManifest = {
  type: "carousel",
  label: "Image carousel",
  description: "Slideshow of images from a static list or a file field.",
  icon: "gallery-horizontal",
  category: "content",
  needsCollection: "optional",
  settingsMode: "manifest",
  settings: [
    { key: "general", label: "General", fields: [
      { key: "source", label: "Source", kind: "select", options: [
        { label: "Static images", value: "static" }, { label: "File field", value: "field" },
      ], default: "static", required: true },
      { key: "images", label: "Images", kind: "list", showIf: { field: "source", equals: "static" }, item: [
        { key: "url", label: "Image URL", kind: "text", required: true, pattern: "^[hH][tT][tT][pP][sS]?://|^/" },
        { key: "caption", label: "Caption", kind: "text" },
      ] },
      { key: "field", label: "File field", kind: "field-picker", showIf: { field: "source", equals: "field" } },
      { key: "recordSource", label: "Record source", kind: "custom", slot: "record-source", showIf: { field: "source", equals: "field" } },
      { key: "autoplay", label: "Autoplay", kind: "boolean" },
      { key: "intervalMs", label: "Interval (ms)", kind: "number", min: 1000, integer: true, showIf: { field: "autoplay", truthy: true } },
    ] },
  ],
  defaults: { source: "static" },
  configVersion: 1,
};

export default manifest;
