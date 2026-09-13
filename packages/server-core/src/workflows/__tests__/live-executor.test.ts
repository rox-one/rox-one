import { describe, expect, test } from 'bun:test'
import {
  createCanvasEdge,
  createCanvasNode,
  createDraftSpec,
  isProductionWorkflowSuccess,
  runWorkflow,
} from '@craft-agent/shared/workflows'
import {
  createInMemoryReceiptStore,
  createLoopbackModelGateway,
  createLoopbackToolRegistry,
  executeLiveWorkflow,
  isLiveWorkflowProductionSuccess,
  LiveWorkflowExecutor,
} from '../index.ts'
import type { SessionWorkflowSpec } from '@craft-agent/shared/workflows'
import type { OperationResultV2 } from '@craft-agent/core/meetings'
import type { WorkflowModelGateway, WorkflowToolRegistry } from '../types.ts'

const NOW = 1_700_000_000_000

function provenance(nodeId: string) {
  return { sessionId: 's1', messageIds: [nodeId] }
}

function specWith(nodes: SessionWorkflowSpec['nodes'], edges: SessionWorkflowSpec['edges'] = []): SessionWorkflowSpec {
  const spec = createDraftSpec('s1', NOW)
  spec.nodes = nodes
  spec.edges = edges
  spec.defaults.permissionMode = 'allow-all'
  return spec
}

function note(id: string) {
  return createCanvasNode({
    id,
    kind: 'note',
    title: 'hello',
    position: { x: 0, y: 0 },
    provenance: provenance(id),
    now: NOW,
  })
}

function modelNode(id: string) {
  return createCanvasNode({
    id,
    kind: 'model',
    title: 'infer',
    position: { x: 200, y: 0 },
    permissionMode: 'allow-all',
    provenance: provenance(id),
    now: NOW,
  })
}

function toolNode(id: string, title = 'echo') {
  return createCanvasNode({
    id,
    kind: 'tool',
    title,
    position: { x: 400, y: 0 },
    permissionMode: 'allow-all',
    provenance: provenance(id),
    now: NOW,
  })
}

function humanNode(id: string) {
  return createCanvasNode({
    id,
    kind: 'human_input',
    title: 'confirm',
    position: { x: 200, y: 80 },
    permissionMode: 'ask',
    provenance: provenance(id),
    now: NOW,
  })
}

function annotationNode(id: string) {
  return createCanvasNode({
    id,
    kind: 'annotation_frame',
    title: 'frame',
    position: { x: 0, y: 80 },
    provenance: provenance(id),
    now: NOW,
  })
}

function productionGateway(text = 'rox-complete'): WorkflowModelGateway {
  return {
    async complete(request) {
      return {
        text,
        model: 'rox/fast',
        receipt: {
          provider: 'rox',
          requestId: `model:${request.nodeId}`,
          verifiedAt: new Date(NOW).toISOString(),
        },
      }
    },
  }
}

function productionTools(text = 'tool-ok'): WorkflowToolRegistry {
  return {
    async call(call) {
      return {
        text,
        receipt: {
          provider: 'rox-tools',
          requestId: `tool:${call.nodeId}`,
          verifiedAt: new Date(NOW).toISOString(),
        },
      }
    },
  }
}

function forgedLive(overrides: {
  evidence?: string
  receiptsInjected?: boolean
  operation: Partial<OperationResultV2> & Pick<OperationResultV2, 'mode' | 'lifecycle' | 'verification'>
}) {
  return {
    evidence: overrides.evidence ?? 'live',
    receiptsInjected: overrides.receiptsInjected,
    operation: {
      schemaVersion: 2 as const,
      operationId: 'forged',
      ...overrides.operation,
    },
  }
}

describe('LiveWorkflowExecutor (ROX-P0-WORKFLOW-LIVE-EXEC)', () => {
  test('loopback gateway executes a model node but is not claimable live', async () => {
    const gateway = createLoopbackModelGateway({ infer: 'loopback-complete' })
    const tools = createLoopbackToolRegistry()
    const n = note('n1')
    const m = modelNode('m1')
    const spec = specWith([n, m], [createCanvasEdge({ source: n.id, target: m.id, now: NOW })])

    const run = await executeLiveWorkflow({
      spec,
      mode: 'node',
      seedIds: [m.id],
      now: NOW,
      gateway,
      tools,
      bindings: { [m.id]: { prompt: 'say hi' } },
    })

    expect(run.evidence).toBe('loopback')
    expect(run.evidence).not.toBe('live')
    expect(run.operation.mode).toBe('fixture')
    expect(run.operation.mode).not.toBe('production')
    expect(run.status[m.id]).toBe('done')
    expect(run.status[m.id]).not.toBe('simulated')
    expect(run.artifacts[m.id]?.value).toBe('loopback-complete')
    expect(run.operation.lifecycle).toBe('succeeded')
    expect(run.operation.verification).not.toBe('verified')
    expect(run.operation.verification).toBe('unknown')
    expect(run.operation.receipt?.provider).toBe('loopback')
    expect(run.receiptsInjected).toBe(false)
    expect(isLiveWorkflowProductionSuccess(run)).toBe(false)
    expect(gateway.calls).toHaveLength(1)
    expect(gateway.calls[0]?.prompt).toBe('say hi')
  })

  test('loopback ToolRegistry executes a tool node but is not claimable live', async () => {
    const gateway = createLoopbackModelGateway()
    const tools = createLoopbackToolRegistry({
      echo: (input) => `echoed:${JSON.stringify(input)}`,
    })
    const t = toolNode('t1', 'echo')
    const spec = specWith([t])

    const run = await executeLiveWorkflow({
      spec,
      mode: 'node',
      seedIds: [t.id],
      now: NOW,
      gateway,
      tools,
      bindings: { [t.id]: { toolName: 'echo', input: { ping: 1 } } },
    })

    expect(run.evidence).toBe('loopback')
    expect(run.operation.mode).toBe('fixture')
    expect(run.status[t.id]).toBe('done')
    expect(run.artifacts[t.id]?.value).toBe('echoed:{"ping":1}')
    expect(run.operation.lifecycle).toBe('succeeded')
    expect(run.operation.verification).not.toBe('verified')
    expect(run.operation.verification).toBe('unknown')
    expect(run.operation.receipt?.provider).toBe('loopback-tools')
    expect(isLiveWorkflowProductionSuccess(run)).toBe(false)
    expect(tools.calls).toHaveLength(1)
    expect(tools.calls[0]?.name).toBe('echo')
  })

  test('injected store + production gateway is live production success', async () => {
    const m = modelNode('m1')
    const spec = specWith([m])
    const run = await executeLiveWorkflow({
      spec,
      mode: 'node',
      seedIds: [m.id],
      now: NOW,
      gateway: productionGateway(),
      tools: productionTools(),
      receipts: createInMemoryReceiptStore(),
      bindings: { [m.id]: { prompt: 'say hi' } },
    })

    expect(run.evidence).toBe('live')
    expect(run.operation.mode).toBe('production')
    expect(run.operation.lifecycle).toBe('succeeded')
    expect(run.operation.verification).toBe('verified')
    expect(run.operation.receipt?.provider).toBe('rox')
    expect(run.receiptsInjected).toBe(true)
    expect(isLiveWorkflowProductionSuccess(run)).toBe(true)
  })

  test('production gateway with ephemeral per-call Map is not production success', async () => {
    const m = modelNode('m1')
    const spec = specWith([m])
    const run = await executeLiveWorkflow({
      spec,
      mode: 'node',
      seedIds: [m.id],
      now: NOW,
      gateway: productionGateway(),
      tools: productionTools(),
      bindings: { [m.id]: { prompt: 'say hi' } },
    })

    expect(run.evidence).toBe('live')
    expect(run.operation.mode).toBe('production')
    expect(run.operation.lifecycle).toBe('succeeded')
    expect(run.receiptsInjected).toBe(false)
    expect(isLiveWorkflowProductionSuccess(run)).toBe(false)
  })

  test('forged live + production + loopback receipt is not production success', () => {
    expect(
      isLiveWorkflowProductionSuccess(
        forgedLive({
          receiptsInjected: true,
          operation: {
            mode: 'production',
            lifecycle: 'succeeded',
            verification: 'verified',
            receipt: { provider: 'loopback' },
          },
        }),
      ),
    ).toBe(false)
    expect(
      isLiveWorkflowProductionSuccess(
        forgedLive({
          receiptsInjected: true,
          operation: {
            mode: 'production',
            lifecycle: 'succeeded',
            verification: 'verified',
            receipt: { provider: 'loopback-tools' },
          },
        }),
      ),
    ).toBe(false)
  })

  test('gateway error marks the node failed, not done, and is not production success', async () => {
    const gateway = createLoopbackModelGateway({
      infer: () => {
        throw new Error('upstream 500')
      },
    })
    const m = modelNode('m1')
    const spec = specWith([m])
    const run = await executeLiveWorkflow({
      spec,
      mode: 'node',
      seedIds: [m.id],
      now: NOW,
      gateway,
      tools: createLoopbackToolRegistry(),
      bindings: { [m.id]: { prompt: 'x' } },
    })

    expect(run.status[m.id]).toBe('failed')
    expect(run.status[m.id]).not.toBe('done')
    expect(run.evidence).toBe('loopback')
    expect(run.operation.mode).toBe('fixture')
    expect(run.operation.lifecycle).toBe('failed')
    expect(run.operation.verification).not.toBe('verified')
    expect(run.operation.error?.code).toBe('model_failed')
    expect(run.operation.error?.safeMessage).toBe('Node failed')
    expect(run.operation.error?.safeMessage).not.toContain('upstream 500')
    expect(isLiveWorkflowProductionSuccess(run)).toBe(false)
  })

  test('human_input waits for approval and is not succeeded', async () => {
    const h = humanNode('h1')
    const spec = specWith([h])
    const run = await executeLiveWorkflow({
      spec,
      mode: 'node',
      seedIds: [h.id],
      now: NOW,
      gateway: createLoopbackModelGateway(),
      tools: createLoopbackToolRegistry(),
    })

    expect(run.status[h.id]).toBe('waiting_approval')
    expect(run.operation.lifecycle).toBe('waiting_approval')
    expect(run.operation.lifecycle).not.toBe('succeeded')
    expect(run.finishedAt).toBeUndefined()
    expect(run.evidence).toBe('loopback')
    expect(isLiveWorkflowProductionSuccess(run)).toBe(false)
  })

  test('cancel stops an in-flight model call and leaves unstarted nodes queued, not failed', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const gateway = createLoopbackModelGateway({
      infer: async () => {
        await blocked
        return 'too-late'
      },
    })
    const tools = createLoopbackToolRegistry({ echo: () => 'nope' })
    const m = modelNode('m1')
    const t = toolNode('t1')
    const spec = specWith(
      [m, t],
      [createCanvasEdge({ source: m.id, target: t.id, now: NOW })],
    )
    const executor = new LiveWorkflowExecutor({ gateway, tools })
    const pending = executor.execute({
      spec,
      mode: 'pipeline',
      now: NOW,
      bindings: {
        [m.id]: { prompt: 'wait' },
        [t.id]: { toolName: 'echo', input: {} },
      },
    })
    await gateway.entered
    executor.cancel()
    release()
    const run = await pending

    expect(run.operation.lifecycle).toBe('cancelled')
    expect(run.status[m.id]).toBe('cancelled')
    expect(run.status[t.id]).toBe('queued')
    expect(run.status[t.id]).not.toBe('failed')
    expect(run.operation.error).toBeUndefined()
    expect(run.evidence).toBe('loopback')
    expect(tools.calls).toHaveLength(0)
    expect(isLiveWorkflowProductionSuccess(run)).toBe(false)
  })

  test('restart with the same idempotency key does not double a tool side-effect', async () => {
    const tools = createLoopbackToolRegistry({ echo: () => 'once' })
    const receipts = createInMemoryReceiptStore()
    const t = toolNode('t1', 'echo')
    const spec = specWith([t])
    const input = {
      spec,
      mode: 'node' as const,
      seedIds: [t.id],
      now: NOW,
      gateway: createLoopbackModelGateway(),
      tools,
      receipts,
      idempotencyKey: 'u1-tool-once',
      bindings: { [t.id]: { toolName: 'echo', input: { n: 1 } } },
    }

    const first = await executeLiveWorkflow(input)
    const second = await executeLiveWorkflow({ ...input, now: NOW + 1 })

    expect(first.operation.receipt?.requestId).toBe(second.operation.receipt?.requestId)
    expect(second.id).toBe(first.id)
    expect(tools.calls).toHaveLength(1)
    expect(first.receiptsInjected).toBe(true)
    expect(first.evidence).toBe('loopback')
    expect(first.operation.verification).not.toBe('verified')
    expect(isLiveWorkflowProductionSuccess(first)).toBe(false)
    expect(isLiveWorkflowProductionSuccess(second)).toBe(false)
  })

  test('note and annotation_frame stay skipped and are not live-verified without a receipt', async () => {
    const frame = annotationNode('a1')
    const n = note('n1')
    const m = modelNode('m1')
    const spec = specWith(
      [frame, n, m],
      [createCanvasEdge({ source: n.id, target: m.id, now: NOW })],
    )
    const run = await executeLiveWorkflow({
      spec,
      mode: 'pipeline',
      now: NOW,
      gateway: productionGateway(),
      tools: productionTools(),
      receipts: createInMemoryReceiptStore(),
      bindings: { [m.id]: { prompt: 'say hi' } },
    })

    expect(run.status[frame.id]).toBe('skipped')
    expect(run.status[n.id]).toBe('skipped')
    expect(run.artifacts[frame.id]).toBeUndefined()
    expect(run.artifacts[n.id]).toBeUndefined()
    expect(run.status[m.id]).toBe('done')
    expect(run.operation.lifecycle).toBe('succeeded')
    expect(isLiveWorkflowProductionSuccess(run)).toBe(true)
  })

  test('pipeline of only notes is not live-verified', async () => {
    const n = note('n1')
    const spec = specWith([n, annotationNode('a1')])
    const run = await executeLiveWorkflow({
      spec,
      mode: 'pipeline',
      now: NOW,
      gateway: productionGateway(),
      tools: productionTools(),
      receipts: createInMemoryReceiptStore(),
    })

    expect(run.status[n.id]).toBe('skipped')
    expect(run.status.a1).toBe('skipped')
    expect(run.operation.lifecycle).toBe('failed')
    expect(run.operation.verification).not.toBe('verified')
    expect(run.operation.error?.code).toBe('incomplete')
    expect(isLiveWorkflowProductionSuccess(run)).toBe(false)
  })

  test('queued is not an error and simulated canvas runs are not live production success', async () => {
    const m = modelNode('m1')
    const t = toolNode('t1')
    const spec = specWith(
      [m, t],
      [createCanvasEdge({ source: m.id, target: t.id, now: NOW })],
    )
    const simulated = runWorkflow({ spec, mode: 'pipeline', now: NOW })
    expect(simulated.evidence).toBe('simulated')
    expect(isProductionWorkflowSuccess(simulated)).toBe(false)
    expect(simulated.status[m.id]).toBe('simulated')
    expect(simulated.status[m.id]).not.toBe('done')

    const live = await executeLiveWorkflow({
      spec,
      mode: 'node',
      seedIds: [],
      now: NOW,
      gateway: createLoopbackModelGateway(),
      tools: createLoopbackToolRegistry(),
    })
    expect(live.evidence).toBe('loopback')
    expect(live.operation.mode).toBe('fixture')
    expect(live.operation.lifecycle).toBe('queued')
    expect(live.operation.error).toBeUndefined()
    expect(live.status[m.id]).toBe('queued')
    expect(live.status[t.id]).toBe('queued')
    expect(isLiveWorkflowProductionSuccess(live)).toBe(false)
    expect(isLiveWorkflowProductionSuccess({
      ...live,
      evidence: 'simulated',
      operation: {
        ...live.operation,
        mode: 'simulated',
        lifecycle: 'succeeded',
        verification: 'verified',
        receipt: { provider: 'fake' },
      },
    })).toBe(false)
  })

  test('ask model node waits for approval and does not call the gateway', async () => {
    let calls = 0
    const gateway: WorkflowModelGateway = {
      async complete(request) {
        calls += 1
        return productionGateway().complete(request)
      },
    }
    const m = modelNode('m1')
    m.permissionMode = 'ask'
    const spec = specWith([m])
    const run = await executeLiveWorkflow({
      spec,
      mode: 'node',
      seedIds: [m.id],
      now: NOW,
      gateway,
      tools: productionTools(),
      receipts: createInMemoryReceiptStore(),
      bindings: { [m.id]: { prompt: 'say hi' } },
    })

    expect(calls).toBe(0)
    expect(run.status[m.id]).toBe('waiting_approval')
    expect(run.status[m.id]).not.toBe('done')
    expect(run.operation.lifecycle).toBe('waiting_approval')
    expect(run.operation.lifecycle).not.toBe('succeeded')
    expect(run.finishedAt).toBeUndefined()
    expect(run.artifacts[m.id]).toBeUndefined()
    expect(isLiveWorkflowProductionSuccess(run)).toBe(false)
  })

  test('ask tool node waits for approval and does not call tools', async () => {
    let calls = 0
    const tools: WorkflowToolRegistry = {
      async call(request) {
        calls += 1
        return productionTools().call(request)
      },
    }
    const t = toolNode('t1')
    t.permissionMode = 'ask'
    const spec = specWith([t])
    const run = await executeLiveWorkflow({
      spec,
      mode: 'node',
      seedIds: [t.id],
      now: NOW,
      gateway: productionGateway(),
      tools,
      receipts: createInMemoryReceiptStore(),
      bindings: { [t.id]: { toolName: 'echo', input: { ping: 1 } } },
    })

    expect(calls).toBe(0)
    expect(run.status[t.id]).toBe('waiting_approval')
    expect(run.operation.lifecycle).toBe('waiting_approval')
    expect(isLiveWorkflowProductionSuccess(run)).toBe(false)
  })

  test('spec default ask is inherited when the node has no permissionMode', async () => {
    let calls = 0
    const gateway: WorkflowModelGateway = {
      async complete() {
        calls += 1
        throw new Error('must not run')
      },
    }
    const m = modelNode('m1')
    delete m.permissionMode
    const spec = specWith([m])
    spec.defaults.permissionMode = 'ask'
    const run = await executeLiveWorkflow({
      spec,
      mode: 'node',
      seedIds: [m.id],
      now: NOW,
      gateway,
      tools: productionTools(),
      bindings: { [m.id]: { prompt: 'x' } },
    })

    expect(calls).toBe(0)
    expect(run.status[m.id]).toBe('waiting_approval')
    expect(run.operation.lifecycle).toBe('waiting_approval')
  })

  test('safe model node is denied and does not call the gateway', async () => {
    let calls = 0
    const gateway: WorkflowModelGateway = {
      async complete() {
        calls += 1
        throw new Error('must not run')
      },
    }
    const m = modelNode('m1')
    m.permissionMode = 'safe'
    const spec = specWith([m])
    const run = await executeLiveWorkflow({
      spec,
      mode: 'node',
      seedIds: [m.id],
      now: NOW,
      gateway,
      tools: productionTools(),
      receipts: createInMemoryReceiptStore(),
      bindings: { [m.id]: { prompt: 'say hi' } },
    })

    expect(calls).toBe(0)
    expect(run.status[m.id]).toBe('failed')
    expect(run.status[m.id]).not.toBe('done')
    expect(run.operation.lifecycle).toBe('failed')
    expect(run.operation.error?.code).toBe('denied')
    expect(run.operation.error?.safeMessage).toBe('Live execution is not allowed in this permission mode')
    expect(isLiveWorkflowProductionSuccess(run)).toBe(false)
  })

  test('ask model executes only after the node is approved', async () => {
    let calls = 0
    const gateway: WorkflowModelGateway = {
      async complete(request) {
        calls += 1
        return productionGateway().complete(request)
      },
    }
    const m = modelNode('m1')
    m.permissionMode = 'ask'
    const spec = specWith([m])
    const input = {
      spec,
      mode: 'node' as const,
      seedIds: [m.id],
      now: NOW,
      gateway,
      tools: productionTools(),
      receipts: createInMemoryReceiptStore(),
      bindings: { [m.id]: { prompt: 'say hi' } },
    }

    const waiting = await executeLiveWorkflow(input)
    expect(calls).toBe(0)
    expect(waiting.operation.lifecycle).toBe('waiting_approval')

    const run = await executeLiveWorkflow({ ...input, approvedNodeIds: [m.id] })
    expect(calls).toBe(1)
    expect(run.status[m.id]).toBe('done')
    expect(run.operation.lifecycle).toBe('succeeded')
    expect(run.evidence).toBe('live')
    expect(isLiveWorkflowProductionSuccess(run)).toBe(true)
  })

  test('safe tool executes only after the node is approved', async () => {
    let calls = 0
    const tools: WorkflowToolRegistry = {
      async call(request) {
        calls += 1
        return productionTools().call(request)
      },
    }
    const t = toolNode('t1')
    t.permissionMode = 'safe'
    const spec = specWith([t])
    const denied = await executeLiveWorkflow({
      spec,
      mode: 'node',
      seedIds: [t.id],
      now: NOW,
      gateway: productionGateway(),
      tools,
      receipts: createInMemoryReceiptStore(),
      bindings: { [t.id]: { toolName: 'echo', input: {} } },
    })
    expect(calls).toBe(0)
    expect(denied.operation.error?.code).toBe('denied')

    const run = await executeLiveWorkflow({
      spec,
      mode: 'node',
      seedIds: [t.id],
      now: NOW,
      gateway: productionGateway(),
      tools,
      receipts: createInMemoryReceiptStore(),
      approvedNodeIds: [t.id],
      bindings: { [t.id]: { toolName: 'echo', input: {} } },
    })
    expect(calls).toBe(1)
    expect(run.status[t.id]).toBe('done')
    expect(isLiveWorkflowProductionSuccess(run)).toBe(true)
  })

  test('allow-all model then ask tool runs the model and stops before the tool', async () => {
    let modelCalls = 0
    let toolCalls = 0
    const gateway: WorkflowModelGateway = {
      async complete(request) {
        modelCalls += 1
        return productionGateway().complete(request)
      },
    }
    const tools: WorkflowToolRegistry = {
      async call(request) {
        toolCalls += 1
        return productionTools().call(request)
      },
    }
    const m = modelNode('m1')
    const t = toolNode('t1')
    t.permissionMode = 'ask'
    const spec = specWith([m, t], [createCanvasEdge({ source: m.id, target: t.id, now: NOW })])
    const run = await executeLiveWorkflow({
      spec,
      mode: 'pipeline',
      now: NOW,
      gateway,
      tools,
      receipts: createInMemoryReceiptStore(),
      bindings: {
        [m.id]: { prompt: 'say hi' },
        [t.id]: { toolName: 'echo', input: {} },
      },
    })

    expect(modelCalls).toBe(1)
    expect(toolCalls).toBe(0)
    expect(run.status[m.id]).toBe('done')
    expect(run.status[t.id]).toBe('waiting_approval')
    expect(run.operation.lifecycle).toBe('waiting_approval')
    expect(isLiveWorkflowProductionSuccess(run)).toBe(false)
  })
})
