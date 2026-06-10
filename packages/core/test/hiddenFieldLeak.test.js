import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";
import { schemaManager } from "../baasix/utils/schemaManager";
import fieldUtils from "../baasix/utils/fieldUtils";

/**
 * Investigation + fix verification for the hidden-field read leak.
 *
 * The `hidden` flag lives on the JSON schema DEFINITION, not the runtime Drizzle
 * table. getHiddenFields() previously read the Drizzle table → returned [] →
 * password hashes (and any hidden field) leaked into API responses.
 *
 * These tests verify the flag is now resolved from the definition, and that
 * stripHiddenFields actually removes it from a record.
 */

let app;

beforeAll(async () => {
  await destroyAllTablesInDB();
  app = await startServerForTesting();
});

afterAll(async () => {
  if (app?.server) await new Promise((r) => app.server.close(r));
});

describe("hidden-field resolution (schema definition, not Drizzle table)", () => {
  test("schemaManager.getHiddenFieldNames includes password for baasix_User", () => {
    const hidden = schemaManager.getHiddenFieldNames("baasix_User");
    expect(hidden).toContain("password");
  });

  test("fieldUtils.getHiddenFields includes password for baasix_User", () => {
    const hidden = fieldUtils.getHiddenFields("baasix_User");
    expect(hidden).toContain("password");
  });

  test("stripHiddenFields removes password from a user record", () => {
    const record = { id: "1", email: "a@b.com", password: "$argon2id$hash", firstName: "A" };
    const stripped = fieldUtils.stripHiddenFields("baasix_User", record);
    expect(stripped).not.toHaveProperty("password");
    expect(stripped).toHaveProperty("email"); // non-hidden field retained
  });

  test("stripHiddenFieldsFromRecords removes password from every record", () => {
    const records = [
      { id: "1", password: "h1", email: "a@b.com" },
      { id: "2", password: "h2", email: "c@d.com" },
    ];
    const stripped = fieldUtils.stripHiddenFieldsFromRecords("baasix_User", records);
    for (const r of stripped) {
      expect(r).not.toHaveProperty("password");
    }
  });

  test("non-hidden collection returns no hidden fields (no over-stripping)", () => {
    // A normal collection without hidden fields should strip nothing.
    const hidden = schemaManager.getHiddenFieldNames("baasix_Role");
    expect(hidden).not.toContain("name");
    expect(hidden).not.toContain("description");
  });
});
