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
      { key: "label", label: "Label", kind: "text", help: "Text shown above the date picker." },
      { key: "mode", label: "Mode", kind: "select", options: [
        { label: "Range", value: "range" }, { label: "Single date", value: "single" },
      ], default: "range", help: "Range shows a start and end date; single shows one date field." },
      { key: "kind", label: "Kind", kind: "select", options: [
        { label: "Date", value: "date" }, { label: "Time", value: "time" }, { label: "Date & time", value: "datetime" },
      ], default: "date", help: "date = calendar days (start/end of day); time = clock times (HH:mm); datetime = exact instants with a time picker." },
      { key: "presets", label: "Show presets", kind: "boolean", help: "Today, Last 7 days, Last 30 days, This month. Hidden automatically when kind is time." },
      { key: "required", label: "Required", kind: "boolean", help: "Consumers stay disabled until a date is chosen." },
    ] },
  ],
  defaults: { mode: "range", presets: true },
  configVersion: 1,
};

export default manifest;
