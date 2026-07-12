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
      { key: "html", label: "HTML", kind: "custom", slot: "html-editor", required: true, help: "Admin-authored HTML and <script>. Expressions {{ }} are allowed." },
      { key: "height", label: "Height (px)", kind: "number", min: 50, max: 2000, integer: true, default: 400, help: "Fixed height of the widget's frame in pixels." },
      { key: "allowInputs", label: "Allow inputs", kind: "boolean", default: true, help: "Lets scripts inside the widget publish $input values that filter sibling blocks (setInput)." },
    ] },
    { key: "data", label: "Data Binding", fields: [
      { key: "filter", label: "Filter", kind: "filter-dsl", help: "Only records matching this filter are passed into the widget's data." },
      { key: "fields", label: "Fields", kind: "field-picker", multiple: true, help: "Which record fields are included in the data passed to the widget." },
      { key: "sort", label: "Sort", kind: "text", requiresCollection: true, help: "e.g. -createdAt" },
      { key: "limit", label: "Limit", kind: "number", min: 1, max: 500, integer: true, default: 100, requiresCollection: true, help: "Maximum number of records passed into the widget's data." },
    ] },
  ],
  defaults: { height: 400, allowInputs: true, limit: 100 },
  configVersion: 1,
};

export default manifest;
