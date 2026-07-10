import type { BlockManifest } from "../manifest-types.js";

const manifest: BlockManifest = {
  type: "pdf",
  label: "PDF viewer",
  description: "Inline PDF from a URL or a file field.",
  icon: "file-text",
  category: "content",
  needsCollection: "optional",
  settingsMode: "manifest",
  settings: [
    { key: "general", label: "General", fields: [
      { key: "source", label: "Source", kind: "select", options: [
        { label: "URL", value: "url" }, { label: "File field", value: "field" },
      ], default: "url", required: true },
      { key: "url", label: "URL", kind: "text", pattern: "^[hH][tT][tT][pP][sS]?://", showIf: { field: "source", equals: "url" } },
      { key: "field", label: "File field", kind: "field-picker", showIf: { field: "source", equals: "field" } },
      { key: "recordSource", label: "Record source", kind: "custom", slot: "record-source", showIf: { field: "source", equals: "field" } },
      { key: "height", label: "Height (px)", kind: "number", min: 100, integer: true },
    ] },
  ],
  defaults: { source: "url" },
  configVersion: 1,
};

export default manifest;
