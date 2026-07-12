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
      ], default: "url", required: true, help: "URL plays a fixed link (e.g. YouTube); file field plays a per-record uploaded file." },
      { key: "url", label: "URL", kind: "text", pattern: "^[hH][tT][tT][pP][sS]?://", showIf: { field: "source", equals: "url" }, help: "Direct or YouTube/Vimeo link, e.g. https://youtube.com/watch?v=..." },
      { key: "field", label: "File field", kind: "field-picker", showIf: { field: "source", equals: "field" }, help: "File-UUID field on the bound record holding the video/audio file." },
      { key: "recordSource", label: "Record source", kind: "custom", slot: "record-source", showIf: { field: "source", equals: "field" }, help: "Which record on the page supplies the file field above." },
      { key: "kind", label: "Kind", kind: "select", options: [
        { label: "Video", value: "video" }, { label: "Audio", value: "audio" },
      ], default: "video", help: "Audio hides the video frame and shows an audio player instead." },
      { key: "autoplay", label: "Autoplay", kind: "boolean", help: "Starts playback automatically when the block loads." },
      { key: "loop", label: "Loop", kind: "boolean", help: "Restarts playback automatically when it ends." },
      { key: "muted", label: "Muted", kind: "boolean", help: "Starts playback with the sound off." },
    ] },
  ],
  defaults: { source: "url", kind: "video" },
  configVersion: 1,
};

export default manifest;
