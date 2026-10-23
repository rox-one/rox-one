import { describe, expect, it } from 'bun:test'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import {
  ActionButtonBlock,
  createActionButtonContent,
  insertActionButtonContent,
} from '../ActionButtonBlock'
import { presentationStateForSpec, parseActionFenceBody } from '../../../../../../core/src/docs/action-spec'

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
  it('slash payload inserts a reviewed declarative command button', () => {
    const editor = makeEditor()
    insertActionButtonContent(editor)
    const json = JSON.stringify(editor.getJSON())
    expect(json).toContain('"type":"actionButton"')
    expect(json).toContain('notes.noop')
    const md = editor.getMarkdown()
    expect(md).toContain('```rox-action')
    expect(md).toContain('"kind": "command"')
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
    const code = String(buttons[0].attrs.code ?? '')
    const language = String(buttons[0].attrs.language ?? 'button')
    const parsed = parseActionFenceBody(code, { language, imported: true })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('expected inert')
    expect(presentationStateForSpec(parsed.inertSpec)).toBe('inert')
    expect(parsed.inertSpec.rejectedUnsafe).toBe(true)

    const md = editor.getMarkdown()
    // Export keeps an inert declarative fence / representation — never a fake success toast string.
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
})
