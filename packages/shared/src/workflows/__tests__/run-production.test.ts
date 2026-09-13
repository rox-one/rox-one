import { describe, expect, test } from 'bun:test'
import { createCanvasEdge, createCanvasNode, createDraftSpec } from '../graph.ts'
import { runWorkflow, runWorkflowProduction } from '../run.ts'

function node(id: string, kind: 'note' | 'model' | 'tool' | 'human_input', x = 0) {
  return createCanvasNode({
    id,
    kind,
    title: id,
    position: { x, y: 0 },
    now: 1,
    provenance: kind === 'note' ? undefined : { sessionId: 's1', messageIds: [id] },
  })
}

function executableSpec(kind: 'model' | 'tool' | 'human_input') {
  const spec = createDraftSpec('s1', 1)
  spec.nodes = [node('x', kind)]
  return spec
}

describe('canvas production runner (issue 325)', () => {
  test('simulate never marks executable nodes done', () => {
    const spec = createDraftSpec('s1', 1)
    spec.nodes = [node('n', 'note'), node('x', 'model', 1)]
    spec.edges = [createCanvasEdge({ source: 'n', target: 'x', now: 2 })]
    const run = runWorkflow({ spec, mode: 'pipeline', now: 10 })
    expect(run.execution).toBe('simulate')
    expect(run.status.n).toBe('done')
    expect(run.status.x).toBe('simulated')
    expect(run.status.x).not.toBe('done')
  })

  test('production without adapters does not succeed executable nodes', async () => {
    const spec = executableSpec('model')
    const run = await runWorkflowProduction({ spec, mode: 'pipeline', now: 10 })
    expect(run.execution).toBe('production')
    expect(run.status.x).toBe('failed')
    expect(run.status.x).not.toBe('done')
  })

  test('model adapter is actually invoked and receipts skip a restart', async () => {
    const spec = executableSpec('model')
    let calls = 0
    const adapters = {
      model: {
        async complete() {
          calls += 1
          return { text: `completion-${calls}` }
        },
      },
    }
    const first = await runWorkflowProduction({ spec, mode: 'pipeline', now: 10, adapters })
    expect(first.status.x).toBe('done')
    expect(first.artifacts.x?.value).toContain('completion-1')
    expect(first.permissionRevision).toBe(`${spec.versionId}:${spec.defaults.permissionMode}`)
    const second = await runWorkflowProduction({
      spec,
      mode: 'pipeline',
      now: 11,
      adapters,
      receipts: first.receipts,
    })
    expect(calls).toBe(1)
    expect(second.artifacts.x?.value).toBe(first.artifacts.x?.value)
  })

  test('human_input waits instead of completing', async () => {
    const spec = executableSpec('human_input')
    const run = await runWorkflowProduction({
      spec,
      mode: 'pipeline',
      now: 10,
      adapters: { human: { async resolve() { return null } } },
    })
    expect(run.status.x).toBe('waiting_approval')
    expect(run.finishedAt).toBeUndefined()
  })

  test('tool error is failed, not done', async () => {
    const spec = executableSpec('tool')
    const run = await runWorkflowProduction({
      spec,
      mode: 'pipeline',
      now: 10,
      adapters: {
        tool: {
          async invoke() {
            throw new Error('boom')
          },
        },
      },
    })
    expect(run.status.x).toBe('failed')
    expect(run.artifacts.x?.value).toBe('boom')
  })
})
