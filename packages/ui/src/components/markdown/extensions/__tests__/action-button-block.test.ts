import { describe, expect, it } from 'bun:test'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import {
  ActionButtonBlock,
  createActionButtonContent,
  insertActionButtonContent,
  isActionButtonActivateAllowed,
} from '../ActionButtonBlock'
import {
  presentationStateForSpec,
  parseActionFenceBody,
  renderActionBasicExport,
} from '../../../../../../core/src/docs/action-spec'

function makeEditor(content?: string) {
  return new Editor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      ActionButtonBlock,
      Markdown,
    ],
    ...(content
      ? { content, contentType: 'markdown' as const }
      : { content: { type: 'doc', content: [{ type: 'paragraph' }] } }),
  })
}

describe('ActionButtonBlock TipTap', () => {
  it('slash payload inserts an unreviewed/inert button without a fake command id', () => {
    const editor = makeEditor()
    insertActionButtonContent(editor)
    const json = JSON.stringify(editor.getJSON())
    expect(json).toContain('"type":"actionButton"')
    expect(json).not.toContain('notes.noop')
    expect(json).toContain('unreviewed')
    expect(json).not.toContain('rejectedUnsafe')
    const md = editor.getMarkdown()
    expect(md).toContain('```rox-action')
    expect(md).toContain('"kind": "command"')
    expect(md).toContain('"reviewState": "unreviewed"')
    expect(md).not.toContain('notes.noop')
    expect(md).not.toContain('rejectedUnsafe')

    const walk = (node: any): any[] => {
      const out = node.type === 'actionButton' ? [node] : []
      for (const child of node.content ?? []) out.push(...walk(child))
      return out
    }
    const buttons = walk(editor.getJSON())
    expect(buttons.length).toBeGreaterThanOrEqual(1)
    expect(String(buttons[0].attrs.language)).toBe('rox-action')
    const parsed = parseActionFenceBody(String(buttons[0].attrs.code ?? ''), {
      language: 'rox-action',
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('expected ok draft')
    expect(parsed.spec.rejectedUnsafe).toBe(false)
    expect(presentationStateForSpec(parsed.spec)).toBe('inert')
    editor.destroy()
  })

  it('imported button fence stays inert and round-trips without executing', () => {
    const source = [
      'Before',
      '',
      '```button',
      'name Dangerous',
      'type js',
      'action console.log("nope")',
      '```',
      '',
      'After',
    ].join('\n')

    const editor = makeEditor(source)
    const json = editor.getJSON()
    const flat = JSON.stringify(json)
    expect(flat).toContain('"type":"actionButton"')

    // Find node attrs
    const walk = (node: any): any[] => {
      const out = node.type === 'actionButton' ? [node] : []
      for (const child of node.content ?? []) out.push(...walk(child))
      return out
    }
    const buttons = walk(json)
    expect(buttons.length).toBeGreaterThanOrEqual(1)
    // Ingest canonicalizes fence lang to rox-action; inbound kept as sourceLanguage.
    expect(String(buttons[0].attrs.language)).toBe('rox-action')
    const code = String(buttons[0].attrs.code ?? '')
    expect(code).toContain('"sourceLanguage"')
    expect(code).toContain('button')
    const parsed = parseActionFenceBody(code, { language: 'rox-action' })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('expected inert')
    expect(presentationStateForSpec(parsed.inertSpec)).toBe('inert')
    expect(parsed.inertSpec.rejectedUnsafe).toBe(true)
    expect(parsed.inertSpec.sourceLanguage).toBe('button')

    const md = editor.getMarkdown()
    // Export keeps an inert declarative fence / representation — never a fake success toast string.
    // Fence language is always canonicalized to rox-action (inbound button → rox-action).
    expect(md).toContain('```rox-action')
    expect(md).not.toContain('```button')
    expect(md.toLowerCase()).not.toContain('executed successfully')
    expect(md).toContain('Before')
    expect(md).toContain('After')
    editor.destroy()
  })

  it('reviewed rox-action fence round-trips typed attrs', () => {
    const source = [
      '```rox-action',
      '{',
      '  "kind": "template",',
      '  "label": "Daily",',
      '  "reviewState": "reviewed",',
      '  "failurePolicy": "stopOnError",',
      '  "templateId": "tpl.daily"',
      '}',
      '```',
    ].join('\n')

    const editor = makeEditor(source)
    const md = editor.getMarkdown()
    expect(md).toContain('```rox-action')
    expect(md).toContain('"kind": "template"')
    expect(md).toContain('"templateId": "tpl.daily"')
    expect(md).toContain('"label": "Daily"')
    editor.destroy()
  })

  it('createActionButtonContent rejects inventing HTML labels', () => {
    const payload = createActionButtonContent({
      label: '<script>x</script>Save',
      kind: 'command',
      commandId: 'notes.save',
    })
    expect(payload.attrs.code).toContain('Save')
    expect(payload.attrs.code).not.toContain('<script>')
  })

  it('createActionButtonContent routes Partial through normalize+serialize', () => {
    const safe = createActionButtonContent({
      kind: 'safeFormula',
      label: 'Calc',
      formula: 'sum(a,b)',
      reviewState: 'reviewed',
    })
    expect(safe.attrs.language).toBe('rox-action')
    const safeParsed = parseActionFenceBody(safe.attrs.code, { language: 'rox-action' })
    expect(safeParsed.ok).toBe(true)
    if (!safeParsed.ok) throw new Error('expected ok')
    expect(safeParsed.spec.formula).toBe('sum(a,b)')
    expect(safeParsed.spec.rejectedUnsafe).toBe(false)

    const unsafe = createActionButtonContent({
      kind: 'safeFormula',
      label: 'Calc',
      formula: 'eval("1+1")',
      reviewState: 'reviewed',
    })
    const unsafeParsed = parseActionFenceBody(unsafe.attrs.code, { language: 'rox-action' })
    const unsafeSpec = unsafeParsed.ok ? unsafeParsed.spec : unsafeParsed.inertSpec
    expect(unsafeSpec.rejectedUnsafe).toBe(true)
    expect(unsafeSpec.formula).toBeUndefined()
    expect(unsafeSpec.reviewState).toBe('unreviewed')
    expect(unsafe.attrs.code).not.toContain('eval(')
  })


  it('inert copy distinguishes slash draft vs imported', () => {
    const draft = parseActionFenceBody(
      JSON.stringify({
        kind: 'command',
        label: 'Action',
        reviewState: 'unreviewed',
      }),
      { language: 'rox-action' },
    )
    expect(draft.ok).toBe(true)
    if (!draft.ok) throw new Error('expected ok')
    expect(draft.spec.rejectedUnsafe).toBe(false)
    expect(renderActionBasicExport(draft.spec)).toContain('unreviewed draft')
    expect(renderActionBasicExport(draft.spec)).not.toContain('unreviewed import')

    const imported = parseActionFenceBody(
      JSON.stringify({
        kind: 'command',
        label: 'Sync',
        commandId: 'notes.sync',
        reviewState: 'unreviewed',
        sourceLanguage: 'button',
      }),
      { language: 'rox-action' },
    )
    const importedSpec = imported.ok ? imported.spec : imported.inertSpec
    expect(importedSpec.sourceLanguage).toBe('button')
    expect(renderActionBasicExport(importedSpec)).toContain('unreviewed import')
  })

  it('read-only editor disables activate (no pending pulse)', () => {
    expect(
      isActionButtonActivateAllowed({ isEditable: false, inert: false, pending: false }),
    ).toBe(false)
    expect(
      isActionButtonActivateAllowed({ isEditable: true, inert: false, pending: false }),
    ).toBe(true)
    expect(
      isActionButtonActivateAllowed({ isEditable: true, inert: true, pending: false }),
    ).toBe(false)
    expect(
      isActionButtonActivateAllowed({ isEditable: true, inert: false, pending: true }),
    ).toBe(false)

    // Editor API: setEditable(false) must surface isEditable=false for the gate.
    const editor = makeEditor()
    insertActionButtonContent(editor, undefined, {
      kind: 'command',
      label: 'Sync',
      commandId: 'notes.sync',
      reviewState: 'reviewed',
    })
    expect(editor.isEditable).toBe(true)
    editor.setEditable(false)
    expect(editor.isEditable).toBe(false)
    expect(
      isActionButtonActivateAllowed({
        isEditable: editor.isEditable,
        inert: false,
        pending: false,
      }),
    ).toBe(false)
    editor.destroy()
  })

})
