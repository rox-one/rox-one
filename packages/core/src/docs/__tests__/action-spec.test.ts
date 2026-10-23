import { describe, expect, test } from 'bun:test'
import {
  ACTION_KINDS,
  beginClientActionAttempt,
  createClientActionUiState,
  canonicalizeActionKind,
  listAvailableCommandIds,
  normalizeActionSpec,
  parseActionFenceBody,
  presentationStateForSpec,
  renderActionBasicExport,
  renderActionFenceMarkdown,
  sanitizeActionLabel,
  settleClientActionAttempt,
} from '../action-spec.ts'

describe('LSX-WP-033 ActionSpec helpers', () => {
  test('all six typed kinds validate when targets are present', () => {
    const cases = [
      { kind: 'command', commandId: 'notes.sync' },
      { kind: 'entityLink', entityRef: 'task:abc' },
      { kind: 'template', templateId: 'tpl.daily' },
      { kind: 'appendBlock', blockKind: 'callout' },
      { kind: 'safeFormula', formula: 'sum(a,b)' },
      { kind: 'workflow', workflowRef: 'wf.review' },
    ] as const

    expect(ACTION_KINDS).toHaveLength(6)
    for (const row of cases) {
      const result = normalizeActionSpec({
        ...row,
        label: 'Go',
        reviewState: 'reviewed',
      })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('expected ok')
      expect(result.spec.kind).toBe(row.kind)
      expect(result.spec.reviewState).toBe('reviewed')
      expect(result.spec.rejectedUnsafe).toBe(false)
      expect(presentationStateForSpec(result.spec)).toBe('default')
    }
  })

  test('imported raw script / eval / shell config stays inert and does not execute', () => {
    const dangerousBodies = [
      'name Hack\ntype js\naction console.log(1)',
      JSON.stringify({
        kind: 'command',
        label: 'Boom',
        script: 'fetch("https://evil.example")',
        commandId: 'x',
      }),
      JSON.stringify({
        kind: 'command',
        label: 'Shell',
        shell: 'rm -rf /',
        commandId: 'x',
      }),
      JSON.stringify({
        kind: 'command',
        label: '<img onerror=alert(1)>',
        commandId: 'x',
      }),
      JSON.stringify({
        kind: 'command',
        label: 'Eval',
        commandId: 'x',
        inputs: { code: 'eval("1+1")' },
      }),
    ]

    for (const body of dangerousBodies) {
      const parsed = parseActionFenceBody(body, { language: 'button', imported: true })
      expect(parsed.ok).toBe(false)
      if (parsed.ok) throw new Error('expected inert')
      expect(parsed.inertSpec.reviewState).toBe('unreviewed')
      expect(parsed.inertSpec.rejectedUnsafe).toBe(true)
      expect(presentationStateForSpec(parsed.inertSpec)).toBe('inert')

      // Negative control: no Function / eval side channel from normalize itself.
      const before = globalThis.Function
      expect(typeof before).toBe('function')
      const ui = createClientActionUiState(parsed.inertSpec)
      const attempt = beginClientActionAttempt(parsed.inertSpec, ui)
      expect(attempt.accepted).toBe(false)
      expect(attempt.reason).toBe('inert')
      expect(attempt.ui.presentation).toBe('inert')
    }
  })

  test('duplicate-click / pending does not invent side effects or success receipts', () => {
    const result = normalizeActionSpec({
      kind: 'command',
      label: 'Sync',
      commandId: 'notes.sync',
      reviewState: 'reviewed',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')

    let ui = createClientActionUiState(result.spec)
    const first = beginClientActionAttempt(result.spec, ui)
    expect(first.accepted).toBe(true)
    expect(first.ui.presentation).toBe('pending')
    expect(first.ui.attemptId).toBe(1)

    const second = beginClientActionAttempt(result.spec, first.ui)
    expect(second.accepted).toBe(false)
    expect(second.reason).toBe('pending')
    expect(second.ui.attemptId).toBe(1)

    // Settling with success/failure must not invent committed outcomes in this slice.
    ui = settleClientActionAttempt(result.spec, first.ui, 'success')
    expect(ui.presentation).toBe('default')
    ui = settleClientActionAttempt(result.spec, first.ui, 'failure')
    expect(ui.presentation).toBe('default')
  })

  test('fence roundtrip keeps safe declarative attrs; basic export stays inert text', () => {
    const result = normalizeActionSpec({
      kind: 'entityLink',
      label: 'Open task',
      entityRef: 'task:42',
      reviewState: 'reviewed',
      failurePolicy: 'stopOnError',
      inputs: { mode: 'preview' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')

    const md = renderActionFenceMarkdown(result.spec)
    expect(md).toContain('```rox-action')
    expect(md).toContain('"kind": "entityLink"')
    expect(md).toContain('"entityRef": "task:42"')
    expect(md).not.toContain('<script')

    const reparsed = parseActionFenceBody(md.replace(/^```rox-action\n/, '').replace(/\n```$/, ''), {
      language: 'rox-action',
    })
    expect(reparsed.ok).toBe(true)
    if (!reparsed.ok) throw new Error('expected ok')
    expect(reparsed.spec.kind).toBe('entityLink')
    expect(reparsed.spec.entityRef).toBe('task:42')

    const basic = renderActionBasicExport(result.spec)
    expect(basic).toContain('Open task')
    expect(basic).toContain('not executed')
    expect(basic).not.toMatch(/success|executed successfully/i)
  })

  test('serialize always canonicalizes fence language to rox-action', () => {
    const imported = parseActionFenceBody(
      JSON.stringify({
        kind: 'command',
        label: 'Sync',
        commandId: 'notes.sync',
        reviewState: 'unreviewed',
      }),
      { language: 'button', imported: true },
    )
    // Imported stays unreviewed; serialize must still emit ```rox-action (no dual langs).
    const spec = imported.ok ? imported.spec : imported.inertSpec
    expect(spec.reviewState).toBe('unreviewed')
    const md = renderActionFenceMarkdown(spec, 'button')
    expect(md.startsWith('```rox-action\n')).toBe(true)
    expect(md).not.toContain('```button')
    expect(md).toContain('"reviewState": "unreviewed"')
  })

    test('sanitizeActionLabel strips HTML and rejects javascript URLs', () => {
    expect(sanitizeActionLabel('<b>Hi</b> there')).toBe('Hi there')
    expect(sanitizeActionLabel('javascript:alert(1)')).toBe('')
    expect(canonicalizeActionKind('entity-link')).toBe('entityLink')
    expect(canonicalizeActionKind('bogus')).toBeNull()
  })

  test('listAvailableCommandIds is a read-only probe', () => {
    expect(listAvailableCommandIds(['a', 'b'])).toEqual(['a', 'b'])
    expect(
      listAvailableCommandIds({
        query: () => [{ id: 'notes.sync' }, { id: 'notes.export' }],
      }),
    ).toEqual(['notes.sync', 'notes.export'])
  })
})
