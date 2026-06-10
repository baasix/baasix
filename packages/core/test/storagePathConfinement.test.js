import { test, expect, describe } from "@jest/globals";
import path from "path";
import { resolveStorageKey } from "../baasix/services/StorageService";

/**
 * A5 — path traversal confinement.
 *
 * resolveStorageKey is the single guard every local-disk storage operation uses
 * (save/get/delete in StorageService, AssetsService, FilesService). It must keep
 * any client-influenced filename/key inside the storage root.
 */

const BASE = path.resolve("/var/lib/baasix/storage");

describe("resolveStorageKey path confinement (A5)", () => {
  test("resolves a normal key inside the base", () => {
    const full = resolveStorageKey(BASE, "abc-123.png");
    expect(full).toBe(path.join(BASE, "abc-123.png"));
  });

  test("resolves a nested key inside the base", () => {
    const full = resolveStorageKey(BASE, "thumbs/abc-123.png");
    expect(full).toBe(path.join(BASE, "thumbs", "abc-123.png"));
  });

  test("rejects parent-traversal escaping the root", () => {
    expect(() => resolveStorageKey(BASE, "../../etc/passwd")).toThrow(/escapes storage root/);
  });

  test("rejects deep traversal that lands outside the root", () => {
    expect(() => resolveStorageKey(BASE, "../../../../../../etc/passwd")).toThrow(/escapes storage root/);
  });

  test("rejects an absolute path", () => {
    expect(() => resolveStorageKey(BASE, "/etc/passwd")).toThrow(/escapes storage root/);
  });

  test("rejects a null byte", () => {
    expect(() => resolveStorageKey(BASE, "abc\0.png")).toThrow(/null byte/);
  });

  test("rejects empty / non-string keys", () => {
    expect(() => resolveStorageKey(BASE, "")).toThrow(/Invalid storage path/);
    expect(() => resolveStorageKey(BASE, undefined)).toThrow(/Invalid storage path/);
  });

  test("allows traversal that stays within the root (normalized back inside)", () => {
    // "thumbs/../abc.png" normalizes to "abc.png" — still inside, so allowed.
    const full = resolveStorageKey(BASE, "thumbs/../abc.png");
    expect(full).toBe(path.join(BASE, "abc.png"));
  });

  test("does not treat a sibling dir with the same prefix as inside", () => {
    // BASE = /var/lib/baasix/storage; "../storage-evil/x" must be rejected.
    expect(() => resolveStorageKey(BASE, "../storage-evil/x")).toThrow(/escapes storage root/);
  });
});
