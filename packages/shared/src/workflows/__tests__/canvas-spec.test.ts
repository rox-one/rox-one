import { describe, expect, test } from 'bun:test'
import {
  compareRuns,
  compareVersions,
  convertNodeKind,
  createCanvasEdge,
  createCanvasNode,
  createDraftSpec,
  createWorkflowDocument,
  exportSpec,
  forkVersion,
  importSpec,
  parseWorkflowDocument,
  promoteTraceToDraft,
  replayRun,
  runWorkflow,
  saveVersion,
  serializeWorkflowDocument,
  validateWorkflowSpec,
  workflowDocumentStorageKey,
} from '../index.ts'

function note(id: string, x = 0) {
  return createCanvasNode({ id, kind: 'note', title: id, position: { x, y: 0 }, now: 1 })
}

describe('session WorkflowSpec', () => {
  test('round-trips save/reopen through the document store', () => {
    const document = createWorkflowDocument('s1', 10)
    const a = createCanvasNode({ id: 'n_note', kind: 'note', title: 'Start', position: { x: 0, y: 0 }, now: 11 })
    const b = createCanvasNode({
      id: 'n_model',
      kind: 'model',
      title: 'Infer',
      position: { x: 200, y: 0 },
      permissionMode: 'ask',
      now: 12,
    })
    document.draft.nodes = [a, b]
    document.draft.edges = [createCanvasEdge({ source: a.id, target: b.id, now: 13 })]
    const frozen = saveVersion(document, 21)
    const raw = serializeWorkflowDocument(frozen)
    const reopened = parseWorkflowDocument(raw, 's1')

    expect(workflowDocumentStorageKey('s1')).toBe('rox.sessionMap.workflow.s1')
    expect(reopened.versions).toHaveLength(1)
    expect(reopened.versions[0]?.nodes.map((node) => node.kind)).toEqual(['note', 'model'])
    expect(reopened.versions[0]?.versionId).toBeDefined()
    expect(reopened.draft.versionId).toBe(reopened.versions[0]!.versionId)
  })

  test('rejects cycles, port mismatches, missing required inputs, and bad permission', () => {
    const spec = createDraftSpec('s1', 1)
    const model = createCanvasNode({ id: 'm1', kind: 'model', title: 'm', position: { x: 0, y: 0 }, now: 1 })
    const tool = createCanvasNode({ id: 't1', kind: 'tool', title: 't', position: { x: 1, y: 0 }, now: 2 })
    spec.nodes = [model, tool]
    spec.edges = [
      createCanvasEdge({ source: model.id, target: tool.id, now: 3 }),
      createCanvasEdge({ source: tool.id, target: model.id, now: 4 }),
    ]
    spec.defaults.permissionMode = 'ask'
    tool.permissionMode = 'yolo' as never

    const result = validateWorkflowSpec(spec)
    expect(result.valid).toBe(false)
    expect(result.errors.some((issue) => issue.message.includes('cycle'))).toBe(true)
    expect(result.errors.some((issue) => issue.message.includes('cannot connect'))).toBe(true)
    expect(result.errors.some((issue) => issue.message.includes('invalid permission'))).toBe(true)
  })

  test('promotes a session trace with provenance and stable layout', () => {
    const spec = promoteTraceToDraft({
      sessionId: 's1',
      now: 50,
      scenes: [
        {
          id: 'scn_u1',
          triggerMessageId: 'u1',
          assistantMessageIds: ['a1'],
          tools: [{ name: 'bash' }],
          triggerPreview: 'run tests',
          outcomePreview: 'ok',
          parentSceneId: null,
        },
        {
          id: 'scn_u2',
          triggerMessageId: 'u2',
          assistantMessageIds: ['a2'],
          tools: [],
          triggerPreview: 'summarize',
          outcomePreview: 'done',
          parentSceneId: 'scn_u1',
        },
      ],
    })
    expect(spec.nodes).toHaveLength(2)
    expect(spec.nodes[0]?.kind).toBe('tool')
    expect(spec.nodes[0]?.provenance).toEqual({ sessionId: 's1', sceneId: 'scn_u1', messageIds: ['u1', 'a1'] })
    expect(spec.edges).toHaveLength(1)
    expect(spec.nodes[0]?.position).toEqual({ x: 40, y: 40 })
    expect(spec.nodes[1]?.position).toEqual({ x: 320, y: 40 })
    expect(validateWorkflowSpec(spec).valid).toBe(true)
  })

  test('runs a saved version twice with identical artifacts', () => {
    const spec = promoteTraceToDraft({
      sessionId: 's1',
      now: 1,
      scenes: [
        {
          id: 'scn_u1',
          triggerMessageId: 'u1',
          assistantMessageIds: ['a1'],
          tools: [],
          triggerPreview: 'hello',
          outcomePreview: 'world',
          parentSceneId: null,
        },
      ],
    })
    const first = runWorkflow({ spec, mode: 'pipeline', now: 10 })
    const second = runWorkflow({ spec, mode: 'pipeline', now: 11 })
    expect(first.specVersionId).toBe(spec.versionId)
    expect(second.specVersionId).toBe(spec.versionId)
    expect(first.execution).toBe('simulate')
    expect(first.status[spec.nodes[0]!.id]).toBe('simulated')
    expect(compareRuns(first, second)).toEqual({ sameSpec: true, artifactDelta: [] })
    const replayed = replayRun(spec, first, 12)
    expect(replayed.specVersionId).toBe(first.specVersionId)
    expect(compareRuns(first, replayed).artifactDelta).toEqual([])
  })

  test('run node / from-here / selection / pipeline select different frontiers', () => {
    const spec = createDraftSpec('s1', 1)
    const a = note('a', 0)
    const b = note('b', 1)
    const c = note('c', 2)
    spec.nodes = [a, b, c]
    spec.edges = [
      createCanvasEdge({ source: a.id, target: b.id, now: 2 }),
      createCanvasEdge({ source: b.id, target: c.id, now: 3 }),
    ]
    const node = runWorkflow({ spec, mode: 'node', seedIds: [b.id], now: 4 })
    const fromHere = runWorkflow({ spec, mode: 'from-here', seedIds: [b.id], now: 5 })
    const selection = runWorkflow({ spec, mode: 'selection', seedIds: [a.id, c.id], now: 6 })
    const pipeline = runWorkflow({ spec, mode: 'pipeline', now: 7 })
    expect(node.nodeIds).toEqual(['b'])
    expect(fromHere.nodeIds.sort()).toEqual(['b', 'c'])
    expect(selection.nodeIds.sort()).toEqual(['a', 'c'])
    expect(pipeline.nodeIds.sort()).toEqual(['a', 'b', 'c'])
  })

  test('forks a version and compares node/edge edits', () => {
    let document = createWorkflowDocument('s1', 1)
    document.draft.nodes = [note('a'), note('b')]
    document.draft.edges = [createCanvasEdge({ source: 'a', target: 'b', now: 2 })]
    document = saveVersion(document, 3)
    const versionId = document.versions[0]!.versionId
    document = forkVersion(document, versionId, 4)
    document.draft.nodes = [...document.draft.nodes, note('c')]
    document.draft.nodes[0] = { ...document.draft.nodes[0]!, title: 'renamed' }
    const diff = compareVersions(document.versions[0]!, document.draft)
    expect(diff.addedNodes).toEqual(['c'])
    expect(diff.changedNodes).toEqual(['a'])
  })

  test('import/export keeps an immutable spec', () => {
    const spec = createDraftSpec('s1', 1)
    spec.nodes = [note('a')]
    const raw = exportSpec(spec)
    const imported = importSpec(raw, 's1')
    expect(imported.nodes[0]?.id).toBe('a')
    expect(() => importSpec(raw, 'other')).toThrow()
  })

  test('converts a note into an output sink', () => {
    const converted = convertNodeKind(note('a'), 'output')
    expect(converted.kind).toBe('output')
    expect(converted.outputs).toEqual([])
    expect(converted.inputs[0]?.name).toBe('value')
  })
})
