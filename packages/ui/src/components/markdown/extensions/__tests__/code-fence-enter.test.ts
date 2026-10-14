import { useDomForFile } from '../../../primitives/__tests__/dom-env'
import { describe, expect, it } from 'bun:test'
import { Editor, Node } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { CodeFenceEnter, codeFenceLanguage } from '../CodeFenceEnter'

useDomForFile()

// A container that only accepts paragraphs, so the conversion must be refused.
const ParagraphOnlyBox = Node.create({
  name: 'paragraphOnlyBox', group: 'block', content: 'paragraph+',
  parseHTML: () => [{ tag: 'div[data-box]' }], renderHTML: () => ['div', { 'data-box': '' }, 0],
})

function editorWith(content: object): Editor {
  return new Editor({ extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true }), ParagraphOnlyBox, CodeFenceEnter], content })
}

// A real keydown through ProseMirror's handlers. (commands.keyboardShortcut
// replays only captured steps and drops the block-type change.)
function pressEnterAtEnd(editor: Editor): void {
  editor.commands.focus('end')
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  const handled = editor.view.someProp('handleKeyDown', handler => handler(editor.view, event))
  if (!handled) editor.commands.splitBlock()
}

const doc = (...content: object[]) => ({ type: 'doc', content })
const paragraph = (text: string) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })

describe('code fence on Enter', () => {
  it('parses fence openers only', () => {
    expect(codeFenceLanguage('```')).toBeNull()
    expect(codeFenceLanguage('```TS')).toBe('ts')
    expect(codeFenceLanguage('```c++')).toBe('c++')
    expect(codeFenceLanguage('``` js')).toBeUndefined()
    expect(codeFenceLanguage('text ```')).toBeUndefined()
    expect(codeFenceLanguage('````')).toBeUndefined()
  })

  it('turns a top-level ```js paragraph into an empty js code block', () => {
    const editor = editorWith(doc(paragraph('intro'), paragraph('```js')))
    pressEnterAtEnd(editor)
    const block = editor.getJSON().content![1]!
    expect(block.type).toBe('codeBlock')
    expect(block.attrs?.language).toBe('js')
    expect(block.content ?? []).toEqual([])
    expect(editor.getJSON().content![0]).toEqual(paragraph('intro'))
    editor.destroy()
  })

  it('lifts a fence typed inside a task item out of the list', () => {
    const editor = editorWith(doc({ type: 'taskList', content: [
      { type: 'taskItem', attrs: { checked: false }, content: [paragraph('todo')] },
      { type: 'taskItem', attrs: { checked: false }, content: [paragraph('```')] },
    ] }))
    pressEnterAtEnd(editor)
    const content = editor.getJSON().content!
    expect(content[0]!.type).toBe('taskList')
    expect(content[0]!.content).toHaveLength(1)
    expect(content[0]!.content![0]!.content).toEqual([paragraph('todo')])
    expect(content[1]!.type).toBe('codeBlock')
    expect(content[1]!.attrs?.language).toBeNull()
    editor.destroy()
  })

  it('leaves ordinary paragraphs and code blocks to the default Enter', () => {
    const editor = editorWith(doc(paragraph('hello ```js')))
    pressEnterAtEnd(editor)
    expect(editor.getJSON().content!.map(node => node.type)).toEqual(['paragraph', 'paragraph'])
    editor.destroy()
    const inCode = editorWith(doc({ type: 'codeBlock', attrs: { language: null }, content: [{ type: 'text', text: '```' }] }))
    pressEnterAtEnd(inCode)
    expect(inCode.getJSON().content![0]!.content![0]!.text).toBe('```\n')
    inCode.destroy()
  })

  it('is all-or-nothing: a refused conversion keeps the fence text and undoes as one step', () => {
    const editor = editorWith(doc({ type: 'paragraphOnlyBox', content: [paragraph('```js')] }))
    pressEnterAtEnd(editor)
    const box = editor.getJSON().content![0]!
    expect(box.type).toBe('paragraphOnlyBox')
    expect(box.content![0]).toEqual(paragraph('```js'))
    editor.destroy()

    const converted = editorWith(doc({ type: 'taskList', content: [
      { type: 'taskItem', attrs: { checked: false }, content: [paragraph('```ts')] },
    ] }))
    const before = converted.getJSON()
    pressEnterAtEnd(converted)
    expect(converted.getJSON().content![0]!.type).toBe('codeBlock')
    converted.commands.undo()
    // StarterKit's trailing-node paragraph is appended outside history; ignore it.
    expect(converted.getJSON().content![0]).toEqual(before.content![0])
    converted.destroy()
  })
})
