import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import * as React from 'react'
import { MarkdownMermaidBlock } from '../MarkdownMermaidBlock'
import { RichBlockShell } from '../RichBlockShell'
import { RICH_BLOCK_EDIT_EVENT } from '../rich-block-events'
import { fenceCodeAttribute, promoteFencedBlocks, serializeLegacyFence } from './legacy-fence'

const MERMAID_LANGUAGES = new Set(['mermaid'])

export const MermaidBlock = Node.create({
  name: 'mermaidBlock',

  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      code: fenceCodeAttribute,
    }
  },

  addStorage() {
    return {
      markdown: {
        serialize: (state: Parameters<typeof serializeLegacyFence>[0], node: { attrs?: { code?: string } }) =>
          serializeLegacyFence(state, node, 'mermaid'),
        parse: {
          updateDOM: (element: HTMLElement) => promoteFencedBlocks(element, MERMAID_LANGUAGES, 'mermaid-block'),
        },
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="mermaid-block"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'mermaid-block' })]
  },

  markdownTokenName: 'code',

  parseMarkdown: (token: any, helpers: any) => {
    if ((token.lang ?? '').toLowerCase() !== 'mermaid') return []
    return helpers.createNode('mermaidBlock', { code: token.text ?? '' })
  },

  renderMarkdown: (node: any) => {
    const code = (node.attrs?.code ?? '').replace(/\n$/, '')
    return `\`\`\`mermaid\n${code}\n\`\`\``
  },

  addNodeView() {
    return ReactNodeViewRenderer(({ node, editor, getPos }) => {
      const selectNode = () => {
        const pos = getPos()
        if (typeof pos !== 'number') return
        editor.chain().focus().setNodeSelection(pos).run()
      }

      const handleEditClick = () => {
        selectNode()
        queueMicrotask(() => (editor as any).emit(RICH_BLOCK_EDIT_EVENT))
      }

      return (
        <NodeViewWrapper
          contentEditable={false}
          className="tiptap-mermaid-block"
          data-drag-handle
          onMouseDownCapture={(event: React.MouseEvent) => {
            if (event.button !== 0) return
            const target = event.target as HTMLElement | null
            if (target?.closest('button')) return
            event.preventDefault()
            event.stopPropagation()
            selectNode()
          }}
        >
          <RichBlockShell onEdit={handleEditClick} editTitle="Edit Mermaid">
            <MarkdownMermaidBlock code={(node.attrs.code as string) ?? ''} showExpandButton={false} tapToOpen={false} minHeight={140} />
          </RichBlockShell>
        </NodeViewWrapper>
      )
    })
  },
})
