import type { BlockManifest } from "../manifest-types.js";

const manifest: BlockManifest = {
  type: "iframe",
  label: "Embed (iframe)",
  description: "Embed an external website or tool by URL.",
  icon: "frame",
  category: "content",
  needsCollection: false,
  settingsMode: "manifest",
  settings: [
    {
      key: "general",
      label: "General",
      fields: [
        { key: "url", label: "URL", kind: "text", required: true, pattern: "^[hH][tT][tT][pP][sS]?://", placeholder: "https://example.com", help: "http/https only." },
        { key: "height", label: "Height (px)", kind: "number", min: 1, integer: true },
        { key: "allowFullscreen", label: "Allow fullscreen", kind: "boolean" },
        { key: "sandbox", label: "Sandbox attributes", kind: "text", help: "Optional iframe sandbox flags." },
      ],
    },
  ],
  defaults: {},
  configVersion: 1,
};

export default manifest;
