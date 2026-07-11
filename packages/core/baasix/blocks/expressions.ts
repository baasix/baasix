import { APIError } from "../utils/errorHandler.js";

/**
 * expressions — the {{ }} runtime-expression contract for block config
 * values (see docs/superpowers/sdd/task-4-brief.md).
 *
 * Most manifest-driven config fields (text/number/boolean/select/json/...)
 * may hold a `{{ expr }}` string instead of a literal value: the server
 * skips kind validation for it (the actual expression is parsed/evaluated
 * client-side or at render time) and only checks brace balance here — a
 * cheap structural guard, NOT a JS/expression parser.
 *
 * Fields where an expression string would let a client-controlled runtime
 * value flow somewhere security- or rendering-sensitive (colors that could
 * end up in inline CSS, theme tokens, format-rules "kind" itself, and
 * picker fields that must name a real collection/field) reject `{{` outright
 * — see EXPRESSION_FORBIDDEN_KINDS in validate-from-manifest.ts and the
 * isExpressionString checks in appearance-fragment.ts, format-rules.ts and
 * theme-tokens.ts.
 */

export function isExpressionString(value: unknown): boolean {
  return typeof value === "string" && value.includes("{{") && value.includes("}}");
}

/** Cheap structural check — NOT a JS parse (that happens client-side). Every {{ needs a following }}, no empty braces, no stray }}. */
export function assertBalancedExpression(value: string, key: string): void {
  let i = 0;
  let count = 0;
  while (i < value.length) {
    const open = value.indexOf("{{", i);
    if (open === -1) break;
    const close = value.indexOf("}}", open + 2);
    if (close === -1) throw new APIError(`Invalid "${key}": unterminated {{ expression }}`, 400);
    if (value.slice(open + 2, close).trim() === "") throw new APIError(`Invalid "${key}": empty {{ }} expression`, 400);
    count++;
    i = close + 2;
  }
  if (value.includes("}}") && count === 0) throw new APIError(`Invalid "${key}": stray }} without {{`, 400);
}
