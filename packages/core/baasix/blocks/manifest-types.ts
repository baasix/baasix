/**
 * Block manifest contract — the single source of truth for a block type.
 * Serialized verbatim to the frontend via GET /pages/block-manifests, so
 * everything here must stay plain JSON (no functions, no classes).
 *
 * The type declarations below are hand-mirrored in the app repo at
 * app/src/types/block-manifest.ts. If you change one side, change the other.
 */

export type BlockCategory = "data" | "input" | "display" | "content" | "layout" | "navigation";

export type SettingsFieldKind =
  | "text" | "number" | "boolean" | "select" | "color" | "json" | "markdown"
  | "collection-picker" | "field-picker" | "filter-dsl" | "actions" | "list" | "custom" | "format-rules";

export interface SettingsFieldBase {
  key: string;
  label: string;
  kind: SettingsFieldKind;
  required?: boolean;
  default?: unknown;
  help?: string;
  /** Show only when a sibling field matches. `equals` wins over `truthy`. */
  showIf?: { field: string; equals?: unknown; truthy?: boolean };
}

export interface TextField extends SettingsFieldBase { kind: "text"; placeholder?: string; multiline?: boolean; pattern?: string; }
export interface NumberField extends SettingsFieldBase { kind: "number"; min?: number; max?: number; integer?: boolean; }
export interface BooleanField extends SettingsFieldBase { kind: "boolean"; }
export interface SelectField extends SettingsFieldBase { kind: "select"; options: Array<{ label: string; value: string }>; multiple?: boolean; }
/** Value is a theme token name (e.g. "primary") or a hex string ("#22c55e"). */
export interface ColorField extends SettingsFieldBase { kind: "color"; }
export interface JsonField extends SettingsFieldBase { kind: "json"; }
export interface MarkdownField extends SettingsFieldBase { kind: "markdown"; }
export interface CollectionPickerField extends SettingsFieldBase { kind: "collection-picker"; }
export interface FieldPickerField extends SettingsFieldBase { kind: "field-picker"; multiple?: boolean; filterTypes?: string[]; }
export interface FilterDslField extends SettingsFieldBase { kind: "filter-dsl"; }
export interface ActionsField extends SettingsFieldBase { kind: "actions"; }
export interface ListField extends SettingsFieldBase { kind: "list"; item: SettingsField[]; minItems?: number; maxItems?: number; }
/** Escape hatch: the app renders a bespoke editor registered under `slot`. */
export interface CustomField extends SettingsFieldBase { kind: "custom"; slot: string; }
export interface FormatRulesField extends SettingsFieldBase { kind: "format-rules"; }

export type SettingsField =
  | TextField | NumberField | BooleanField | SelectField | ColorField | JsonField | MarkdownField
  | CollectionPickerField | FieldPickerField | FilterDslField | ActionsField | ListField | CustomField | FormatRulesField;

export interface SettingsGroup { key: string; label: string; fields: SettingsField[]; }

export interface BlockManifest {
  type: string;
  label: string;
  description: string;
  /** lucide icon name, kebab-case (rendered by PageIcon in the app) */
  icon: string;
  category: BlockCategory;
  needsCollection: boolean | "optional";
  /**
   * "manifest": settings UI generated + config validated from this manifest.
   * "legacy": palette metadata only; the sheet keeps its hand-written section
   * and BlockConfigService keeps its inline validator for this type.
   */
  settingsMode: "manifest" | "legacy";
  settings: SettingsGroup[];
  defaults: Record<string, unknown>;
  configVersion: number;
}

const CATEGORIES: BlockCategory[] = ["data", "input", "display", "content", "layout", "navigation"];
const KINDS: SettingsFieldKind[] = [
  "text", "number", "boolean", "select", "color", "json", "markdown",
  "collection-picker", "field-picker", "filter-dsl", "actions", "list", "custom", "format-rules",
];

function fail(path: string, message: string): never {
  throw new Error(`Invalid block manifest at ${path}: ${message}`);
}

function validateFields(fields: SettingsField[], path: string, seenKeys: Set<string>, siblingKeys: Set<string>): void {
  if (!Array.isArray(fields)) fail(path, "fields must be an array");
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i] as SettingsField;
    const fpath = `${path}[${i}]`;
    if (!f || typeof f !== "object") fail(fpath, "field must be an object");
    if (typeof f.key !== "string" || !f.key) fail(fpath, "field key is required");
    if (typeof f.label !== "string" || !f.label) fail(`${fpath}(${f.key})`, "field label is required");
    if (!KINDS.includes(f.kind)) fail(`${fpath}(${f.key})`, `unknown kind "${(f as { kind?: string }).kind}"`);
    if (seenKeys.has(f.key)) fail(`${fpath}(${f.key})`, `duplicate field key "${f.key}"`);
    seenKeys.add(f.key);
    if (f.kind === "select" && (!Array.isArray((f as SelectField).options) || (f as SelectField).options.length === 0)) {
      fail(`${fpath}(${f.key})`, "select field requires non-empty options");
    }
    if (f.kind === "custom" && (typeof (f as CustomField).slot !== "string" || !(f as CustomField).slot)) {
      fail(`${fpath}(${f.key})`, "custom field requires a slot name");
    }
    if (f.kind === "list") {
      const item = (f as ListField).item;
      if (!Array.isArray(item) || item.length === 0) fail(`${fpath}(${f.key})`, "list field requires non-empty item fields");
      // list item keys live in their own namespace per row
      validateFields(item, `${fpath}(${f.key}).item`, new Set(), new Set(item.map((it) => it.key)));
    }
  }
  // showIf targets must exist among siblings (checked after all keys known)
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (f.showIf && !siblingKeys.has(f.showIf.field)) {
      fail(`${path}[${i}](${f.key})`, `showIf references unknown field "${f.showIf.field}"`);
    }
  }
}

export function validateManifest(manifest: BlockManifest): void {
  if (!manifest || typeof manifest !== "object") throw new Error("Invalid block manifest: not an object");
  const path = `manifest(${(manifest as { type?: string }).type ?? "?"})`;
  for (const key of ["type", "label", "description", "icon"] as const) {
    if (typeof manifest[key] !== "string" || !manifest[key]) fail(path, `"${key}" must be a non-empty string`);
  }
  if (!/^[a-z][a-z0-9-]*$/.test(manifest.type)) fail(path, `"type" must be kebab-case (got "${manifest.type}")`);
  if (!CATEGORIES.includes(manifest.category)) fail(path, `unknown category "${manifest.category}"`);
  if (manifest.needsCollection !== true && manifest.needsCollection !== false && manifest.needsCollection !== "optional") {
    fail(path, `"needsCollection" must be true, false, or "optional"`);
  }
  if (manifest.settingsMode !== "manifest" && manifest.settingsMode !== "legacy") {
    fail(path, `"settingsMode" must be "manifest" or "legacy"`);
  }
  if (!Array.isArray(manifest.settings)) fail(path, `"settings" must be an array`);
  if (!Number.isInteger(manifest.configVersion) || manifest.configVersion < 1) fail(path, `"configVersion" must be a positive integer`);
  if (manifest.defaults == null || typeof manifest.defaults !== "object" || Array.isArray(manifest.defaults)) {
    fail(path, `"defaults" must be an object`);
  }
  const seenGroupKeys = new Set<string>();
  const seenFieldKeys = new Set<string>();
  const allTopLevelKeys = new Set<string>();
  for (const group of manifest.settings) {
    for (const f of group?.fields ?? []) if (f && typeof f.key === "string") allTopLevelKeys.add(f.key);
  }
  for (let g = 0; g < manifest.settings.length; g++) {
    const group = manifest.settings[g];
    const gpath = `${path}.settings[${g}]`;
    if (!group || typeof group !== "object") fail(gpath, "group must be an object");
    if (typeof group.key !== "string" || !group.key) fail(gpath, "group key is required");
    if (typeof group.label !== "string" || !group.label) fail(`${gpath}(${group.key})`, "group label is required");
    if (seenGroupKeys.has(group.key)) fail(`${gpath}(${group.key})`, `duplicate group key "${group.key}"`);
    seenGroupKeys.add(group.key);
    validateFields(group.fields, `${gpath}(${group.key}).fields`, seenFieldKeys, allTopLevelKeys);
  }
  for (const key of Object.keys(manifest.defaults)) {
    if (!seenFieldKeys.has(key)) fail(path, `defaults references unknown field key "${key}"`);
  }
}
