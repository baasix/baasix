import { db } from './db.js';
import { schemaManager } from './schemaManager.js';
import { lt } from 'drizzle-orm';
import env from './env.js';

/**
 * Log cleanup configuration
 */
interface LogCleanupConfig {
  auditLogEnabled: boolean;
  auditLogRetentionDays: number;
  emailLogEnabled: boolean;
  emailLogRetentionDays: number;
}

/**
 * Get log cleanup configuration from environment
 */
function getConfig(): LogCleanupConfig {
  return {
    auditLogEnabled: env.get('AUDIT_LOG_CLEANUP_ENABLED') === 'true',
    auditLogRetentionDays: parseInt(env.get('AUDIT_LOG_RETENTION_DAYS') || '90', 10),
    emailLogEnabled: env.get('EMAIL_LOG_CLEANUP_ENABLED') === 'true',
    emailLogRetentionDays: parseInt(env.get('EMAIL_LOG_RETENTION_DAYS') || '30', 10),
  };
}

/**
 * Clean up old audit logs from the database
 */
async function cleanupAuditLogs(retentionDays: number): Promise<number> {
  try {
    const auditLogTable = schemaManager.getTable('baasix_AuditLog');

    if (!auditLogTable) {
      console.warn('[LogCleanup] baasix_AuditLog table not found, skipping audit log cleanup');
      return 0;
    }

    const createdAtColumn = auditLogTable['createdAt'];

    if (!createdAtColumn) {
      console.warn('[LogCleanup] createdAt column not found in baasix_AuditLog, skipping cleanup');
      return 0;
    }

    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await db
      .delete(auditLogTable)
      .where(lt(createdAtColumn, cutoffDate));

    const deletedCount = (result as any).rowCount || 0;

    if (deletedCount > 0) {
      console.info(`[LogCleanup] Audit log cleanup: removed ${deletedCount} record(s) older than ${retentionDays} days`);
    }

    return deletedCount;
  } catch (error: any) {
    console.error('[LogCleanup] Error during audit log cleanup:', error.message);
    return 0;
  }
}

/**
 * Clean up old email logs from the database
 */
async function cleanupEmailLogs(retentionDays: number): Promise<number> {
  try {
    const emailLogTable = schemaManager.getTable('baasix_EmailLog');

    if (!emailLogTable) {
      console.warn('[LogCleanup] baasix_EmailLog table not found, skipping email log cleanup');
      return 0;
    }

    const createdAtColumn = emailLogTable['createdAt'];

    if (!createdAtColumn) {
      console.warn('[LogCleanup] createdAt column not found in baasix_EmailLog, skipping cleanup');
      return 0;
    }

    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await db
      .delete(emailLogTable)
      .where(lt(createdAtColumn, cutoffDate));

    const deletedCount = (result as any).rowCount || 0;

    if (deletedCount > 0) {
      console.info(`[LogCleanup] Email log cleanup: removed ${deletedCount} record(s) older than ${retentionDays} days`);
    }

    return deletedCount;
  } catch (error: any) {
    console.error('[LogCleanup] Error during email log cleanup:', error.message);
    return 0;
  }
}

/**
 * Run all enabled log cleanup tasks
 */
async function runLogCleanup(): Promise<{ auditLogs: number; emailLogs: number }> {
  const config = getConfig();
  let auditLogs = 0;
  let emailLogs = 0;

  if (config.auditLogEnabled) {
    auditLogs = await cleanupAuditLogs(config.auditLogRetentionDays);
  }

  if (config.emailLogEnabled) {
    emailLogs = await cleanupEmailLogs(config.emailLogRetentionDays);
  }

  return { auditLogs, emailLogs };
}

/**
 * Start periodic cleanup of logs
 * Runs daily at 3 AM (to avoid conflicts with other scheduled tasks)
 */
export function startLogCleanup(): void {
  const config = getConfig();

  // Check if any cleanup is enabled
  if (!config.auditLogEnabled && !config.emailLogEnabled) {
    console.info('[LogCleanup] Log cleanup is disabled (set AUDIT_LOG_CLEANUP_ENABLED=true or EMAIL_LOG_CLEANUP_ENABLED=true to enable)');
    return;
  }

  const enabledLogs: string[] = [];
  if (config.auditLogEnabled) {
    enabledLogs.push(`audit logs (${config.auditLogRetentionDays} days retention)`);
  }
  if (config.emailLogEnabled) {
    enabledLogs.push(`email logs (${config.emailLogRetentionDays} days retention)`);
  }

  console.info(`[LogCleanup] Log cleanup service started for: ${enabledLogs.join(', ')}`);

  // Run initial cleanup after a short delay (to ensure tables are ready)
  setTimeout(() => {
    runLogCleanup();
  }, 10000); // 10 seconds after startup

  // Clean up daily (every 24 hours)
  setInterval(async () => {
    await runLogCleanup();
  }, 86400000); // 24 hours
}

/**
 * Manually trigger log cleanup (useful for admin endpoints or testing)
 */
export async function triggerLogCleanup(options?: {
  auditLogs?: boolean;
  emailLogs?: boolean;
  auditLogRetentionDays?: number;
  emailLogRetentionDays?: number;
}): Promise<{ auditLogs: number; emailLogs: number }> {
  const config = getConfig();
  let auditLogs = 0;
  let emailLogs = 0;

  const cleanAudit = options?.auditLogs ?? config.auditLogEnabled;
  const cleanEmail = options?.emailLogs ?? config.emailLogEnabled;
  const auditDays = options?.auditLogRetentionDays ?? config.auditLogRetentionDays;
  const emailDays = options?.emailLogRetentionDays ?? config.emailLogRetentionDays;

  if (cleanAudit) {
    auditLogs = await cleanupAuditLogs(auditDays);
  }

  if (cleanEmail) {
    emailLogs = await cleanupEmailLogs(emailDays);
  }

  return { auditLogs, emailLogs };
}

export default runLogCleanup;
