import { Extension } from '@tiptap/core'
import { setBlockType } from '@tiptap/pm/commands'
import { EditorState, TextSelection, type Command, type Transaction } from '@tiptap/pm/state'
import { liftListItem } from '@tiptap/pm/schema-list'
import type { Step } from '@tiptap/pm/transform'

/** ```, ```ts, ```c++ … typed as the whole paragraph. */
export const CODE_FENCE_LINE = /^```([A-Za-z0-9_+#.-]*)$/

/** Language for a paragraph that is only a fence opener, or `undefined` when it is not one. */
export function codeFenceLanguage(text: string): string | null | undefined {
  const match = CODE_FENCE_LINE.exec(text)
  if (!match) return undefined
  return match[1] ? match[1].toLowerCase() : null
}

/**
 * Turns a paragraph that holds only "```lang" into a code block on Enter.
 * The stock input rule fires only on a trailing space, so Notion/Lark-style
 * "```" + Enter left the fence as text; inside a list item the block cannot
 * become a code block in place, so it is lifted out of the list first.
 */
export const CodeFenceEnter = Extension.create({
  name: 'roxCodeFenceEnter',
  // Ahead of list-item Enter (split item) and the default paragraph split.
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { selection } = editor.state
        if (!selection.empty || !editor.schema.nodes.codeBlock) return false
        const { $from } = selection
        const block = $from.parent
        if (block.type.name !== 'paragraph' || $from.parentOffset !== block.content.size) return false
        const language = codeFenceLanguage(block.textContent)
        if (language === undefined) return false
        const attributes = language ? { language } : { language: null }
        // A list item cannot hold a code block as its first child, so lift it
        // out of every enclosing list first (innermost first).
        const listItems: string[] = []
        for (let depth = $from.depth - 1; depth > 0; depth--) {
          const name = $from.node(depth).type.name
          if (name === 'listItem' || name === 'taskItem') listItems.push(name)
        }
        const { codeBlock } = editor.schema.nodes
        // One transaction, all or nothing: every step is simulated on a scratch
        // state first and only dispatched if the whole conversion succeeds, so
        // the fence text is never lost to a half-applied chain.
        return editor.commands.command(({ tr, dispatch }) => {
          // The real state (not the chain proxy) so scratch transactions can be applied.
          let current: EditorState = editor.state
          const steps: Step[] = []
          const apply = (next: Transaction) => { steps.push(...next.steps); current = current.apply(next) }
          const run = (command: Command) => {
            let applied = false
            const ok = command(current, next => { applied = true; apply(next) })
            return ok && applied
          }
          apply(current.tr.delete($from.start(), $from.end()))
          for (const name of listItems) {
            const type = editor.schema.nodes[name]
            if (!type || !run(liftListItem(type))) return false
          }
          if (!run(setBlockType(codeBlock, attributes))) return false
          if (dispatch) {
            for (const step of steps) tr.step(step)
            tr.setSelection(TextSelection.create(tr.doc, current.selection.from))
          }
          return true
        })
      },
    }
  },
})
