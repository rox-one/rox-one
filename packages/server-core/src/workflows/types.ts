import type { OperationReceipt, OperationResultV2 } from '@craft-agent/core/meetings'
import type {
  SessionWorkflowSpec,
  WorkflowArtifact,
  WorkflowNodeRunStatus,
  WorkflowRunMode,
} from '@craft-agent/shared/workflows'

export type WorkflowModelRequest = {
  nodeId: string
  nodeTitle: string
  prompt: string
  model?: string
  signal?: AbortSignal
}

export type WorkflowModelCompletion = {
  text: string
  model?: string
  receipt?: OperationReceipt
}

export interface WorkflowModelGateway {
  complete(request: WorkflowModelRequest): Promise<WorkflowModelCompletion>
}

export type WorkflowToolCall = {
  nodeId: string
  name: string
  input: unknown
  signal?: AbortSignal
}

export type WorkflowToolResult = {
  text: string
  receipt?: OperationReceipt
}

export interface WorkflowToolRegistry {
  call(call: WorkflowToolCall): Promise<WorkflowToolResult>
}

export type WorkflowNodeBinding = {
  prompt?: string
  model?: string
  toolName?: string
  input?: unknown
}

export type LiveWorkflowRun = {
  id: string
  specId: string
  specVersionId: string
  mode: WorkflowRunMode
  nodeIds: string[]
  status: Record<string, WorkflowNodeRunStatus>
  artifacts: Record<string, WorkflowArtifact>
  startedAt: number
  finishedAt?: number
  /** This executor is live-only. Simulated canvas runs live in shared/workflows/run.ts. */
  evidence: 'live'
  operation: OperationResultV2
}

export interface WorkflowReceiptStore {
  get(key: string): LiveWorkflowRun | undefined
  put(key: string, run: LiveWorkflowRun): void
}

export type LiveWorkflowExecuteInput = {
  spec: SessionWorkflowSpec
  mode: WorkflowRunMode
  seedIds?: string[]
  now?: number
  idempotencyKey?: string
  signal?: AbortSignal
  gateway: WorkflowModelGateway
  tools: WorkflowToolRegistry
  receipts?: WorkflowReceiptStore
  bindings?: Record<string, WorkflowNodeBinding>
}

export class LiveWorkflowError extends Error {
  constructor(
    message: string,
    readonly issues: Array<{ path: string; message: string }>,
  ) {
    super(message)
    this.name = 'LiveWorkflowError'
  }
}
