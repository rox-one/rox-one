import { describe, expect, test } from 'bun:test'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import {
  beginClientActionAttempt,
  createClientActionUiState,
  normalizeActionSpec,
  parseActionFenceBody,
  presentationStateForSpec,
  settleClientActionAttempt,
} from '../../packages/core/src/docs/action-spec.ts'
import { ActionButtonBlock } from '../../packages/ui/src/components/markdown/extensions/ActionButtonBlock.tsx'
import { createSlashCommandItems, filterSlashCommandItems } from '../../packages/ui/src/components/markdown/TiptapSlashMenu.ts'

describe('LSX-WP-033 action buttons typed registry + inert imports', () => {
  test('six kinds are declarative/typed and gated; imported fences inert until review', () => {
    const kinds = ['command', 'entityLink', 'template', 'appendBlock', 'safeFormula', 'workflow'] as const
    for (const kind of kinds) {
      const payload: Record<string, unknown> = {
        kind,
        label: kind,
        reviewState: 'reviewed',
      }
      if (kind === 'command') payload.commandId = 'notes.sync'
      if (kind === 'entityLink') payload.entityRef = 'note:1'
      if (kind === 'template') payload.templateId = 'tpl'
      if (kind === 'appendBlock') payload.blockKind = 'callout'
      if (kind === 'safeFormula') payload.formula = '1+1'
      if (kind === 'workflow') payload.workflowRef = 'wf.1'
      const result = normalizeActionSpec(payload)
      expect(result.ok).toBe(true)
    }

    const imported = parseActionFenceBody('name X\ntype js\naction alert(1)', {
      language: 'button',
      imported: true,
    })
    expect(imported.ok).toBe(false)
    if (imported.ok) throw new Error('expected inert')
    expect(presentationStateForSpec(imported.inertSpec)).toBe('inert')
  })

  test('slash menu exposes action button insert', () => {
    const editor = new Editor({
      extensions: [StarterKit.configure({ codeBlock: false }), ActionButtonBlock, Markdown],
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    })
    const items = createSlashCommandItems(editor as any)
    const hit = filterSlashCommandItems(items, 'action').find((item) => item.id === 'action-button')
    expect(hit).toBeTruthy()
    hit!.run(editor as any)
    const flat = JSON.stringify(editor.getJSON())
    expect(flat).toContain('actionButton')
    expect(flat).toContain('unreviewed')
    expect(flat).not.toContain('rejectedUnsafe')
    expect(flat).not.toContain('notes.noop')
    editor.destroy()
  })

  test('pending duplicate click does not invent side effects', () => {
    const result = normalizeActionSpec({
      kind: 'command',
      label: 'Go',
      commandId: 'notes.sync',
      reviewState: 'reviewed',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    const first = beginClientActionAttempt(result.spec, createClientActionUiState(result.spec))
    expect(first.accepted).toBe(true)
    const second = beginClientActionAttempt(result.spec, first.ui)
    expect(second.accepted).toBe(false)
    expect(settleClientActionAttempt(result.spec, first.ui, 'success').presentation).toBe('default')
  })
})
