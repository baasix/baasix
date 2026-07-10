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
  test("non-required multi-select with [] remains valid (not treated as missing)", () => expect(run({ ...ok, tags: [] })).not.toThrow());
});

describe("required treats empty arrays as missing (validator-wide)", () => {
  const FIXTURE_REQ_LIST = {
    ...FIXTURE,
    settings: [{ key: "g", label: "G", fields: [
      { key: "req", label: "Req", kind: "actions", required: true },
      { key: "optNoMin", label: "OptNoMin", kind: "list", item: [{ key: "f", label: "F", kind: "text" }] },
    ] }],
  };
  const run = (config) => () => validateConfigAgainstManifest(FIXTURE_REQ_LIST, config, null, noFields);

  test("required actions field with [] is rejected as missing", () => {
    expect(run({ req: [] })).toThrow(/req/);
  });
  test("required actions field with a non-empty array passes", () => {
    expect(run({ req: [{ label: "A", action: { type: "page", slug: "a" } }] })).not.toThrow();
  });
  test("non-required list field (no minItems) with [] remains valid", () => {
    expect(run({ req: [{ label: "A", action: { type: "page", slug: "a" } }], optNoMin: [] })).not.toThrow();
  });
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
  test("iframe: url scheme match is case-insensitive, javascript: still rejected", () => {
    expect(() => validateBlockData({ type: "iframe", config: { url: "HTTPS://x.dev" } }, noFields)).not.toThrow();
    expect(() => validateBlockData({ type: "iframe", config: { url: "javascript:alert(1)" } }, noFields)).toThrow(/url/i);
  });
  test("legacy types still validate through the old chain", () => {
    expect(() => validateBlockData(
      { type: "table", collection: "posts", config: { columns: [{ field: "name" }] } },
      stubFields({ name: {} })
    )).not.toThrow();
    expect(() => validateBlockData({ type: "bogus" }, noFields)).toThrow(/type/);
  });
});

describe("wave-1 input block validation", () => {
  const cases = [
    { name: "select static valid", data: { type: "select", config: { name: "status", optionsSource: "static", options: [{ label: "Open", value: "open" }] } }, ok: true },
    { name: "select missing name", data: { type: "select", config: { optionsSource: "static" } }, ok: false, err: /name/ },
    { name: "select bad name pattern", data: { type: "select", config: { name: "9bad", optionsSource: "static" } }, ok: false, err: /name/ },
    { name: "daterange valid", data: { type: "daterange", config: { name: "created", mode: "range" } }, ok: true },
    { name: "daterange bad mode", data: { type: "daterange", config: { name: "created", mode: "weekly" } }, ok: false, err: /mode/ },
    { name: "slider valid", data: { type: "slider", config: { name: "price", min: 0, max: 100 } }, ok: true },
    { name: "slider missing bounds", data: { type: "slider", config: { name: "price" } }, ok: false, err: /min|max/ },
    { name: "switch segmented needs options rows valid", data: { type: "switch", config: { name: "mode", variant: "segmented", options: [{ label: "A", value: "a" }] } }, ok: true },
    { name: "switch bad variant", data: { type: "switch", config: { name: "m", variant: "dial" } }, ok: false, err: /variant/ },
    { name: "rating input valid", data: { type: "rating", config: { mode: "input", name: "score", max: 5 } }, ok: true },
    { name: "rating max too big", data: { type: "rating", config: { mode: "input", name: "score", max: 50 } }, ok: false, err: /max/ },
    { name: "unknown type still rejected", data: { type: "carouselx" }, ok: false, err: /type/ },
  ];
  for (const c of cases) {
    test(c.name, () => {
      const fn = () => validateBlockData(c.data, noFields);
      if (c.ok) expect(fn).not.toThrow();
      else expect(fn).toThrow(c.err);
    });
  }
});

describe("wave-1 display block validation", () => {
  const fields = stubFields({ name: {}, parent_Id: {}, status: {} });
  const cases = [
    { name: "stat valid", data: { type: "stat", collection: "posts", config: { tiles: [{ label: "Total", aggregate: { function: "count" } }] } }, ok: true },
    { name: "stat empty tiles", data: { type: "stat", collection: "posts", config: { tiles: [] } }, ok: false, err: /tiles/ },
    { name: "stat missing collection", data: { type: "stat", config: { tiles: [{ label: "T" }] } }, ok: false, err: /collection/i },
    // Per-tile value formatting is `kind: "custom"` (slot "format-rules-value")
    // — custom kinds skip generic validation, so any array-shaped value on a
    // tile is accepted here; this just confirms the field doesn't get rejected.
    { name: "stat tile with formatting accepted", data: { type: "stat", collection: "posts", config: { tiles: [{ label: "Total", aggregate: { function: "count" }, formatting: [{ field: "value", operator: "gt", value: 100, style: { textColor: "destructive" } }] }] } }, ok: true },
    { name: "tree valid", data: { type: "tree", collection: "cats", config: { labelField: "name", parentField: "parent_Id" } }, ok: true },
    { name: "tree missing parentField", data: { type: "tree", collection: "cats", config: { labelField: "name" } }, ok: false, err: /parentField/ },
    { name: "tree unknown field", data: { type: "tree", collection: "cats", config: { labelField: "nope", parentField: "parent_Id" } }, ok: false, err: /nope/ },
    { name: "steps valid", data: { type: "steps", collection: "orders", config: { statusField: "status", steps: [{ label: "A", value: "a" }, { label: "B", value: "b" }] } }, ok: true },
    { name: "steps too few", data: { type: "steps", collection: "orders", config: { statusField: "status", steps: [{ label: "A", value: "a" }] } }, ok: false, err: /steps/ },
    { name: "badge valid with colors", data: { type: "badge", collection: "orders", config: { field: "status", colorMap: [{ value: "open", color: "success" }] } }, ok: true },
    { name: "badge bad color", data: { type: "badge", collection: "orders", config: { field: "status", colorMap: [{ value: "open", color: "url(x)" }] } }, ok: false, err: /color/ },
  ];
  for (const c of cases) {
    test(c.name, () => {
      const fn = () => validateBlockData(c.data, fields);
      if (c.ok) expect(fn).not.toThrow();
      else expect(fn).toThrow(c.err);
    });
  }
});

describe("wave-1 navigation block validation", () => {
  const cases = [
    { name: "breadcrumbs auto valid", data: { type: "breadcrumbs", config: { mode: "auto" } }, ok: true },
    { name: "breadcrumbs bad mode", data: { type: "breadcrumbs", config: { mode: "magic" } }, ok: false, err: /mode/ },
    { name: "links valid", data: { type: "links", config: { layout: "grid", items: [{ label: "Home", action: { type: "page", slug: "home" } }] } }, ok: true },
    { name: "links missing items", data: { type: "links", config: { layout: "grid" } }, ok: false, err: /items/ },
    { name: "links empty items array", data: { type: "links", config: { layout: "grid", items: [] } }, ok: false, err: /items/ },
    { name: "links action without label", data: { type: "links", config: { items: [{ action: { type: "page", slug: "x" } }] } }, ok: false, err: /label/ },
    { name: "header valid", data: { type: "header", config: { heading: "Dashboard" } }, ok: true },
    { name: "header missing heading", data: { type: "header", config: {} }, ok: false, err: /heading/ },
  ];
  for (const c of cases) {
    test(c.name, () => {
      const fn = () => validateBlockData(c.data, noFields);
      if (c.ok) expect(fn).not.toThrow();
      else expect(fn).toThrow(c.err);
    });
  }
});

describe("wave-1 content block validation", () => {
  const cases = [
    { name: "video url valid", data: { type: "video", config: { source: "url", url: "https://youtu.be/x", kind: "video" } }, ok: true },
    { name: "video bad url", data: { type: "video", config: { source: "url", url: "javascript:alert(1)" } }, ok: false, err: /url/ },
    { name: "video url scheme case-insensitive", data: { type: "video", config: { source: "url", url: "HtTpS://youtu.be/x", kind: "video" } }, ok: true },
    { name: "pdf valid", data: { type: "pdf", config: { source: "url", url: "https://x.dev/a.pdf" } }, ok: true },
    { name: "pdf url scheme case-insensitive", data: { type: "pdf", config: { source: "url", url: "HTTP://x.dev/a.pdf" } }, ok: true },
    { name: "carousel static valid", data: { type: "carousel", config: { source: "static", images: [{ url: "https://x.dev/a.png" }] } }, ok: true },
    { name: "carousel bad image url", data: { type: "carousel", config: { source: "static", images: [{ url: "notaurl" }] } }, ok: false, err: /url/ },
    { name: "carousel image url scheme case-insensitive", data: { type: "carousel", config: { source: "static", images: [{ url: "HTTPS://x.dev/a.png" }] } }, ok: true },
    { name: "alert valid", data: { type: "alert", config: { tone: "warning", body: "**careful**" } }, ok: true },
    { name: "alert missing body", data: { type: "alert", config: { tone: "info" } }, ok: false, err: /body/ },
    { name: "alert bad tone", data: { type: "alert", config: { tone: "loud", body: "x" } }, ok: false, err: /tone/ },
    { name: "html valid", data: { type: "html", config: { html: "<b>hi</b>" } }, ok: true },
    { name: "html missing html", data: { type: "html", config: {} }, ok: false, err: /html/ },
  ];
  for (const c of cases) {
    test(c.name, () => {
      const fn = () => validateBlockData(c.data, noFields);
      if (c.ok) expect(fn).not.toThrow();
      else expect(fn).toThrow(c.err);
    });
  }
});

describe("appearance validation (common envelope)", () => {
  const block = (appearance) => ({ type: "divider", config: { appearance } });
  test("valid appearance accepted on any type", () => {
    expect(() => validateBlockData(block({
      background: "muted", borderColor: "#334155", borderWidth: 1, borderRadius: 12,
      shadow: "sm", padding: "md", hideCard: true, titleAlign: "center", titleSize: "lg",
      titleColor: "primary", accent: "#22c55e",
    }), noFields)).not.toThrow();
  });
  test("bad values rejected", () => {
    expect(() => validateBlockData(block({ shadow: "huge" }), noFields)).toThrow(/shadow/);
    expect(() => validateBlockData(block({ borderWidth: 99 }), noFields)).toThrow(/borderWidth/);
    expect(() => validateBlockData(block({ background: "url(x)" }), noFields)).toThrow(/background/);
    expect(() => validateBlockData(block({ hideCard: "yes" }), noFields)).toThrow(/hideCard/);
    expect(() => validateBlockData(block("solid"), noFields)).toThrow(/appearance/);
  });
  test("appearance is validated for legacy types too", () => {
    expect(() => validateBlockData(
      { type: "table", collection: "posts", config: { columns: [{ field: "name" }], appearance: { shadow: "huge" } } },
      stubFields({ name: {} })
    )).toThrow(/shadow/);
  });
});

describe("wave-2 block validation", () => {
  const f = stubFields({ name: {}, status: {}, avatarFile: {}, total: {} });
  const cases = [
    { name: "image url valid", data: { type: "image", config: { source: "url", url: "https://x.dev/a.png" } }, ok: true },
    { name: "image bad url", data: { type: "image", config: { source: "url", url: "javascript:x" } }, ok: false, err: /url/ },
    { name: "spacer valid", data: { type: "spacer", config: { height: 24 } }, ok: true },
    { name: "spacer out of range", data: { type: "spacer", config: { height: 1000 } }, ok: false, err: /height/ },
    { name: "countdown valid", data: { type: "countdown", config: { mode: "countdown", target: "2026-12-31T00:00:00Z" } }, ok: true },
    { name: "avatar valid", data: { type: "avatar", collection: "users", config: { nameField: "name", max: 5 } }, ok: true },
    { name: "avatar missing nameField", data: { type: "avatar", collection: "users", config: {} }, ok: false, err: /nameField/ },
    { name: "subpage valid", data: { type: "subpage", config: { slug: "dash" } }, ok: true },
    { name: "subpage missing slug", data: { type: "subpage", config: {} }, ok: false, err: /slug/ },
    { name: "comparison valid", data: { type: "comparison", collection: "orders", config: { leftLabel: "This", rightLabel: "Last" } }, ok: true },
    { name: "keyvalue valid with formatting", data: { type: "keyvalue", collection: "orders", config: { fields: [{ field: "status" }], formatting: [{ field: "status", operator: "eq", value: "open", style: { bold: true } }] } }, ok: true },
    { name: "keyvalue bad formatting", data: { type: "keyvalue", collection: "orders", config: { fields: [{ field: "status" }], formatting: [{ field: "status", operator: "wat", value: 1, style: { bold: true } }] } }, ok: false, err: /operator/ },
    { name: "leaderboard valid", data: { type: "leaderboard", collection: "orders", config: { groupField: "status", limit: 10 } }, ok: true },
    { name: "leaderboard limit bounds", data: { type: "leaderboard", collection: "orders", config: { groupField: "status", limit: 100 } }, ok: false, err: /limit/ },
    { name: "badge distinct mode valid", data: { type: "badge", collection: "orders", config: { mode: "distinct", field: "status" } }, ok: true },
    { name: "badge bad mode", data: { type: "badge", collection: "orders", config: { mode: "grouped", field: "status" } }, ok: false, err: /mode/ },
  ];
  for (const c of cases) {
    test(c.name, () => {
      const fn = () => validateBlockData(c.data, f);
      if (c.ok) expect(fn).not.toThrow(); else expect(fn).toThrow(c.err);
    });
  }
});
