import type { BlockManifest } from "../manifest-types.js";

const manifest: BlockManifest = {
  type: "html",
  label: "HTML embed",
  description: "Static HTML rendered inside a sandboxed iframe.",
  icon: "code-xml",
  category: "content",
  needsCollection: false,
  settingsMode: "manifest",
  settings: [
    { key: "general", label: "General", fields: [
      { key: "html", label: "HTML", kind: "text", multiline: true, required: true, help: "Raw HTML markup rendered inside the sandboxed frame." },
      { key: "height", label: "Height (px)", kind: "number", min: 50, integer: true, help: "Fixed height of the embed in pixels." },
      { key: "allowScripts", label: "Allow scripts", kind: "boolean", help: "Runs inside a sandboxed iframe with no origin access. Admin-authored content only." },
    ] },
  ],
  defaults: {},
  configVersion: 1,
};

export default manifest;
