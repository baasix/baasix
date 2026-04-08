import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";
import postgres from "postgres";

let app;
let adminToken;
let sql;

beforeAll(async () => {
    await destroyAllTablesInDB();

    app = await startServerForTesting();

    // Login as admin
    const adminLoginResponse = await request(app).post("/auth/login").send({
        email: "admin@baasix.com",
        password: "admin@123",
    });
    adminToken = adminLoginResponse.body.token;

    // Direct SQL connection for verifying database state
    sql = postgres(process.env.DATABASE_URL);
});

afterAll(async () => {
    if (sql) await sql.end();
    if (app?.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});

// ─── Helper: get column info from information_schema ───
async function getColumnInfo(tableName, columnName) {
    const rows = await sql`
        SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
        FROM information_schema.columns
        WHERE table_name = ${tableName} AND column_name = ${columnName}
    `;
    return rows[0] || null;
}

// ─────────────────────────────────────────────────────────
// 1. NOT NULL ↔ nullable sync
// ─────────────────────────────────────────────────────────
describe("NOT NULL constraint syncing", () => {
    const collectionName = "sync_notnull_test";

    test("Create schema with a NOT NULL field", async () => {
        const response = await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                collectionName,
                schema: {
                    name: "SyncNotNullTest",
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        title: { type: "String", allowNull: false },
                        description: { type: "Text", allowNull: true },
                    },
                },
            });

        expect(response.status).toBe(201);

        // Verify title is NOT NULL in DB
        const titleCol = await getColumnInfo(collectionName, "title");
        expect(titleCol).not.toBeNull();
        expect(titleCol.is_nullable).toBe("NO");

        // Verify description is nullable in DB
        const descCol = await getColumnInfo(collectionName, "description");
        expect(descCol).not.toBeNull();
        expect(descCol.is_nullable).toBe("YES");
    });

    test("Change NOT NULL field to nullable — DB constraint is updated", async () => {
        const response = await request(app)
            .patch(`/schemas/${collectionName}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                schema: {
                    name: "SyncNotNullTest",
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        title: { type: "String", allowNull: true }, // changed from false → true
                        description: { type: "Text", allowNull: true },
                    },
                },
            });

        expect(response.status).toBe(200);

        // DB should now allow NULL on title
        const titleCol = await getColumnInfo(collectionName, "title");
        expect(titleCol.is_nullable).toBe("YES");
    });

    test("Change nullable field back to NOT NULL — DB constraint is updated", async () => {
        const response = await request(app)
            .patch(`/schemas/${collectionName}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                schema: {
                    name: "SyncNotNullTest",
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        title: { type: "String", allowNull: false }, // changed back to NOT NULL
                        description: { type: "Text", allowNull: true },
                    },
                },
            });

        expect(response.status).toBe(200);

        const titleCol = await getColumnInfo(collectionName, "title");
        expect(titleCol.is_nullable).toBe("NO");
    });

    test("Primary key stays NOT NULL even if allowNull is not set", async () => {
        const idCol = await getColumnInfo(collectionName, "id");
        expect(idCol.is_nullable).toBe("NO");
    });
});

// ─────────────────────────────────────────────────────────
// 2. DEFAULT value syncing
// ─────────────────────────────────────────────────────────
describe("DEFAULT value syncing", () => {
    const collectionName = "sync_default_test";

    test("Create schema with default values", async () => {
        const response = await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                collectionName,
                schema: {
                    name: "SyncDefaultTest",
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        status: { type: "String", defaultValue: "draft" },
                        priority: { type: "Integer", defaultValue: 0 },
                        isActive: { type: "Boolean", defaultValue: true },
                        notes: { type: "Text" }, // no default
                    },
                },
            });

        expect(response.status).toBe(201);

        // Verify defaults in DB
        const statusCol = await getColumnInfo(collectionName, "status");
        expect(statusCol.column_default).toContain("draft");

        const priorityCol = await getColumnInfo(collectionName, "priority");
        expect(priorityCol.column_default).toContain("0");

        const activeCol = await getColumnInfo(collectionName, "isActive");
        expect(activeCol.column_default).toContain("true");

        const notesCol = await getColumnInfo(collectionName, "notes");
        expect(notesCol.column_default).toBeNull();
    });

    test("Change default value — DB default is updated", async () => {
        const response = await request(app)
            .patch(`/schemas/${collectionName}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                schema: {
                    name: "SyncDefaultTest",
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        status: { type: "String", defaultValue: "published" }, // changed
                        priority: { type: "Integer", defaultValue: 5 },        // changed
                        isActive: { type: "Boolean", defaultValue: false },     // changed
                        notes: { type: "Text" },
                    },
                },
            });

        expect(response.status).toBe(200);

        const statusCol = await getColumnInfo(collectionName, "status");
        expect(statusCol.column_default).toContain("published");

        const priorityCol = await getColumnInfo(collectionName, "priority");
        expect(priorityCol.column_default).toContain("5");

        const activeCol = await getColumnInfo(collectionName, "isActive");
        expect(activeCol.column_default).toContain("false");
    });

    test("Remove default value — DB default is dropped", async () => {
        const response = await request(app)
            .patch(`/schemas/${collectionName}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                schema: {
                    name: "SyncDefaultTest",
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        status: { type: "String" },   // default removed
                        priority: { type: "Integer" }, // default removed
                        isActive: { type: "Boolean" }, // default removed
                        notes: { type: "Text" },
                    },
                },
            });

        expect(response.status).toBe(200);

        const statusCol = await getColumnInfo(collectionName, "status");
        expect(statusCol.column_default).toBeNull();

        const priorityCol = await getColumnInfo(collectionName, "priority");
        expect(priorityCol.column_default).toBeNull();

        const activeCol = await getColumnInfo(collectionName, "isActive");
        expect(activeCol.column_default).toBeNull();
    });

    test("Add default value to a field that had none — DB default is set", async () => {
        const response = await request(app)
            .patch(`/schemas/${collectionName}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                schema: {
                    name: "SyncDefaultTest",
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        status: { type: "String" },
                        priority: { type: "Integer" },
                        isActive: { type: "Boolean" },
                        notes: { type: "Text", defaultValue: "No notes" }, // default added
                    },
                },
            });

        expect(response.status).toBe(200);

        const notesCol = await getColumnInfo(collectionName, "notes");
        expect(notesCol.column_default).toContain("No notes");
    });

    test("Insert record uses database default values correctly", async () => {
        // Set a known default for testing
        await request(app)
            .patch(`/schemas/${collectionName}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                schema: {
                    name: "SyncDefaultTest",
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        status: { type: "String", defaultValue: "active" },
                        priority: { type: "Integer", defaultValue: 1 },
                        isActive: { type: "Boolean", defaultValue: true },
                        notes: { type: "Text" },
                    },
                },
            });

        // Insert without providing fields that have defaults
        const insertRes = await request(app)
            .post(`/items/${collectionName}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({});

        expect(insertRes.status).toBe(201);

        // Read back the record
        const id = insertRes.body.data.id;
        const readRes = await request(app)
            .get(`/items/${collectionName}/${id}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(readRes.status).toBe(200);
        expect(readRes.body.data.status).toBe("active");
        expect(readRes.body.data.priority).toBe(1);
        expect(readRes.body.data.isActive).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────
// 3. SUID field type support
// ─────────────────────────────────────────────────────────
describe("SUID field type", () => {
    const collectionName = "suid_test";

    test("Create schema with SUID primary key", async () => {
        const response = await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                collectionName,
                schema: {
                    name: "SuidTest",
                    fields: {
                        id: { type: "SUID", primaryKey: true, defaultValue: { type: "SUID" } },
                        name: { type: "String" },
                    },
                },
            });

        expect(response.status).toBe(201);

        // Verify the column type is VARCHAR(21), not UUID or TEXT
        const idCol = await getColumnInfo(collectionName, "id");
        expect(idCol).not.toBeNull();
        expect(idCol.data_type).toBe("character varying");
        expect(idCol.character_maximum_length).toBe(21);
    });

    test("SUID generates a 21-character URL-safe ID on insert", async () => {
        const insertRes = await request(app)
            .post(`/items/${collectionName}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ name: "Test Item 1" });

        expect(insertRes.status).toBe(201);

        const id = insertRes.body.data.id;
        expect(typeof id).toBe("string");
        expect(id.length).toBe(21);
        // Should only contain URL-safe chars: A-Z, a-z, 0-9, _, -
        expect(id).toMatch(/^[A-Za-z0-9_-]{21}$/);
    });

    test("Multiple SUID inserts produce unique IDs", async () => {
        const ids = new Set();
        for (let i = 0; i < 10; i++) {
            const res = await request(app)
                .post(`/items/${collectionName}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .send({ name: `Item ${i}` });

            expect(res.status).toBe(201);
            ids.add(res.body.data.id);
        }
        // All 10 IDs should be unique
        expect(ids.size).toBe(10);
    });

    test("SUID field can be used as a non-primary-key default field", async () => {
        const collection2 = "suid_field_test";
        const createRes = await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                collectionName: collection2,
                schema: {
                    name: "SuidFieldTest",
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        shortCode: { type: "SUID", defaultValue: { type: "SUID" } },
                        label: { type: "String" },
                    },
                },
            });

        expect(createRes.status).toBe(201);

        // Insert and verify shortCode is auto-generated
        const insertRes = await request(app)
            .post(`/items/${collection2}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ label: "Test Label" });

        expect(insertRes.status).toBe(201);

        // Read back the record to get DB-generated defaults
        const readRes = await request(app)
            .get(`/items/${collection2}/${insertRes.body.data.id}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(readRes.status).toBe(200);

        const record = readRes.body.data;
        expect(typeof record.shortCode).toBe("string");
        expect(record.shortCode.length).toBe(21);
        expect(record.shortCode).toMatch(/^[A-Za-z0-9_-]{21}$/);
    });

    test("SUID default is reflected in database column_default", async () => {
        const idCol = await getColumnInfo(collectionName, "id");
        expect(idCol.column_default).toContain("baasix_generate_suid");
    });
});

// ─────────────────────────────────────────────────────────
// 4. Combined: NOT NULL + DEFAULT changes together
// ─────────────────────────────────────────────────────────
describe("Combined NOT NULL and DEFAULT changes", () => {
    const collectionName = "sync_combined_test";

    test("Create schema, then change both NOT NULL and default together", async () => {
        // Create with NOT NULL and a default
        const createRes = await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                collectionName,
                schema: {
                    name: "SyncCombinedTest",
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        status: { type: "String", allowNull: false, defaultValue: "active" },
                    },
                },
            });

        expect(createRes.status).toBe(201);

        let statusCol = await getColumnInfo(collectionName, "status");
        expect(statusCol.is_nullable).toBe("NO");
        expect(statusCol.column_default).toContain("active");

        // Now make it nullable AND change the default
        const updateRes = await request(app)
            .patch(`/schemas/${collectionName}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                schema: {
                    name: "SyncCombinedTest",
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        status: { type: "String", allowNull: true, defaultValue: "inactive" },
                    },
                },
            });

        expect(updateRes.status).toBe(200);

        statusCol = await getColumnInfo(collectionName, "status");
        expect(statusCol.is_nullable).toBe("YES");
        expect(statusCol.column_default).toContain("inactive");
    });

    test("Make field NOT NULL and remove default at the same time", async () => {
        // First insert a value so NOT NULL constraint doesn't fail
        await sql.unsafe(`UPDATE "${collectionName}" SET status = 'filled' WHERE status IS NULL`);

        const updateRes = await request(app)
            .patch(`/schemas/${collectionName}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                schema: {
                    name: "SyncCombinedTest",
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        status: { type: "String", allowNull: false }, // NOT NULL, no default
                    },
                },
            });

        expect(updateRes.status).toBe(200);

        const statusCol = await getColumnInfo(collectionName, "status");
        expect(statusCol.is_nullable).toBe("NO");
        expect(statusCol.column_default).toBeNull();
    });
});
