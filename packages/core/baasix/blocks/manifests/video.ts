import type { BlockManifest } from "../manifest-types.js";

const manifest: BlockManifest = {
  type: "video",
  label: "Video / audio",
  description: "Embed video or audio from a URL (YouTube/Vimeo/direct) or a file field.",
  icon: "play",
  category: "content",
  needsCollection: "optional",
  settingsMode: "manifest",
  settings: [
    { key: "general", label: "General", fields: [
      { key: "source", label: "Source", kind: "select", options: [
        { label: "URL", value: "url" }, { label: "File field", value: "field" },
      ], default: "url", required: true },
      { key: "url", label: "URL", kind: "text", pattern: "^[hH][tT][tT][pP][sS]?://", showIf: { field: "source", equals: "url" } },
      { key: "field", label: "File field", kind: "field-picker", showIf: { field: "source", equals: "field" } },
      { key: "recordSource", label: "Record source", kind: "custom", slot: "record-source", showIf: { field: "source", equals: "field" } },
      { key: "kind", label: "Kind", kind: "select", options: [
        { label: "Video", value: "video" }, { label: "Audio", value: "audio" },
      ], default: "video" },
      { key: "autoplay", label: "Autoplay", kind: "boolean" },
      { key: "loop", label: "Loop", kind: "boolean" },
      { key: "muted", label: "Muted", kind: "boolean" },
    ] },
  ],
  defaults: { source: "url", kind: "video" },
  configVersion: 1,
};

export default manifest;
