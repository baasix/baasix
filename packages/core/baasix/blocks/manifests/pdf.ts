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
      ], default: "url", required: true, help: "URL shows a fixed link; file field shows a per-record uploaded PDF." },
      { key: "url", label: "URL", kind: "text", pattern: "^[hH][tT][tT][pP][sS]?://", showIf: { field: "source", equals: "url" }, help: "Direct link to a PDF file, e.g. https://example.com/doc.pdf." },
      { key: "field", label: "File field", kind: "field-picker", showIf: { field: "source", equals: "field" }, help: "File-UUID field on the bound record holding the PDF." },
      { key: "recordSource", label: "Record source", kind: "custom", slot: "record-source", showIf: { field: "source", equals: "field" }, help: "Which record on the page supplies the file field above." },
      { key: "height", label: "Height (px)", kind: "number", min: 100, integer: true, help: "Fixed height of the PDF viewer in pixels." },
    ] },
  ],
  defaults: { source: "url" },
  configVersion: 1,
};

export default manifest;
