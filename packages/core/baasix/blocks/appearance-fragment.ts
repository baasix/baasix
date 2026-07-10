import { APIError } from "../utils/errorHandler.js";
import type { SettingsGroup } from "./manifest-types.js";

const HEX_RE = /^#([0-9a-fA-F]{3,8})$/;
const TOKEN_RE = /^[a-z][a-z0-9-]*$/;
const SHADOWS = ["none", "sm", "md", "lg"];
const PADDINGS = ["none", "sm", "md", "lg"];
const ALIGNS = ["left", "center", "right"];
const TITLE_SIZES = ["sm", "md", "lg"];

/** Serve-time settings group appended to every manifest for the app's Appearance tab. */
export const APPEARANCE_GROUP: SettingsGroup = {
  key: "appearance",
  label: "Appearance",
  fields: [
    { key: "background", label: "Background", kind: "color" },
    { key: "borderColor", label: "Border color", kind: "color" },
    { key: "borderWidth", label: "Border width (px)", kind: "number", min: 0, max: 8, integer: true },
    { key: "borderRadius", label: "Corner radius (px)", kind: "number", min: 0, max: 32, integer: true },
    { key: "shadow", label: "Shadow", kind: "select", options: SHADOWS.map((v) => ({ label: v, value: v })) },
    { key: "padding", label: "Padding", kind: "select", options: PADDINGS.map((v) => ({ label: v, value: v })) },
    { key: "hideCard", label: "Hide card chrome", kind: "boolean" },
    { key: "titleAlign", label: "Title alignment", kind: "select", options: ALIGNS.map((v) => ({ label: v, value: v })) },
    { key: "titleSize", label: "Title size", kind: "select", options: TITLE_SIZES.map((v) => ({ label: v, value: v })) },
    { key: "titleColor", label: "Title color", kind: "color" },
    { key: "accent", label: "Accent color", kind: "color" },
  ],
};

function isColor(v: unknown): boolean {
  return typeof v === "string" && (HEX_RE.test(v) || TOKEN_RE.test(v));
}

export function validateAppearance(appearance: unknown): void {
  if (appearance == null) return;
  if (typeof appearance !== "object" || Array.isArray(appearance)) {
    throw new APIError(`Invalid "appearance": must be an object`, 400);
  }
  const a = appearance as Record<string, unknown>;
  const colorKeys = ["background", "borderColor", "titleColor", "accent"];
  for (const key of colorKeys) {
    if (a[key] != null && !isColor(a[key])) throw new APIError(`Invalid "${key}": must be a theme token or hex color`, 400);
  }
  for (const [key, max] of [["borderWidth", 8], ["borderRadius", 32]] as const) {
    if (a[key] != null && (typeof a[key] !== "number" || !Number.isInteger(a[key]) || (a[key] as number) < 0 || (a[key] as number) > max)) {
      throw new APIError(`Invalid "${key}": must be an integer between 0 and ${max}`, 400);
    }
  }
  for (const [key, allowed] of [["shadow", SHADOWS], ["padding", PADDINGS], ["titleAlign", ALIGNS], ["titleSize", TITLE_SIZES]] as const) {
    if (a[key] != null && !allowed.includes(a[key] as string)) {
      throw new APIError(`Invalid "${key}": must be one of ${allowed.join(", ")}`, 400);
    }
  }
  if (a.hideCard != null && typeof a.hideCard !== "boolean") {
    throw new APIError(`Invalid "hideCard": must be a boolean`, 400);
  }
}
