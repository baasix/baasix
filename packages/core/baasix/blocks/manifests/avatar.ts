import type { BlockManifest } from "../manifest-types.js";

const manifest: BlockManifest = {
  type: "avatar",
  label: "Avatar list",
  description: "Display user avatars from a collection with name and image fields.",
  icon: "users",
  category: "display",
  needsCollection: true,
  settingsMode: "manifest",
  settings: [
    { key: "general", label: "General", fields: [
      { key: "nameField", label: "Name field", kind: "field-picker", required: true },
      { key: "imageField", label: "Image field", kind: "field-picker", help: "file-UUID field" },
      { key: "filter", label: "Filter", kind: "filter-dsl" },
      { key: "sort", label: "Sort", kind: "text" },
      { key: "max", label: "Maximum avatars", kind: "number", min: 1, max: 20, integer: true, default: 5 },
      { key: "size", label: "Size", kind: "select", options: [
        { label: "Small", value: "sm" }, { label: "Medium", value: "md" }, { label: "Large", value: "lg" },
      ], default: "md" },
    ] },
  ],
  defaults: { max: 5, size: "md" },
  configVersion: 1,
};

export default manifest;
