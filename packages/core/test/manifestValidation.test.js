import { test, expect, describe } from "@jest/globals";
import { validateConfigAgainstManifest } from "../baasix/blocks/validate-from-manifest.js";
import { validateBlockData } from "../baasix/services/BlockConfigService.js";

const stubFields = (map) => () => map;
const noFields = () => null;

const FIXTURE = {
  type: "fixture",
  label: "Fixture", description: "x", icon: "square",
  category: "display", needsCollection: false, settingsMode: "manifest",
  settings: [
    { key: "g", label: "G", fields: [
      { key: "name", label: "Name", kind: "text", required: true, pattern: "^[a-z]+$" },
      { key: "count", label: "Count", kind: "number", min: 1, max: 10, integer: true },
      { key: "on", label: "On", kind: "boolean" },
      { key: "mode", label: "Mode", kind: "select", options: [{ label: "A", value: "a" }, { label: "B", value: "b" }] },
      { key: "tags", label: "Tags", kind: "select", multiple: true, options: [{ label: "X", value: "x" }, { label: "Y", value: "y" }] },
      { key: "color", label: "Color", kind: "color" },
      { key: "field", label: "Field", kind: "field-picker" },
      { key: "fields", label: "Fields", kind: "field-picker", multiple: true },
      { key: "extra", label: "Extra", kind: "text", required: true, showIf: { field: "on", truthy: true } },
      { key: "rows", label: "Rows", kind: "list", minItems: 1, item: [
        { key: "f", label: "F", kind: "text", required: true },
        { key: "w", label: "W", kind: "number", min: 0 },
      ] },
    ] },
  ],
  defaults: {}, configVersion: 1,
};

const ok = { name: "abc", rows: [{ f: "a" }] };

describe("validateConfigAgainstManifest", () => {
  const run = (config, collection = null, getFields = noFields) =>
    () => validateConfigAgainstManifest(FIXTURE, config, collection, getFields);

  test("valid config passes", () => expect(run(ok)).not.toThrow());
  test("missing required throws with field key", () => expect(run({ rows: [{ f: "a" }] })).toThrow(/name/));
  test("null config with required fields throws", () => expect(run(null)).toThrow(/name/));
  test("pattern violation throws", () => expect(run({ ...ok, name: "ABC" })).toThrow(/name/));
  test("number bounds + integer enforced", () => {
    expect(run({ ...ok, count: 0 })).toThrow(/count/);
    expect(run({ ...ok, count: 11 })).toThrow(/count/);
    expect(run({ ...ok, count: 1.5 })).toThrow(/count/);
    expect(run({ ...ok, count: "3" })).toThrow(/count/);
  });
  test("boolean type enforced", () => expect(run({ ...ok, on: "yes", extra: "x" })).toThrow(/on/));
  test("select must be an allowed value; multiple must be array of allowed", () => {
    expect(run({ ...ok, mode: "c" })).toThrow(/mode/);
    expect(run({ ...ok, tags: "x" })).toThrow(/tags/);
    expect(run({ ...ok, tags: ["x", "z"] })).toThrow(/tags/);
    expect(run({ ...ok, mode: "a", tags: ["x", "y"] })).not.toThrow();
  });
  test("color accepts theme token or hex, rejects junk", () => {
    expect(run({ ...ok, color: "primary" })).not.toThrow();
    expect(run({ ...ok, color: "#22c55e" })).not.toThrow();
    expect(run({ ...ok, color: "red;drop" })).toThrow(/color/);
  });
  test("showIf-hidden required field is not required; visible one is", () => {
    expect(run({ ...ok })).not.toThrow();                       // on unset → extra hidden
    expect(run({ ...ok, on: true })).toThrow(/extra/);          // on → extra required
    expect(run({ ...ok, on: true, extra: "x" })).not.toThrow();
  });
  test("list minItems + item validation", () => {
    expect(run({ ...ok, rows: [] })).toThrow(/rows/);
    expect(run({ ...ok, rows: [{ w: 1 }] })).toThrow(/f/);
    expect(run({ ...ok, rows: [{ f: "a", w: -1 }] })).toThrow(/w/);
  });
  test("field-picker checks existence when collection + fields available", () => {
    const getFields = stubFields({ name: {}, title: {} });
    expect(run({ ...ok, field: "name" }, "posts", getFields)).not.toThrow();
    expect(run({ ...ok, field: "nope" }, "posts", getFields)).toThrow(/nope/);
    expect(run({ ...ok, fields: ["name", "nope"] }, "posts", getFields)).toThrow(/nope/);
    // dotted paths (relations) are not existence-checked
    expect(run({ ...ok, field: "author.name" }, "posts", getFields)).not.toThrow();
  });
  test("unknown config keys are allowed", () => expect(run({ ...ok, somethingElse: 1 })).not.toThrow());
});

describe("validateBlockData routes manifest-mode types through the manifest", () => {
  test("divider: non-string label rejected, string accepted", () => {
    expect(() => validateBlockData({ type: "divider", config: { label: 5 } }, noFields)).toThrow(/label/i);
    expect(() => validateBlockData({ type: "divider", config: { label: "Team" } }, noFields)).not.toThrow();
  });
  test("markdown: content required", () => {
    expect(() => validateBlockData({ type: "markdown", config: {} }, noFields)).toThrow(/content/i);
    expect(() => validateBlockData({ type: "markdown", config: { content: "# hi" } }, noFields)).not.toThrow();
  });
  test("iframe: url required and must be http(s)", () => {
    expect(() => validateBlockData({ type: "iframe", config: {} }, noFields)).toThrow(/url/i);
    expect(() => validateBlockData({ type: "iframe", config: { url: "ftp://x" } }, noFields)).toThrow(/url/i);
    expect(() => validateBlockData({ type: "iframe", config: { url: "https://x.dev", height: 480 } }, noFields)).not.toThrow();
  });
  test("legacy types still validate through the old chain", () => {
    expect(() => validateBlockData(
      { type: "table", collection: "posts", config: { columns: [{ field: "name" }] } },
      stubFields({ name: {} })
    )).not.toThrow();
    expect(() => validateBlockData({ type: "bogus" }, noFields)).toThrow(/type/);
  });
});
