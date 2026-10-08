/**
 * EntityEmbed (W1-08, TECH-SPEC §3.9) — block atom node
 * `{ type: 'entityEmbed', attrs: { ref, label, source } }`, serialised as
 * `![[kind:id]]` / `![[kind:id|label]]` on its own line. `source` keeps the
 * original Markdown so saving never rewrites it. Hosts pass `view` (a React node view, e.g. the
 * renderer's EntityCard) to render the live preview card.
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import type { ComponentType } from 'react'
import {
  ENTITY_EMBED_NODE,
  canonicalEntityTarget,
  entityEmbedBlockStart,
  installEntityMarkdownRules,
  isMarkedRootTokenList,
  matchEntityEmbedBlock,
  serializeEntityEmbed,
  type MarkdownItLike,
} from '../entity-markdown'
import { entityEmbedInputRule, entityEmbedPasteRule } from './entity-input-rules'

export interface EntityEmbedOptions {
  view?: ComponentType<ReactNodeViewProps>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    entityEmbed: {
      insertEntityEmbed: (attrs: { ref: string; label?: string }) => ReturnType
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
      label: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-label') ?? '',
        renderHTML: (attrs: { label?: string }) => (attrs.label ? { 'data-label': attrs.label } : {}),
      },
      source: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-source') ?? '',
        renderHTML: (attrs: { source?: string }) => (attrs.source ? { 'data-source': attrs.source } : {}),
      },
    }
  },

  parseHTML() {
    // Pasted HTML with a ref that is not a writable explicit ref is not an embed.
    return [{ tag: 'div[data-entity-embed]', getAttrs: (el: HTMLElement) => (canonicalEntityTarget(el.getAttribute('data-entity-embed') ?? '') ? null : false) }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'tiptap-entity-embed', contenteditable: 'false' }), node.attrs.ref]
  },

  renderText({ node }) {
    return serializeEntityEmbed(node.attrs.ref as string, node.attrs.label as string, node.attrs.source as string)
  },

  addNodeView() {
    const view = this.options.view
    return view ? ReactNodeViewRenderer(view, { className: 'tiptap-entity-embed-view' }) : null
  },

  addCommands() {
    return {
      // Refs that cannot be written inside `![[…]]` (`|`, `]`, `[[`, line
      // breaks) are refused: no-op, returns false, nothing is written.
      insertEntityEmbed: (attrs) => ({ commands }) => {
        const ref = canonicalEntityTarget(attrs.ref)
        if (!ref) return false
        return commands.insertContent({ type: this.name, attrs: { ref, label: attrs.label ?? '', source: '' } })
      },
    }
  },

  addInputRules() {
    return [entityEmbedInputRule(this.type)]
  },

  addPasteRules() {
    return [entityEmbedPasteRule(this.type)]
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (text: string) => void; closeBlock: (node: unknown) => void }, node: { attrs: { ref?: string; label?: string; source?: string } }) {
          state.write(serializeEntityEmbed(node.attrs.ref ?? '', node.attrs.label, node.attrs.source))
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
    // Line-start positions only (after a blank line or at 0): never cut a
    // paragraph mid-line or pull an embed out of the paragraph above it.
    start: (src: string) => entityEmbedBlockStart(src),
    // Top level only (not inside list items / blockquotes), like the
    // markdown-it rule: a nested line stays paragraph text. The line after
    // must be blank or the end, so `![[…]]\nPara` stays one paragraph.
    tokenize: (src: string, tokens: unknown) => {
      if (!isMarkedRootTokenList(tokens)) return undefined
      const block = matchEntityEmbedBlock(src)
      if (!block) return undefined
      const { match, raw } = block
      return { type: ENTITY_EMBED_NODE, raw, ref: match.ref, label: match.label ?? '', source: match.raw }
    },
  },

  parseMarkdown: (token) => ({
    type: ENTITY_EMBED_NODE,
    attrs: { ref: token.ref, label: token.label ?? '', source: token.source ?? '' },
  }),

  renderMarkdown: (node) => serializeEntityEmbed(
    String(node.attrs?.ref ?? ''),
    node.attrs?.label as string | undefined,
    node.attrs?.source as string | undefined,
  ),
})
