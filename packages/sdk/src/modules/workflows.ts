import type { HttpClient } from "../client";
import type {
  PaginatedResponse,
  Workflow,
  WorkflowExecution,
} from "../types";

export interface WorkflowsModuleConfig {
  client: HttpClient;
}

/**
 * Workflows module for managing visual workflow automation.
 *
 * @example
 * ```typescript
 * // Execute a workflow
 * const result = await baasix.workflows.execute('workflow-uuid', {
 *   orderId: 'order-123'
 * });
 *
 * // Get workflow executions
 * const { data } = await baasix.workflows.getExecutions('workflow-uuid');
 * ```
 */
export class WorkflowsModule {
  private client: HttpClient;

  constructor(config: WorkflowsModuleConfig) {
    this.client = config.client;
  }

  /**
   * List all workflows
   *
   * @example
   * ```typescript
   * const { data } = await baasix.workflows.find();
   * ```
   */
  async find(params?: {
    limit?: number;
    page?: number;
    filter?: Record<string, unknown>;
  }): Promise<PaginatedResponse<Workflow>> {
    return this.client.get<PaginatedResponse<Workflow>>("/workflows", {
      params: params as Record<string, unknown>,
    });
  }

  /**
   * Get a workflow by ID
   *
   * @example
   * ```typescript
   * const workflow = await baasix.workflows.findOne('workflow-uuid');
   * ```
   */
  async findOne(id: string): Promise<Workflow> {
    const response = await this.client.get<{ data: Workflow }>(
      `/workflows/${id}`
    );
    return response.data;
  }

  /**
   * Create a new workflow
   *
   * @example
   * ```typescript
   * const workflow = await baasix.workflows.create({
   *   name: 'Order Processing',
   *   description: 'Process new orders',
   *   trigger: {
   *     type: 'hook',
   *     config: {
   *       collection: 'orders',
   *       event: 'items.create.after'
   *     }
   *   },
   *   nodes: [...],
   *   edges: [...],
   *   isActive: true
   * });
   * ```
   */
  async create(
    data: Omit<Workflow, "id" | "createdAt" | "updatedAt">
  ): Promise<Workflow> {
    const response = await this.client.post<{ data: Workflow }>(
      "/workflows",
      data
    );
    return response.data;
  }

  /**
   * Update a workflow
   *
   * @example
   * ```typescript
   * await baasix.workflows.update('workflow-uuid', {
   *   name: 'Updated Workflow Name',
   *   isActive: false
   * });
   * ```
   */
  async update(
    id: string,
    data: Partial<Omit<Workflow, "id" | "createdAt" | "updatedAt">>
  ): Promise<Workflow> {
    const response = await this.client.patch<{ data: Workflow }>(
      `/workflows/${id}`,
      data
    );
    return response.data;
  }

  /**
   * Delete a workflow
   *
   * @example
   * ```typescript
   * await baasix.workflows.delete('workflow-uuid');
   * ```
   */
  async delete(id: string): Promise<void> {
    await this.client.delete(`/workflows/${id}`);
  }

  /**
   * Execute a workflow manually
   *
   * @example
   * ```typescript
   * const result = await baasix.workflows.execute('workflow-uuid', {
   *   // Trigger data
   *   customerId: 'customer-123',
   *   action: 'sendEmail'
   * });
   * ```
   */
  async execute(
    id: string,
    triggerData?: Record<string, unknown>
  ): Promise<WorkflowExecution> {
    const response = await this.client.post<{ data: WorkflowExecution }>(
      `/workflows/${id}/execute`,
      { triggerData }
    );
    return response.data;
  }

  /**
   * Test a workflow without persisting execution
   *
   * @example
   * ```typescript
   * const result = await baasix.workflows.test('workflow-uuid', {
   *   testData: { value: 123 }
   * });
   * ```
   */
  async test(
    id: string,
    triggerData?: Record<string, unknown>
  ): Promise<WorkflowExecution> {
    const response = await this.client.post<{ data: WorkflowExecution }>(
      `/workflows/${id}/test`,
      { triggerData }
    );
    return response.data;
  }

  /**
   * Get workflow execution history
   *
   * @example
   * ```typescript
   * const { data } = await baasix.workflows.getExecutions('workflow-uuid', {
   *   limit: 50
   * });
   * ```
   */
  async getExecutions(
    id: string,
    params?: {
      limit?: number;
      page?: number;
      status?: "pending" | "running" | "completed" | "failed";
    }
  ): Promise<PaginatedResponse<WorkflowExecution>> {
    return this.client.get<PaginatedResponse<WorkflowExecution>>(
      `/workflows/${id}/executions`,
      { params: params as Record<string, unknown> }
    );
  }

  /**
   * Get a specific execution
   *
   * @example
   * ```typescript
   * const execution = await baasix.workflows.getExecution(
   *   'workflow-uuid',
   *   'execution-uuid'
   * );
   * ```
   */
  async getExecution(
    workflowId: string,
    executionId: string
  ): Promise<WorkflowExecution> {
    const response = await this.client.get<{ data: WorkflowExecution }>(
      `/workflows/${workflowId}/executions/${executionId}`
    );
    return response.data;
  }

  /**
   * Cancel a running execution
   *
   * @example
   * ```typescript
   * await baasix.workflows.cancelExecution('workflow-uuid', 'execution-uuid');
   * ```
   */
  async cancelExecution(
    workflowId: string,
    executionId: string
  ): Promise<void> {
    await this.client.post(
      `/workflows/${workflowId}/executions/${executionId}/cancel`
    );
  }

  /**
   * Enable a workflow
   *
   * @example
   * ```typescript
   * await baasix.workflows.enable('workflow-uuid');
   * ```
   */
  async enable(id: string): Promise<Workflow> {
    return this.update(id, { isActive: true });
  }

  /**
   * Disable a workflow
   *
   * @example
   * ```typescript
   * await baasix.workflows.disable('workflow-uuid');
   * ```
   */
  async disable(id: string): Promise<Workflow> {
    return this.update(id, { isActive: false });
  }

  /**
   * Duplicate a workflow
   *
   * @example
   * ```typescript
   * const newWorkflow = await baasix.workflows.duplicate('workflow-uuid', {
   *   name: 'Copy of My Workflow'
   * });
   * ```
   */
  async duplicate(
    id: string,
    overrides?: Partial<Omit<Workflow, "id" | "createdAt" | "updatedAt">>
  ): Promise<Workflow> {
    const original = await this.findOne(id);
    const { id: _, createdAt, updatedAt, ...workflowData } = original;

    return this.create({
      ...workflowData,
      name: `Copy of ${workflowData.name}`,
      ...overrides,
    });
  }
}

// Re-export types
export type { Workflow, WorkflowExecution };
