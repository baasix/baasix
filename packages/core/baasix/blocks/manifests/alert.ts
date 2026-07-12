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
      ], default: "info", help: "Sets the banner's color and default icon." },
      { key: "heading", label: "Heading", kind: "text", help: "Bold title shown above the body text." },
      { key: "body", label: "Body", kind: "markdown", required: true, help: "Message text, written in markdown (bold, links, lists)." },
      { key: "dismissible", label: "Dismissible", kind: "boolean", help: "Adds a close button that hides the banner for the visitor." },
      { key: "icon", label: "Icon override", kind: "text", help: "lucide icon name" },
    ] },
  ],
  defaults: { tone: "info" },
  configVersion: 1,
};

export default manifest;
