import { makePathAlias } from "../baasix/utils/relationPathResolver.js";
import { test, expect, describe } from "@jest/globals";

/**
 * Join aliases must be unique per RELATION PATH, not per position in the join list.
 *
 * Callers deduplicate joins by alias (ItemsService.deduplicateJoins) over a single
 * shared joins array for the whole filter tree. When two sibling paths reached the
 * same table at the same depth they produced the SAME alias, so the second path's
 * join was dropped and its condition silently evaluated against the first path's
 * table — wrong permission results with no error raised.
 */

describe("makePathAlias", () => {
  const base = "class_schedule";

  test("sibling paths through the same target table get distinct aliases", () => {
    // The regression: `course.organisation` vs `faculty.organisation` both used
    // to resolve to `organisation_organisation_1`.
    const viaCourse = makePathAlias(makePathAlias(base, "course"), "organisation");
    const viaFaculty = makePathAlias(makePathAlias(base, "faculty"), "organisation");
    const direct = makePathAlias(base, "organisation");

    expect(viaCourse).not.toBe(viaFaculty);
    expect(viaCourse).not.toBe(direct);
    expect(viaFaculty).not.toBe(direct);
    expect(new Set([viaCourse, viaFaculty, direct]).size).toBe(3);
  });

  test("alias reflects the full path", () => {
    expect(makePathAlias(base, "course")).toBe("class_schedule__course");
    expect(makePathAlias("class_schedule__course", "organisation"))
      .toBe("class_schedule__course__organisation");
  });

  test("is deterministic", () => {
    expect(makePathAlias(base, "course")).toBe(makePathAlias(base, "course"));
  });

  test("respects Postgres's 63-char identifier limit", () => {
    const alias = makePathAlias("a".repeat(80), "organisation");
    expect(alias.length).toBeLessThanOrEqual(63);
  });

  test("truncation does not reintroduce collisions", () => {
    // Long paths sharing a prefix would collide if truncated without a hash,
    // silently recreating the original bug on deeply nested relations.
    const parent = "z".repeat(60);
    const a = makePathAlias(parent, "verticalAlpha");
    const b = makePathAlias(parent, "verticalBeta");

    expect(a.length).toBeLessThanOrEqual(63);
    expect(b.length).toBeLessThanOrEqual(63);
    expect(a).not.toBe(b);
  });
});
