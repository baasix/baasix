import type { BlockManifest } from "../manifest-types.js";

const manifest: BlockManifest = {
  type: "countdown",
  label: "Countdown / clock",
  description: "Display a countdown timer or current time.",
  icon: "timer",
  category: "display",
  needsCollection: false,
  settingsMode: "manifest",
  settings: [
    { key: "general", label: "General", fields: [
      { key: "mode", label: "Mode", kind: "select", options: [
        { label: "Countdown", value: "countdown" }, { label: "Clock", value: "clock" },
      ], default: "countdown", required: true },
      { key: "target", label: "Target date/time", kind: "text", showIf: { field: "mode", equals: "countdown" }, help: "ISO datetime, e.g. 2026-12-31T00:00:00Z" },
      { key: "endedLabel", label: "Ended label", kind: "text", showIf: { field: "mode", equals: "countdown" } },
      { key: "showSeconds", label: "Show seconds", kind: "boolean", default: true },
    ] },
  ],
  defaults: { mode: "countdown", showSeconds: true },
  configVersion: 1,
};

export default manifest;
