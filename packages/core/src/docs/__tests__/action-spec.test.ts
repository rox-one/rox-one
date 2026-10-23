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


  test('safeFormula rejects eval/function/HTML and clears formula (mirrors normalizeInputs)', () => {
    const cases = [
      'eval("1+1")',
      'Function("return 1")()',
      'new Function("x", "return x")',
      '<script>alert(1)</script>sum(a,b)',
      'onclick=alert(1)',
      'javascript:alert(1)',
    ]
    for (const formula of cases) {
      const result = normalizeActionSpec({
        kind: 'safeFormula',
        label: 'Calc',
        formula,
        reviewState: 'reviewed',
      })
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected inert')
      expect(result.inertSpec.rejectedUnsafe).toBe(true)
      expect(result.inertSpec.formula).toBeUndefined()
      expect(result.inertSpec.reviewState).toBe('unreviewed')
      expect(presentationStateForSpec(result.inertSpec)).toBe('inert')
    }

    // Benign formula still accepted when reviewed.
    const ok = normalizeActionSpec({
      kind: 'safeFormula',
      label: 'Calc',
      formula: 'sum(a,b)',
      reviewState: 'reviewed',
    })
    expect(ok.ok).toBe(true)
    if (!ok.ok) throw new Error('expected ok')
    expect(ok.spec.formula).toBe('sum(a,b)')
    expect(ok.spec.rejectedUnsafe).toBe(false)
  })


  test('unreviewed missing-target slash draft is ok and not rejectedUnsafe', () => {
    const result = normalizeActionSpec({
      kind: 'command',
      label: 'Action',
      reviewState: 'unreviewed',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.spec.rejectedUnsafe).toBe(false)
    expect(result.spec.commandId).toBeUndefined()
    expect(presentationStateForSpec(result.spec)).toBe('inert')

    const md = renderActionFenceMarkdown(result.spec)
    expect(md).toContain('```rox-action')
    expect(md).toContain('"reviewState": "unreviewed"')
    expect(md).not.toContain('rejectedUnsafe')
    expect(md).not.toContain('notes.noop')

    expect(renderActionBasicExport(result.spec)).toContain('unreviewed draft')
    expect(renderActionBasicExport(result.spec)).not.toContain('unreviewed import')
  })

  test('imported sourceLanguage keeps import copy; rejectedUnsafe only for unsafe payload', () => {
    const cleanImport = normalizeActionSpec(
      {
        kind: 'command',
        label: 'Sync',
        commandId: 'notes.sync',
        reviewState: 'unreviewed',
      },
      { imported: true, sourceLanguage: 'button' },
    )
    expect(cleanImport.ok).toBe(true)
    if (!cleanImport.ok) throw new Error('expected ok')
    expect(cleanImport.spec.rejectedUnsafe).toBe(false)
    expect(cleanImport.spec.sourceLanguage).toBe('button')
    expect(presentationStateForSpec(cleanImport.spec)).toBe('inert')
    expect(renderActionBasicExport(cleanImport.spec)).toContain('unreviewed import')

    const missingTargetImport = normalizeActionSpec(
      { kind: 'command', label: 'Draft', reviewState: 'unreviewed' },
      { imported: true, sourceLanguage: 'button' },
    )
    expect(missingTargetImport.ok).toBe(true)
    if (!missingTargetImport.ok) throw new Error('expected ok')
    expect(missingTargetImport.spec.rejectedUnsafe).toBe(false)
  })

  test('invalid-shape inert defaults keep rejectedUnsafe false', () => {
    const empty = parseActionFenceBody('', { language: 'rox-action' })
    expect(empty.ok).toBe(false)
    if (empty.ok) throw new Error('expected inert')
    expect(empty.issues).toContain('invalid-shape')
    expect(empty.inertSpec.rejectedUnsafe).toBe(false)

    const badJson = parseActionFenceBody('{not-json', { language: 'rox-action' })
    expect(badJson.ok).toBe(false)
    if (badJson.ok) throw new Error('expected inert')
    expect(badJson.issues).toContain('invalid-shape')
    expect(badJson.inertSpec.rejectedUnsafe).toBe(false)

    const noKeys = parseActionFenceBody('just prose without key lines', { language: 'button' })
    expect(noKeys.ok).toBe(false)
    if (noKeys.ok) throw new Error('expected inert')
    expect(noKeys.issues).toContain('invalid-shape')
    expect(noKeys.inertSpec.rejectedUnsafe).toBe(false)

    const notObject = normalizeActionSpec('string-payload')
    expect(notObject.ok).toBe(false)
    if (notObject.ok) throw new Error('expected inert')
    expect(notObject.inertSpec.rejectedUnsafe).toBe(false)
  })

  test('Obsidian key-lines map action into kind-appropriate targets', () => {
    const link = parseActionFenceBody(
      ['name Open task', 'type link', 'action task:42'].join('\n'),
      { language: 'button', imported: true },
    )
    expect(link.ok).toBe(true)
    if (!link.ok) throw new Error('expected ok')
    expect(link.spec.kind).toBe('entityLink')
    expect(link.spec.entityRef).toBe('task:42')
    expect(link.spec.commandId).toBeUndefined()

    const template = parseActionFenceBody(
      ['name Daily', 'type template', 'action tpl.daily'].join('\n'),
      { language: 'button', imported: true },
    )
    expect(template.ok).toBe(true)
    if (!template.ok) throw new Error('expected ok')
    expect(template.spec.kind).toBe('template')
    expect(template.spec.templateId).toBe('tpl.daily')
    expect(template.spec.commandId).toBeUndefined()

    const command = parseActionFenceBody(
      ['name Sync', 'type command', 'action notes.sync'].join('\n'),
      { language: 'button', imported: true },
    )
    expect(command.ok).toBe(true)
    if (!command.ok) throw new Error('expected ok')
    expect(command.spec.kind).toBe('command')
    expect(command.spec.commandId).toBe('notes.sync')
    expect(command.spec.entityRef).toBeUndefined()

    const workflow = parseActionFenceBody(
      ['name Review', 'type workflow', 'action wf.review'].join('\n'),
      { language: 'button', imported: true },
    )
    expect(workflow.ok).toBe(true)
    if (!workflow.ok) throw new Error('expected ok')
    expect(workflow.spec.kind).toBe('workflow')
    expect(workflow.spec.workflowRef).toBe('wf.review')
    expect(workflow.spec.commandId).toBeUndefined()
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
