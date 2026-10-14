import { useDomForFile } from '../../primitives/__tests__/dom-env'
import { describe, expect, it } from 'bun:test'
import { Editor } from '@tiptap/core'

useDomForFile()
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Markdown } from 'tiptap-markdown'
import { LatexBlock } from '../extensions/LatexBlock'
import { MermaidBlock } from '../extensions/MermaidBlock'
import { taskCheckboxInputRule } from '../extensions/task-checkbox-input-rule'
import { promoteFencedBlocks, serializeLegacyFence } from '../extensions/legacy-fence'

function legacyEditor(extra: Parameters<typeof Editor>[0]['extensions'] = []) {
  return new Editor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      TaskList,
      TaskItem.extend({ addInputRules() { return [...(this.parent?.() ?? []), taskCheckboxInputRule()] } }).configure({ nested: true }),
      LatexBlock,
      MermaidBlock,
      Markdown.configure({ html: false }),
      ...extra,
    ],
    // tiptap-markdown parses a string as markdown; start from a real empty paragraph.
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  })
}

function typeChars(editor: Editor, text: string) {
  for (const ch of text) {
    const { from, to } = editor.state.selection
    let handled = false
    editor.view.someProp('handleTextInput', (handler) => {
      handled = handler(editor.view, from, to, ch) === true
      return handled
    })
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(ch))
  }
}

describe('legacy rich-block markdown (notes engine)', () => {
  it('serialises a latexBlock node as a ```latex fence instead of [latexBlock]', () => {
    const editor = legacyEditor()
    editor.commands.insertContent({ type: 'latexBlock', attrs: { code: 'E = mc^2' } })
    const md = editor.storage.markdown.getMarkdown() as string
    expect(md).toContain('```latex')
    expect(md).toContain('E = mc^2')
    expect(md).not.toContain('[latexBlock]')
    editor.destroy()
  })

  it('round-trips a ```latex fence through the legacy parser', () => {
    const source = 'Intro\n\n```latex\nE = mc^2\n```\n'
    const editor = legacyEditor()
    editor.commands.setContent(source)
    const json = JSON.stringify(editor.getJSON())
    expect(json).toContain('"type":"latexBlock"')
    expect(json).toContain('E = mc^2')
    const md = editor.storage.markdown.getMarkdown() as string
    expect(md).toContain('```latex')
    expect(md).not.toContain('[latexBlock]')
    editor.destroy()
  })

  it('serialises mermaidBlock as a ```mermaid fence', () => {
    const editor = legacyEditor()
    editor.commands.insertContent({ type: 'mermaidBlock', attrs: { code: 'graph TD\n  A --> B' } })
    const md = editor.storage.markdown.getMarkdown() as string
    expect(md).toContain('```mermaid')
    expect(md).toContain('graph TD')
    expect(md).not.toContain('[mermaidBlock]')
    editor.destroy()
  })

  it('turns typed `- [ ] ` into a task list', () => {
    const editor = legacyEditor()
    typeChars(editor, '- [ ] ship it')
    const json = JSON.stringify(editor.getJSON())
    expect(json).toContain('"type":"taskList"')
    expect(json).toContain('"type":"taskItem"')
    expect(json).toContain('"checked":false')
    expect(json).toContain('ship it')
    editor.destroy()
  })

  it('turns typed `- [x] ` into a checked task item', () => {
    const editor = legacyEditor()
    typeChars(editor, '- [x] done')
    const json = JSON.stringify(editor.getJSON())
    expect(json).toContain('"checked":true')
    expect(json).toContain('done')
    editor.destroy()
  })
})

describe('legacy fence helpers', () => {
  it('writes a closed fence and closes the block', () => {
    const writes: string[] = []
    serializeLegacyFence(
      { write: (text) => writes.push(text), closeBlock: () => writes.push('CLOSE') },
      { attrs: { code: 'E = mc^2' } },
      'latex',
    )
    expect(writes.join('')).toBe('```latex\nE = mc^2\n```CLOSE')
  })

  it('promotes language-latex pre>code to a latex-block div', () => {
    const root = document.createElement('div')
    root.innerHTML = '<pre><code class="language-latex">E = mc^2</code></pre>'
    promoteFencedBlocks(root, new Set(['latex']), 'latex-block')
    const block = root.querySelector('[data-type="latex-block"]')
    expect(block?.getAttribute('data-code')).toBe('E = mc^2')
    expect(root.querySelector('pre')).toBeNull()
  })
})
