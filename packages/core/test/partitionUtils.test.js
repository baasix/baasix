import { describe, test, expect } from "@jest/globals";
import {
  normalizePartitioning, validatePartitioning, getPartitionKeyColumns,
  partitionName, tenantPartitionName, periodsToEnsure, timeSuffixForStart,
} from "../baasix/utils/partitionUtils.js";

describe("partitionUtils", () => {
  test("normalize applies defaults", () => {
    expect(normalizePartitioning({ strategy: "time" })).toEqual({
      strategy: "time", timeField: "createdAt", interval: "year", premake: 1,
    });
    expect(normalizePartitioning(undefined)).toBeNull();
    expect(normalizePartitioning(null)).toBeNull();
  });

  test("normalize rejects bad values", () => {
    expect(() => normalizePartitioning({ strategy: "hash" })).toThrow(/strategy/i);
    expect(() => normalizePartitioning({ strategy: "time", interval: "week" })).toThrow(/interval/i);
    expect(() => normalizePartitioning({ strategy: "time", premake: 99 })).toThrow(/premake/i);
  });

  test("partition key columns per strategy", () => {
    expect(getPartitionKeyColumns(normalizePartitioning({ strategy: "tenant" }))).toEqual(["tenant_Id"]);
    expect(getPartitionKeyColumns(normalizePartitioning({ strategy: "time" }))).toEqual(["createdAt"]);
    expect(getPartitionKeyColumns(normalizePartitioning({ strategy: "tenant+time", timeField: "loggedAt" })))
      .toEqual(["tenant_Id", "loggedAt"]);
  });

  test("tenant partition name uses first 8 hex of uuid", () => {
    expect(tenantPartitionName("orders", "a1b2c3d4-e5f6-4a7b-8c9d-000011112222")).toBe("orders__t_a1b2c3d4");
    expect(() => tenantPartitionName("orders", "not-a-uuid; DROP TABLE x")).toThrow(/tenant id/i);
  });

  test("partitionName truncates >63 chars deterministically", () => {
    const long = "x".repeat(70);
    const name = partitionName(long, ["default"]);
    expect(name.length).toBeLessThanOrEqual(63);
    expect(name).toBe(partitionName(long, ["default"])); // deterministic
  });

  test("year periods with premake", () => {
    const periods = periodsToEnsure(new Date("2026-07-05T10:00:00Z"), "year", 1);
    expect(periods).toEqual([
      { suffix: "y2026", start: "2026-01-01 00:00:00+00", end: "2027-01-01 00:00:00+00" },
      { suffix: "y2027", start: "2027-01-01 00:00:00+00", end: "2028-01-01 00:00:00+00" },
    ]);
  });

  test("quarter and month periods", () => {
    expect(periodsToEnsure(new Date("2026-07-05T00:00:00Z"), "quarter", 0)).toEqual([
      { suffix: "2026q3", start: "2026-07-01 00:00:00+00", end: "2026-10-01 00:00:00+00" },
    ]);
    expect(periodsToEnsure(new Date("2026-12-15T00:00:00Z"), "month", 1)).toEqual([
      { suffix: "202612", start: "2026-12-01 00:00:00+00", end: "2027-01-01 00:00:00+00" },
      { suffix: "202701", start: "2027-01-01 00:00:00+00", end: "2027-02-01 00:00:00+00" },
    ]);
  });

  test("timeSuffixForStart matches periodsToEnsure suffixes (all intervals)", () => {
    // year: any date in 2026 → y2026
    expect(timeSuffixForStart("year", new Date("2026-01-01T00:00:00Z"))).toBe("y2026");
    expect(timeSuffixForStart("year", new Date("2026-11-30T23:59:59Z"))).toBe("y2026");
    // quarter: Q3 starts July → 2026q3; Q1 → 2026q1
    expect(timeSuffixForStart("quarter", new Date("2026-07-01T00:00:00Z"))).toBe("2026q3");
    expect(timeSuffixForStart("quarter", new Date("2026-02-15T00:00:00Z"))).toBe("2026q1");
    // month: zero-padded → 202607, 202612
    expect(timeSuffixForStart("month", new Date("2026-07-01T00:00:00Z"))).toBe("202607");
    expect(timeSuffixForStart("month", new Date("2026-12-01T00:00:00Z"))).toBe("202612");

    // Cross-check: for every interval, the suffix derived from a period's start string equals
    // the suffix periodsToEnsure produced. This guarantees the promotion rename lands on the
    // exact name the create/reconcile paths use.
    for (const interval of ["year", "quarter", "month"]) {
      for (const p of periodsToEnsure(new Date("2026-07-05T10:00:00Z"), interval, 3)) {
        const startDate = new Date(p.start.replace(" ", "T").replace("+00", "Z"));
        expect(timeSuffixForStart(interval, startDate)).toBe(p.suffix);
      }
    }
  });

  test("validatePartitioning gates env/system/timeField", () => {
    const base = { fields: { id: { type: "UUID", primaryKey: true } }, timestamps: true };
    const ctx = { isMultiTenant: true, pgOk: true };
    expect(validatePartitioning("orders", { ...base, partitioning: { strategy: "tenant" } }, ctx))
      .toMatchObject({ strategy: "tenant" });
    expect(() => validatePartitioning("orders", { ...base, partitioning: { strategy: "tenant" } },
      { isMultiTenant: false, pgOk: true })).toThrow(/MULTI_TENANT/);
    expect(() => validatePartitioning("baasix_File", { ...base, partitioning: { strategy: "tenant" } }, ctx))
      .toThrow(/system/i);
    expect(() => validatePartitioning("orders",
      { ...base, tenantScoped: false, partitioning: { strategy: "tenant" } }, ctx)).toThrow(/tenantScoped/);
    expect(() => validatePartitioning("orders",
      { ...base, timestamps: false, partitioning: { strategy: "time" } }, ctx)).toThrow(/timeField/i);
    expect(() => validatePartitioning("orders", { ...base, partitioning: { strategy: "time" } },
      { isMultiTenant: false, pgOk: false })).toThrow(/PostgreSQL 12/);
    expect(validatePartitioning("orders", base, ctx)).toBeNull();
  });
});
