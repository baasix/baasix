import { APIError } from "../utils/errorHandler.js";
import type { BlockManifest, SettingsField, ListField, SelectField, NumberField, TextField, FieldPickerField, CustomField } from "./manifest-types.js";
import { validateFormatRules } from "./format-rules.js";

export type GetFieldsFn = (collection: string) => Record<string, any> | null | undefined;

const HEX_RE = /^#([0-9a-fA-F]{3,8})$/;
const TOKEN_RE = /^[a-z][a-z0-9-]*$/;

function bad(key: string, message: string): never {
  throw new APIError(`Invalid "${key}": ${message}`, 400);
}

function isVisible(field: SettingsField, values: Record<string, unknown>): boolean {
  if (!field.showIf) return true;
  const actual = values[field.showIf.field];
  if ("equals" in field.showIf && field.showIf.equals !== undefined) return actual === field.showIf.equals;
  return !!actual;
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

// A `[]` is "missing" for the purposes of `required`, but only there: a
// non-required list/actions/multi-select/multi-field-picker field with an
// empty array still flows into validateField below exactly as it does today
// (e.g. so `minItems` on a non-required list is still enforced against a
// present-but-empty array, and a non-required field with no minItems still
// accepts `[]`).
function isEmptyForRequired(value: unknown): boolean {
  return isEmpty(value) || (Array.isArray(value) && value.length === 0);
}

function validateField(field: SettingsField, value: unknown, collection: string | null, getFields: GetFieldsFn): void {
  switch (field.kind) {
    case "text":
    case "markdown": {
      if (typeof value !== "string") bad(field.key, "must be a string");
      const pattern = (field as TextField).pattern;
      // Trim only for the pattern check (not the stored value) so incidental
      // leading/trailing whitespace (e.g. a pasted URL) doesn't fail a
      // pattern anchored at the start, mirroring the legacy iframe url trim.
      if (pattern && !new RegExp(pattern).test(value.trim())) bad(field.key, `must match ${pattern}`);
      return;
    }
    case "number": {
      const f = field as NumberField;
      if (typeof value !== "number" || !Number.isFinite(value)) bad(field.key, "must be a number");
      if (f.integer && !Number.isInteger(value)) bad(field.key, "must be an integer");
      if (f.min != null && value < f.min) bad(field.key, `must be >= ${f.min}`);
      if (f.max != null && value > f.max) bad(field.key, `must be <= ${f.max}`);
      return;
    }
    case "boolean": {
      if (typeof value !== "boolean") bad(field.key, "must be a boolean");
      return;
    }
    case "select": {
      const f = field as SelectField;
      const allowed = f.options.map((o) => o.value);
      if (f.multiple) {
        if (!Array.isArray(value) || value.some((v) => !allowed.includes(v as string))) {
          bad(field.key, `must be an array of: ${allowed.join(", ")}`);
        }
      } else if (!allowed.includes(value as string)) {
        bad(field.key, `must be one of: ${allowed.join(", ")}`);
      }
      return;
    }
    case "color": {
      if (typeof value !== "string" || !(HEX_RE.test(value) || TOKEN_RE.test(value))) {
        bad(field.key, "must be a theme token or hex color");
      }
      return;
    }
    case "json":
    case "filter-dsl": {
      if (value == null || typeof value !== "object") bad(field.key, "must be an object or array");
      return;
    }
    case "collection-picker": {
      if (typeof value !== "string" || !value) bad(field.key, "must be a collection name");
      return;
    }
    case "field-picker": {
      const f = field as FieldPickerField;
      const names = f.multiple ? value : [value];
      if (f.multiple && !Array.isArray(value)) bad(field.key, "must be an array of field names");
      const fields = collection ? getFields(collection) : null;
      for (const name of names as unknown[]) {
        if (typeof name !== "string" || !name) bad(field.key, "must be a field name");
        // dotted paths traverse relations; existence is checked only for plain names
        if (fields && !name.includes(".") && !(name in fields)) {
          bad(field.key, `field "${name}" does not exist on "${collection}"`);
        }
      }
      return;
    }
    case "actions": {
      if (!Array.isArray(value)) bad(field.key, "must be an array of actions");
      for (const item of value) {
        if (item == null || typeof item !== "object") bad(field.key, "each action must be an object");
        const a = item as { label?: unknown; action?: { type?: unknown } };
        if (typeof a.label !== "string" || !a.label) bad(field.key, "each action requires a label");
        if (a.action == null || typeof a.action !== "object" || typeof a.action.type !== "string") {
          bad(field.key, "each action requires an action object with a type");
        }
      }
      return;
    }
    case "list": {
      const f = field as ListField;
      if (!Array.isArray(value)) bad(field.key, "must be an array");
      if (f.minItems != null && value.length < f.minItems) bad(field.key, `requires at least ${f.minItems} item(s)`);
      if (f.maxItems != null && value.length > f.maxItems) bad(field.key, `allows at most ${f.maxItems} item(s)`);
      for (const row of value) {
        if (row == null || typeof row !== "object" || Array.isArray(row)) bad(field.key, "each item must be an object");
        validateValues(f.item, row as Record<string, unknown>, collection, getFields);
      }
      return;
    }
    case "format-rules": {
      validateFormatRules(value, field.key);
      return;
    }
    case "custom":
      return; // validated by the per-block hook if one exists
  }
}

function validateValues(fields: SettingsField[], values: Record<string, unknown>, collection: string | null, getFields: GetFieldsFn): void {
  for (const field of fields) {
    const value = values[field.key];
    const visible = isVisible(field, values);
    if (field.required && visible && isEmptyForRequired(value)) bad(field.key, "is required");
    if (isEmpty(value)) continue;
    if (field.kind !== "custom" && !visible) continue; // hidden values are ignored, not validated
    validateField(field, value, collection, getFields);
  }
}

export function validateConfigAgainstManifest(
  manifest: BlockManifest,
  config: Record<string, unknown> | null,
  collection: string | null,
  getFields: GetFieldsFn
): void {
  const values = config ?? {};
  const fields = manifest.settings.flatMap((g) => g.fields);
  validateValues(fields, values, collection, getFields);
}
