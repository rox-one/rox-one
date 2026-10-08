/**
 * W1-08 (#1505) — entity UI (renderer). See ./README.md.
 */
export { EntityChip, ENTITY_HOVER_DELAY_MS, type EntityChipProps } from './EntityChip'
export { EntityHoverCard, type EntityHoverCardProps } from './EntityHoverCard'
export { EntityCard, EntityPreviewBody, type EntityCardProps } from './EntityCard'
export { EntityPicker, EntityPickerPanel, ENTITY_PICKER_KIND_FILTERS, buildEntityPickerItems, type EntityPickerProps } from './EntityPicker'
export { BacklinksPanel, BacklinksList, BACKLINKS_GROUP_PREVIEW, type BacklinksPanelProps } from './BacklinksPanel'
export { BACKLINK_GROUPS, backlinkGroupOf, groupBacklinks, type BacklinkGroup } from './backlink-groups'
export { EntityRowContextMenu, useEntityRowActions } from './EntityRowContextMenu'
export {
  DEFAULT_ENTITY_ROW_ACTIONS,
  getEntityRowActions,
  registerEntityRowActionHandler,
  type EntityRowAction,
  type EntityRowActionHandler,
} from './row-actions'
export { ENTITY_REF_MIME, readEntityDragData, setEntityDragData, type EntityDragPayload } from './drag'
export { registerPreview, type EntityPreviewRenderers } from './preview-registry'
export {
  getEntityDataSource,
  setEntityDataSource,
  type EntityDataSource,
  type EntitySearchHit,
} from './entity-data-source'
export { useEntityPreview, invalidateEntityPreviews, type EntityPreviewState, type EntityPreviewView } from './use-entity-preview'
export { useEntityBacklinks } from './use-entity-backlinks'
export {
  ENTITIES_PREVIEWS_STORAGE_KEY,
  entitiesPreviewsRequestedAtom,
  entityUiFlagsAtom,
  resolveEntityUiFlags,
  useEntityPreviewsEnabled,
} from './flags'
export { EntityWorkspaceContext } from './entity-context'
export { EntityKindIcon, ENTITY_KIND_ICONS } from './kind-icons'
export { useNoteEntityMentions } from './NoteEntityMentions'
export { TaskEntityBacklinks } from './TaskEntityBacklinks'
