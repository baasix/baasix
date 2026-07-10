import { test, expect, describe } from "@jest/globals";
import { validateManifest } from "../baasix/blocks/manifest-types.js";

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
