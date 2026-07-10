import type { BlockManifest } from "../manifest-types.js";

const manifest: BlockManifest = {
  type: "spacer",
  label: "Spacer",
  description: "Vertical spacing between blocks.",
  icon: "move-vertical",
  category: "layout",
  needsCollection: false,
  settingsMode: "manifest",
  settings: [
    { key: "general", label: "General", fields: [
      { key: "height", label: "Height (px)", kind: "number", min: 4, max: 400, integer: true, required: true, default: 24 },
    ] },
  ],
  defaults: { height: 24 },
  configVersion: 1,
};

export default manifest;
