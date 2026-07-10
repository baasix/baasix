import type { BlockManifest } from "../manifest-types.js";

const manifest: BlockManifest = {
  type: "markdown",
  label: "Markdown",
  description: "Static formatted text written in markdown.",
  icon: "file-text",
  category: "content",
  needsCollection: false,
  settingsMode: "manifest",
  settings: [
    {
      key: "general",
      label: "General",
      fields: [
        { key: "content", label: "Content", kind: "markdown", required: true },
      ],
    },
  ],
  defaults: { content: "" },
  configVersion: 1,
};

export default manifest;
