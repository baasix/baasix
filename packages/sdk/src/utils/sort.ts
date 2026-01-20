import type { Sort, SortDirection } from "../types";

/**
 * Normalize sort parameter to string format "field:direction,field2:direction2"
 * This is the format expected by the API for query string parameters.
 * 
 * @example
 * ```typescript
 * normalizeSort({ name: 'asc', createdAt: 'desc' })
 * // Returns: "name:asc,createdAt:desc"
 * 
 * normalizeSort(['-createdAt', 'name'])
 * // Returns: "createdAt:desc,name:asc"
 * 
 * normalizeSort('name:asc')
 * // Returns: "name:asc"
 * ```
 */
export function normalizeSort(sort: Sort | undefined): string | undefined {
  if (!sort) return undefined;

  // Already a string
  if (typeof sort === "string") {
    return sort;
  }

  // Array of strings like ['-createdAt', 'name']
  if (Array.isArray(sort)) {
    if (sort.length === 0) return undefined;
    
    // Check if it's array of objects { column, order }
    if (typeof sort[0] === "object" && "column" in sort[0]) {
      return (sort as { column: string; order: SortDirection }[])
        .map((s) => `${s.column}:${s.order.toLowerCase()}`)
        .join(",");
    }
    
    // Array of strings like ['-name', 'createdAt']
    return (sort as string[])
      .map((s) => {
        if (s.startsWith("-")) {
          return `${s.substring(1)}:desc`;
        }
        if (s.includes(":")) {
          return s;
        }
        return `${s}:asc`;
      })
      .join(",");
  }

  // Object like { name: 'asc', createdAt: 'desc' }
  if (typeof sort === "object") {
    const entries = Object.entries(sort as Record<string, SortDirection>);
    if (entries.length === 0) return undefined;
    
    return entries
      .map(([field, direction]) => `${field}:${direction.toLowerCase()}`)
      .join(",");
  }

  return undefined;
}
