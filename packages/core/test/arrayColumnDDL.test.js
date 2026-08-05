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

    test("promotion parses serialized array literals instead of double-wrapping them", async () => {
        // Version-skew corruption: an older build created Array_* fields as scalar
        // text, and an array-typed DEFAULT stored its literal rendering ('{medical}')
        // in that scalar column. Promotion must parse such literals back into real
        // arrays — blindly wrapping produces {"{medical}"}.
        const litCollection = "arrayDDLLiteralTest";
        const schema = {
            name: "ArrayDDLLiteralTest",
            fields: {
                id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                name: { type: "String", allowNull: false },
                labels: { type: "Array_String", allowNull: true },
                nums: { type: "Array_Integer", allowNull: true },
            },
        };
        await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ collectionName: litCollection, schema });

        // Force both columns back to the broken scalar shape and seed every case.
        await sql.unsafe(`ALTER TABLE "${litCollection}" ALTER COLUMN "labels" TYPE text USING "labels"[1]`);
        await sql.unsafe(`ALTER TABLE "${litCollection}" ALTER COLUMN "nums" TYPE text USING "nums"[1]::text`);
        await sql.unsafe(
            `INSERT INTO "${litCollection}" ("name", "labels", "nums") VALUES ` +
            `('literal', '{medical}', NULL), ` +
            `('multi', '{medical,dental}', NULL), ` +
            `('nulls', NULL, NULL), ` +
            `('braces', 'not {an} array', NULL), ` +
            `('scalar', 'medical', NULL), ` +
            `('ints', NULL, '{1,2}')`
        );

        const resync = await request(app)
            .patch(`/schemas/${litCollection}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ schema });
        expect(resync.status).toBeLessThan(400);

        expect((await getColumnInfo(litCollection, "labels")).data_type).toBe("ARRAY");
        expect((await getColumnInfo(litCollection, "nums")).data_type).toBe("ARRAY");

        const rows = await sql.unsafe(`SELECT "name", "labels", "nums" FROM "${litCollection}"`);
        const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
        // The failing case: '{medical}' must parse to ['medical'], not ['{medical}'].
        expect(byName.literal.labels).toEqual(["medical"]);
        expect(byName.multi.labels).toEqual(["medical", "dental"]);
        expect(byName.nulls.labels).toBeNull();
        // Not an anchored array literal — must be wrapped, not parsed.
        expect(byName.braces.labels).toEqual(["not {an} array"]);
        // Genuine scalar keeps the original wrap behavior.
        expect(byName.scalar.labels).toEqual(["medical"]);
        // Not text-specific: integer literals parse too.
        expect(byName.ints.nums).toEqual([1, 2]);
    });

    test("round-trip: scalar column with array-typed SQL default heals to a real array value", async () => {
        // The reporter's exact scenario. An old build created `verticals` as scalar
        // text; its DEFAULT ARRAY['medical']::text[] was accepted via the implicit
        // output cast, so rows taking the default stored the string '{medical}'.
        // A schema resync on a new build must promote the column AND end up with
        // {medical}, not {"{medical}"}.
        const rtCollection = "arrayDDLRoundTripTest";
        const schema = {
            name: "ArrayDDLRoundTripTest",
            fields: {
                id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                name: { type: "String", allowNull: false },
                verticals: {
                    type: "Array_String",
                    allowNull: false,
                    defaultValue: { type: "SQL", value: "ARRAY['medical']::text[]" },
                },
            },
        };
        await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ collectionName: rtCollection, schema });

        // Recreate the old-build state: scalar text column carrying the array default.
        await sql.unsafe(`ALTER TABLE "${rtCollection}" ALTER COLUMN "verticals" DROP DEFAULT`);
        await sql.unsafe(`ALTER TABLE "${rtCollection}" ALTER COLUMN "verticals" TYPE text USING "verticals"[1]`);
        await sql.unsafe(`ALTER TABLE "${rtCollection}" ALTER COLUMN "verticals" SET DEFAULT ARRAY['medical']::text[]`);
        // Row created without the field takes the default -> stores the literal string.
        await sql.unsafe(`INSERT INTO "${rtCollection}" ("name") VALUES ('defaulted')`);
        const before = await sql.unsafe(`SELECT "verticals" FROM "${rtCollection}"`);
        expect(before[0].verticals).toBe("{medical}");

        const resync = await request(app)
            .patch(`/schemas/${rtCollection}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ schema });
        expect(resync.status).toBeLessThan(400);

        const healed = await getColumnInfo(rtCollection, "verticals");
        expect(healed.data_type).toBe("ARRAY");
        const rows = await sql.unsafe(`SELECT "verticals" FROM "${rtCollection}"`);
        expect(rows[0].verticals).toEqual(["medical"]);
    });

    test("omits an array-constructor default on a non-array field", async () => {
        // Defense in depth: DEFAULT ARRAY[...] on a scalar column is accepted by
        // Postgres via the output cast and silently stores a stringified array.
        // Such a schema/DDL mismatch must drop the default instead of emitting it.
        const guardCollection = "arrayDDLDefaultGuardTest";
        const create = await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                collectionName: guardCollection,
                schema: {
                    name: "ArrayDDLDefaultGuardTest",
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        name: { type: "String", allowNull: false },
                        bad: {
                            type: "String",
                            allowNull: true,
                            defaultValue: { type: "SQL", value: "ARRAY['x']::text[]" },
                        },
                        ok: { type: "String", allowNull: true },
                    },
                },
            });
        expect(create.status).toBeLessThan(400);

        // Creation path (buildColumnDefinition) must not emit the default.
        const createdDefault = await sql`
            SELECT column_default FROM information_schema.columns
            WHERE table_name = ${guardCollection} AND column_name = 'bad'
        `;
        expect(createdDefault[0].column_default).toBeNull();

        // Sync path (getDefaultExpression) must not apply it to an existing column.
        const resync = await request(app)
            .patch(`/schemas/${guardCollection}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                schema: {
                    name: "ArrayDDLDefaultGuardTest",
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        name: { type: "String", allowNull: false },
                        bad: {
                            type: "String",
                            allowNull: true,
                            defaultValue: { type: "SQL", value: "ARRAY['x']::text[]" },
                        },
                        ok: {
                            type: "String",
                            allowNull: true,
                            defaultValue: { type: "SQL", value: "ARRAY['y']::text[]" },
                        },
                    },
                },
            });
        expect(resync.status).toBeLessThan(400);

        const synced = await sql`
            SELECT column_name, column_default FROM information_schema.columns
            WHERE table_name = ${guardCollection} AND column_name IN ('bad', 'ok')
        `;
        for (const row of synced) {
            expect(`${row.column_name}:${row.column_default}`).toBe(`${row.column_name}:null`);
        }
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
