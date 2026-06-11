import { test, expect, describe, afterEach } from "@jest/globals";
import {
  buildStorageFolder,
  getStorageKey,
  storageFolderStructureEnabled,
} from "../baasix/services/FilesService";
import env from "../baasix/utils/env";

/**
 * Storage folder-structure layout (STORAGE_FOLDER_STRUCTURE).
 *
 * buildStorageFolder maps a file's owner context to a folder prefix; getStorageKey
 * reconstructs the full physical key from { storage_folder, filename }. These pure
 * helpers are the single source of truth for the new layout, so we test them
 * directly. Default off → folder is null and the key is the flat filename.
 */

afterEach(() => env.set("STORAGE_FOLDER_STRUCTURE", ""));

describe("buildStorageFolder — 4-case layout (feature on)", () => {
  function on() {
    env.set("STORAGE_FOLDER_STRUCTURE", "true");
  }

  test("tenant + user → tenants/{t}/users/{u}", () => {
    on();
    expect(buildStorageFolder({ tenant_Id: "t1", userCreated_Id: "u1" })).toBe("tenants/t1/users/u1");
  });

  test("tenant + no user → tenants/{t}/system", () => {
    on();
    expect(buildStorageFolder({ tenant_Id: "t1" })).toBe("tenants/t1/system");
    expect(buildStorageFolder({ tenant_Id: "t1", userCreated_Id: null })).toBe("tenants/t1/system");
  });

  test("no tenant + user → users/{u}", () => {
    on();
    expect(buildStorageFolder({ userCreated_Id: "u1" })).toBe("users/u1");
  });

  test("no tenant + no user → system", () => {
    on();
    expect(buildStorageFolder({})).toBe("system");
  });

  test("ids are sanitized (no path traversal via tenant/user id)", () => {
    on();
    // A malicious id can't inject slashes or ".." into the path.
    const folder = buildStorageFolder({ tenant_Id: "../../etc", userCreated_Id: "a/b" });
    expect(folder).not.toMatch(/\.\.|\//.source.replace("//", "/")); // no ".."
    expect(folder.startsWith("tenants/")).toBe(true);
    // The dangerous characters are stripped, leaving safe segments.
    expect(folder).toBe("tenants/etc/users/ab");
  });
});

describe("buildStorageFolder — feature off", () => {
  test("returns null so files stay flat (backward compatible)", () => {
    env.set("STORAGE_FOLDER_STRUCTURE", "");
    expect(storageFolderStructureEnabled()).toBe(false);
    expect(buildStorageFolder({ tenant_Id: "t1", userCreated_Id: "u1" })).toBeNull();
  });
});

describe("getStorageKey — full key reconstruction", () => {
  test("folder set → folder/filename", () => {
    expect(getStorageKey({ storage_folder: "tenants/t1/users/u1", filename: "123-x.jpg" })).toBe(
      "tenants/t1/users/u1/123-x.jpg"
    );
  });

  test("folder null/empty → flat filename (legacy)", () => {
    expect(getStorageKey({ storage_folder: null, filename: "123-x.jpg" })).toBe("123-x.jpg");
    expect(getStorageKey({ storage_folder: "", filename: "123-x.jpg" })).toBe("123-x.jpg");
    expect(getStorageKey({ filename: "123-x.jpg" })).toBe("123-x.jpg");
  });
});
