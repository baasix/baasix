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
      ], default: "url", required: true, help: "URL shows a fixed image; file field shows a per-record uploaded image." },
      { key: "url", label: "URL", kind: "text", pattern: "^[hH][tT][tT][pP][sS]?://|^/", showIf: { field: "source", equals: "url" }, help: "Direct link to the image, e.g. https://example.com/photo.jpg." },
      { key: "field", label: "File field", kind: "field-picker", showIf: { field: "source", equals: "field" }, help: "File-UUID field on the bound record holding the image." },
      { key: "recordSource", label: "Record source", kind: "custom", slot: "record-source", showIf: { field: "source", equals: "field" }, help: "Which record on the page supplies the file field above." },
      { key: "fit", label: "Fit", kind: "select", options: [
        { label: "Cover", value: "cover" }, { label: "Contain", value: "contain" },
      ], default: "cover", help: "Cover crops to fill the box; contain shrinks to fit without cropping." },
      { key: "aspect", label: "Aspect ratio", kind: "select", options: [
        { label: "16/9", value: "16/9" }, { label: "4/3", value: "4/3" }, { label: "1/1", value: "1/1" }, { label: "Auto", value: "auto" },
      ], default: "auto", help: "Locks the image box's width-to-height ratio. Auto uses the image's natural size." },
      { key: "caption", label: "Caption", kind: "text", help: "Text shown under the image." },
      { key: "action", label: "Click action", kind: "custom", slot: "single-action", help: "Action to run when the image is clicked, e.g. open a link." },
    ] },
  ],
  defaults: { source: "url", fit: "cover", aspect: "auto" },
  configVersion: 1,
};

export default manifest;
