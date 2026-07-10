import type { BlockManifest } from "../manifest-types.js";

const manifest: BlockManifest = {
  type: "divider",
  label: "Divider",
  description: "Horizontal separator line with an optional centered label.",
  icon: "minus",
  category: "layout",
  needsCollection: false,
  settingsMode: "manifest",
  settings: [
    {
      key: "general",
      label: "General",
      fields: [
        { key: "label", label: "Label", kind: "text", placeholder: "Section name", help: "Optional caption centered on the line." },
      ],
    },
  ],
  defaults: {},
  configVersion: 1,
};

export default manifest;
