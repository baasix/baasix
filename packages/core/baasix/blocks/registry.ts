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
import stat from "./manifests/stat.js";
import tree from "./manifests/tree.js";
import steps from "./manifests/steps.js";
import badge from "./manifests/badge.js";
import breadcrumbs from "./manifests/breadcrumbs.js";
import links from "./manifests/links.js";
import header from "./manifests/header.js";
import video from "./manifests/video.js";
import pdf from "./manifests/pdf.js";
import carousel from "./manifests/carousel.js";
import alert from "./manifests/alert.js";
import html from "./manifests/html.js";
import image from "./manifests/image.js";
import spacer from "./manifests/spacer.js";
import countdown from "./manifests/countdown.js";
import avatar from "./manifests/avatar.js";
import subpage from "./manifests/subpage.js";
import comparison from "./manifests/comparison.js";
import keyvalue from "./manifests/keyvalue.js";
import leaderboard from "./manifests/leaderboard.js";

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

registerManifests([...LEGACY_MANIFESTS, divider, markdown, iframe, select, daterange, slider, switchManifest, rating, stat, tree, steps, badge, breadcrumbs, links, header, video, pdf, carousel, alert, html, image, spacer, countdown, avatar, subpage, comparison, keyvalue, leaderboard]);

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
