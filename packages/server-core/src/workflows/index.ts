/**
 * Server-side live workflow executor (ROX-P0-WORKFLOW-LIVE-EXEC).
 *
 * The client canvas runner (`@craft-agent/shared/workflows/run.ts`) stays
 * simulate-only. Production success is live evidence + production mode +
 * succeeded + verified non-loopback receipt + a caller-injected receipt store.
 *
 * Loopback gateways/tools execute for U1 but are stamped `evidence: 'loopback'`
 * and `operation.mode: 'fixture'`. Succeeded loopback runs keep
 * `verification: 'unknown'` (never `'verified'`). They never satisfy
 * `isLiveWorkflowProductionSuccess`.
 *
 * `permissionMode: 'ask'` waits (`waiting_approval`); `'safe'` fails closed
 * (`denied`). Neither calls gateway/tools until `approvedNodeIds` includes the
 * node. Internal catch details stay in logs, not `safeMessage`.
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

export {
  executeLiveWorkflow,
  isLiveWorkflowProductionSuccess,
  isLoopbackProvider,
  isLoopbackTransport,
  LiveWorkflowExecutor,
  LiveWorkflowError,
} from './executor.ts'
export { createInMemoryReceiptStore, runIdempotencyKey } from './receipts.ts'
export {
  createLoopbackModelGateway,
  createLoopbackToolRegistry,
  LOOPBACK_KIND,
  LOOPBACK_MODEL_PROVIDER,
  LOOPBACK_TOOLS_PROVIDER,
} from './fakes.ts'
export type { LoopbackModelGateway, LoopbackToolRegistry } from './fakes.ts'
export type {
  LiveWorkflowEvidence,
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
