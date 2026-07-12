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
      { key: "labelField", label: "Label field", kind: "field-picker", required: true, help: "Field whose value is shown as each node's text." },
      { key: "parentField", label: "Parent field", kind: "field-picker", required: true, help: "Self-referencing field, e.g. parent_Id." },
      { key: "iconField", label: "Icon field", kind: "field-picker", help: "Optional field holding a lucide icon name per node." },
      { key: "filter", label: "Filter", kind: "filter-dsl", help: "Only records matching this filter appear in the tree." },
      { key: "sort", label: "Sort", kind: "text", help: "e.g. name or -createdAt" },
      { key: "selectable", label: "Publish selection on click", kind: "boolean", default: true, help: "Clicking a node publishes its record id for sibling blocks to filter on." },
      { key: "itemAction", label: "On item click", kind: "custom", slot: "single-action", help: "Runs when a node is clicked. Selection is still published." },
    ] },
  ],
  defaults: { selectable: true },
  configVersion: 1,
};

export default manifest;
