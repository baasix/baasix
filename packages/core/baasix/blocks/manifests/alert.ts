import type { BlockManifest } from "../manifest-types.js";

const manifest: BlockManifest = {
  type: "alert",
  label: "Alert",
  description: "Callout banner with tone, markdown body, and optional dismiss.",
  icon: "triangle-alert",
  category: "content",
  needsCollection: false,
  settingsMode: "manifest",
  settings: [
    { key: "general", label: "General", fields: [
      { key: "tone", label: "Tone", kind: "select", required: true, options: [
        { label: "Info", value: "info" }, { label: "Success", value: "success" },
        { label: "Warning", value: "warning" }, { label: "Error", value: "error" },
      ], default: "info" },
      { key: "heading", label: "Heading", kind: "text" },
      { key: "body", label: "Body", kind: "markdown", required: true },
      { key: "dismissible", label: "Dismissible", kind: "boolean" },
      { key: "icon", label: "Icon override", kind: "text", help: "lucide icon name" },
    ] },
  ],
  defaults: { tone: "info" },
  configVersion: 1,
};

export default manifest;
