import type { HttpClient } from "../client";

export interface MigrationsModuleConfig {
  client: HttpClient;
}

export interface MigrationStatus {
  lastBatch: number;
  totalMigrations: number;
  pendingCount: number;
  completedCount: number;
  hasPending: boolean;
}

export interface Migration {
  id: string;
  version: string;
  name: string;
  type: string;
  status: string;
  batch: number;
  migratedAt: string;
  executionTime?: number;
}

export interface PendingMigration {
  version: string;
  name: string;
  type: string;
  path?: string;
}

export interface MigrationRunOptions {
  /** Run only a specific migration version */
  version?: string;
  /** Run migrations up to and including this version */
  toVersion?: string;
  /** Number of migrations to run */
  step?: number;
  /** Preview without executing */
  dryRun?: boolean;
}

export interface MigrationRunResult {
  results: Array<{
    version: string;
    name: string;
    status: "completed" | "failed";
    error?: string;
  }>;
  summary: {
    total: number;
    completed: number;
    failed: number;
  };
}

export interface RollbackResult {
  results: Array<{
    version: string;
    name: string;
    status: string;
  }>;
  summary: {
    total: number;
  };
}

export interface CreateMigrationOptions {
  /** Migration type (system, schema, data, custom) */
  type?: "system" | "schema" | "data" | "custom";
  /** Migration description */
  description?: string;
  /** Custom version (auto-generated if not provided) */
  version?: string;
}

/**
 * Migrations module for managing database schema migrations.
 * Admin access required for all operations.
 * 
 * @example
 * ```typescript
 * // Check migration status
 * const status = await baasix.migrations.status();
 * 
 * // Run pending migrations
 * if (status.hasPending) {
 *   await baasix.migrations.run();
 * }
 * ```
 */
export class MigrationsModule {
  private client: HttpClient;

  constructor(config: MigrationsModuleConfig) {
    this.client = config.client;
  }

  /**
   * Get migration status
   * 
   * @example
   * ```typescript
   * const status = await baasix.migrations.status();
   * console.log(`Pending migrations: ${status.pendingCount}`);
   * ```
   */
  async status(): Promise<MigrationStatus> {
    const response = await this.client.get<{ data: MigrationStatus }>(
      "/migrations/status"
    );
    return response.data;
  }

  /**
   * Get all migrations with optional filtering
   * 
   * @example
   * ```typescript
   * // Get all migrations
   * const migrations = await baasix.migrations.list();
   * 
   * // Get completed migrations
   * const completed = await baasix.migrations.list({ status: 'completed' });
   * ```
   */
  async list(options?: {
    status?: "pending" | "completed" | "failed";
    type?: "system" | "schema" | "data" | "custom";
  }): Promise<Migration[]> {
    const response = await this.client.get<{ data: Migration[] }>("/migrations", {
      params: options,
    });
    return response.data;
  }

  /**
   * Get pending migrations
   * 
   * @example
   * ```typescript
   * const pending = await baasix.migrations.pending();
   * ```
   */
  async pending(): Promise<PendingMigration[]> {
    const response = await this.client.get<{ data: PendingMigration[] }>(
      "/migrations/pending"
    );
    return response.data;
  }

  /**
   * Check if migrations are needed
   * 
   * @example
   * ```typescript
   * const check = await baasix.migrations.check();
   * if (check.hasPending) {
   *   console.log('Migrations needed');
   * }
   * ```
   */
  async check(): Promise<{ hasPending: boolean; pendingCount: number }> {
    const response = await this.client.get<{ data: { hasPending: boolean; pendingCount: number } }>(
      "/migrations/check"
    );
    return response.data;
  }

  /**
   * Get a specific migration by version
   * 
   * @example
   * ```typescript
   * const migration = await baasix.migrations.get('20231201000000');
   * ```
   */
  async get(version: string): Promise<Migration | null> {
    try {
      const response = await this.client.get<{ data: Migration }>(
        `/migrations/${encodeURIComponent(version)}`
      );
      return response.data;
    } catch {
      return null;
    }
  }

  /**
   * Run pending migrations
   * 
   * @example
   * ```typescript
   * // Run all pending migrations
   * const result = await baasix.migrations.run();
   * 
   * // Run with options
   * const result = await baasix.migrations.run({
   *   step: 1,  // Run only 1 migration
   *   dryRun: true  // Preview without executing
   * });
   * ```
   */
  async run(options?: MigrationRunOptions): Promise<MigrationRunResult> {
    const response = await this.client.post<{ data: MigrationRunResult }>(
      "/migrations/run",
      options || {}
    );
    return response.data;
  }

  /**
   * Rollback a specific migration
   * 
   * @example
   * ```typescript
   * const result = await baasix.migrations.rollback('20231201000000');
   * ```
   */
  async rollback(version: string): Promise<RollbackResult> {
    const response = await this.client.post<{ data: RollbackResult }>(
      `/migrations/rollback/${encodeURIComponent(version)}`,
      {}
    );
    return response.data;
  }

  /**
   * Rollback the last batch of migrations
   * 
   * @example
   * ```typescript
   * const result = await baasix.migrations.rollbackBatch();
   * ```
   */
  async rollbackBatch(): Promise<RollbackResult> {
    const response = await this.client.post<{ data: RollbackResult }>(
      "/migrations/rollback-batch",
      {}
    );
    return response.data;
  }

  /**
   * Create a new migration file
   * 
   * @example
   * ```typescript
   * const { filepath } = await baasix.migrations.create('add_status_column', {
   *   type: 'schema',
   *   description: 'Add status column to orders'
   * });
   * ```
   */
  async create(
    name: string,
    options?: CreateMigrationOptions
  ): Promise<{ filepath: string }> {
    const response = await this.client.post<{ data: { filepath: string } }>(
      "/migrations/create",
      { name, ...options }
    );
    return response.data;
  }

  /**
   * Mark a specific migration as completed without running it
   * Useful for existing installations that already have the changes
   * 
   * @example
   * ```typescript
   * await baasix.migrations.markCompleted('20231201000000');
   * ```
   */
  async markCompleted(
    version: string,
    metadata?: Record<string, unknown>
  ): Promise<Migration> {
    const response = await this.client.post<{ data: Migration }>(
      `/migrations/mark-completed/${encodeURIComponent(version)}`,
      { metadata }
    );
    return response.data;
  }

  /**
   * Mark all pending migrations as completed
   * Useful for bringing an existing database up to date without running migrations
   * 
   * @example
   * ```typescript
   * // Mark all pending
   * await baasix.migrations.markAllCompleted();
   * 
   * // Mark up to a specific version
   * await baasix.migrations.markAllCompleted('20231201000000');
   * ```
   */
  async markAllCompleted(toVersion?: string): Promise<MigrationRunResult> {
    const response = await this.client.post<{ data: MigrationRunResult }>(
      "/migrations/mark-all-completed",
      { toVersion }
    );
    return response.data;
  }
}
