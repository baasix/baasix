import { test, expect, describe } from "@jest/globals";
import { isExpressionString, assertBalancedExpression } from "../baasix/blocks/expressions.js";
import { validateBlockData } from "../baasix/services/BlockConfigService.js";
import { validateManifest } from "../baasix/blocks/manifest-types.js";
import { validateConfigAgainstManifest } from "../baasix/blocks/validate-from-manifest.js";

describe("isExpressionString / assertBalancedExpression", () => {
  test("detects {{ }}", () => {
    expect(isExpressionString("{{ input.x }}")).toBe(true);
    expect(isExpressionString("hi {{ user.name }}")).toBe(true);
    expect(isExpressionString("plain")).toBe(false);
    expect(isExpressionString(5)).toBe(false);
  });
  test("balanced/nonempty enforced", () => {
    expect(() => assertBalancedExpression("{{ input.x }}", "k")).not.toThrow();
    expect(() => assertBalancedExpression("{{ }}", "k")).toThrow(/k/);
    expect(() => assertBalancedExpression("{{ input.x", "k")).toThrow(/k/);
    expect(() => assertBalancedExpression("input.x }}", "k")).toThrow(/k/);
  });
});

describe("expression strings in manifest config", () => {
  const m = {
    type: "demo-x", label: "D", description: "d", icon: "square", category: "display",
    needsCollection: false, settingsMode: "manifest",
    settings: [{ key: "g", label: "G", fields: [
      { key: "count", label: "Count", kind: "number", min: 0 },
      { key: "on", label: "On", kind: "boolean" },
      { key: "tone", label: "Tone", kind: "select", options: [{ label: "A", value: "a" }] },
      { key: "tint", label: "Tint", kind: "color" },
    ] }],
    defaults: {}, configVersion: 1,
  };
  test("meta-schema still valid", () => expect(() => validateManifest(m)).not.toThrow());
  test("expression accepted on number/boolean/select (skip kind validation)", () => {
    const run = (cfg) => () => validateConfigAgainstManifest(m, cfg, null, () => ({}));
    expect(run({ count: "{{ input.n }}" })).not.toThrow();
    expect(run({ on: "{{ user.isAdmin }}" })).not.toThrow();
    expect(run({ tone: "{{ input.tone }}" })).not.toThrow();
  });
  test("expression REJECTED on color kind", () => {
    expect(() => validateConfigAgainstManifest(m, { tint: "{{ input.c }}" }, null, () => ({}))).toThrow(/tint/);
  });
  test("unbalanced expression rejected on any field", () => {
    expect(() => validateConfigAgainstManifest(m, { count: "{{ input.n" }, null, () => ({}))).toThrow(/count/);
  });
});

describe("expression strings on pattern-guarded text fields", () => {
  const m = {
    type: "demo-y", label: "D", description: "d", icon: "square", category: "display",
    needsCollection: false, settingsMode: "manifest",
    settings: [{ key: "g", label: "G", fields: [
      { key: "url", label: "URL", kind: "text", pattern: "^https?://" },
      { key: "label", label: "Label", kind: "text" },
    ] }],
    defaults: {}, configVersion: 1,
  };
  test("expression REJECTED on a text field with a pattern (URL-scheme guard)", () => {
    expect(() => validateConfigAgainstManifest(m, { url: "{{ input.u }}" }, null, () => ({}))).toThrow(/url/);
  });
  test("expression still ACCEPTED on a text field without a pattern", () => {
    expect(() => validateConfigAgainstManifest(m, { label: "{{ input.l }}" }, null, () => ({}))).not.toThrow();
  });
  test("a literal value matching the pattern is still accepted", () => {
    expect(() => validateConfigAgainstManifest(m, { url: "https://example.com" }, null, () => ({}))).not.toThrow();
  });
});

describe("strict envelopes reject expressions", () => {
  test("appearance color rejects expression", () => {
    expect(() => validateBlockData({ type: "markdown", config: { content: "x", appearance: { background: "{{ input.c }}" } } }, () => ({}))).toThrow(/background/);
  });
  test("format-rules style color rejects expression", () => {
    expect(() => validateBlockData({ type: "details", collection: "o", config: { fields: [{ field: "s" }], formatting: [{ field: "s", operator: "eq", value: "x", style: { textColor: "{{ input.c }}" } }] } }, () => ({ s: {} }))).toThrow(/textColor/);
  });
  test("expression allowed in a filter DSL value", () => {
    expect(() => validateBlockData({ type: "table", collection: "o", config: { columns: [{ field: "s" }], filter: { s: { eq: "{{ input.s }}" } } } }, () => ({ s: {} }))).not.toThrow();
  });
});
