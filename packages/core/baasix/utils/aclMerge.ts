/**
 * ACL merge utility — combines multiple named ACL entries assigned to one
 * permission into a single effective permission payload.
 *
 * Semantics are ADDITIVE (Directus-policy style): assigning more ACL entries
 * can only grant more access, never narrow it.
 * - conditions:     OR of all entries; an entry with no conditions means
 *                   unrestricted, which short-circuits the whole result to {}.
 * - fields:         union; all-null => null (unrestricted). A null list among
 *                   non-null lists contributes "*" so explicit names from
 *                   other entries survive (privilege fields are writable only
 *                   when explicitly named — see getFullPermissionData rawFields).
 * - defaultValues:  shallow merge in assignment order, later entries win.
 * - relConditions:  a relation is restricted only if EVERY entry restricts it
 *                   (key intersection); shared keys OR their conditions.
 */

export interface ACLEntry {
  id: string;
  name: string;
  description?: string | null;
  conditions?: Record<string, any> | null;
  relConditions?: Record<string, any> | null;
  fields?: string[] | null;
  defaultValues?: Record<string, any> | null;
  system?: boolean;
}

export interface MergedACL {
  conditions: Record<string, any>;
  relConditions: Record<string, any>;
  fields: string[] | null;
  defaultValues: Record<string, any>;
}

function isEmptyObject(value: Record<string, any> | null | undefined): boolean {
  return !value || Object.keys(value).length === 0;
}

export function mergeACLEntries(entries: ACLEntry[]): MergedACL {
  if (!entries || entries.length === 0) {
    throw new Error("mergeACLEntries requires at least one ACL entry");
  }

  // --- conditions: OR, unrestricted short-circuit ---
  let conditions: Record<string, any>;
  if (entries.some((e) => isEmptyObject(e.conditions))) {
    conditions = {};
  } else if (entries.length === 1) {
    conditions = entries[0].conditions!;
  } else {
    conditions = { OR: entries.map((e) => e.conditions) };
  }

  // --- fields: union; all-null => null; null among lists => "*" ---
  let fields: string[] | null = null;
  const hasAnyFields = entries.some((e) => Array.isArray(e.fields) && e.fields.length > 0);
  if (hasAnyFields) {
    const union: string[] = [];
    for (const entry of entries) {
      const list = Array.isArray(entry.fields) && entry.fields.length > 0 ? entry.fields : ["*"];
      for (const field of list) {
        if (!union.includes(field)) union.push(field);
      }
    }
    fields = union;
  }

  // --- defaultValues: shallow merge in order ---
  const defaultValues: Record<string, any> = {};
  for (const entry of entries) {
    if (entry.defaultValues && typeof entry.defaultValues === "object") {
      Object.assign(defaultValues, entry.defaultValues);
    }
  }

  // --- relConditions: key intersection, OR values ---
  let relConditions: Record<string, any> = {};
  if (!entries.some((e) => isEmptyObject(e.relConditions))) {
    const keySets = entries.map((e) => Object.keys(e.relConditions!));
    const sharedKeys = keySets.reduce((acc, keys) => acc.filter((k) => keys.includes(k)));
    for (const key of sharedKeys) {
      const values = entries.map((e) => e.relConditions![key]);
      relConditions[key] = values.length === 1 ? values[0] : { OR: values };
    }
  }

  return { conditions, relConditions, fields, defaultValues };
}
