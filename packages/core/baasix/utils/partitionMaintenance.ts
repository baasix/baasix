import { schemaManager } from "./schemaManager.js";

const DAILY_MS = 24 * 60 * 60 * 1000;
let maintenanceTimer: NodeJS.Timeout | null = null;

async function runPartitionMaintenance(): Promise<void> {
  try {
    await schemaManager.reconcilePartitions();
  } catch (error) {
    console.error("[partitioning] Scheduled partition maintenance failed:", error);
  }
}

/** Pre-creates upcoming time partitions and heals partition drift once a day. */
export function startPartitionMaintenance(): void {
  if (maintenanceTimer) return;
  setTimeout(runPartitionMaintenance, 20000);
  maintenanceTimer = setInterval(runPartitionMaintenance, DAILY_MS);
  if (typeof maintenanceTimer.unref === "function") maintenanceTimer.unref();
}

export function stopPartitionMaintenance(): void {
  if (maintenanceTimer) { clearInterval(maintenanceTimer); maintenanceTimer = null; }
}
