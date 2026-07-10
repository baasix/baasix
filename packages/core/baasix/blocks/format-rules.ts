import { APIError } from "../utils/errorHandler.js";

export const FORMAT_OPERATORS = [
  "eq", "neq", "gt", "gte", "lt", "lte", "contains", "empty", "notEmpty",
] as const;
export type FormatOperator = (typeof FORMAT_OPERATORS)[number];

export interface FormatStyle {
  textColor?: string;   // theme token or hex
  background?: string;
  icon?: string;        // lucide icon name (kebab or PascalCase)
  bold?: boolean;
}

export interface FormatRule {
  field: string;
  operator: FormatOperator;
  value?: string | number;
  style: FormatStyle;
}

const HEX_RE = /^#([0-9a-fA-F]{3,8})$/;
const TOKEN_RE = /^[a-z][a-z0-9-]*$/;
const ICON_RE = /^[a-zA-Z][a-zA-Z0-9-]*$/;
const VALUELESS: FormatOperator[] = ["empty", "notEmpty"];

function bad(key: string, message: string): never {
  throw new APIError(`Invalid "${key}": ${message}`, 400);
}

function isColor(v: unknown): boolean {
  return typeof v === "string" && (HEX_RE.test(v) || TOKEN_RE.test(v));
}

export function validateFormatRules(rules: unknown, key: string): void {
  if (!Array.isArray(rules)) bad(key, "must be an array of format rules");
  for (const r of rules as FormatRule[]) {
    if (r == null || typeof r !== "object") bad(key, "each rule must be an object");
    if (typeof r.field !== "string" || !r.field) bad(`${key}.field`, "is required");
    if (!FORMAT_OPERATORS.includes(r.operator)) bad(`${key}.operator`, `must be one of: ${FORMAT_OPERATORS.join(", ")}`);
    if (!VALUELESS.includes(r.operator)) {
      if (r.value == null || r.value === "") bad(`${key}.value`, `is required for operator "${r.operator}"`);
      if (typeof r.value !== "string" && typeof r.value !== "number") bad(`${key}.value`, "must be a string or number");
    }
    if (r.style == null || typeof r.style !== "object") bad(`${key}.style`, "is required");
    const { textColor, background, icon, bold } = r.style;
    if (textColor == null && background == null && icon == null && bold == null) bad(`${key}.style`, "must set at least one of textColor/background/icon/bold");
    if (textColor != null && !isColor(textColor)) bad(`${key}.textColor`, "must be a theme token or hex color");
    if (background != null && !isColor(background)) bad(`${key}.background`, "must be a theme token or hex color");
    if (icon != null && (typeof icon !== "string" || !ICON_RE.test(icon))) bad(`${key}.icon`, "must be a lucide icon name");
    if (bold != null && typeof bold !== "boolean") bad(`${key}.bold`, "must be a boolean");
  }
}
