import { test, expect, describe } from "@jest/globals";
import { validateManifest } from "../baasix/blocks/manifest-types.js";
import { getManifest, listManifests, isKnownBlockType, collectionRequirement } from "../baasix/blocks/registry.js";
import { getBlockConfigDoc } from "../baasix/utils/blockConfigDoc.js";
import systemSchemaModule from "../baasix/utils/systemschema.js";

const minimal = () => ({
  type: "demo",
  label: "Demo",
  description: "A demo block",
  icon: "square",
  category: "display",
  needsCollection: false,
  settingsMode: "manifest",
  settings: [
    {
      key: "general",
      label: "General",
      fields: [
        { key: "content", label: "Content", kind: "text", required: true },
        { key: "level", label: "Level", kind: "select", options: [{ label: "Low", value: "low" }, { label: "High", value: "high" }], default: "low" },
      ],
    },
  ],
  defaults: { level: "low" },
  configVersion: 1,
});

describe("validateManifest", () => {
  test("accepts a minimal valid manifest", () => {
    expect(() => validateManifest(minimal())).not.toThrow();
  });
  test("rejects missing type/label/description/icon", () => {
    for (const key of ["type", "label", "description", "icon"]) {
      const m = minimal();
      delete m[key];
      expect(() => validateManifest(m)).toThrow(new RegExp(key));
    }
  });
  test("rejects unknown category", () => {
    const m = minimal();
    m.category = "widgets";
    expect(() => validateManifest(m)).toThrow(/category/);
  });
  test("rejects duplicate field keys across groups", () => {
    const m = minimal();
    m.settings.push({ key: "extra", label: "Extra", fields: [{ key: "content", label: "Again", kind: "text" }] });
    expect(() => validateManifest(m)).toThrow(/duplicate.*content/i);
  });
  test("rejects select without options and custom without slot", () => {
    const m1 = minimal();
    m1.settings[0].fields.push({ key: "bad", label: "Bad", kind: "select" });
    expect(() => validateManifest(m1)).toThrow(/options/);
    const m2 = minimal();
    m2.settings[0].fields.push({ key: "bad2", label: "Bad2", kind: "custom" });
    expect(() => validateManifest(m2)).toThrow(/slot/);
  });
  test("rejects list field without item fields, validates nested items", () => {
    const m = minimal();
    m.settings[0].fields.push({ key: "cols", label: "Columns", kind: "list", item: [] });
    expect(() => validateManifest(m)).toThrow(/item/);
  });
  test("rejects defaults referencing unknown field keys", () => {
    const m = minimal();
    m.defaults = { nope: 1 };
    expect(() => validateManifest(m)).toThrow(/defaults.*nope/i);
  });
  test("rejects showIf referencing unknown sibling", () => {
    const m = minimal();
    m.settings[0].fields[1].showIf = { field: "missing", truthy: true };
    expect(() => validateManifest(m)).toThrow(/showIf.*missing/i);
  });
});

const LEGACY_TYPES = [
  "table", "form", "details", "kanban", "calendar", "chart", "cardlist", "map",
  "markdown", "filter", "buttons", "media", "feed", "iframe", "upload", "code",
  "geochart", "tabs", "container", "modal", "divider", "timeline", "progress",
  "repeater", "richtext", "report", "input",
];

describe("block registry", () => {
  test("contains a manifest for every legacy block type", () => {
    for (const t of LEGACY_TYPES) {
      expect(isKnownBlockType(t)).toBe(true);
      const m = getManifest(t);
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.description.length).toBeGreaterThan(0);
      expect(m.icon.length).toBeGreaterThan(0);
    }
  });
  test("divider, markdown, iframe are manifest-mode; table stays legacy", () => {
    expect(getManifest("divider").settingsMode).toBe("manifest");
    expect(getManifest("markdown").settingsMode).toBe("manifest");
    expect(getManifest("iframe").settingsMode).toBe("manifest");
    expect(getManifest("table").settingsMode).toBe("legacy");
  });
  test("collection requirements match existing service semantics", () => {
    expect(collectionRequirement("table")).toBe(true);
    expect(collectionRequirement("markdown")).toBe(false);
    expect(collectionRequirement("code")).toBe("optional");
    expect(collectionRequirement("richtext")).toBe("optional");
    expect(collectionRequirement("nope")).toBeUndefined();
  });
  test("unknown type is not registered", () => {
    expect(isKnownBlockType("bogus")).toBe(false);
    expect(listManifests().length).toBe(LEGACY_TYPES.length);
  });
});

describe("getBlockConfigDoc", () => {
  test("contains legacy doc plus generated manifest sections", () => {
    const doc = getBlockConfigDoc();
    expect(doc).toContain("# Baasix page-builder: block config reference");   // legacy content kept
    expect(doc).toContain("## Manifest-defined block types");
    expect(doc).toContain("### iframe");
    expect(doc).toMatch(/`url`.*required/);
  });
});

describe("systemschema", () => {
  test("baasix_Block.type is a String, not an ENUM", () => {
    const block = systemSchemaModule.schemas.find((s) => s.collectionName === "baasix_Block");
    expect(block.schema.fields.type.type).toBe("String");
    expect(block.schema.fields.type.values).toBeUndefined();
  });
});
