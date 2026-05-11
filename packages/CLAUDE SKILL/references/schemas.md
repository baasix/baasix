# Schemas Reference

## Table of Contents
1. [Schema Creation](#schema-creation)
2. [Field Types](#field-types)
3. [Field Properties](#field-properties)
4. [Default Values](#default-values)
5. [Validation Rules](#validation-rules)
6. [Relationships](#relationships)
7. [Indexes](#indexes)

---

## Schema Creation

```javascript
POST /schemas
{
  "collectionName": "products",   // Table name: lowercase, snake_case
  "schema": {
    "name": "Product",            // Model name: PascalCase
    "timestamps": true,           // Adds createdAt, updatedAt
    "paranoid": false,            // Set true for soft deletes (adds deletedAt)
    "tenantScoped": true,         // Set false for global/shared in multi-tenant deployments
    "fields": {
      "id": {
        "type": "UUID",
        "primaryKey": true,
        "defaultValue": {"type": "UUIDV4"}
      }
      // ... more fields
    }
  }
}
```

### PATCH /schemas/:collection — FULL REPLACEMENT

The PATCH endpoint performs a **FULL REPLACEMENT** of the schema definition.
When adding, modifying, or removing columns:
1. First `GET /schemas/:collection` to retrieve the current full schema
2. Include ALL existing fields in your PATCH request body
3. Add/modify/remove only the specific fields you need

Sending only new fields will DELETE all other field definitions.

---

## Field Types

| Type | PostgreSQL | Description |
|------|------------|-------------|
| **String types** | | |
| String | VARCHAR(255) | Short text (use `values.length` for custom) |
| Text | TEXT | Unlimited text |
| CiText | CITEXT | Case-insensitive text |
| HTML | TEXT | HTML content |
| **Numeric types** | | |
| Integer | INTEGER | 32-bit integer |
| BigInt | BIGINT | 64-bit integer |
| Real | REAL | Single-precision float |
| Double | DOUBLE PRECISION | Double-precision float |
| Decimal | DECIMAL(p,s) | Exact decimal (`values: {precision, scale}`) |
| **Boolean** | | |
| Boolean | BOOLEAN | true/false |
| **Date/Time** | | |
| Date | DATE | Date only |
| DateTime | TIMESTAMP WITH TZ | Date+time with timezone |
| DateTime_NO_TZ | TIMESTAMP | Date+time without timezone |
| Time | TIME WITH TZ | Time with timezone |
| Time_NO_TZ | TIME | Time without timezone |
| **Identifiers** | | |
| UUID | UUID | UUID v4 |
| TOKEN | VARCHAR(9) | 9-character token |
| **JSON** | | |
| JSON | JSON | Not queryable |
| JSONB | JSONB | Queryable, indexable (prefer this) |
| **Enum** | | |
| ENUM | VARCHAR(255) | Stored as varchar |
| **Virtual** | | |
| VIRTUAL | (computed) | Requires `calculated` expression |
| **Array types** | | |
| Array_String | TEXT[] | Array of strings |
| Array_Integer | INTEGER[] | Array of integers |
| Array_Double | DOUBLE PRECISION[] | Array of doubles |
| Array_Decimal | NUMERIC[] | Array of decimals |
| Array_DateTime | TIMESTAMP WITH TZ[] | Array of datetimes |
| Array_DateTime_NO_TZ | TIMESTAMP[] | |
| Array_Date | DATE[] | Array of dates |
| Array_Time | TIME WITH TZ[] | |
| Array_Time_NO_TZ | TIME[] | |
| Array_UUID | UUID[] | Array of UUIDs |
| Array_Boolean | BOOLEAN[] | Array of booleans |
| **Range types** | | |
| Range_Integer | INT4RANGE | Integer range |
| Range_Double / Range_Decimal | NUMRANGE | Numeric range |
| Range_DateTime | TSTZRANGE | DateTime range (with TZ) |
| Range_DateTime_NO_TZ | TSRANGE | |
| Range_Date | DATERANGE | Date range |
| **PostGIS Geometry** | | |
| Point | POINT | PostGIS point |
| LineString | LINESTRING | |
| Polygon | POLYGON | |
| MultiPoint | MULTIPOINT | |
| MultiLineString | MULTILINESTRING | |
| MultiPolygon | MULTIPOLYGON | |
| GeometryCollection | GEOMETRYCOLLECTION | |
| Geography | GEOGRAPHY | Geographic coordinates |
| **pgvector (Vector Embeddings)** | | |
| Vector | vector(n) | float32 vector (requires DATABASE_VECTOR=true) |
| HalfVec | halfvec(n) | float16 vector (pgvector >= 0.7) |
| SparseVec | sparsevec(n) | sparse vector (pgvector >= 0.7) |

---

## Field Properties

| Property | Type | Description |
|----------|------|-------------|
| type | string | Field type (required) |
| primaryKey | boolean | Is primary key |
| allowNull | boolean | Allow NULL values |
| unique | boolean | Unique constraint |
| defaultValue | any | Default value or type object |
| values | object | Type-specific options (e.g., `{length: 500}`, `{precision: 10, scale: 2}`) |
| validate | object | Validation rules |
| comment | string | Column comment |

### Common Field Definitions

```javascript
// UUID primary key
"id": { "type": "UUID", "primaryKey": true, "defaultValue": {"type": "UUIDV4"} }

// String with length
"title": { "type": "String", "allowNull": false, "values": {"length": 500} }

// Decimal with precision
"price": { "type": "Decimal", "values": {"precision": 10, "scale": 2}, "defaultValue": 0.00 }

// Boolean with default
"isPublished": { "type": "Boolean", "allowNull": false, "defaultValue": false }

// Array of strings
"tags": { "type": "Array_String", "defaultValue": [] }

// JSONB
"metadata": { "type": "JSONB", "allowNull": true, "defaultValue": {} }

// PostGIS Point
"location": { "type": "Point", "allowNull": true }

// Vector embedding (pgvector — requires DATABASE_VECTOR=true)
"embedding": { "type": "Vector", "allowNull": true, "values": { "dimensions": 1536 } }
```

---

## Default Values

```javascript
{"type": "UUIDV4"}         // Generate UUID v4
{"type": "SUID"}           // Short unique ID (compact, URL-safe)
{"type": "NOW"}            // Current timestamp
{"type": "AUTOINCREMENT"}  // Auto-incrementing integer
{"type": "SQL", "value": "(SELECT COALESCE(MAX(sort_order), 0) + 1 FROM products)"}
"static value"             // Literal string
0                          // Numeric default
false                      // Boolean default
[]                         // Empty array
{}                         // Empty object
```

### SQL Default Value Examples

```javascript
// Next sort order
{
  "sortOrder": {
    "type": "Integer",
    "defaultValue": {"type": "SQL", "value": "(SELECT COALESCE(MAX(sort_order), 0) + 1 FROM products)"}
  }
}

// Random code
{
  "code": {
    "type": "String",
    "defaultValue": {"type": "SQL", "value": "md5(random()::text)"}
  }
}

// Current fiscal year
{
  "fiscalYear": {
    "type": "Integer",
    "defaultValue": {"type": "SQL", "value": "EXTRACT(YEAR FROM CURRENT_DATE)"}
  }
}
```

---

## Validation Rules

### Numeric (Integer, BigInt, Decimal, Double, Real)
```javascript
"age": { "type": "Integer", "validate": { "min": 0, "max": 150, "isInt": true } }
```

### String
```javascript
"email": { "type": "String", "validate": { "isEmail": true, "notEmpty": true, "len": [5, 255] } }
"website": { "type": "String", "validate": { "isUrl": true } }
"zipCode": { "type": "String", "validate": { "is": "^\\d{5}(-\\d{4})?$" } }
```

### Array — validation applies per element
```javascript
"scores": { "type": "Array_Integer", "validate": { "min": 0, "max": 100 } }
```

### Range — validation applies to both bounds; also enforces lower <= upper
```javascript
"age_range": { "type": "Range_Integer", "validate": { "min": 0, "max": 200 } }
```

---

## Relationships

### M2O (Many-to-One / BelongsTo)
```javascript
POST /schemas/posts/relationships
{
  "type": "M2O",
  "target": "baasix_User",
  "name": "author",         // Creates posts.author_Id → baasix_User.id
  "alias": "posts"          // Reverse relation name on users (optional)
}
// Auto-creates index on author_Id
```

### O2M (One-to-Many / HasMany)
Automatically created as the reverse of M2O. Access via the `alias`.

### M2M (Many-to-Many)
```javascript
POST /schemas/posts/relationships
{
  "type": "M2M",
  "target": "tags",
  "name": "tags",
  "alias": "posts",
  "through": "post_tags"    // Optional custom junction table name (max 63 chars)
}
// Auto-generates junction table with isJunction: true
```

### M2A (Many-to-Any / Polymorphic)
```javascript
POST /schemas/comments/relationships
{
  "type": "M2A",
  "name": "commentable",
  "tables": ["posts", "products"],
  "alias": "comments",
  "through": "comment_refs"
}
```

### Junction Table Naming
- **Auto-generated:** `{source}_{target}_{name}_junction`
- **Custom:** Use `through` property (max 63 characters for PostgreSQL)
- All FK columns are automatically indexed

### Relationship Management Routes
```
POST   /schemas/:collection/relationships              — Create relationship
PATCH  /schemas/:collection/relationships/:name         — Update relationship
DELETE /schemas/:collection/relationships/:name         — Delete relationship
```

---

## Indexes

```javascript
POST /schemas/:collection/indexes

// Unique index
{ "name": "idx_email_unique", "fields": ["email"], "unique": true }

// Composite index
{ "name": "idx_status_created", "fields": ["status", "createdAt"] }
```

Delete: `DELETE /schemas/:collection/indexes/:name`
