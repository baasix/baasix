import type { BlockManifest } from "../manifest-types.js";

const manifest: BlockManifest = {
  type: "header",
  label: "Page header",
  description: "Hero heading with subtitle, description, icon, and action buttons.",
  icon: "heading-1",
  category: "navigation",
  needsCollection: false,
  settingsMode: "manifest",
  settings: [
    { key: "general", label: "General", fields: [
      { key: "heading", label: "Heading", kind: "text", required: true },
      { key: "subheading", label: "Subheading", kind: "text" },
      { key: "description", label: "Description", kind: "text", multiline: true },
      { key: "icon", label: "Icon", kind: "text", help: "lucide icon name" },
      { key: "align", label: "Alignment", kind: "select", options: [
        { label: "Left", value: "left" }, { label: "Center", value: "center" },
      ], default: "left" },
      { key: "actions", label: "Actions", kind: "actions" },
    ] },
  ],
  defaults: { align: "left" },
  configVersion: 1,
};

export default manifest;
