import env from "../utils/env.js";
import { getCache } from "../utils/cache.js";
import { db } from "../utils/db.js";
import { schemaManager } from "../utils/schemaManager.js";
import { eq, lte, and, or, isNull } from "drizzle-orm";
import { hooksManager } from "./HooksManager.js";
import type { BackgroundTask } from '../types/index.js';
import Redis from "ioredis";
import crypto from "crypto";

class TasksService {
  private cache: any = null;
  private cacheKey: string = "baasix_tasks_not_started";
  private refreshInterval: number = 0;
  private refreshIntervalId: NodeJS.Timeout | null = null;
  private initialized: boolean = false;

  // Shutdown guard
  private shuttingDown: boolean = false;

  // Concurrency control
  private concurrency: number = 1;
  private runningCount: number = 0;

  // Stall detection
  private stallTimeout: number = 300; // seconds before a Running task is considered stalled

  // Redis-based distributed locking (separate from cache)
  private redisClient: Redis | null = null;
  private useTaskRedis: boolean = false;
  private instanceId: string = crypto.randomUUID();
  private lockRenewalInterval: NodeJS.Timeout | null = null;
  private hasInstanceLock: boolean = false;
  private static readonly LOCK_KEY = "baasix:task_lock";
  private static readonly LOCK_TTL_SECONDS = 60;
  private static readonly LOCK_RENEWAL_INTERVAL = 20000;

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Check if TasksService is enabled
    const isEnabled = env.get("TASK_SERVICE_ENABLED") === "true";
    if (!isEnabled) {
      console.info("TasksService is disabled (TASK_SERVICE_ENABLED=false)");
      return;
    }

    try {
      this.cache = getCache();

      // Concurrency (max concurrent tasks per instance, default: 1)
      this.concurrency = Math.max(1, parseInt(env.get("TASK_CONCURRENCY") || "1"));

      // Stall timeout (seconds before a Running task is considered stalled, min: 60s)
      this.stallTimeout = Math.max(60, parseInt(env.get("TASK_STALL_TIMEOUT") || "300"));

      // Initialize Redis for distributed locking if enabled
      this.useTaskRedis = env.get("TASK_REDIS_ENABLED") === "true";
      const taskRedisUrl = env.get("TASK_REDIS_URL");
      
      if (this.useTaskRedis && taskRedisUrl) {
        this.redisClient = new Redis(taskRedisUrl, {
          maxRetriesPerRequest: null,       // Don't throw on transient failures
          connectTimeout: 30000,            // 30s to establish initial connection (cloud Redis can be slow)
          enableReadyCheck: true,
          retryStrategy(times: number) {
            return Math.min(times * 200, 5000); // Reconnect with back-off, max 5s
          },
        });
        console.info(`TasksService: Redis enabled for distributed locking (instance: ${this.instanceId.slice(0, 8)})`);
      } else {
        console.info("TasksService: Single instance mode (no Redis for distributed locking)");
      }

      // Set refresh interval from ENV with maximum of 3 hours (10800 seconds)
      const envInterval = parseInt(env.get("TASK_LIST_REFRESH_INTERVAL") || "600");
      const maxInterval = 10800; // 3 hours in seconds
      this.refreshInterval = Math.min(envInterval, maxInterval) * 1000;

      // Recover stalled tasks, then initialize cache
      await this.recoverStalledTasks();
      await this.refreshCache();

      if(env.get('TEST_MODE') !== 'true') {
        // Start periodic refresh
        this.startPeriodicRefresh();
      }

      // Register hooks for baasix_Tasks CRUD operations
      this.registerHooks();

      this.initialized = true;
      console.info(
        `TasksService initialized (refresh: ${this.refreshInterval / 1000}s, concurrency: ${this.concurrency}, stall timeout: ${this.stallTimeout}s)`
      );
    } catch (error: any) {
      console.warn("TasksService: Initialization failed, will retry on first use:", error.message);
    }
  }

  async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }

  async refreshCache(): Promise<void> {
    try {
      // Get the Task table from schema manager
      const baasixTasksTable = schemaManager.getTable("baasix_Tasks");
      
      // Calculate time 4 hours from now
      const fourHoursFromNow = new Date();
      fourHoursFromNow.setHours(fourHoursFromNow.getHours() + 4);

      // Fetch "Not started" tasks with scheduled_time within 4 hours
      const notStartedTasks = await db
        .select()
        .from(baasixTasksTable)
        .where(
          and(
            eq(baasixTasksTable.task_status, "Not started"),
            lte(baasixTasksTable.scheduled_time, fourHoursFromNow)
          )
        )
        .orderBy(baasixTasksTable.scheduled_time);

      // Cache the tasks
      await this.cache.set(this.cacheKey, JSON.stringify(notStartedTasks));

      console.info(`TasksService: Cached ${notStartedTasks.length} not started tasks (scheduled within 4 hours)`);
    } catch (error: any) {
      console.error("TasksService: Error refreshing cache:", error);
    }
  }

  async getNotStartedTasks(): Promise<BackgroundTask[]> {
    await this.ensureInitialized();
    if (!this.initialized) {
      console.warn("TasksService: Cannot get tasks - initialization failed");
      return [];
    }

    if (this.shuttingDown) {
      console.info("TasksService: Shutdown in progress, returning empty task list");
      return [];
    }

    try {
      const cachedTasks = await this.cache.get(this.cacheKey);
      if (cachedTasks) {
        return JSON.parse(cachedTasks);
      }

      // If cache is empty, refresh and return
      await this.refreshCache();
      const refreshedTasks = await this.cache.get(this.cacheKey);
      return refreshedTasks ? JSON.parse(refreshedTasks) : [];
    } catch (error: any) {
      console.error("TasksService: Error getting not started tasks:", error);
      return [];
    }
  }

  /**
   * Atomically claim a task for processing.
   * Uses UPDATE ... WHERE task_status = 'Not started' to prevent duplicate processing.
   * If another worker already claimed the task, returns null (0 rows updated).
   *
   * @param taskId - The task ID to claim
   * @returns The claimed task record, or null if already claimed/not found
   */
  async claimTask(taskId: string | number): Promise<BackgroundTask | null> {
    await this.ensureInitialized();
    if (!this.initialized) {
      console.warn("TasksService: Cannot claim task - initialization failed");
      return null;
    }

    if (this.shuttingDown) {
      console.info("TasksService: Shutdown in progress, rejecting claimTask");
      return null;
    }

    try {
      const tasksTable = schemaManager.getTable("baasix_Tasks");

      // Atomic claim: only succeeds if task is still "Not started"
      const result = await db
        .update(tasksTable)
        .set({
          task_status: "Running",
          started_at: new Date(),
        })
        .where(
          and(
            eq(tasksTable.id, taskId),
            eq(tasksTable.task_status, "Not started")
          )
        )
        .returning();

      if (result.length === 0) {
        // Task was already claimed by another worker or doesn't exist
        return null;
      }

      // Incrementally remove claimed task from cache (no DB query needed)
      await this.removeTaskFromCache(taskId);

      console.info(`TasksService: Task ${taskId} claimed successfully`);
      return result[0] as BackgroundTask;
    } catch (error: any) {
      console.error(`TasksService: Error claiming task ${taskId}:`, error.message);
      return null;
    }
  }

  // ==================== Stall Recovery & Retry ====================

  /**
   * Recover tasks stuck in "Running" state beyond the stall timeout.
   * - If retry_count < max_retries: resets to "Not started" for automatic retry
   * - Otherwise: marks as "Error" with stall information
   *
   * Called during initialization and each periodic cache refresh.
   */
  async recoverStalledTasks(): Promise<void> {
    try {
      const tasksTable = schemaManager.getTable("baasix_Tasks");
      const stallThreshold = new Date(Date.now() - this.stallTimeout * 1000);

      // Find tasks stuck in Running (started_at null = legacy stuck tasks, or past threshold)
      const stalledTasks = await db
        .select()
        .from(tasksTable)
        .where(
          and(
            eq(tasksTable.task_status, "Running"),
            or(
              isNull(tasksTable.started_at),
              lte(tasksTable.started_at, stallThreshold)
            )
          )
        );

      if (stalledTasks.length === 0) return;

      let retried = 0;
      let errored = 0;

      for (const task of stalledTasks) {
        const maxRetries = task.max_retries || 0;
        const retryCount = task.retry_count || 0;

        if (maxRetries > 0 && retryCount < maxRetries) {
          // Retry: reset to "Not started" with incremented retry_count
          await db.update(tasksTable)
            .set({
              task_status: "Not started",
              retry_count: retryCount + 1,
              started_at: null,
              error_data: JSON.stringify({
                message: `Task stalled, auto-retrying (attempt ${retryCount + 1}/${maxRetries})`,
                stalled_at: new Date().toISOString(),
              }),
            })
            .where(and(eq(tasksTable.id, task.id), eq(tasksTable.task_status, "Running")));
          retried++;
        } else {
          // No retries left (or max_retries=0): mark as Error
          await db.update(tasksTable)
            .set({
              task_status: "Error",
              started_at: null,
              error_data: JSON.stringify({
                message: `Task stalled${maxRetries > 0 ? ` after ${maxRetries} retries` : ' (no retries configured)'}`,
                stalled_at: new Date().toISOString(),
              }),
            })
            .where(and(eq(tasksTable.id, task.id), eq(tasksTable.task_status, "Running")));
          errored++;
        }
      }

      console.info(`TasksService: Recovered ${stalledTasks.length} stalled tasks (${retried} retried, ${errored} errored)`);
    } catch (error: any) {
      // Table might not exist yet during initial setup
      console.warn("TasksService: Error recovering stalled tasks:", error.message);
    }
  }

  // ==================== Task Coordination ====================

  /**
   * @deprecated Use tryAcquireLock()/releaseLock() for atomic task coordination.
   * setTaskRunning(true) now delegates to tryAcquireLock() internally.
   */
  async setTaskRunning(isRunning: boolean): Promise<void> {
    await this.ensureInitialized();
    if (!this.initialized) {
      console.warn("TasksService: Cannot set task running state - initialization failed");
      return;
    }

    if (isRunning) {
      const acquired = await this.tryAcquireLock();
      if (!acquired) {
        console.warn("TasksService: setTaskRunning(true) failed - at capacity or lock held by another instance");
      }
    } else {
      await this.releaseLock();
    }
  }

  /**
   * Check if task processing is at capacity.
   * Returns true when running task count >= configured TASK_CONCURRENCY.
   * With default concurrency of 1, returns true if any task is running.
   */
  async isTaskRunning(): Promise<boolean> {
    await this.ensureInitialized();
    if (!this.initialized) return false;
    return this.runningCount >= this.concurrency;
  }

  /**
   * Get the number of currently running tasks.
   */
  getRunningCount(): number {
    return this.runningCount;
  }

  /**
   * Try to acquire a task processing slot.
   * Respects TASK_CONCURRENCY — allows up to N concurrent tasks per instance.
   * In multi-instance mode, only one instance can hold the processing lock at a time.
   *
   * @param lockTimeout - Redis lock TTL in seconds (multi-instance only, default: 60s)
   * @returns True if slot acquired, false if at capacity or lock held by another instance
   */
  async tryAcquireLock(lockTimeout: number = TasksService.LOCK_TTL_SECONDS): Promise<boolean> {
    await this.ensureInitialized();
    if (!this.initialized) {
      console.warn("TasksService: Cannot acquire lock - initialization failed");
      return false;
    }

    try {
      // Block new task acquisition during shutdown
      if (this.shuttingDown) {
        console.info("TasksService: Shutdown in progress, rejecting tryAcquireLock");
        return false;
      }

      // Check concurrency limit
      if (this.runningCount >= this.concurrency) {
        console.info(`TasksService: At capacity (${this.runningCount}/${this.concurrency})`);
        return false;
      }

      // Multi-instance mode: acquire Redis instance lock (only one instance processes)
      if (this.useTaskRedis && this.redisClient && !this.hasInstanceLock) {
        const result = await this.redisClient.set(
          TasksService.LOCK_KEY,
          this.instanceId,
          "EX", lockTimeout,
          "NX"
        );

        if (result !== "OK") {
          console.info("TasksService: Lock already held by another instance");
          return false;
        }

        this.hasInstanceLock = true;
        this.startLockRenewal();
        console.info(`TasksService: Instance lock acquired via Redis (instance: ${this.instanceId.slice(0, 8)})`);
      }

      this.runningCount++;
      console.info(`TasksService: Slot acquired (running: ${this.runningCount}/${this.concurrency})`);
      return true;
    } catch (error: any) {
      console.error("TasksService: Error acquiring lock:", error);
      return false;
    }
  }

  /**
   * Start automatic lock renewal to prevent expiry during long-running tasks.
   * Uses Lua script for atomic check-and-renew (prevents race between GET and EXPIRE).
   */
  private startLockRenewal(): void {
    this.stopLockRenewal();
    
    this.lockRenewalInterval = setInterval(async () => {
      if (this.useTaskRedis && this.redisClient) {
        try {
          // Atomic check-and-renew: only extend TTL if we still own the lock
          const luaRenew = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
              return redis.call("expire", KEYS[1], ARGV[2])
            else
              return 0
            end
          `;
          const result = await this.redisClient.eval(
            luaRenew, 1, TasksService.LOCK_KEY, this.instanceId, TasksService.LOCK_TTL_SECONDS
          );
          if (result === 1) {
            console.info(`TasksService: Lock renewed (instance: ${this.instanceId.slice(0, 8)})`);
          } else {
            // Lock lost (expired or taken by another instance)
            this.hasInstanceLock = false;
            this.runningCount = 0;
            this.stopLockRenewal();
            console.warn("TasksService: Lost instance lock, resetting");
          }
        } catch (error: any) {
          console.error("TasksService: Error renewing lock:", error.message);
        }
      }
    }, TasksService.LOCK_RENEWAL_INTERVAL);
  }

  /**
   * Stop lock renewal interval
   */
  private stopLockRenewal(): void {
    if (this.lockRenewalInterval) {
      clearInterval(this.lockRenewalInterval);
      this.lockRenewalInterval = null;
    }
  }

  /**
   * Release a task processing slot.
   * When all slots are released, the instance lock (Redis) is also released.
   * @returns True if slot released, false otherwise
   */
  async releaseLock(): Promise<boolean> {
    await this.ensureInitialized();
    if (!this.initialized) {
      console.warn("TasksService: Cannot release lock - initialization failed");
      return false;
    }

    try {
      // Decrement running count
      this.runningCount = Math.max(0, this.runningCount - 1);

      // Only release instance lock when all slots are free
      if (this.runningCount > 0) {
        console.info(`TasksService: Slot released (running: ${this.runningCount}/${this.concurrency})`);
        return true;
      }

      // All slots free — release instance lock
      this.stopLockRenewal();

      if (this.useTaskRedis && this.redisClient && this.hasInstanceLock) {
        const luaScript = `
          if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
          else
            return 0
          end
        `;
        const result = await this.redisClient.eval(luaScript, 1, TasksService.LOCK_KEY, this.instanceId);
        this.hasInstanceLock = false;

        if (result === 1) {
          console.info(`TasksService: Lock released via Redis (instance: ${this.instanceId.slice(0, 8)})`);
        } else {
          console.info("TasksService: Lock not owned by this instance");
        }
      } else {
        console.info("TasksService: All slots released");
      }

      return true;
    } catch (error: any) {
      console.error("TasksService: Error releasing lock:", error);
      return false;
    }
  }

  // ==================== Generic Job Locking ====================

  /**
   * In-memory set of job locks held by this instance (single-instance fallback).
   */
  private heldJobLocks: Set<string> = new Set();

  /**
   * Acquire a named distributed lock for a scheduled job.
   * Prevents the same job from running on multiple instances simultaneously.
   *
   * - With Redis (`TASK_REDIS_ENABLED=true`): uses `SET NX EX` for cross-instance locking
   * - Without Redis: uses in-memory set (prevents re-entry within same process)
   *
   * @param jobName  - Unique job identifier (e.g., "attendance-cron", "cleanup-job")
   * @param ttlSeconds - Lock TTL in seconds. Should be >= your job's max execution time.
   *                     Lock auto-expires after this, so a crashed instance won't block forever.
   *                     Default: 300 (5 minutes)
   * @returns `true` if lock acquired, `false` if already held (by this or another instance)
   *
   * @example
   * ```ts
   * schedule.scheduleJob(everyFifteenMinutes, async () => {
   *   const locked = await tasksService.acquireJobLock("attendance-cron", 600);
   *   if (!locked) return; // another instance is running this job
   *   try {
   *     await AttendanceUtils.ProcessScheduleAttendance(...);
   *   } finally {
   *     await tasksService.releaseJobLock("attendance-cron");
   *   }
   * });
   * ```
   */
  async acquireJobLock(jobName: string, ttlSeconds: number = 300): Promise<boolean> {
    await this.ensureInitialized();
    if (!this.initialized) {
      console.warn(`TasksService: Cannot acquire job lock '${jobName}' - initialization failed`);
      return false;
    }

    const lockKey = `baasix:job_lock:${jobName}`;

    try {
      if (this.useTaskRedis && this.redisClient) {
        // Distributed lock via Redis SET NX EX
        const result = await this.redisClient.set(
          lockKey,
          this.instanceId,
          "EX", ttlSeconds,
          "NX"
        );

        if (result === "OK") {
          this.heldJobLocks.add(jobName);
          console.info(`TasksService: Job lock '${jobName}' acquired (instance: ${this.instanceId.slice(0, 8)}, TTL: ${ttlSeconds}s)`);
          return true;
        }

        console.info(`TasksService: Job lock '${jobName}' already held by another instance`);
        return false;
      }

      // Single-instance mode: in-memory re-entry guard
      if (this.heldJobLocks.has(jobName)) {
        console.info(`TasksService: Job '${jobName}' already running (re-entry blocked)`);
        return false;
      }

      this.heldJobLocks.add(jobName);
      console.info(`TasksService: Job lock '${jobName}' acquired (single-instance)`);
      return true;
    } catch (error: any) {
      console.error(`TasksService: Error acquiring job lock '${jobName}':`, error.message);
      return false;
    }
  }

  /**
   * Release a named job lock.
   * Only releases if this instance owns the lock (atomic check via Lua in Redis mode).
   *
   * @param jobName - The job name used in acquireJobLock()
   * @returns `true` if released, `false` if not owned or error
   */
  async releaseJobLock(jobName: string): Promise<boolean> {
    await this.ensureInitialized();
    if (!this.initialized) return false;

    const lockKey = `baasix:job_lock:${jobName}`;

    try {
      if (this.useTaskRedis && this.redisClient) {
        // Atomic release: only delete if we own the lock
        const luaRelease = `
          if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
          else
            return 0
          end
        `;
        const result = await this.redisClient.eval(luaRelease, 1, lockKey, this.instanceId);
        this.heldJobLocks.delete(jobName);

        if (result === 1) {
          console.info(`TasksService: Job lock '${jobName}' released (instance: ${this.instanceId.slice(0, 8)})`);
          return true;
        }

        console.info(`TasksService: Job lock '${jobName}' not owned by this instance`);
        return false;
      }

      // Single-instance mode
      this.heldJobLocks.delete(jobName);
      console.info(`TasksService: Job lock '${jobName}' released (single-instance)`);
      return true;
    } catch (error: any) {
      console.error(`TasksService: Error releasing job lock '${jobName}':`, error.message);
      this.heldJobLocks.delete(jobName); // Clean up in-memory on error
      return false;
    }
  }

  // ==================== Periodic Refresh ====================

  startPeriodicRefresh(): void {
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
    }

    this.refreshIntervalId = setInterval(async () => {
      await this.recoverStalledTasks();
      await this.refreshCache();
    }, this.refreshInterval);

    console.info(`TasksService: Started periodic refresh every ${this.refreshInterval}ms`);
  }

  stopPeriodicRefresh(): void {
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
      this.refreshIntervalId = null;
      console.info("TasksService: Stopped periodic refresh");
    }
  }

  // ==================== Incremental Cache Helpers ====================

  /**
   * Add a task to the cached "not started" list without querying the DB.
   * Only adds if the task is "Not started" and scheduled within 4 hours.
   */
  private async addTaskToCache(task: any): Promise<void> {
    try {
      const fourHoursFromNow = new Date();
      fourHoursFromNow.setHours(fourHoursFromNow.getHours() + 4);

      // Only cache if it's "Not started" and within the 4-hour window
      if (task.task_status !== "Not started") return;
      const scheduledTime = task.scheduled_time ? new Date(task.scheduled_time) : null;
      if (!scheduledTime || scheduledTime > fourHoursFromNow) return;

      const cached = await this.cache.get(this.cacheKey);
      const tasks: any[] = cached ? JSON.parse(cached) : [];

      // Avoid duplicates
      if (!tasks.some((t: any) => String(t.id) === String(task.id))) {
        tasks.push(task);
        // Keep sorted by scheduled_time
        tasks.sort((a: any, b: any) => new Date(a.scheduled_time).getTime() - new Date(b.scheduled_time).getTime());
        await this.cache.set(this.cacheKey, JSON.stringify(tasks));
      }
    } catch (error: any) {
      console.warn("TasksService: Error adding task to cache:", error.message);
    }
  }

  /**
   * Remove a task from the cached "not started" list by ID without querying the DB.
   */
  private async removeTaskFromCache(taskId: string | number): Promise<void> {
    try {
      const cached = await this.cache.get(this.cacheKey);
      if (!cached) return;

      const tasks: any[] = JSON.parse(cached);
      const filtered = tasks.filter((t: any) => String(t.id) !== String(taskId));

      // Only write back if something was actually removed
      if (filtered.length !== tasks.length) {
        await this.cache.set(this.cacheKey, JSON.stringify(filtered));
      }
    } catch (error: any) {
      console.warn("TasksService: Error removing task from cache:", error.message);
    }
  }

  /**
   * Update a task in the cached "not started" list without querying the DB.
   * Replaces the cached task object with the new document.
   */
  private async updateTaskInCache(taskId: string | number, document: any): Promise<void> {
    try {
      const cached = await this.cache.get(this.cacheKey);
      if (!cached) return;

      const tasks: any[] = JSON.parse(cached);
      const index = tasks.findIndex((t: any) => String(t.id) === String(taskId));
      if (index !== -1) {
        tasks[index] = document;
        // Re-sort in case scheduled_time changed
        tasks.sort((a: any, b: any) => new Date(a.scheduled_time).getTime() - new Date(b.scheduled_time).getTime());
        await this.cache.set(this.cacheKey, JSON.stringify(tasks));
      }
    } catch (error: any) {
      console.warn("TasksService: Error updating task in cache:", error.message);
    }
  }

  registerHooks(): void {
    // Auto-set started_at when task_status changes to "Running", clear when changing away
    hooksManager.registerHook("baasix_Tasks", "items.update.before", async (context: any) => {
      if (context.data?.task_status === "Running" && !context.data.started_at) {
        context.data.started_at = new Date();
      } else if (context.data?.task_status && context.data.task_status !== "Running") {
        context.data.started_at = null;
      }
      return context;
    });

    // Incremental cache updates — no DB queries
    hooksManager.registerHook("baasix_Tasks", "items.create.after", async (context: any) => {
      const doc = context.document;
      if (doc?.task_status === "Not started") {
        await this.addTaskToCache(doc);
      }
      return context;
    });

    hooksManager.registerHook("baasix_Tasks", "items.update.after", async (context: any) => {
      const { id, document, previousDocument } = context;
      const prevStatus = previousDocument?.task_status;
      const newStatus = document?.task_status;

      if (prevStatus === "Not started" && newStatus !== "Not started") {
        // Moved away from "Not started" → remove from cache
        await this.removeTaskFromCache(id);
      } else if (prevStatus !== "Not started" && newStatus === "Not started") {
        // Moved to "Not started" (e.g., retry/reset) → add to cache
        await this.addTaskToCache(document);
      } else if (newStatus === "Not started") {
        // Still "Not started" but fields changed (e.g., scheduled_time) → update in place
        await this.updateTaskInCache(id, document);
      }
      return context;
    });

    hooksManager.registerHook("baasix_Tasks", "items.delete.after", async (context: any) => {
      await this.removeTaskFromCache(context.id);
      return context;
    });

    console.info("TasksService: Registered after-hooks for baasix_Tasks CRUD operations");
  }

  /**
   * Wait for all running tasks to complete (with timeout)
   */
  async waitForTaskCompletion(timeoutMs: number = 30000): Promise<void> {
    if (!this.initialized) {
      return;
    }

    const startTime = Date.now();
    console.info("TasksService: Waiting for running tasks to complete...");

    while (this.runningCount > 0) {
      if (Date.now() - startTime > timeoutMs) {
        console.warn(`TasksService: Timeout reached (${timeoutMs}ms), forcing shutdown (${this.runningCount} tasks still running)`);
        break;
      }

      console.info(`TasksService: ${this.runningCount} task(s) still running, waiting...`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.info("TasksService: No running tasks detected");
  }

  /**
   * Cleanup method for graceful shutdown
   */
  async shutdown(timeoutMs: number = 30000): Promise<void> {
    console.info("TasksService: Starting graceful shutdown...");

    // Set shutdown flag — blocks getNotStartedTasks, claimTask, tryAcquireLock
    this.shuttingDown = true;

    // Stop periodic refresh immediately (no point refreshing during shutdown)
    this.stopPeriodicRefresh();

    // Wait for running tasks to complete
    await this.waitForTaskCompletion(timeoutMs);

    // Stop lock renewal
    this.stopLockRenewal();

    // Force release all slots and instance lock
    this.runningCount = 0;
    await this.releaseLock();
    this.hasInstanceLock = false;

    // Release all held job locks
    if (this.heldJobLocks.size > 0) {
      const jobNames = [...this.heldJobLocks];
      for (const jobName of jobNames) {
        await this.releaseJobLock(jobName);
      }
      console.info(`TasksService: Released ${jobNames.length} job lock(s)`);
    }

    // Close Redis connection if open
    if (this.redisClient) {
      await this.redisClient.quit();
      this.redisClient = null;
      console.info("TasksService: Redis connection closed");
    }

    console.info("TasksService: Shutdown completed");
  }

  /**
   * Method to manually trigger cache refresh (useful for testing or manual operations)
   */
  async forceRefresh(): Promise<void> {
    console.info("TasksService: Force refreshing cache");
    await this.refreshCache();
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<Record<string, any>> {
    await this.ensureInitialized();
    if (!this.initialized) {
      return {
        cachedTasksCount: 0,
        runningCount: 0,
        concurrency: this.concurrency,
        isAtCapacity: false,
        stallTimeout: this.stallTimeout,
        refreshInterval: this.refreshInterval,
        initialized: false,
        error: "Service not initialized",
      };
    }

    try {
      const cachedTasks = await this.cache.get(this.cacheKey);

      return {
        cachedTasksCount: cachedTasks ? JSON.parse(cachedTasks).length : 0,
        runningCount: this.runningCount,
        concurrency: this.concurrency,
        isAtCapacity: this.runningCount >= this.concurrency,
        stallTimeout: this.stallTimeout,
        refreshInterval: this.refreshInterval,
        refreshIntervalSeconds: this.refreshInterval / 1000,
        maxRefreshIntervalSeconds: 10800,
        taskTimeWindow: "4 hours",
        initialized: this.initialized,
        lastRefreshed: new Date().toISOString(),
        distributedMode: this.useTaskRedis,
        hasInstanceLock: this.hasInstanceLock,
        instanceId: this.instanceId.slice(0, 8),
      };
    } catch (error: any) {
      console.error("TasksService: Error getting cache stats:", error);
      return {
        cachedTasksCount: 0,
        runningCount: 0,
        concurrency: this.concurrency,
        isAtCapacity: false,
        stallTimeout: this.stallTimeout,
        refreshInterval: this.refreshInterval,
        refreshIntervalSeconds: this.refreshInterval / 1000,
        maxRefreshIntervalSeconds: 10800,
        taskTimeWindow: "4 hours",
        initialized: this.initialized,
        error: error.message,
      };
    }
  }
}

// Use globalThis to ensure singleton across different module loading paths
declare global {
  var __baasix_tasksService: TasksService | undefined;
}

// Create singleton instance only if it doesn't exist
if (!globalThis.__baasix_tasksService) {
  globalThis.__baasix_tasksService = new TasksService();
}

const tasksService = globalThis.__baasix_tasksService;

export default tasksService;
