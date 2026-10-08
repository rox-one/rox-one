/**
 * Shared by official-markdown-instance.test.ts and official-global-control.ts
 * (#1505): the same editor setup and measurements for a per-editor marked
 * instance and for main's global `marked`.
 */
import { Editor, type AnyExtension, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Mathematics } from '@tiptap/extension-mathematics'
import { EntityEmbed } from '../extensions/EntityEmbed'
import { EntityMention } from '../extensions/EntityMention'

export type Flag = 'on' | 'off'

/** Math, underline (`++…++`) and `[[task:1]]` inside every list / quote shape. */
export const PARITY_CORPUS: string[] = [
  '1. set $\\{x\\}$ ok',
  '1. ordered $b$ and ++under++ and [[task:1]]\n2. second $c$',
  '- [ ] task $c$ ++u++ [[task:1]]\n- [x] done $d$',
  '- [ ] parent $p$\n  - [ ] nested $d$ ++u++ [[task:1]]\n    - [ ] deeper $e$ [[task:2|Two]]',
  '1. ordered\n   - [ ] task in ordered $f$ ++u++ [[task:1]]',
  '- bullet $a$ ++u++ [[task:1]]\n  - sub $g$',
  '> quote $e$ ++u++ [[task:1]]',
  'Para $h$ ++u++ [[task:1]]\n\n- bullet $a$\n\n1. ordered $b$\n\n- [ ] task $c$\n\n> quote $e$',
]

export function parityExtensions(flag: Flag, markdown: AnyExtension): AnyExtension[] {
  return [
    StarterKit,
    TaskList,
    TaskItem.configure({ nested: true }),
    Mathematics.configure({ katexOptions: { throwOnError: false, strict: false } }),
    ...(flag === 'on' ? [EntityMention, EntityEmbed] : []),
    markdown,
  ]
}

export interface ParityResult {
  source: string
  out: string
  counts: Record<string, number>
}

export function measure(flag: Flag, markdown: AnyExtension, source: string): ParityResult {
  const editor = new Editor({ extensions: parityExtensions(flag, markdown), content: source, contentType: 'markdown' })
  const counts: Record<string, number> = {}
  const walk = (node: JSONContent) => {
    if (node.type) counts[node.type] = (counts[node.type] ?? 0) + 1
    for (const mark of node.marks ?? []) counts[`mark:${mark.type}`] = (counts[`mark:${mark.type}`] ?? 0) + 1
    for (const child of node.content ?? []) walk(child)
  }
  walk(editor.getJSON())
  const out = (editor as unknown as { getMarkdown(): string }).getMarkdown()
  editor.destroy()
  return { source, out, counts }
}
