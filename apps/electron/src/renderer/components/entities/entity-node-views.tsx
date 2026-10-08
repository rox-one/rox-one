/**
 * W1-08 (#1505) — React node views for the EntityMention / EntityEmbed TipTap
 * nodes. Created per workspace (`createEntityNodeViews`) so chips resolve
 * previews in the right scope without reaching into the app shell.
 */
import * as React from 'react'
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { parseEntityRef } from '@rox/core/entities'
import { EntityChip } from './EntityChip'
import { EntityCard } from './EntityCard'
import { EntityWorkspaceContext } from './entity-context'
import { openEntity } from './open-entity'
import { useEntityPreview } from './use-entity-preview'

export function createEntityNodeViews(workspaceId: string | null) {
  function EntityMentionView({ node }: ReactNodeViewProps) {
    const ref = String(node.attrs.ref ?? '')
    const label = node.attrs.label ? String(node.attrs.label) : undefined
    return (
      <NodeViewWrapper as="span" className="inline" data-entity-mention-view="">
        <EntityWorkspaceContext.Provider value={workspaceId}>
          {/* In-editor chips are not drag sources: ProseMirror owns node drags. */}
          <EntityChip entityRef={ref} label={label} draggable={false} />
        </EntityWorkspaceContext.Provider>
      </NodeViewWrapper>
    )
  }

  function EntityEmbedView({ node }: ReactNodeViewProps) {
    const parsed = parseEntityRef(String(node.attrs.ref ?? ''))
    const ref = parsed.ok ? parsed.value : null
    const state = useEntityPreview(ref, workspaceId, !!ref)
    if (!ref) return <NodeViewWrapper as="div" data-entity-invalid="">{String(node.attrs.ref ?? '')}</NodeViewWrapper>
    return (
      <NodeViewWrapper as="div" contentEditable={false} data-entity-embed-view="">
        <EntityCard
          variant="embed"
          entityRef={ref}
          preview={state.status === 'ready' ? state.preview : null}
          loading={state.status !== 'ready'}
          onOpen={(target, event) => { openEntity(target, { newPanel: event.metaKey || event.ctrlKey }) }}
        />
      </NodeViewWrapper>
    )
  }

  return { EntityMentionView, EntityEmbedView }
}
