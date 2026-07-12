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
      ], default: "static", required: true, help: "Static: list image URLs yourself. File field: show images from a per-record file field." },
      { key: "images", label: "Images", kind: "list", showIf: { field: "source", equals: "static" }, help: "The slides shown in the carousel, in order.", item: [
        { key: "url", label: "Image URL", kind: "text", required: true, pattern: "^[hH][tT][tT][pP][sS]?://|^/", help: "Direct link to the image, e.g. https://example.com/photo.jpg." },
        { key: "caption", label: "Caption", kind: "text", help: "Text shown under this slide." },
      ] },
      { key: "field", label: "File field", kind: "field-picker", showIf: { field: "source", equals: "field" }, help: "File-UUID field on the bound record holding the images." },
      { key: "recordSource", label: "Record source", kind: "custom", slot: "record-source", showIf: { field: "source", equals: "field" }, help: "Which record on the page supplies the file field above." },
      { key: "autoplay", label: "Autoplay", kind: "boolean", help: "Advances slides automatically without a click." },
      { key: "intervalMs", label: "Interval (ms)", kind: "number", min: 1000, integer: true, showIf: { field: "autoplay", truthy: true }, help: "Time each slide stays on screen before auto-advancing, in milliseconds." },
    ] },
  ],
  defaults: { source: "static" },
  configVersion: 1,
};

export default manifest;
