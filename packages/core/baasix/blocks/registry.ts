import type { BlockManifest } from "./manifest-types.js";
import { validateManifest } from "./manifest-types.js";
import { LEGACY_MANIFESTS } from "./manifests/legacy.js";
import divider from "./manifests/divider.js";
import markdown from "./manifests/markdown.js";
import iframe from "./manifests/iframe.js";
import select from "./manifests/select.js";
import daterange from "./manifests/daterange.js";
import slider from "./manifests/slider.js";
import switchManifest from "./manifests/switch.js";
import rating from "./manifests/rating.js";

const registry = new Map<string, BlockManifest>();

/**
 * Register manifests, skipping (and logging) invalid or duplicate ones so a
 * bad manifest can never take the server down or break the palette.
 */
export function registerManifests(manifests: BlockManifest[]): void {
  for (const m of manifests) {
    try {
      validateManifest(m);
    } catch (error: any) {
      console.error(`[blocks] skipping invalid manifest: ${error?.message || error}`);
      continue;
    }
    if (registry.has(m.type)) {
      console.error(`[blocks] skipping duplicate manifest type "${m.type}"`);
      continue;
    }
    registry.set(m.type, m);
  }
}

registerManifests([...LEGACY_MANIFESTS, divider, markdown, iframe, select, daterange, slider, switchManifest, rating]);
// Wave-1 manifests register here in later tasks (imports appended above).

export function getManifest(type: string): BlockManifest | undefined {
  return registry.get(type);
}

export function listManifests(): BlockManifest[] {
  return [...registry.values()];
}

export function isKnownBlockType(type: string): boolean {
  return registry.has(type);
}

export function collectionRequirement(type: string): boolean | "optional" | undefined {
  return registry.get(type)?.needsCollection;
}
