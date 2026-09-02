import { describe, expect, it } from 'bun:test'
import { Editor } from '@tiptap/core'
import { EditorState } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import {
  DocumentFolding,
  DocumentFoldingPluginKey,
  applyDocumentFoldingAction,
  collectDocumentFoldTargets,
  computeDocumentFoldHiddenRanges,
  createDocumentFoldingPlugin,
  getDocumentFoldingState,
  normalizeDocumentFoldingState,
  type DocumentFoldingJSON,
} from '../DocumentFolding'

function createEditor(extensions = [DocumentFolding]) {
  return new Editor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      ...extensions,
    ],
    content: {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Intro' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Opening paragraph' }],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Details' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Nested details' }],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Details' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'More detail' }],
        },
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Next' }],
        },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Ship release' }],
                },
              ],
            },
          ],
        },
      ],
    },
  })
}

describe('DocumentFolding', () => {
  it('collects canonical heading and top-level task list targets', () => {
    const editor = createEditor([])
    const targets = collectDocumentFoldTargets(editor.state.doc)

    expect(targets.map(target => target.id)).toEqual([
      'heading:1:intro',
      'heading:2:details',
      'heading:2:details:2',
      'heading:1:next',
      'task-list:ship-release',
    ])

    expect(targets.map(target => target.kind)).toEqual([
      'heading',
      'heading',
      'heading',
      'heading',
      'taskList',
    ])

    const intro = targets.find(target => target.id === 'heading:1:intro')
    const next = targets.find(target => target.id === 'heading:1:next')

    expect(intro?.level).toBe(1)
    expect(intro?.contentFrom).toBeGreaterThan(intro?.from ?? 0)
    expect(intro?.contentTo).toBe(next?.from)
    expect(next?.contentTo).toBe(targets.at(-1)?.to)

    editor.destroy()
  })

  it('respects disabled task-list collection', () => {
    const editor = createEditor([])
    const targets = collectDocumentFoldTargets(editor.state.doc, { includeTopLevelTaskLists: false })

    expect(targets.some(target => target.kind === 'taskList')).toBe(false)

    editor.destroy()
  })

  it('computes hidden ranges from local editor state', () => {
    const editor = createEditor([])
    const targets = collectDocumentFoldTargets(editor.state.doc)
    const intro = targets.find(target => target.id === 'heading:1:intro')
    const taskList = targets.find(target => target.id === 'task-list:ship-release')

    const ranges = computeDocumentFoldHiddenRanges(editor.state.doc, [
      intro?.id ?? '',
      taskList?.id ?? '',
    ])

    expect(ranges).toEqual([
      {
        id: 'heading:1:intro',
        kind: 'heading',
        from: intro?.contentFrom,
        to: intro?.contentTo,
      },
      {
        id: 'task-list:ship-release',
        kind: 'taskList',
        from: taskList?.contentFrom,
        to: taskList?.contentTo,
      },
    ])

    const introText = editor.state.doc.textBetween(ranges[0]!.from, ranges[0]!.to, ' ')
    const taskText = editor.state.doc.textBetween(ranges[1]!.from, ranges[1]!.to, ' ')

    expect(introText).toContain('Opening paragraph')
    expect(introText).toContain('Nested details')
    expect(introText).not.toContain('Next')
    expect(taskText).toContain('Ship release')

    editor.destroy()
  })

  it('normalizes local state into canonical document order and JSON-safe shape', () => {
    const editor = createEditor([])
    const targets = collectDocumentFoldTargets(editor.state.doc)
    const normalized = normalizeDocumentFoldingState({
      version: 1,
      foldedIds: [
        'missing',
        'heading:2:details:2',
        'heading:1:intro',
        'heading:1:intro',
        'heading:2:details',
      ],
    }, targets)

    expect(normalized).toEqual({
      version: 1,
      foldedIds: ['heading:1:intro', 'heading:2:details', 'heading:2:details:2'],
    })
    expect(JSON.parse(JSON.stringify(normalized))).toEqual(normalized)

    const toggled = applyDocumentFoldingAction(normalized, { type: 'toggle', id: 'heading:1:intro' }, targets)
    expect(toggled).toEqual({
      version: 1,
      foldedIds: ['heading:2:details', 'heading:2:details:2'],
    })

    editor.destroy()
  })

  it('exposes plugin state transitions for later editor integration', () => {
    const changes: DocumentFoldingJSON[] = []
    const editor = createEditor([])
    const plugin = createDocumentFoldingPlugin({
      initialState: ['heading:2:details'],
      onChange: state => changes.push(state),
    })
    let state = EditorState.create({
      schema: editor.schema,
      doc: editor.state.doc,
      plugins: [plugin],
    })

    expect(getDocumentFoldingState(state)).toEqual({
      version: 1,
      foldedIds: ['heading:2:details'],
    })

    state = state.apply(state.tr.setMeta(DocumentFoldingPluginKey, { type: 'toggle', id: 'heading:1:intro' }))
    expect(getDocumentFoldingState(state)).toEqual({
      version: 1,
      foldedIds: ['heading:1:intro', 'heading:2:details'],
    })

    state = state.apply(state.tr.setMeta(DocumentFoldingPluginKey, { type: 'unfold', id: 'heading:2:details' }))
    expect(getDocumentFoldingState(state)).toEqual({
      version: 1,
      foldedIds: ['heading:1:intro'],
    })

    state = state.apply(state.tr.setMeta(DocumentFoldingPluginKey, { type: 'replace', state: ['missing', 'task-list:ship-release'] }))
    expect(getDocumentFoldingState(state)).toEqual({
      version: 1,
      foldedIds: ['task-list:ship-release'],
    })

    state = state.apply(state.tr.setMeta(DocumentFoldingPluginKey, { type: 'clear' }))
    expect(getDocumentFoldingState(state)).toEqual({
      version: 1,
      foldedIds: [],
    })
    expect(changes).toEqual([])

    const commandEditor = createEditor([DocumentFolding])
    expect(typeof commandEditor.commands.toggleDocumentFold).toBe('function')
    commandEditor.destroy()

    editor.destroy()
  })
})
