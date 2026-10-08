/**
 * EntityEmbed (W1-08, TECH-SPEC §3.9) — block atom node
 * `{ type: 'entityEmbed', attrs: { ref } }`, serialised as `![[kind:id]]`
 * on its own line. Hosts pass `view` (a React node view, e.g. the
 * renderer's EntityCard) to render the live preview card.
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import type { ComponentType } from 'react'
import {
  ENTITY_EMBED_NODE,
  canonicalEntityTarget,
  installEntityMarkdownRules,
  matchEntityEmbed,
  serializeEntityEmbed,
  type MarkdownItLike,
} from '../entity-markdown'

export interface EntityEmbedOptions {
  view?: ComponentType<ReactNodeViewProps>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    entityEmbed: {
      insertEntityEmbed: (attrs: { ref: string }) => ReturnType
    }
  }
}

export const EntityEmbed = Node.create<EntityEmbedOptions>({
  name: ENTITY_EMBED_NODE,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { view: undefined }
  },

  addAttributes() {
    return {
      ref: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-entity-embed') ?? '',
        renderHTML: (attrs: { ref?: string }) => ({ 'data-entity-embed': attrs.ref ?? '' }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-entity-embed]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'tiptap-entity-embed', contenteditable: 'false' }), node.attrs.ref]
  },

  renderText({ node }) {
    return serializeEntityEmbed(node.attrs.ref as string)
  },

  addNodeView() {
    const view = this.options.view
    return view ? ReactNodeViewRenderer(view, { className: 'tiptap-entity-embed-view' }) : null
  },

  addCommands() {
    return {
      insertEntityEmbed: (attrs) => ({ commands }) => {
        const ref = canonicalEntityTarget(attrs.ref)
        if (!ref) return false
        return commands.insertContent({ type: this.name, attrs: { ref } })
      },
    }
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (text: string) => void; closeBlock: (node: unknown) => void }, node: { attrs: { ref?: string } }) {
          state.write(serializeEntityEmbed(node.attrs.ref ?? ''))
          state.closeBlock(node)
        },
        parse: {
          setup(markdownit: MarkdownItLike) {
            installEntityMarkdownRules(markdownit)
          },
        },
      },
    }
  },

  markdownTokenizer: {
    name: ENTITY_EMBED_NODE,
    level: 'block',
    start: (src: string) => src.indexOf('![['),
    tokenize: (src: string) => {
      const line = src.split('\n', 1)[0] ?? ''
      const match = matchEntityEmbed(line.trim())
      if (!match || match.raw.length !== line.trim().length) return undefined
      const raw = src.startsWith(`${line}\n`) ? `${line}\n` : line
      return { type: ENTITY_EMBED_NODE, raw, ref: match.ref }
    },
  },

  parseMarkdown: (token) => ({ type: ENTITY_EMBED_NODE, attrs: { ref: token.ref } }),

  renderMarkdown: (node) => serializeEntityEmbed(String(node.attrs?.ref ?? '')),
})
