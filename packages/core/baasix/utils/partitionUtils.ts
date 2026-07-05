import crypto from "crypto";
import { APIError } from "./errorHandler.js";

export interface PartitioningConfig {
  strategy: "tenant" | "time" | "tenant+time";
  timeField: string;
  interval: "month" | "quarter" | "year";
  premake: number;
}

const STRATEGIES = ["tenant", "time", "tenant+time"];
const INTERVALS = ["month", "quarter", "year"];
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const PG_MAX_IDENTIFIER = 63;

export function normalizePartitioning(raw: any): PartitioningConfig | null {
  if (raw === undefined || raw === null || raw === false) return null;
  if (typeof raw !== "object" || !raw.strategy) {
    throw new APIError("Invalid partitioning config", 400, "partitioning must be an object with a strategy");
  }
  if (!STRATEGIES.includes(raw.strategy)) {
    throw new APIError("Invalid partitioning strategy", 400,
      `strategy must be one of ${STRATEGIES.join(", ")}; got "${raw.strategy}"`);
  }
  const interval = raw.interval ?? "year";
  if (!INTERVALS.includes(interval)) {
    throw new APIError("Invalid partitioning interval", 400,
      `interval must be one of ${INTERVALS.join(", ")}; got "${raw.interval}"`);
  }
  const premake = raw.premake ?? 1;
  if (!Number.isInteger(premake) || premake < 0 || premake > 12) {
    throw new APIError("Invalid partitioning premake", 400, "premake must be an integer between 0 and 12");
  }
  return { strategy: raw.strategy, timeField: raw.timeField ?? "createdAt", interval, premake };
}

export function validatePartitioning(
  collectionName: string,
  schema: any,
  ctx: { isMultiTenant: boolean; pgOk: boolean }
): PartitioningConfig | null {
  const config = normalizePartitioning(schema?.partitioning);
  if (!config) return null;
  if (!ctx.pgOk) {
    throw new APIError("Partitioning requires PostgreSQL 12 or newer", 400);
  }
  if (collectionName.startsWith("baasix_")) {
    throw new APIError("Partitioning is not supported on system collections", 400);
  }
  if (config.strategy === "tenant" || config.strategy === "tenant+time") {
    if (!ctx.isMultiTenant) {
      throw new APIError(
        `Strategy "${config.strategy}" requires MULTI_TENANT=true`, 400);
    }
    if (schema?.tenantScoped === false) {
      throw new APIError(
        `Strategy "${config.strategy}" cannot be used with tenantScoped: false`, 400);
    }
  }
  if (config.strategy === "time" || config.strategy === "tenant+time") {
    const field = schema?.fields?.[config.timeField];
    const isDefaultTimestamp = config.timeField === "createdAt" && schema?.timestamps !== false;
    const fieldOk = field && (field.type === "DateTime" || field.type === "DateTime_NO_TZ") &&
      (field.allowNull === false || field.defaultValue?.type === "NOW");
    if (!isDefaultTimestamp && !fieldOk) {
      throw new APIError(
        `timeField "${config.timeField}" must be a DateTime field that is NOT NULL or has a NOW default`, 400);
    }
  }
  return config;
}

export function getPartitionKeyColumns(config: PartitioningConfig): string[] {
  if (config.strategy === "tenant") return ["tenant_Id"];
  if (config.strategy === "time") return [config.timeField];
  return ["tenant_Id", config.timeField];
}

export function partitionName(base: string, parts: string[]): string {
  const full = [base, ...parts].join("__");
  if (full.length <= PG_MAX_IDENTIFIER) return full;
  const hash = crypto.createHash("sha1").update(full).digest("hex").slice(0, 8);
  return `${full.slice(0, PG_MAX_IDENTIFIER - 10)}_h${hash}`;
}

export function tenantPartitionName(table: string, tenantId: string): string {
  if (!UUID_RE.test(tenantId)) {
    throw new APIError("Invalid tenant id", 400, `"${tenantId}" is not a valid tenant id (UUID expected)`);
  }
  return partitionName(table, [`t_${tenantId.replace(/-/g, "").slice(0, 8).toLowerCase()}`]);
}

function boundsFor(interval: string, year: number, monthIdx: number): { suffix: string; start: Date; end: Date } {
  if (interval === "year") {
    return { suffix: `y${year}`, start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year + 1, 0, 1)) };
  }
  if (interval === "quarter") {
    const q = Math.floor(monthIdx / 3);
    return {
      suffix: `${year}q${q + 1}`,
      start: new Date(Date.UTC(year, q * 3, 1)),
      end: new Date(Date.UTC(year, q * 3 + 3, 1)),
    };
  }
  return {
    suffix: `${year}${String(monthIdx + 1).padStart(2, "0")}`,
    start: new Date(Date.UTC(year, monthIdx, 1)),
    end: new Date(Date.UTC(year, monthIdx + 1, 1)),
  };
}

function fmt(d: Date): string {
  return `${d.toISOString().slice(0, 10)} 00:00:00+00`;
}

export function periodsToEnsure(
  now: Date, interval: "month" | "quarter" | "year", premake: number
): Array<{ suffix: string; start: string; end: string }> {
  const out: Array<{ suffix: string; start: string; end: string }> = [];
  let cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let i = 0; i <= premake; i++) {
    const b = boundsFor(interval, cursor.getUTCFullYear(), cursor.getUTCMonth());
    out.push({ suffix: b.suffix, start: fmt(b.start), end: fmt(b.end) });
    cursor = b.end; // next period starts where this one ends
  }
  return out;
}
