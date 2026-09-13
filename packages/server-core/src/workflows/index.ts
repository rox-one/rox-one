/**
 * Server-side live workflow executor (ROX-P0-WORKFLOW-LIVE-EXEC).
 *
 * The client canvas runner (`@craft-agent/shared/workflows/run.ts`) stays
 * simulate-only. Production success is live + succeeded + verified receipt.
 *
 * Invoke with an injected model gateway and ToolRegistry. Tests and U1 use
 * `createLoopbackModelGateway` / `createLoopbackToolRegistry` so a real ROX
 * model is not required.
 *
 *   import {
 *     executeLiveWorkflow,
 *     createLoopbackModelGateway,
 *     createLoopbackToolRegistry,
 *   } from '@craft-agent/server-core/src/workflows/index.ts'
 *
 *   const gateway = createLoopbackModelGateway({ infer: 'ok' })
 *   const tools = createLoopbackToolRegistry({ echo: (input) => JSON.stringify(input) })
 *   await executeLiveWorkflow({ spec, mode: 'node', seedIds: [id], gateway, tools, bindings })
 */

export { executeLiveWorkflow, isLiveWorkflowProductionSuccess, LiveWorkflowExecutor, LiveWorkflowError } from './executor.ts'
export { createInMemoryReceiptStore, runIdempotencyKey } from './receipts.ts'
export { createLoopbackModelGateway, createLoopbackToolRegistry } from './fakes.ts'
export type { LoopbackModelGateway, LoopbackToolRegistry } from './fakes.ts'
export type {
  LiveWorkflowExecuteInput,
  LiveWorkflowRun,
  WorkflowModelCompletion,
  WorkflowModelGateway,
  WorkflowModelRequest,
  WorkflowNodeBinding,
  WorkflowReceiptStore,
  WorkflowToolCall,
  WorkflowToolRegistry,
  WorkflowToolResult,
} from './types.ts'
