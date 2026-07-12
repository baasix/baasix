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
      { key: "nameField", label: "Name field", kind: "field-picker", required: true, help: "Field whose value is used for the initials and tooltip name." },
      { key: "imageField", label: "Image field", kind: "field-picker", help: "file-UUID field" },
      { key: "filter", label: "Filter", kind: "filter-dsl", help: "Only records matching this filter are shown as avatars." },
      { key: "sort", label: "Sort", kind: "text", help: "Field to order avatars by, e.g. -createdAt for newest first." },
      { key: "max", label: "Maximum avatars", kind: "number", min: 1, max: 20, integer: true, default: 5, help: "Avatars beyond this count collapse into a +N overflow badge." },
      // "avatarSize", not "size": `size` is a reserved envelope key on every
      // block config (BlockSizeConfig pixel constraints in the app) — a
      // manifest field named `size` collides with it in the editor/renderer.
      { key: "avatarSize", label: "Size", kind: "select", options: [
        { label: "Small", value: "sm" }, { label: "Medium", value: "md" }, { label: "Large", value: "lg" },
      ], default: "md", help: "Diameter of each avatar circle." },
      { key: "itemAction", label: "On item click", kind: "custom", slot: "single-action", help: "Runs when an avatar is clicked." },
    ] },
  ],
  defaults: { max: 5, avatarSize: "md" },
  configVersion: 1,
};

export default manifest;
