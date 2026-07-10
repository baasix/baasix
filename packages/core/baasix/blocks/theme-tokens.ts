import { APIError } from "../utils/errorHandler.js";

/**
 * theme-tokens — shared token contract for baasix_Theme.tokens and
 * baasix_Page.options.theme (see docs/superpowers/sdd/task-3-brief.md).
 *
 * Color values are HSL triples ("<h> <s>% <l>%"), radius is a plain CSS
 * length (0.5rem, 8px). Values are validated with strict regexes — never
 * interpolated into CSS unescaped elsewhere — to rule out CSS injection via
 * theme token values.
 */
export const THEME_TOKENS = [
  "background", "foreground", "card", "card-foreground", "popover", "popover-foreground",
  "primary", "primary-foreground", "secondary", "secondary-foreground",
  "muted", "muted-foreground", "accent", "accent-foreground",
  "destructive", "destructive-foreground", "border", "input", "ring",
  "chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "radius",
] as const;
export type ThemeToken = (typeof THEME_TOKENS)[number];

const HSL_TRIPLE_RE = /^\d{1,3}(\.\d+)?\s+\d{1,3}(\.\d+)?%\s+\d{1,3}(\.\d+)?%$/;
const LENGTH_RE = /^\d+(\.\d+)?(px|rem|em)$/;
const SCHEMES = ["light", "dark"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bad(key: string, message: string): never {
  throw new APIError(`Invalid "${key}": ${message}`, 400);
}

function validateTokenSet(set: unknown, path: string): void {
  if (set == null || typeof set !== "object" || Array.isArray(set)) bad(path, "must be an object of token overrides");
  for (const [key, value] of Object.entries(set as Record<string, unknown>)) {
    if (!(THEME_TOKENS as readonly string[]).includes(key)) bad(key, `unknown theme token (allowed: ${THEME_TOKENS.join(", ")})`);
    if (typeof value !== "string") bad(key, "must be a string");
    if (key === "radius") {
      if (!LENGTH_RE.test(value)) bad("radius", "must be a plain CSS length like 0.5rem or 8px");
    } else if (!HSL_TRIPLE_RE.test(value)) {
      bad(key, `must be an HSL triple like "222.2 47.4% 11.2%"`);
    }
  }
}

/** Validate a baasix_Theme.tokens payload: { light?: {...}, dark?: {...} }. */
export function validateThemeTokens(tokens: unknown): void {
  if (tokens == null || typeof tokens !== "object" || Array.isArray(tokens)) bad("tokens", "must be an object with light/dark token sets");
  for (const [scheme, set] of Object.entries(tokens as Record<string, unknown>)) {
    if (!SCHEMES.includes(scheme)) bad(scheme, `unknown scheme (allowed: ${SCHEMES.join(", ")})`);
    validateTokenSet(set, `tokens.${scheme}`);
  }
}

/** Validate a baasix_Page.options.theme payload: { themeId?: UUID, overrides?: tokens }. */
export function validatePageThemeOption(theme: unknown): void {
  if (theme == null) return;
  if (typeof theme !== "object" || Array.isArray(theme)) bad("options.theme", "must be an object with themeId and/or overrides");
  const t = theme as { themeId?: unknown; overrides?: unknown };
  if (t.themeId != null && (typeof t.themeId !== "string" || !UUID_RE.test(t.themeId))) bad("themeId", "must be a theme id (UUID)");
  if (t.overrides != null) validateThemeTokens(t.overrides);
}
