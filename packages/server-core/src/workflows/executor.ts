import {
  OPERATION_RESULT_V2_SCHEMA,
  isUiVerified,
  type OperationReceipt,
  type OperationResultV2,
} from '@craft-agent/core/meetings'
import {
  reachableFrom,
  topologicalOrder,
  validateWorkflowSpec,
  type CanvasNode,
  type SessionWorkflowSpec,
  type WorkflowArtifact,
  type WorkflowNodeRunStatus,
  type WorkflowRunMode,
} from '@craft-agent/shared/workflows'
import { isLoopbackProvider, isLoopbackTransport } from './fakes.ts'
import { createInMemoryReceiptStore, runIdempotencyKey } from './receipts.ts'
import type {
  LiveWorkflowEvidence,
  LiveWorkflowExecuteInput,
  LiveWorkflowRun,
  WorkflowNodeBinding,
  WorkflowReceiptStore,
  WorkflowModelGateway,
  WorkflowToolRegistry,
} from './types.ts'
import { LiveWorkflowError } from './types.ts'

export { LiveWorkflowError } from './types.ts'
export { isLoopbackProvider, isLoopbackTransport } from './fakes.ts'

const NODE_FAILED_SAFE_MESSAGE = 'Node failed'
const PERMISSION_DENIED_SAFE_MESSAGE = 'Live execution is not allowed in this permission mode'

/**
 * Production success is live evidence + production mode + succeeded +
 * verified non-loopback receipt + a caller-injected receipt store.
 * Loopback/fake gateways can execute, but they are not claimable live
 * and never stamp `verification: 'verified'`.
 * A per-call in-memory Map (U1) is not a durable store.
 */
export function isLiveWorkflowProductionSuccess(run: {
  evidence: string
  operation: OperationResultV2
  receiptsInjected?: boolean
}): boolean {
  if (run.evidence !== 'live') return false
  if (run.receiptsInjected !== true) return false
  if (!isUiVerified(run.operation)) return false
  const receipt = run.operation.receipt
  if (receipt == null) return false
  if (isLoopbackProvider(receipt.provider)) return false
  return true
}

export class LiveWorkflowExecutor {
  private active: AbortController | null = null

  constructor(
    private readonly deps: {
      gateway: WorkflowModelGateway
      tools: WorkflowToolRegistry
      receipts?: WorkflowReceiptStore
    },
  ) {}

  cancel(): void {
    this.active?.abort()
  }

  execute(input: Omit<LiveWorkflowExecuteInput, 'gateway' | 'tools'> & {
    gateway?: WorkflowModelGateway
    tools?: WorkflowToolRegistry
  }): Promise<LiveWorkflowRun> {
    return executeLiveWorkflow({
      ...input,
      gateway: input.gateway ?? this.deps.gateway,
      tools: input.tools ?? this.deps.tools,
      receipts: input.receipts ?? this.deps.receipts,
      signal: this.bindSignal(input.signal),
    })
  }

  private bindSignal(outer?: AbortSignal): AbortSignal {
    const controller = new AbortController()
    this.active = controller
    const onAbort = () => controller.abort()
    outer?.addEventListener('abort', onAbort)
    if (outer?.aborted) controller.abort()
    controller.signal.addEventListener(
      'abort',
      () => {
        outer?.removeEventListener('abort', onAbort)
        if (this.active === controller) this.active = null
      },
      { once: true },
    )
    return controller.signal
  }
}

export async function executeLiveWorkflow(input: LiveWorkflowExecuteInput): Promise<LiveWorkflowRun> {
  const now = input.now ?? Date.now()
  const selected = selectNodeIds(input.spec, input.mode, input.seedIds ?? [])
  const order = topologicalOrder(input.spec.nodes, input.spec.edges) ?? input.spec.nodes.map((node) => node.id)
  const ran = order.filter((id) => selected.has(id))
  const key = runIdempotencyKey({
    specVersionId: input.spec.versionId,
    mode: input.mode,
    nodeIds: ran,
    explicit: input.idempotencyKey,
  })
  const receiptsInjected = input.receipts != null
  const store = input.receipts ?? createInMemoryReceiptStore()
  const cached = store.get(key)
  if (cached) return cached
  const loopbackTransport = isLoopbackTransport(input)

  const status: Record<string, WorkflowNodeRunStatus> = {}
  for (const node of input.spec.nodes) {
    if (node.kind === 'annotation_frame') {
      status[node.id] = 'skipped'
      continue
    }
    if (!selected.has(node.id)) {
      status[node.id] = selected.size === 0 ? 'queued' : 'skipped'
      continue
    }
    status[node.id] = 'queued'
  }

  const stamps = claimStamps({ loopbackTransport, receipts: [] })
  const base = {
    id: `run_${now.toString(36)}`,
    specId: input.spec.id,
    specVersionId: input.spec.versionId,
    mode: input.mode,
    nodeIds: ran,
    status,
    artifacts: {} as Record<string, WorkflowArtifact>,
    startedAt: now,
    evidence: stamps.evidence,
    receiptsInjected,
  }

  if (selected.size === 0) {
    return {
      ...base,
      operation: operation({
        mode: stamps.mode,
        lifecycle: 'queued',
        verification: 'not_requested',
        operationId: base.id,
      }),
    }
  }

  assertSpecRunnable(input.spec, selected, input.bindings ?? {})

  const artifacts: Record<string, WorkflowArtifact> = {}
  const receipts: OperationReceipt[] = []
  let lifecycle: OperationResultV2['lifecycle'] = 'running'
  let error: OperationResultV2['error']
  const signal = input.signal
  const approved = new Set(input.approvedNodeIds ?? [])

  for (const nodeId of ran) {
    const node = input.spec.nodes.find((item) => item.id === nodeId)
    if (!node) continue
    if (signal?.aborted) {
      lifecycle = 'cancelled'
      break
    }
    if (node.kind === 'human_input') {
      status[node.id] = 'waiting_approval'
      lifecycle = 'waiting_approval'
      break
    }
    if (node.kind === 'subflow') {
      status[node.id] = 'failed'
      lifecycle = 'failed'
      error = { code: 'unsupported_node', retryable: false, safeMessage: 'subflow is not executed in this slice' }
      break
    }
    if (node.kind !== 'model' && node.kind !== 'tool') {
      status[node.id] = 'skipped'
      continue
    }
    const gate = liveNodeGate(node, input.spec, approved)
    if (gate === 'wait') {
      status[node.id] = 'waiting_approval'
      lifecycle = 'waiting_approval'
      break
    }
    if (gate === 'deny') {
      status[node.id] = 'failed'
      lifecycle = 'failed'
      error = { code: 'denied', retryable: false, safeMessage: PERMISSION_DENIED_SAFE_MESSAGE }
      break
    }
    try {
      status[node.id] = 'running'
      const binding = input.bindings?.[node.id]
      if (node.kind === 'model') {
        const completion = await input.gateway.complete({
          nodeId: node.id,
          nodeTitle: node.title,
          prompt: promptFor(node, binding, artifacts, input.spec),
          model: binding?.model,
          signal,
        })
        throwIfAborted(signal)
        if (!completion.receipt) {
          status[node.id] = 'failed'
          lifecycle = 'failed'
          error = { code: 'missing_receipt', retryable: false, safeMessage: 'Model completion had no receipt' }
          break
        }
        const artifact = { nodeId: node.id, kind: node.outputs[0]?.kind ?? 'completion', value: completion.text }
        artifacts[node.id] = artifact
        receipts.push(completion.receipt)
        status[node.id] = 'done'
        continue
      }
      if (node.kind === 'tool') {
        const result = await input.tools.call({
          nodeId: node.id,
          name: binding?.toolName ?? node.title,
          input: binding?.input ?? artifactInput(node, artifacts, input.spec),
          signal,
        })
        throwIfAborted(signal)
        if (!result.receipt) {
          status[node.id] = 'failed'
          lifecycle = 'failed'
          error = { code: 'missing_receipt', retryable: false, safeMessage: 'Tool result had no receipt' }
          break
        }
        artifacts[node.id] = { nodeId: node.id, kind: node.outputs[0]?.kind ?? 'json', value: result.text }
        receipts.push(result.receipt)
        status[node.id] = 'done'
        continue
      }
      const unexpected: never = node.kind
      throw new Error(`unexpected live node kind: ${unexpected}`)
    } catch (caught) {
      if (isAbort(caught) || signal?.aborted) {
        status[node.id] = 'cancelled'
        lifecycle = 'cancelled'
        break
      }
      status[node.id] = 'failed'
      lifecycle = 'failed'
      console.error('[workflows] live node failed', {
        nodeId: node.id,
        kind: node.kind,
        error: caught instanceof Error ? caught.message : caught,
      })
      error = {
        code: node.kind === 'model' ? 'model_failed' : 'tool_failed',
        retryable: false,
        safeMessage: NODE_FAILED_SAFE_MESSAGE,
      }
      break
    }
  }

  if (lifecycle === 'running') {
    const executable = ran
      .map((id) => input.spec.nodes.find((node) => node.id === id))
      .filter((node): node is CanvasNode => Boolean(node && (node.kind === 'model' || node.kind === 'tool')))
    const allDone = executable.every((node) => status[node.id] === 'done')
    lifecycle =
      executable.length > 0 && allDone && receipts.length === executable.length ? 'succeeded' : 'failed'
    if (lifecycle === 'failed' && !error) {
      error = {
        code: 'incomplete',
        retryable: false,
        safeMessage:
          executable.length === 0
            ? 'Live run had no model or tool node to verify'
            : 'Live run did not produce a receipt for every executable node',
      }
    }
  }

  const claimed = claimStamps({ loopbackTransport, receipts })
  const succeededWithReceipts = lifecycle === 'succeeded' && receipts.length > 0
  const verified =
    succeededWithReceipts && claimed.evidence === 'live' && claimed.mode === 'production'
  const receipt = succeededWithReceipts ? receipts[receipts.length - 1] : undefined
  const run: LiveWorkflowRun = {
    ...base,
    evidence: claimed.evidence,
    artifacts,
    finishedAt: lifecycle === 'waiting_approval' ? undefined : now,
    operation: operation({
      mode: claimed.mode,
      lifecycle,
      verification: verified ? 'verified' : lifecycle === 'succeeded' ? 'unknown' : 'not_requested',
      operationId: base.id,
      receipt,
      error,
    }),
  }

  if (lifecycle === 'succeeded' && receipt) store.put(key, run)
  return run
}

function liveNodeGate(
  node: CanvasNode,
  spec: SessionWorkflowSpec,
  approved: ReadonlySet<string>,
): 'allow' | 'wait' | 'deny' {
  if (approved.has(node.id)) return 'allow'
  const mode = node.permissionMode ?? spec.defaults.permissionMode
  if (mode === 'allow-all') return 'allow'
  if (mode === 'ask') return 'wait'
  return 'deny'
}

function claimStamps(input: {
  loopbackTransport: boolean
  receipts: readonly OperationReceipt[]
}): { evidence: LiveWorkflowEvidence; mode: OperationResultV2['mode'] } {
  if (input.loopbackTransport || input.receipts.some((item) => isLoopbackProvider(item.provider))) {
    return { evidence: 'loopback', mode: 'fixture' }
  }
  return { evidence: 'live', mode: 'production' }
}

function operation(input: {
  mode: OperationResultV2['mode']
  lifecycle: OperationResultV2['lifecycle']
  verification: OperationResultV2['verification']
  operationId: string
  receipt?: OperationReceipt
  error?: OperationResultV2['error']
}): OperationResultV2 {
  return {
    schemaVersion: OPERATION_RESULT_V2_SCHEMA,
    mode: input.mode,
    lifecycle: input.lifecycle,
    verification: input.verification,
    operationId: input.operationId,
    ...(input.receipt ? { receipt: input.receipt } : {}),
    ...(input.error ? { error: input.error } : {}),
  }
}

function selectNodeIds(spec: SessionWorkflowSpec, mode: WorkflowRunMode, seedIds: string[]): Set<string> {
  const known = new Set(spec.nodes.map((node) => node.id))
  if (mode === 'pipeline') return new Set(spec.nodes.map((node) => node.id))
  const seeds = seedIds.filter((id) => known.has(id))
  if (mode === 'node' || mode === 'selection') return new Set(seeds)
  const fromHere = new Set<string>()
  for (const id of seeds) {
    for (const next of reachableFrom(id, spec.edges)) fromHere.add(next)
  }
  return fromHere
}

function assertSpecRunnable(
  spec: SessionWorkflowSpec,
  selected: Set<string>,
  bindings: Record<string, WorkflowNodeBinding>,
): void {
  const validation = validateWorkflowSpec(spec)
  if (validation.valid) return
  const remaining = validation.errors.filter((issue) => {
    const match = /^nodes\.([^.]+)\.inputs\./.exec(issue.path)
    if (match && issue.message.includes('Required input')) {
      const nodeId = match[1]!
      if (!selected.has(nodeId)) return false
      const binding = bindings[nodeId]
      if (binding?.prompt != null || binding?.input !== undefined) return false
      const node = spec.nodes.find((item) => item.id === nodeId)
      if (node?.kind === 'human_input') return false
    }
    return true
  })
  if (remaining.length > 0) {
    throw new LiveWorkflowError('WorkflowSpec is invalid', remaining)
  }
}

function promptFor(
  node: CanvasNode,
  binding: WorkflowNodeBinding | undefined,
  artifacts: Record<string, WorkflowArtifact>,
  spec: SessionWorkflowSpec,
): string {
  if (binding?.prompt != null) return binding.prompt
  const upstream = upstreamValues(node.id, spec, artifacts)
  if (upstream.length > 0) return upstream.join('\n')
  return node.title
}

function artifactInput(
  node: CanvasNode,
  artifacts: Record<string, WorkflowArtifact>,
  spec: SessionWorkflowSpec,
): unknown {
  const upstream = upstreamValues(node.id, spec, artifacts)
  if (upstream.length === 1) return upstream[0]
  if (upstream.length > 1) return upstream
  return { nodeId: node.id, title: node.title }
}

function upstreamValues(
  nodeId: string,
  spec: SessionWorkflowSpec,
  artifacts: Record<string, WorkflowArtifact>,
): string[] {
  return spec.edges
    .filter((edge) => edge.target === nodeId)
    .map((edge) => artifacts[edge.source]?.value)
    .filter((value): value is string => typeof value === 'string')
}

function isAbort(caught: unknown): boolean {
  return caught instanceof Error && (caught.name === 'AbortError' || caught.message === 'Aborted')
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  throw abortError()
}

function abortError(): Error {
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}
