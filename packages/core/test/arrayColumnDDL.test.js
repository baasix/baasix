import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";
import postgres from "postgres";

// Array_* field types must produce real PostgreSQL array columns (text[], uuid[], ...).
// buildColumnDefinition had no Array_* case, so every one of them fell through to the
// default 'TEXT' initialiser and silently created a scalar text column — which meant
// arraycontains/arrayoverlap could not work without a manual ALTER ... TYPE text[].

let app;
let adminToken;
let sql;

const collection = "arrayDDLTest";
const alterCollection = "arrayDDLAlterTest";

beforeAll(async () => {
    await destroyAllTablesInDB();
    app = await startServerForTesting();

    const adminLoginResponse = await request(app).post("/auth/login").send({
        email: "admin@baasix.com",
        password: "admin@123",
    });
    adminToken = adminLoginResponse.body.token;

    sql = postgres(process.env.DATABASE_URL);
});

afterAll(async () => {
    if (sql) await sql.end();
    if (app?.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});

// data_type is 'ARRAY' for any array column; udt_name carries the element type
// prefixed with an underscore (_text, _uuid, _int4, ...).
async function getColumnInfo(tableName, columnName) {
    const rows = await sql`
        SELECT column_name, data_type, udt_name
        FROM information_schema.columns
        WHERE table_name = ${tableName} AND column_name = ${columnName}
    `;
    return rows[0] || null;
}

describe("Array_* field types create real PostgreSQL array columns", () => {
    test("creates array columns for every Array_* type", async () => {
        const res = await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                collectionName: collection,
                schema: {
                    name: "ArrayDDLTest",
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        name: { type: "String", allowNull: false },
                        tags: { type: "Array_String", allowNull: true },
                        scores: { type: "Array_Integer", allowNull: true },
                        prices: { type: "Array_Decimal", allowNull: true },
                        ratios: { type: "Array_Double", allowNull: true },
                        flags: { type: "Array_Boolean", allowNull: true },
                        userIds: { type: "Array_UUID", allowNull: true },
                        stamps: { type: "Array_DateTime", allowNull: true },
                        stampsNoTz: { type: "Array_DateTime_NO_TZ", allowNull: true },
                        days: { type: "Array_Date", allowNull: true },
                        clocks: { type: "Array_Time", allowNull: true },
                        clocksNoTz: { type: "Array_Time_NO_TZ", allowNull: true },
                    },
                },
            });
        expect(res.status).toBeLessThan(400);

        const expected = {
            tags: "_text",
            scores: "_int4",
            prices: "_numeric",
            ratios: "_float8",
            flags: "_bool",
            userIds: "_uuid",
            stamps: "_timestamptz",
            stampsNoTz: "_timestamp",
            days: "_date",
            clocks: "_timetz",
            clocksNoTz: "_time",
        };

        for (const [field, udt] of Object.entries(expected)) {
            const col = await getColumnInfo(collection, field);
            expect(col).not.toBeNull();
            // The regression this guards: data_type was 'text', not 'ARRAY'.
            expect(`${field}:${col.data_type}`).toBe(`${field}:ARRAY`);
            expect(`${field}:${col.udt_name}`).toBe(`${field}:${udt}`);
        }
    });

    test("array columns accept and return array values end-to-end", async () => {
        const created = await request(app)
            .post(`/items/${collection}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                name: "Row 1",
                tags: ["alpha", "beta"],
                scores: [1, 2, 3],
                flags: [true, false],
            });
        expect(created.status).toBeLessThan(400);

        // A scalar text column would have stringified this; a real text[] round-trips.
        const read = await request(app)
            .get(`/items/${collection}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ filter: JSON.stringify({ tags: { arraycontains: ["alpha"] } }) });

        expect(read.status).toBe(200);
        expect(read.body.data.length).toBe(1);
        expect(Array.isArray(read.body.data[0].tags)).toBe(true);
        expect(read.body.data[0].tags).toEqual(["alpha", "beta"]);
        expect(read.body.data[0].scores).toEqual([1, 2, 3]);
    });

    test("heals a scalar text column that should be an array", async () => {
        // Reproduces a collection created by an older core build, where Array_String
        // wrongly produced a scalar text column. Reconciliation must promote it.
        const healCollection = "arrayDDLHealTest";
        await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                collectionName: healCollection,
                schema: {
                    name: "ArrayDDLHealTest",
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        name: { type: "String", allowNull: false },
                        labels: { type: "Array_String", allowNull: true },
                    },
                },
            });

        // Force the column back to the broken scalar shape, with a value in it.
        await sql.unsafe(`ALTER TABLE "${healCollection}" ALTER COLUMN "labels" TYPE text USING "labels"[1]`);
        await sql.unsafe(`INSERT INTO "${healCollection}" ("name", "labels") VALUES ('Legacy', 'solo')`);

        const broken = await getColumnInfo(healCollection, "labels");
        expect(broken.data_type).toBe("text");

        // Re-running schema sync should promote it back to text[].
        const resync = await request(app)
            .patch(`/schemas/${healCollection}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                schema: {
                    name: "ArrayDDLHealTest",
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        name: { type: "String", allowNull: false },
                        labels: { type: "Array_String", allowNull: true },
                    },
                },
            });
        expect(resync.status).toBeLessThan(400);

        const healed = await getColumnInfo(healCollection, "labels");
        expect(healed.data_type).toBe("ARRAY");
        expect(healed.udt_name).toBe("_text");

        // The pre-existing scalar value must survive as a 1-element array.
        const rows = await sql.unsafe(`SELECT "labels" FROM "${healCollection}" WHERE "name" = 'Legacy'`);
        expect(rows[0].labels).toEqual(["solo"]);
    });

    test("adds an array column to an existing collection", async () => {
        // Columns added during reconciliation take the same buildColumnDefinition path,
        // so ALTER TABLE ADD COLUMN must produce an array type too.
        await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                collectionName: alterCollection,
                schema: {
                    name: "ArrayDDLAlterTest",
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        name: { type: "String", allowNull: false },
                    },
                },
            });

        const updated = await request(app)
            .patch(`/schemas/${alterCollection}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                schema: {
                    name: "ArrayDDLAlterTest",
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        name: { type: "String", allowNull: false },
                        labels: { type: "Array_String", allowNull: true },
                    },
                },
            });
        expect(updated.status).toBeLessThan(400);

        const col = await getColumnInfo(alterCollection, "labels");
        expect(col).not.toBeNull();
        expect(col.data_type).toBe("ARRAY");
        expect(col.udt_name).toBe("_text");
    });
});
