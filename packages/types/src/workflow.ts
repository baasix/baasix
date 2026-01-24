/**
 * Workflow Types
 * Shared across core, sdk, and app packages
 */

// ============================================================================
// Workflow Types
// ============================================================================

/**
 * Workflow trigger types
 */
export type WorkflowTriggerType = "manual" | "webhook" | "schedule" | "hook" | "cron";

/**
 * Workflow status
 */
export type WorkflowStatus = "draft" | "active" | "inactive" | "archived";

/**
 * Workflow definition
 */
export interface Workflow {
  id: string;
  name: string;
  description?: string;
  status: WorkflowStatus;
  /** @deprecated Use status instead. Kept for backward compatibility. */
  isActive?: boolean;
  trigger_type?: WorkflowTriggerType;
  /** Alternative trigger format used by SDK */
  trigger?: WorkflowTrigger;
  trigger_cron?: string;
  trigger_webhook_path?: string;
  trigger_webhook_method?: string;
  trigger_hook_collection?: string;
  trigger_hook_action?: string;
  allowed_roles?: string[];
  flow_data?: WorkflowFlowData;
  /** Alternative format: nodes at top level */
  nodes?: WorkflowNode[];
  /** Alternative format: edges at top level */
  edges?: WorkflowEdge[];
  variables?: Record<string, unknown>;
  options?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Workflow flow data (React Flow format)
 */
export interface WorkflowFlowData {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  viewport?: { x: number; y: number; zoom: number };
}

/**
 * Workflow trigger configuration
 */
export interface WorkflowTrigger {
  type: WorkflowTriggerType;
  config?: Record<string, unknown>;
}

/**
 * Workflow node
 */
export interface WorkflowNode {
  id: string;
  type: string;
  data: WorkflowNodeData;
  position: { x: number; y: number };
}

/**
 * Workflow node data
 */
export interface WorkflowNodeData {
  label?: string;
  [key: string]: unknown;
}

/**
 * Workflow edge
 */
export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  condition?: string;
  label?: string;
}

// ============================================================================
// Workflow Execution Types
// ============================================================================

/**
 * Workflow execution status
 */
export type WorkflowExecutionStatus =
  | "queued"
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Workflow execution
 */
export interface WorkflowExecution {
  id: string;
  workflow_Id: string;
  status: WorkflowExecutionStatus;
  triggeredBy?: string;
  triggerData?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  durationMs?: number;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt?: string;
}

/**
 * Workflow execution log
 */
export interface WorkflowExecutionLog {
  id: string;
  execution_Id: string;
  nodeId: string;
  nodeType: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  durationMs?: number;
  startedAt?: string;
  completedAt?: string;
}
