import { Extension } from '@tiptap/core'
import { Fragment } from '@tiptap/pm/model'
import { Plugin, PluginKey, Transaction } from '@tiptap/pm/state'

export interface RetainedTrailingNodeOptions {
  node?: string
  notAfter?: string | string[]
}

/**
 * Retain the loaded document until an emitting document edit needs a trailing
 * block. A selection/decorations transaction must never normalize source bytes,
 * and setContent({ emitUpdate: false }) must not queue work for a later refresh.
 */
export function createRetainedTrailingNodePlugin(options: RetainedTrailingNodeOptions = {}): Plugin {
  const key = new PluginKey('retainedTrailingNode')
  return new Plugin({
    key,
    appendTransaction(transactions, _oldState, state) {
      if (transactions.some(transaction => {
        // ProseMirror may call us again with only another plugin's appended
        // transaction. Its source transaction still owns the hydration policy.
        const source: unknown = transaction.getMeta('appendedTransaction')
        return transaction.getMeta('preventUpdate')
          || (source instanceof Transaction && source.getMeta('preventUpdate'))
      })) return null
      const edited = transactions.some(transaction => transaction.docChanged
        && !transaction.getMeta('__uniqueIDTransaction')
        && !transaction.getMeta(key))
      if (!edited) return null

      const name = options.node ?? state.schema.topNodeType.contentMatch.defaultType?.name ?? 'paragraph'
      const notAfter = typeof options.notAfter === 'string' ? [options.notAfter] : options.notAfter ?? []
      const lastNode = state.doc.lastChild
      if (!lastNode || lastNode.type.name === name || notAfter.includes(lastNode.type.name)) return null

      const type = state.schema.nodes[name]
      const trailing = type?.createAndFill()
      if (!trailing || !state.doc.canReplace(state.doc.childCount, state.doc.childCount, Fragment.from(trailing))) return null

      return state.tr.insert(state.doc.content.size, trailing).setMeta(key, true)
    },
  })
}

export const RetainedTrailingNode = Extension.create<RetainedTrailingNodeOptions>({
  name: 'retainedTrailingNode',
  addOptions() {
    return { node: undefined, notAfter: [] }
  },
  addProseMirrorPlugins() {
    return [createRetainedTrailingNodePlugin(this.options)]
  },
})
