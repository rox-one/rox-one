/**
 * W1-08 (#1505) — typed/pasted explicit entity syntax → nodes.
 *
 * Only registered through EntityMention / EntityEmbed, which hosts add only
 * while `entities.previews.v1` is on, so these rules are inert by default.
 *
 * - Typing the closing `]]` of `[[kind:id]]` / `[[kind:id|label]]` (a known
 *   kind, per the shared classifier) turns it into a mention node.
 * - Typing the closing `]]` of `![[kind:id]]` alone on a line turns the line
 *   into an embed block.
 * - The same conversions run on pasted plain text.
 *
 * The original text is kept in the node's `source` attr, so the saved
 * Markdown is byte-identical to what the user typed. Plain `[[title]]`
 * (including `[[Встреча: итоги]]`) stays a WikiLink.
 *
 * TODO(UI-SPEC MentionMenu): the `[[` / `@` suggestion menu from UI-SPEC is a
 * later package; these rules only cover fully typed explicit syntax.
 */
import { InputRule, PasteRule } from '@tiptap/core'
import type { NodeType } from '@tiptap/pm/model'
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { matchEntityEmbedLine, matchEntityMention, type EntityMentionMatch } from '../entity-markdown'

/** `[[…]]` ending at the cursor, not preceded by `!`. */
const MENTION_INPUT = /(?<!!)\[\[[^\]\n|]+?(?:\|[^\]\n]*)?\]\]$/
/** `![[…]]` as the whole text before the cursor. */
const EMBED_INPUT = /^!\[\[[^\]\n|]+?(?:\|[^\]\n]*)?\]\]$/
const MENTION_PASTE = /(?<!!)\[\[[^\]\n|]+?(?:\|[^\]\n]*)?\]\]/g
const EMBED_PASTE = /^\s*!\[\[[^\]\n|]+?(?:\|[^\]\n]*)?\]\]\s*$/g

function mentionAttrs(match: EntityMentionMatch) {
  return { ref: match.ref, label: match.label ?? '', source: match.raw }
}

export function entityMentionInputRule(type: NodeType): InputRule {
  return new InputRule({
    find: MENTION_INPUT,
    handler: ({ state, range, match }) => {
      const parsed = matchEntityMention(match[0])
      if (!parsed || parsed.raw !== match[0]) return null
      state.tr.replaceWith(range.from, range.to, type.create(mentionAttrs(parsed)))
    },
  })
}

export function entityMentionPasteRule(type: NodeType): PasteRule {
  return new PasteRule({
    find: MENTION_PASTE,
    handler: ({ state, range, match }) => {
      // TipTap visits both the textblock and its text nodes; act only when
      // the mapped range still holds exactly the matched text.
      if (state.doc.textBetween(range.from, range.to) !== match[0]) return
      if (range.from > 0 && state.doc.textBetween(range.from - 1, range.from) === '!') return
      const parsed = matchEntityMention(match[0])
      if (!parsed || parsed.raw !== match[0]) return
      state.tr.replaceWith(range.from, range.to, type.create(mentionAttrs(parsed)))
    },
  })
}

/** Replace the paragraph around `pos` with an embed block; false when not allowed. */
function replaceParagraphWithEmbed(
  state: EditorState,
  tr: Transaction,
  pos: number,
  type: NodeType,
  match: EntityMentionMatch,
  moveCursor: boolean,
): boolean {
  const $pos = state.doc.resolve(pos)
  const paragraph = $pos.parent
  if (paragraph.type.name !== 'paragraph' || $pos.depth < 1) return false
  const container = $pos.node($pos.depth - 1)
  const index = $pos.index($pos.depth - 1)
  if (!container.canReplaceWith(index, index + 1, type)) return false
  const before = $pos.before()
  const embed = type.create(mentionAttrs(match))
  tr.replaceWith(before, before + paragraph.nodeSize, embed)
  if (moveCursor) {
    const after = before + embed.nodeSize
    const next = tr.doc.nodeAt(after)
    const paragraphType = state.schema.nodes.paragraph
    if ((!next || !next.isTextblock) && paragraphType && $pos.depth === 1) {
      tr.insert(after, paragraphType.create())
    }
    const target = tr.doc.nodeAt(after)
    if (target?.isTextblock) tr.setSelection(TextSelection.create(tr.doc, after + 1))
  }
  return true
}

export function entityEmbedInputRule(type: NodeType): InputRule {
  return new InputRule({
    find: EMBED_INPUT,
    handler: ({ state, range, match }) => {
      const parsed = matchEntityEmbedLine(match[0])
      if (!parsed) return null
      const $from = state.doc.resolve(range.from)
      // Line start only, with nothing after the cursor in this paragraph.
      if (range.from !== $from.start()) return null
      const $to = state.doc.resolve(range.to)
      if ($to.parentOffset !== $to.parent.content.size) return null
      if (!replaceParagraphWithEmbed(state, state.tr, range.from, type, parsed, true)) return null
    },
  })
}

export function entityEmbedPasteRule(type: NodeType): PasteRule {
  return new PasteRule({
    find: EMBED_PASTE,
    handler: ({ state, range, match }) => {
      if (state.doc.textBetween(range.from, range.to) !== match[0]) return
      const $from = state.doc.resolve(range.from)
      const paragraph = $from.parent
      if (!paragraph.isTextblock || paragraph.textContent !== match[0]) return
      if (paragraph.childCount !== 1 || !paragraph.firstChild?.isText) return
      const parsed = matchEntityEmbedLine(match[0])
      if (!parsed) return
      replaceParagraphWithEmbed(state, state.tr, range.from, type, parsed, false)
    },
  })
}
