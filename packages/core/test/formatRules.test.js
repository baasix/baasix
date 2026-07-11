import { test, expect, describe } from "@jest/globals";
import { validateFormatRules, FORMAT_OPERATORS } from "../baasix/blocks/format-rules.js";
import { validateManifest } from "../baasix/blocks/manifest-types.js";
import { validateConfigAgainstManifest } from "../baasix/blocks/validate-from-manifest.js";
import { validateBlockData } from "../baasix/services/BlockConfigService.js";

const rule = (over = {}) => ({ field: "status", operator: "eq", value: "open", style: { textColor: "success" }, ...over });

describe("validateFormatRules", () => {
  test("valid rules pass", () => {
    expect(() => validateFormatRules([rule()], "formatting")).not.toThrow();
    expect(() => validateFormatRules([rule({ operator: "gt", value: 5, style: { background: "#fee2e2", bold: true } })], "formatting")).not.toThrow();
    expect(() => validateFormatRules([rule({ operator: "empty", value: undefined })], "formatting")).not.toThrow();
    expect(() => validateFormatRules([], "formatting")).not.toThrow();
  });
  test("non-array rejected", () => expect(() => validateFormatRules({}, "formatting")).toThrow(/formatting/));
  test("missing field rejected", () => expect(() => validateFormatRules([rule({ field: "" })], "formatting")).toThrow(/field/));
  test("unknown operator rejected", () => expect(() => validateFormatRules([rule({ operator: "matches" })], "formatting")).toThrow(/operator/));
  test("value required unless empty/notEmpty", () => {
    expect(() => validateFormatRules([rule({ value: undefined })], "formatting")).toThrow(/value/);
    expect(() => validateFormatRules([rule({ operator: "notEmpty", value: undefined })], "formatting")).not.toThrow();
  });
  test("bad style color rejected; bad icon rejected; empty style rejected", () => {
    expect(() => validateFormatRules([rule({ style: { textColor: "url(x)" } })], "formatting")).toThrow(/textColor/);
    expect(() => validateFormatRules([rule({ style: { icon: "Not An Icon!" } })], "formatting")).toThrow(/icon/);
    expect(() => validateFormatRules([rule({ style: {} })], "formatting")).toThrow(/style/);
  });
  test("operator list is exactly the contract", () => {
    expect([...FORMAT_OPERATORS].sort()).toEqual(["contains", "empty", "eq", "gt", "gte", "lt", "lte", "neq", "notEmpty"]);
  });
});

describe("format-rules manifest kind", () => {
  const manifest = {
    type: "demo-fmt", label: "D", description: "d", icon: "square",
    category: "display", needsCollection: true, settingsMode: "manifest",
    settings: [{ key: "g", label: "G", fields: [
      { key: "formatting", label: "Formatting", kind: "format-rules" },
    ] }],
    defaults: {}, configVersion: 1,
  };
  test("meta-schema accepts the kind", () => expect(() => validateManifest(manifest)).not.toThrow());
  test("config validation routes through validateFormatRules", () => {
    const run = (v) => () => validateConfigAgainstManifest(manifest, { formatting: v }, "posts", () => ({ status: {} }));
    expect(run([rule()])).not.toThrow();
    expect(run([rule({ operator: "bogus" })])).toThrow(/operator/);
    expect(run("nope")).toThrow(/formatting/);
  });
});

const fields = () => ({ status: {}, name: {}, total: {} });

describe("legacy block formatting validation", () => {
  const tableBase = { type: "table", collection: "orders", config: { columns: [{ field: "status" }] } };
  test("table column + row rules valid", () => {
    expect(() => validateBlockData({ ...tableBase, config: { ...tableBase.config, formatting: {
      columns: { status: [rule()] },
      rows: [rule({ style: { background: "#fef9c3" } })],
    } } }, fields)).not.toThrow();
  });
  test("table formatting must be an object with known keys", () => {
    expect(() => validateBlockData({ ...tableBase, config: { ...tableBase.config, formatting: [rule()] } }, fields)).toThrow(/formatting/);
  });
  test("table row rules reject non-background styles", () => {
    expect(() => validateBlockData({ ...tableBase, config: { ...tableBase.config, formatting: {
      rows: [rule({ style: { textColor: "primary" } })],
    } } }, fields)).toThrow(/rows.*background/i);
  });
  test("table column rules validate rule shape", () => {
    expect(() => validateBlockData({ ...tableBase, config: { ...tableBase.config, formatting: {
      columns: { status: [rule({ operator: "bogus" })] },
    } } }, fields)).toThrow(/operator/);
  });
  test("details/cardlist/kanban/progress take a flat rules array", () => {
    expect(() => validateBlockData({ type: "details", collection: "orders",
      config: { fields: [{ field: "status" }], formatting: [rule()] } }, fields)).not.toThrow();
    expect(() => validateBlockData({ type: "progress", collection: "orders",
      config: { variant: "bar", aggregate: { function: "count", field: "*" }, target: 10, formatting: [rule({ field: "value", operator: "gt", value: 5 })] } }, fields)).not.toThrow();
    expect(() => validateBlockData({ type: "details", collection: "orders",
      config: { fields: [{ field: "status" }], formatting: { rows: [] } } }, fields)).toThrow(/formatting/);
  });
});

describe("value-formatting server validation (stat/comparison/leaderboard)", () => {
  const f = () => ({ status: {} });
  test("stat tile with bad value-formatting rejected", () => {
    expect(() => validateBlockData({ type: "stat", collection: "orders", config: {
      tiles: [{ label: "T", aggregate: { function: "count", field: "*" }, formatting: [{ field: "value", operator: "wat", value: 1, style: { bold: true } }] }],
    } }, f)).toThrow(/operator/);
  });
  test("stat tile with valid value-formatting accepted", () => {
    expect(() => validateBlockData({ type: "stat", collection: "orders", config: {
      tiles: [{ label: "T", aggregate: { function: "count", field: "*" }, formatting: [{ field: "value", operator: "gt", value: 5, style: { textColor: "destructive" } }] }],
    } }, f)).not.toThrow();
  });
  test("comparison with bad formatting rejected", () => {
    expect(() => validateBlockData({ type: "comparison", collection: "orders", config: {
      leftLabel: "A", rightLabel: "B", formatting: [{ field: "value", operator: "wat", value: 1, style: { bold: true } }],
    } }, f)).toThrow(/operator/);
  });
  test("leaderboard with valid value-formatting accepted", () => {
    expect(() => validateBlockData({ type: "leaderboard", collection: "orders", config: {
      groupField: "status", limit: 10, formatting: [{ field: "value", operator: "gt", value: 5, style: { textColor: "destructive" } }],
    } }, f)).not.toThrow();
  });
  test("leaderboard with bad formatting rejected", () => {
    expect(() => validateBlockData({ type: "leaderboard", collection: "orders", config: {
      groupField: "status", limit: 10, formatting: [{ field: "value", operator: "wat", value: 1, style: { bold: true } }],
    } }, f)).toThrow(/operator/);
  });
});
