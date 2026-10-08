/**
 * EntityMention (W1-08, TECH-SPEC §3.9) — inline atom node
 * `{ type: 'mention', attrs: { ref, label } }`.
 *
 * - Markdown: `[[kind:id|label]]` (legacy tiptap-markdown + official engine).
 * - Rendering: a plain chip span by default; hosts pass `view` (a React node
 *   view, e.g. the renderer's EntityChip) to render live previews.
 * - `onRequestInsert` binds Mod-Shift-K («Связать элемент Rox…») so the host
 *   can open its EntityPicker and call `insertEntityMention`.
 *
 * The extension is opt-in: TiptapMarkdownEditor only adds it when the host
 * passes `entityNodes` (renderer: behind `entities.previews.v1`).
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import type { ComponentType } from 'react'
import {
  ENTITY_MENTION_NODE,
  canonicalEntityTarget,
  installEntityMarkdownRules,
  matchEntityMention,
  serializeEntityMention,
  type MarkdownItLike,
} from '../entity-markdown'

export interface EntityMentionOptions {
  onEntityClick?: (ref: string, event: MouseEvent) => void
  onRequestInsert?: () => void
  view?: ComponentType<ReactNodeViewProps>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    entityMention: {
      /** Insert `[[ref|label]]` as a mention node at the selection. */
      insertEntityMention: (attrs: { ref: string; label?: string }) => ReturnType
    }
  }
}

export const EntityMention = Node.create<EntityMentionOptions>({
  name: ENTITY_MENTION_NODE,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { onEntityClick: undefined, onRequestInsert: undefined, view: undefined }
  },

  addAttributes() {
    return {
      ref: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-entity-mention') ?? '',
        renderHTML: (attrs: { ref?: string }) => ({ 'data-entity-mention': attrs.ref ?? '' }),
      },
      label: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-label') ?? el.textContent ?? '',
        renderHTML: (attrs: { label?: string }) => ({ 'data-label': attrs.label ?? '' }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-entity-mention]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'tiptap-entity-mention', contenteditable: 'false' }), node.attrs.label || node.attrs.ref]
  },

  renderText({ node }) {
    return serializeEntityMention(node.attrs.ref as string, node.attrs.label as string)
  },

  addNodeView() {
    const view = this.options.view
    return view ? ReactNodeViewRenderer(view, { as: 'span', className: 'tiptap-entity-mention-view' }) : null
  },

  addCommands() {
    return {
      insertEntityMention: (attrs) => ({ commands }) => {
        const ref = canonicalEntityTarget(attrs.ref)
        if (!ref) return false
        return commands.insertContent({ type: this.name, attrs: { ref, label: attrs.label ?? '' } })
      },
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-k': () => {
        if (!this.options.onRequestInsert) return false
        this.options.onRequestInsert()
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    const options = this.options
    const name = this.name
    return [
      new Plugin({
        key: new PluginKey('roxEntityMentionClick'),
        props: {
          handleClickOn(_view, _pos, node, _nodePos, event) {
            if (node.type.name !== name || !options.onEntityClick) return false
            const ref = String(node.attrs.ref ?? '')
            if (!ref) return false
            options.onEntityClick(ref, event)
            return true
          },
        },
      }),
    ]
  },

  // Legacy engine (tiptap-markdown) — storage contract.
  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (text: string) => void }, node: { attrs: { ref?: string; label?: string } }) {
          state.write(serializeEntityMention(node.attrs.ref ?? '', node.attrs.label))
        },
        parse: {
          setup(markdownit: MarkdownItLike) {
            installEntityMarkdownRules(markdownit)
          },
        },
      },
    }
  },

  // Official engine (@tiptap/markdown).
  markdownTokenizer: {
    name: ENTITY_MENTION_NODE,
    level: 'inline',
    start: (src: string) => {
      let from = 0
      for (;;) {
        const idx = src.indexOf('[[', from)
        if (idx === -1) return -1
        if (idx === 0 || src[idx - 1] !== '!') return idx
        from = idx + 2
      }
    },
    tokenize: (src: string) => {
      const match = matchEntityMention(src)
      if (!match) return undefined
      return { type: ENTITY_MENTION_NODE, raw: match.raw, ref: match.ref, label: match.label ?? '' }
    },
  },

  parseMarkdown: (token) => ({ type: ENTITY_MENTION_NODE, attrs: { ref: token.ref, label: token.label ?? '' } }),

  renderMarkdown: (node) => serializeEntityMention(String(node.attrs?.ref ?? ''), node.attrs?.label as string | undefined),
})
