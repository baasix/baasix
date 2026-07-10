import type { BlockManifest } from "../manifest-types.js";

const manifest: BlockManifest = {
  type: "image",
  label: "Image",
  description: "Embed an image from a URL or a file field.",
  icon: "image",
  category: "content",
  needsCollection: "optional",
  settingsMode: "manifest",
  settings: [
    { key: "general", label: "General", fields: [
      { key: "source", label: "Source", kind: "select", options: [
        { label: "URL", value: "url" }, { label: "File field", value: "field" },
      ], default: "url", required: true },
      { key: "url", label: "URL", kind: "text", pattern: "^[hH][tT][tT][pP][sS]?://|^/", showIf: { field: "source", equals: "url" } },
      { key: "field", label: "File field", kind: "field-picker", showIf: { field: "source", equals: "field" } },
      { key: "recordSource", label: "Record source", kind: "custom", slot: "record-source", showIf: { field: "source", equals: "field" } },
      { key: "fit", label: "Fit", kind: "select", options: [
        { label: "Cover", value: "cover" }, { label: "Contain", value: "contain" },
      ], default: "cover" },
      { key: "aspect", label: "Aspect ratio", kind: "select", options: [
        { label: "16/9", value: "16/9" }, { label: "4/3", value: "4/3" }, { label: "1/1", value: "1/1" }, { label: "Auto", value: "auto" },
      ], default: "auto" },
      { key: "caption", label: "Caption", kind: "text" },
      { key: "action", label: "Click action", kind: "custom", slot: "single-action" },
    ] },
  ],
  defaults: { source: "url", fit: "cover", aspect: "auto" },
  configVersion: 1,
};

export default manifest;
