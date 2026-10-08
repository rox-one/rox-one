/**
 * W1-08 (#1505) — Notes integration: entity mentions in the rich editor.
 *
 * `useNoteEntityMentions` returns `entityNodes` for TiptapMarkdownEditor and
 * the picker element to render next to it. With `entities.previews.v1` off it
 * returns `{ entityNodes: undefined, picker: null }`, so the editor loads no
 * extra nodes and `[[kind:id|label]]` stays plain text exactly as before.
 */
import * as React from 'react'
import { isWikilinkSafeRefLiteral, type EntityNodesOptions, type TiptapEditorHandle } from '@rox/ui'
import { formatEntityRef, type EntityRef } from '@rox/core/entities'
import { EntityPicker } from './EntityPicker'
import { createEntityNodeViews } from './entity-node-views'
import { useEntityPreviewsEnabled } from './flags'

/** Notes can only link refs whose literal is writable as `[[kind:id]]`. */
export const isNoteLinkableRef = (ref: EntityRef): boolean => isWikilinkSafeRefLiteral(formatEntityRef(ref))

export interface UseNoteEntityMentionsInput {
  workspaceId: string | null | undefined
  editorRef: React.RefObject<TiptapEditorHandle | null>
  /** Overrides the flag (tests). */
  enabled?: boolean
}

export function useNoteEntityMentions({ workspaceId, editorRef, enabled: override }: UseNoteEntityMentionsInput): {
  entityNodes: EntityNodesOptions | undefined
  picker: React.ReactNode
} {
  const flag = useEntityPreviewsEnabled()
  const enabled = override ?? flag
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const scope = workspaceId ?? null

  const entityNodes = React.useMemo<EntityNodesOptions | undefined>(() => {
    if (!enabled) return undefined
    const views = createEntityNodeViews(scope)
    return {
      onRequestInsert: () => setPickerOpen(true),
      mentionView: views.EntityMentionView,
      embedView: views.EntityEmbedView,
    }
  }, [enabled, scope])

  const picker = enabled ? (
    <EntityPicker
      open={pickerOpen}
      onOpenChange={setPickerOpen}
      workspaceId={scope}
      accept={isNoteLinkableRef}
      onSelect={(hit) => {
        const editor = editorRef.current
        if (!editor || editor.isDestroyed) return
        const ref = formatEntityRef(hit.ref)
        editor.chain().focus().insertEntityMention({ ref, label: hit.title !== ref ? hit.title : undefined }).run()
      }}
    />
  ) : null

  return { entityNodes, picker }
}
