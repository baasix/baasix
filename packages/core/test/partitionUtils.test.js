import { describe, test, expect } from "@jest/globals";
import {
  normalizePartitioning, validatePartitioning, getPartitionKeyColumns,
  partitionName, tenantPartitionName, periodsToEnsure,
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
