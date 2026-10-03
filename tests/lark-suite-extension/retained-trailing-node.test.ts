import { describe, expect, test } from 'bun:test'
import { getSchema, resolveExtensions } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { TrailingNode, type TrailingNodeOptions } from '@tiptap/extensions'
import { Schema, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { EditorState, Plugin, TextSelection } from '@tiptap/pm/state'
import { RetainedTrailingNode, createRetainedTrailingNodePlugin } from '../../packages/ui/src/components/markdown/retained-trailing-node'

const schema = getSchema([
  StarterKit.configure({ trailingNode: false }), TaskList, TaskItem.configure({ nested: true }),
])

function codeDocument(text = 'console.log("source")'): ProseMirrorNode {
  return schema.node('doc', null, [
    schema.node('paragraph', null, schema.text('Original paragraph')),
    schema.node('codeBlock', { language: 'js' }, schema.text(text)),
  ])
}

function retainedState(doc = codeDocument()) {
  return EditorState.create({ schema, doc, plugins: [createRetainedTrailingNodePlugin()] })
}

interface InstalledTrailingNodeContext {
  name: string
  options: TrailingNodeOptions
  editor: { schema: Schema }
}
type InstalledTrailingNodeFactory = (this: InstalledTrailingNodeContext) => Plugin[]

function installedTrailingNodePlugin(): Plugin {
  const factory = TrailingNode.config.addProseMirrorPlugins
  if (!factory) throw new Error('Installed TrailingNode has no plugin factory')
  // Invoke the actual extension method with exactly the fields it reads. The
  // Tiptap lifecycle declares a full Editor; this headless port needs its schema.
  const invoke = factory as unknown as InstalledTrailingNodeFactory
  const plugins = invoke.call({ name: TrailingNode.name, options: TrailingNode.options, editor: { schema } })
  const plugin = plugins[0]
  if (!plugin) throw new Error('Installed TrailingNode returned no plugin')
  return plugin
}

describe('retained trailing node through actual ProseMirror state transactions', () => {
  test('negative control: installed TrailingNode rewrites a loaded document on pure metadata', () => {
    const source = codeDocument()
    const state = EditorState.create({ schema, doc: source, plugins: [installedTrailingNodePlugin()] })
    const refresh = state.tr.setMeta('shikiPluginForceDecoration', true)
    expect(refresh.docChanged).toBe(false)
    const result = state.applyTransaction(refresh)
    expect(result.transactions).toHaveLength(2)
    expect(result.transactions[1]?.docChanged).toBe(true)
    expect(result.state.doc.childCount).toBe(source.childCount + 1)
    expect(result.state.doc.lastChild?.type.name).toBe('paragraph')
    expect(result.state.doc.eq(source)).toBe(false)
  })

  test('opening, decoration refreshes and selection leave the exact loaded document untouched', () => {
    const source = codeDocument()
    let state = retainedState(source)
    expect(state.doc).toBe(source)
    for (const makeTransaction of [
      (current: EditorState) => current.tr.setMeta('shikiPluginForceDecoration', true),
      (current: EditorState) => current.tr.setSelection(TextSelection.create(current.doc, 2)),
      (current: EditorState) => current.tr.setMeta('focus', true),
      (current: EditorState) => current.tr.setMeta('preventUpdate', true),
      (current: EditorState) => current.tr,
    ]) {
      const transaction = makeTransaction(state)
      expect(transaction.docChanged).toBe(false)
      const result = state.applyTransaction(transaction)
      expect(result.transactions).toHaveLength(1)
      expect(result.state.doc).toBe(source)
      expect(result.state.doc.toJSON()).toEqual(source.toJSON())
      state = result.state
    }
  })

  test('preventUpdate hydration does not append or queue a rewrite for later metadata', () => {
    const state = retainedState()
    const hydrated = codeDocument('Hydrated host content')
    const hydration = state.tr.replaceWith(0, state.doc.content.size, hydrated.content).setMeta('preventUpdate', true)
    expect(hydration.docChanged).toBe(true)
    const result = state.applyTransaction(hydration)
    expect(result.transactions).toHaveLength(1)
    expect(result.state.doc.toJSON()).toEqual(hydrated.toJSON())
    const refresh = result.state.applyTransaction(result.state.tr.setMeta('shikiPluginForceDecoration', true))
    expect(refresh.transactions).toHaveLength(1)
    expect(refresh.state.doc).toBe(result.state.doc)
    expect(refresh.state.doc.lastChild?.type.name).toBe('codeBlock')
  })

  test('a real edit appends one writable paragraph, preserves the original step and does not loop', () => {
    const state = retainedState()
    const edit = state.tr.insertText(' edited', state.doc.content.size - 1)
    const editedDocument = edit.doc
    const result = state.applyTransaction(edit)
    expect(result.transactions).toHaveLength(2)
    expect(result.transactions[0]).toBe(edit)
    expect(edit.steps).toHaveLength(1)
    expect(result.transactions[1]?.steps).toHaveLength(1)
    expect(result.state.doc.childCount).toBe(editedDocument.childCount + 1)
    for (let index = 0; index < editedDocument.childCount; index++) {
      expect(result.state.doc.child(index).toJSON()).toEqual(editedDocument.child(index).toJSON())
    }
    expect(result.state.doc.lastChild?.type.name).toBe('paragraph')
    expect(result.state.doc.lastChild?.textContent).toBe('')
    const selectionOnly = result.state.applyTransaction(result.state.tr.setSelection(TextSelection.atEnd(result.state.doc)))
    expect(selectionOnly.transactions).toHaveLength(1)
    expect(selectionOnly.state.doc).toBe(result.state.doc)
    const typing = selectionOnly.state.tr.insertText('Continue editing', selectionOnly.state.doc.content.size - 1)
    const next = selectionOnly.state.applyTransaction(typing)
    expect(next.transactions).toHaveLength(1)
    expect(next.state.doc.lastChild?.textContent).toBe('Continue editing')
    expect(next.state.doc.childCount).toBe(result.state.doc.childCount)
  })

  test('hydration remains protected when another plugin appends a document transaction', () => {
    const maintenanceKey = 'testHydrationMaintenance'
    const maintenance = new Plugin({
      appendTransaction(transactions, _previous, current) {
        if (!transactions.some(transaction => transaction.getMeta('preventUpdate') && transaction.docChanged)
          || transactions.some(transaction => transaction.getMeta(maintenanceKey))) return null
        return current.tr.setNodeMarkup(0).setMeta(maintenanceKey, true)
      },
    })
    for (const plugins of [
      [createRetainedTrailingNodePlugin(), maintenance],
      [maintenance, createRetainedTrailingNodePlugin()],
    ]) {
      const state = EditorState.create({ schema, doc: codeDocument(), plugins })
      const hydrated = codeDocument('Hydrated with plugin maintenance')
      const result = state.applyTransaction(state.tr.replaceWith(0, state.doc.content.size, hydrated.content).setMeta('preventUpdate', true))
      expect(result.transactions).toHaveLength(2)
      expect(result.transactions[1]?.docChanged).toBe(true)
      expect(result.state.doc.toJSON()).toEqual(hydrated.toJSON())
      expect(result.state.doc.lastChild?.type.name).toBe('codeBlock')
    }
  })

  test('checkbox edits retain the native markup step and checked state', () => {
    const paragraph = schema.node('paragraph', null, schema.text('Original parent'))
    const task = schema.node('taskItem', { checked: false }, schema.node('paragraph', null, schema.text('Task source')))
    const source = schema.node('doc', null, [paragraph, schema.node('taskList', null, [task])])
    const state = retainedState(source)
    const position = paragraph.nodeSize + 1
    const toggle = state.tr.setNodeMarkup(position, undefined, { ...task.attrs, checked: true })
    const result = state.applyTransaction(toggle)
    expect(result.transactions).toHaveLength(2)
    expect(result.transactions[0]).toBe(toggle)
    expect(result.transactions[0]?.steps.map(step => step.toJSON())).toEqual(toggle.steps.map(step => step.toJSON()))
    expect(result.state.doc.nodeAt(position)?.attrs.checked).toBe(true)
    expect(result.state.doc.nodeAt(position)?.textContent).toBe('Task source')
    expect(result.state.doc.child(0).toJSON()).toEqual(paragraph.toJSON())
    expect(result.state.doc.lastChild?.type.name).toBe('paragraph')
    result.state.doc.check()
  })

  test('an emitting host content edit retains its replacement step and adds only the trailing paragraph', () => {
    const state = retainedState()
    const replacement = codeDocument('Explicit host edit')
    const edit = state.tr.replaceWith(0, state.doc.content.size, replacement.content).setMeta('preventUpdate', false)
    const result = state.applyTransaction(edit)
    expect(result.transactions).toHaveLength(2)
    expect(result.transactions[0]).toBe(edit)
    expect(result.state.doc.child(1).toJSON()).toEqual(replacement.child(1).toJSON())
    expect(result.state.doc.childCount).toBe(replacement.childCount + 1)
    expect(result.state.doc.lastChild?.type.name).toBe('paragraph')
  })

  test('already trailing paragraphs and configured exclusions need no extra step', () => {
    const source = schema.node('doc', null, [schema.node('paragraph', null, schema.text('Plain'))])
    const state = retainedState(source)
    const result = state.applyTransaction(state.tr.insertText(' edit', 2))
    expect(result.transactions).toHaveLength(1)
    const excluded = EditorState.create({ schema, doc: codeDocument(), plugins: [createRetainedTrailingNodePlugin({ notAfter: 'codeBlock' })] })
    expect(excluded.applyTransaction(excluded.tr.insertText(' edit', excluded.doc.content.size - 1)).transactions).toHaveLength(1)
    const arrayExcluded = EditorState.create({ schema, doc: codeDocument(), plugins: [createRetainedTrailingNodePlugin({ notAfter: ['codeBlock'] })] })
    expect(arrayExcluded.applyTransaction(arrayExcluded.tr.insertText(' edit', arrayExcluded.doc.content.size - 1)).transactions).toHaveLength(1)
  })

  test('UniqueID maintenance and absent or schema-invalid target types do not force a repair', () => {
    const state = retainedState()
    const maintenance = state.tr.insertText(' ID maintenance', state.doc.content.size - 1).setMeta('__uniqueIDTransaction', true)
    const result = state.applyTransaction(maintenance)
    expect(result.transactions).toHaveLength(1)
    expect(result.state.doc).toBe(maintenance.doc)
    const missing = EditorState.create({ schema, doc: codeDocument(), plugins: [createRetainedTrailingNodePlugin({ node: 'missing' })] })
    expect(missing.applyTransaction(missing.tr.insertText(' edit', missing.doc.content.size - 1)).transactions).toHaveLength(1)
    const constrained = new Schema({ nodes: {
      doc: { content: 'codeBlock' },
      codeBlock: { content: 'text*', group: 'block' },
      paragraph: { content: 'text*', group: 'block' },
      text: {},
    } })
    const constrainedState = EditorState.create({ schema: constrained, doc: constrained.node('doc', null, [constrained.node('codeBlock', null, constrained.text('Only block'))]), plugins: [createRetainedTrailingNodePlugin({ node: 'paragraph' })] })
    const constrainedResult = constrainedState.applyTransaction(constrainedState.tr.insertText(' edit', 2))
    expect(constrainedResult.transactions).toHaveLength(1)
    constrainedResult.state.doc.check()
  })

  test('the integration replaces StarterKit TrailingNode and preserves its keyboard extensions', () => {
    const extensions = resolveExtensions([StarterKit.configure({ trailingNode: false }), RetainedTrailingNode])
    const names = extensions.map(extension => extension.name)
    expect(names).not.toContain('trailingNode')
    expect(names.filter(name => name === 'retainedTrailingNode')).toHaveLength(1)
    for (const name of ['paragraph', 'codeBlock', 'listItem', 'listKeymap', 'gapCursor', 'undoRedo']) expect(names).toContain(name)
  })
})
