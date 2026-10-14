import { Extension } from '@tiptap/core'

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
        // A list item cannot hold a code block as its first child, so lift it
        // out of every enclosing list first (innermost first).
        const listItems: string[] = []
        for (let depth = $from.depth - 1; depth > 0; depth--) {
          const name = $from.node(depth).type.name
          if (name === 'listItem' || name === 'taskItem') listItems.push(name)
        }
        const strip = (chain: ReturnType<typeof editor.chain>) => {
          let next = chain.command(({ tr }) => { tr.delete($from.start(), $from.end()); return true })
          for (const name of listItems) next = next.liftListItem(name)
          return next
        }
        // chain().run() applies earlier steps even when a later command fails, so
        // dry-run first: a refused conversion must never eat the fence text.
        if (listItems.length === 0) {
          if (!strip(editor.can().chain()).setCodeBlock({ language }).run()) return false
          return strip(editor.chain()).setCodeBlock({ language }).run()
        }
        // can() cannot see the lifted block, so lifting and retyping are two steps.
        if (!strip(editor.can().chain()).run()) return false
        strip(editor.chain()).run()
        editor.commands.setCodeBlock({ language })
        return true
      },
    }
  },
})
