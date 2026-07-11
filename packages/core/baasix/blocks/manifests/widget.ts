import type { BlockManifest } from "../manifest-types.js";

const manifest: BlockManifest = {
  type: "widget",
  label: "Custom widget",
  description: "Sandboxed custom HTML and JavaScript with optional data binding.",
  icon: "code",
  category: "content",
  needsCollection: "optional",
  settingsMode: "manifest",
  settings: [
    { key: "general", label: "General", fields: [
      { key: "html", label: "HTML", kind: "text", multiline: true, required: true, help: "Admin-authored HTML and <script>. Expressions {{ }} are allowed." },
      { key: "height", label: "Height (px)", kind: "number", min: 50, max: 2000, integer: true, default: 400 },
      { key: "allowInputs", label: "Allow inputs", kind: "boolean", default: true },
    ] },
    { key: "data", label: "Data Binding", fields: [
      { key: "filter", label: "Filter", kind: "filter-dsl" },
      { key: "fields", label: "Fields", kind: "field-picker", multiple: true },
      { key: "sort", label: "Sort", kind: "text", help: "e.g. -createdAt" },
      { key: "limit", label: "Limit", kind: "number", min: 1, max: 500, integer: true, default: 100 },
    ] },
  ],
  defaults: { height: 400, allowInputs: true, limit: 100 },
  configVersion: 1,
};

export default manifest;
