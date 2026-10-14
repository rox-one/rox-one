import { InputRule } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'

/** `- [ ] ` is first consumed by the bullet-list rule; this matches the leftover `[ ] `. */
export const TASK_CHECKBOX_INPUT = /^\s*\[(\s|x|X)\]\s$/

function ancestorNamed(state: EditorState, name: string): boolean {
  const $from = state.selection.$from
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === name) return true
  }
  return false
}

/**
 * Convert a paragraph (or a bullet/ordered list item) into a task item when
 * the user types `[ ] ` / `[x] ` at the start of the block.
 */
export function taskCheckboxInputRule(): InputRule {
  return new InputRule({
    find: TASK_CHECKBOX_INPUT,
    handler: ({ state, range, match, chain }) => {
      if (ancestorNamed(state, 'taskList')) return null
      const checked = (match[1] ?? ' ').toLowerCase() === 'x'
      chain()
        .deleteRange(range)
        .toggleTaskList()
        .updateAttributes('taskItem', { checked })
        .run()
    },
  })
}
