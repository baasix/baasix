import { test, expect, describe } from "@jest/globals";
import { hasReadRestrictions, allIdsVisible } from "../baasix/services/SocketService";

/**
 * A12 (hybrid) — row-level realtime scoping decision logic.
 *
 * These pure helpers drive the per-subscriber broadcast decision:
 *  - hasReadRestrictions: does the role's read permission restrict rows? (false →
 *    fast path, deliver without a DB check; true → authoritative existence check)
 *  - allIdsVisible: deliver only if EVERY changed id is in the role's visible set
 *    (fails closed).
 * Full behavior is gated behind REALTIME_ROW_LEVEL_SCOPING (default off).
 */

describe("A12 — hasReadRestrictions (fast-path classifier)", () => {
  test("no conditions and no relConditions → unrestricted (fast path)", () => {
    expect(hasReadRestrictions({ conditions: {}, relConditions: {} })).toBe(false);
    expect(hasReadRestrictions({})).toBe(false);
    expect(hasReadRestrictions(null)).toBe(false);
    expect(hasReadRestrictions(undefined)).toBe(false);
  });

  test("flat conditions → restricted (needs a check)", () => {
    expect(hasReadRestrictions({ conditions: { owner_Id: { eq: "u1" } }, relConditions: {} })).toBe(true);
  });

  test("nested relConditions → restricted (needs a check)", () => {
    expect(
      hasReadRestrictions({ conditions: {}, relConditions: { project: { team_Id: { eq: "t1" } } } })
    ).toBe(true);
  });
});

describe("A12 — allIdsVisible (deliver decision, fails closed)", () => {
  test("delivers when every changed id is visible", () => {
    expect(allIdsVisible(["a"], ["a", "b"])).toBe(true);
    expect(allIdsVisible(["a", "b"], ["a", "b", "c"])).toBe(true);
  });

  test("withholds when any changed id is NOT visible", () => {
    expect(allIdsVisible(["a"], [])).toBe(false); // restricted row the user can't read
    expect(allIdsVisible(["a", "b"], ["a"])).toBe(false);
  });

  test("type-coerces ids (number vs string) so 5 matches '5'", () => {
    expect(allIdsVisible([5], ["5"])).toBe(true);
    expect(allIdsVisible(["5"], [5])).toBe(true);
  });

  test("no changed ids → trivially deliverable", () => {
    expect(allIdsVisible([], [])).toBe(true);
  });
});
