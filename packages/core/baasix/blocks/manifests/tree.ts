import type { BlockManifest } from "../manifest-types.js";

const manifest: BlockManifest = {
  type: "tree",
  label: "Tree",
  description: "Hierarchy from a self-referencing collection; node click selects.",
  icon: "list-tree",
  category: "display",
  needsCollection: true,
  settingsMode: "manifest",
  settings: [
    { key: "general", label: "General", fields: [
      { key: "labelField", label: "Label field", kind: "field-picker", required: true },
      { key: "parentField", label: "Parent field", kind: "field-picker", required: true, help: "Self-referencing field, e.g. parent_Id." },
      { key: "iconField", label: "Icon field", kind: "field-picker" },
      { key: "filter", label: "Filter", kind: "filter-dsl" },
      { key: "sort", label: "Sort", kind: "text", help: "e.g. name or -createdAt" },
      { key: "selectable", label: "Publish selection on click", kind: "boolean", default: true },
      { key: "itemAction", label: "On item click", kind: "custom", slot: "single-action", help: "Runs when a node is clicked. Selection is still published." },
    ] },
  ],
  defaults: { selectable: true },
  configVersion: 1,
};

export default manifest;
