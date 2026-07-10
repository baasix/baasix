import type { BlockManifest } from "../manifest-types.js";

const manifest: BlockManifest = {
  type: "daterange",
  label: "Date range",
  description: "Date or date-range picker publishing $input.<name>_from / _to.",
  icon: "calendar-range",
  category: "input",
  needsCollection: false,
  settingsMode: "manifest",
  settings: [
    { key: "general", label: "General", fields: [
      { key: "name", label: "Input name", kind: "text", required: true, pattern: "^[a-zA-Z][a-zA-Z0-9_]*$", help: "Range mode publishes $input.<name>_from and $input.<name>_to; single mode publishes $input.<name>." },
      { key: "label", label: "Label", kind: "text" },
      { key: "mode", label: "Mode", kind: "select", options: [
        { label: "Range", value: "range" }, { label: "Single date", value: "single" },
      ], default: "range" },
      { key: "presets", label: "Show presets", kind: "boolean", help: "Today, Last 7 days, Last 30 days, This month." },
      { key: "required", label: "Required", kind: "boolean" },
    ] },
  ],
  defaults: { mode: "range", presets: true },
  configVersion: 1,
};

export default manifest;
