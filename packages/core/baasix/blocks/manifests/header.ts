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
      { key: "heading", label: "Heading", kind: "text", required: true, help: "Main title text, e.g. Dashboard." },
      { key: "subheading", label: "Subheading", kind: "text", help: "Short text shown next to or below the heading." },
      { key: "description", label: "Description", kind: "text", multiline: true, help: "Longer explanatory text shown under the heading." },
      { key: "icon", label: "Icon", kind: "text", help: "lucide icon name" },
      { key: "align", label: "Alignment", kind: "select", options: [
        { label: "Left", value: "left" }, { label: "Center", value: "center" },
      ], default: "left", help: "Horizontal alignment of the heading and description text." },
      { key: "actions", label: "Actions", kind: "actions", help: "Buttons shown alongside the header, e.g. New record or Export." },
    ] },
  ],
  defaults: { align: "left" },
  configVersion: 1,
};

export default manifest;
