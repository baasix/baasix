import { test, expect, describe } from "@jest/globals";
import { validateFormatRules, FORMAT_OPERATORS } from "../baasix/blocks/format-rules.js";
import { validateManifest } from "../baasix/blocks/manifest-types.js";
import { validateConfigAgainstManifest } from "../baasix/blocks/validate-from-manifest.js";

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
