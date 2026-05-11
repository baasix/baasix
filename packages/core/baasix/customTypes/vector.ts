/**
 * pgvector column types for Drizzle ORM
 * Wraps Drizzle's native pgvector support (drizzle-orm >= 0.31).
 * Requires the `vector` PostgreSQL extension (pgvector).
 *
 * Enable by setting DATABASE_VECTOR=true in your environment.
 * The extension must be installed: `CREATE EXTENSION IF NOT EXISTS vector;`
 */

import {
  vector as drizzleVector,
  halfvec as drizzleHalfvec,
  sparsevec as drizzleSparsevec,
} from 'drizzle-orm/pg-core';

/**
 * vector(name, dimensions) - Fixed-length float32 vector column.
 *
 * Usage:
 *   embedding: vector('embedding', 1536)
 *
 * Supports distance operators via Drizzle's l2Distance, cosineDistance,
 * innerProduct, and l1Distance helpers.
 */
export const vector = (name: string, dimensions: number) =>
  drizzleVector(name, { dimensions });

/**
 * halfvec(name, dimensions) - Half-precision float16 vector column.
 * Requires pgvector >= 0.7.
 */
export const halfvec = (name: string, dimensions: number) =>
  drizzleHalfvec(name, { dimensions });

/**
 * sparsevec(name, dimensions) - Sparse vector column.
 * Requires pgvector >= 0.7.
 */
export const sparsevec = (name: string, dimensions: number) =>
  drizzleSparsevec(name, { dimensions });

