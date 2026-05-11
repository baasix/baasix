# Queries & Filters Reference

## Table of Contents
1. [Query Parameters](#query-parameters)
2. [Field Selection](#field-selection)
3. [Basic Comparison Operators](#basic-comparison-operators)
4. [Collection Operators](#collection-operators)
5. [String Pattern Operators](#string-pattern-operators)
6. [Prefix/Suffix Operators](#prefixsuffix-operators)
7. [Range Operators](#range-operators)
8. [Null Check Operators](#null-check-operators)
9. [PostgreSQL Array Operators](#postgresql-array-operators)
10. [JSONB Operators](#jsonb-operators)
11. [Geospatial Operators](#geospatial-operators-postgis)
12. [Vector Similarity Operators](#vector-similarity-operators-pgvector)
13. [Logical Operators](#logical-operators)
13. [Column-to-Column Comparisons](#column-to-column-comparisons)
14. [Type Casting](#type-casting)
15. [Dynamic Variables](#dynamic-variables)
16. [Sorting and Pagination](#sorting-and-pagination)
17. [Aggregation](#aggregation)
18. [relConditions](#relconditions)
19. [Full-Text Search](#full-text-search)

---

## Query Parameters

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| fields | string[] | Fields to return | `["id","name","author.*"]` |
| filter | object | Filter conditions | `{"status":{"eq":"active"}}` |
| sort | object/string[] | Sort order | `{"createdAt":"desc"}` or `["-createdAt"]` |
| limit | number | Items per page (-1 for all) | 20 |
| page | number | Page number (1-indexed) | 1 |
| offset | number | Skip N records | 0 |
| search | string | Full-text search | "keyword" |
| searchFields | string[] | Fields to search | `["title","content"]` |
| aggregate | object | Aggregation ops | `{"total":{"function":"count","field":"id"}}` |
| groupBy | string[] | Group by fields | `["status","category"]` |
| paranoid | boolean | Include soft-deleted | false |
| relConditions | object | Filter array relations | `{"comments":{"approved":true}}` |

---

## Field Selection

```javascript
fields: ["*"]                            // All direct fields
fields: ["id", "name", "email"]          // Specific fields
fields: ["*", "author.*"]               // Include relation (all fields)
fields: ["*", "author.firstName"]       // Specific relation fields
fields: ["*", "posts.*", "posts.comments.*"]  // Deep nesting
fields: ["*.*"]                          // All + first level relations
fields: ["*.*.*"]                        // Full tree expansion
fields: ["*", "-password", "-secretKey"] // Exclude fields
```

---

## Basic Comparison Operators

| Operator | Description | Example |
|----------|-------------|---------|
| eq | Equal | `{"status": {"eq": "active"}}` |
| ne | Not equal | `{"status": {"ne": "deleted"}}` |
| gt | Greater than | `{"age": {"gt": 18}}` |
| gte | Greater than or equal | `{"price": {"gte": 100}}` |
| lt | Less than | `{"stock": {"lt": 10}}` |
| lte | Less than or equal | `{"rating": {"lte": 5}}` |
| is | IS (for null) | `{"deletedAt": {"is": null}}` |
| not | NOT | `{"status": {"not": "spam"}}` |

## Collection Operators

| Operator | Description | Example |
|----------|-------------|---------|
| in | Value in array | `{"status": {"in": ["active", "pending"]}}` |
| notIn | Value not in array | `{"category": {"notIn": ["spam", "deleted"]}}` |

## String Pattern Operators (Auto-wrap with %)

| Operator | Description | Case |
|----------|-------------|------|
| like | LIKE %value% | Sensitive |
| notLike | NOT LIKE %value% | Sensitive |
| iLike | ILIKE %value% | Insensitive |
| notILike | NOT ILIKE %value% | Insensitive |

## Prefix/Suffix Operators

| Operator | Pattern | Case |
|----------|---------|------|
| startsWith | value% | Insensitive |
| startsWiths | value% | Sensitive |
| endsWith | %value | Insensitive |
| endsWiths | %value | Sensitive |
| nstartsWith | NOT value% | Insensitive |
| nstartsWiths | NOT value% | Sensitive |
| nendsWith | NOT %value | Insensitive |
| nendsWiths | NOT %value | Sensitive |

## Range Operators

| Operator | Example |
|----------|---------|
| between | `{"price": {"between": [10, 100]}}` |
| notBetween | `{"age": {"notBetween": [0, 17]}}` |

## Null Check Operators

| Operator | Value | Result |
|----------|-------|--------|
| isNull | true | IS NULL |
| isNull | false | IS NOT NULL |
| isNotNull | true | IS NOT NULL |
| isNotNull | false | IS NULL |

---

## PostgreSQL Array Operators

| Operator | PostgreSQL | Description | Example |
|----------|------------|-------------|---------|
| arraycontains | @> | Array contains all | `{"tags": {"arraycontains": ["js", "api"]}}` |
| arraycontained | <@ | Array contained by | `{"perms": {"arraycontained": ["read", "write", "admin"]}}` |

---

## JSONB Operators

### Containment
| Operator | Description |
|----------|-------------|
| jsonbContains | JSONB contains object: `{"metadata": {"jsonbContains": {"status": "active"}}}` |
| jsonbContainedBy | JSONB is contained by |
| jsonbNotContains | JSONB does not contain |

### Key Existence
| Operator | Description | Example |
|----------|-------------|---------|
| jsonbHasKey | Has key | `{"metadata": {"jsonbHasKey": "discount"}}` |
| jsonbHasAnyKeys | Has any of keys | `{"metadata": {"jsonbHasAnyKeys": ["promo", "coupon"]}}` |
| jsonbHasAllKeys | Has all keys | `{"metadata": {"jsonbHasAllKeys": ["price", "stock"]}}` |

### Key Value Comparisons
| Operator | Example |
|----------|---------|
| jsonbKeyEquals | `{"metadata": {"jsonbKeyEquals": {"key": "status", "value": "active"}}}` |
| jsonbKeyNotEquals | `{"metadata": {"jsonbKeyNotEquals": {"key": "status", "value": "deleted"}}}` |
| jsonbKeyGt / jsonbKeyGte | `{"metadata": {"jsonbKeyGt": {"key": "price", "value": 100}}}` |
| jsonbKeyLt / jsonbKeyLte | `{"metadata": {"jsonbKeyLt": {"key": "discount", "value": 50}}}` |
| jsonbKeyIn | `{"metadata": {"jsonbKeyIn": {"key": "type", "values": ["A", "B"]}}}` |
| jsonbKeyNotIn | `{"metadata": {"jsonbKeyNotIn": {"key": "category", "values": ["spam"]}}}` |
| jsonbKeyLike | `{"metadata": {"jsonbKeyLike": {"key": "name", "pattern": "%test%"}}}` |
| jsonbKeyIsNull | `{"metadata": {"jsonbKeyIsNull": "deletedAt"}}` |
| jsonbKeyIsNotNull | `{"metadata": {"jsonbKeyIsNotNull": "publishedAt"}}` |

### JSON Path
| Operator | Description | Example |
|----------|-------------|---------|
| jsonbPathExists | Path returns items | `{"profile": {"jsonbPathExists": "$.user.preferences"}}` |
| jsonbPathMatch | Path predicate matches | `{"metadata": {"jsonbPathMatch": "$.price > 100"}}` |

### Deep Nested Value Access
```javascript
{"profile": {"jsonbDeepValue": {
  "path": ["user", "preferences", "theme"],
  "value": "dark"
}}}

// With comparison operator
{"profile": {"jsonbDeepValue": {
  "path": ["stats", "loginCount"],
  "value": 10,
  "op": "gte"  // eq, ne, gt, gte, lt, lte, like, ilike
}}}
```

### JSONB Array/Type Operators
```javascript
{"tags": {"jsonbArrayLength": {"op": "gte", "value": 3}}}
{"metadata": {"jsonbTypeOf": {"type": "object"}}}
// Types: object, array, string, number, boolean, null
```

---

## Geospatial Operators (PostGIS)

| Operator | PostGIS Function | Description |
|----------|-----------------|-------------|
| within | ST_Within | Geometry within another |
| containsGEO | ST_Contains | Geometry contains another |
| intersects | ST_Intersects | Geometries intersect |
| nIntersects | NOT ST_Intersects | Don't intersect |
| dwithin | ST_DWithin | Within distance (meters) |

```javascript
// Within radius
{"location": {"dwithin": {
  "geometry": {"type": "Point", "coordinates": [-74.006, 40.7128]},
  "distance": 5000
}}}

// Sort by distance
{"sort": {"_distance": {
  "target": [-74.006, 40.7128],
  "column": "location",
  "direction": "ASC"
}}}

// Within polygon
{"location": {"within": {
  "type": "Polygon",
  "coordinates": [[[lng1,lat1], [lng2,lat2], [lng3,lat3], [lng1,lat1]]]
}}}
```

---

## Vector Similarity Operators (pgvector)

Requires `DATABASE_VECTOR=true` and a field of type `Vector`, `HalfVec`, or `SparseVec`.

| Operator | SQL Operator | Description |
|----------|-------------|-------------|
| vectorL2 | `<->` | L2 (Euclidean) distance — lowest = closest |
| vectorCosine | `<=>` | Cosine distance — lowest = most similar |
| vectorInnerProduct | `<#>` | Inner product (negated) — highest dot product |
| vectorL1 | `<+>` | L1 (Manhattan) distance (pgvector >= 0.7) |

```javascript
// Semantic search (cosine similarity)
{"embedding": {"vectorCosine": {"vector": [0.1, 0.2, 0.3], "threshold": 0.2}}}

// Nearest neighbors by L2
{"embedding": {"vectorL2": {"vector": [0.1, 0.2, 0.3], "threshold": 0.5}}}

// Maximum inner product
{"embedding": {"vectorInnerProduct": {"vector": [0.1, 0.2, 0.3], "threshold": 0.8}}}

// L1 distance
{"embedding": {"vectorL1": {"vector": [0.1, 0.2, 0.3], "threshold": 1.0}}}
```

---

## Logical Operators

```javascript
// AND (explicit)
{"AND": [{"status": {"eq": "published"}}, {"views": {"gt": 100}}]}

// OR
{"OR": [{"status": {"eq": "featured"}}, {"views": {"gt": 1000}}]}

// Nested
{"AND": [
  {"OR": [{"status": {"eq": "published"}}, {"status": {"eq": "featured"}}]},
  {"createdAt": {"gt": "2025-01-01"}}
]}

// Implicit AND (multiple keys)
{"status": {"eq": "active"}, "price": {"lt": 100}}
```

---

## Column-to-Column Comparisons

Use `$COL(columnName)` to compare against another column:

```javascript
{"actualCost": {"gt": "$COL(estimatedCost)"}}
{"startTime": {"gt": "$COL(endTime)", "cast": "time"}}
{"salary": {"gt": "$COL(manager.salary)"}}  // Relational
```

---

## Type Casting

Add `"cast": "type"` to any filter condition:

| Cast Type | Description |
|-----------|-------------|
| text, varchar | String |
| integer, bigint | Integer |
| decimal, numeric | Decimal |
| boolean | Boolean |
| date | Extract date from datetime |
| time | Extract time from datetime |
| timestamp | Timestamp |
| uuid | UUID |
| json, jsonb | JSON |

```javascript
{"createdAt": {"eq": "2025-01-15", "cast": "date"}}
{"workStart": {"between": ["08:00:00", "18:00:00"], "cast": "time"}}
```

---

## Dynamic Variables

| Variable | Description |
|----------|-------------|
| $CURRENT_USER | Current user's ID |
| $CURRENT_USER.field | User's field (e.g., `$CURRENT_USER.department`) |
| $CURRENT_ROLE | Current role's ID |
| $CURRENT_ROLE.field | Role's field |
| $CURRENT_TENANT | Current tenant ID |
| $CURRENT_TENANT.field | Tenant's field |
| $CURRENT_SETTINGS.field | Settings field (tenant-aware) |
| $NOW | Current timestamp |

### Relative Date Variables

Pattern: `$NOW[+|-][UNIT]_[NUMBER]`

Units: SECONDS, MINUTES, HOURS, DAYS, WEEKS, MONTHS, YEARS

```javascript
{"createdAt": {"gte": "$NOW-DAYS_30"}}      // Last 30 days
{"scheduledAt": {"between": ["$NOW", "$NOW+DAYS_7"]}}  // Next week
{"authorId": {"eq": "$CURRENT_USER"}}
```

---

## Sorting and Pagination

```javascript
// Object syntax
GET /items/products?sort={"category_Id":"asc","price":"desc"}

// Array syntax
GET /items/products?sort=["-createdAt","name"]   // - prefix = desc

// Pagination
GET /items/products?limit=20&page=1

// Get all (use carefully)
GET /items/products?limit=-1
```

---

## Aggregation

```javascript
GET /items/orders?aggregate={
  "revenue": {"function": "sum", "field": "total"},
  "count": {"function": "count", "field": "id"},
  "avgOrder": {"function": "avg", "field": "total"}
}&groupBy=["status"]
```

| Function | Description |
|----------|-------------|
| count | Count records |
| sum | Sum values |
| avg | Average |
| min | Minimum |
| max | Maximum |

All numeric aggregate functions return JavaScript numbers. `array_agg` returns an array.

---

## Querying with Relations

### Including Relations in Results
```javascript
// Include related data via fields
GET /items/products?fields=["*","category.*","reviews.*"]

// Specific relation fields only
GET /items/products?fields=["*","author.firstName","author.email"]

// Deep nesting (3+ levels)
GET /items/products?fields=["*","category.parent.*","reviews.author.*"]
```

### Filtering by Relation Fields
```javascript
// Filter parent records by relation field values
GET /items/products?filter={
  "category.name": {"eq": "Electronics"},
  "reviews.rating": {"gte": 4}
}
```

This filters which **parent records** are returned — it returns only products whose category name is "Electronics" AND have reviews with rating >= 4.

---

## relConditions (Filtering Array Relations: O2M / M2M / HasMany)

`relConditions` filters which **related items appear in the response array** — it does NOT filter the parent records. Use this for HasMany (O2M) and M2M relations where you want to limit the nested array contents.

**Key distinction:**
- `filter` → controls which parent records are returned
- `relConditions` → controls which child/related items appear within each parent's relation arrays

### Basic relConditions (HasMany / O2M)
```javascript
// Products with reviews — but only show approved reviews with rating >= 3
GET /items/products?fields=["*","reviews.*"]&relConditions={
  "reviews": {"approved": {"eq": true}, "rating": {"gte": 3}}
}
// Returns ALL products, but each product's reviews array only contains approved ones with rating >= 3
```

### Nested relConditions (deep filtering)
```javascript
// Orders with items — only items with quantity > 0 AND in-stock products
GET /items/orders?fields=["*","items.*","items.product.*"]&relConditions={
  "items": {
    "quantity": {"gt": 0},
    "product": {"inStock": {"eq": true}}
  }
}
```

### Combining filter + relConditions
```javascript
// Completed orders (filter) with only high-quantity items (relConditions)
GET /items/orders?fields=["*","items.*","items.product.*"]&filter={
  "status": {"eq": "completed"}
}&relConditions={
  "items": {
    "quantity": {"gt": 0},
    "product": {"inStock": {"eq": true}}
  }
}
```

### relConditions with M2M
```javascript
// Posts with only published tags
GET /items/posts?fields=["*","tags.*"]&relConditions={
  "tags": {"status": {"eq": "published"}}
}
```

---

## Full-Text Search

```javascript
GET /items/products?search=wireless headphones&searchFields=["name","description","tags"]

// Combine with filters
GET /items/products?search=laptop&filter={"category.slug":"electronics","inStock":true}
```

---

## Relational Field Filtering

```javascript
// BelongsTo
{"author.name": {"like": "John"}}

// Deep nesting (3+ levels)
{"comments.user.profile.verified": {"eq": true}}

// Arrays in relations
{"author.skills": {"arraycontains": ["javascript"]}}
```
