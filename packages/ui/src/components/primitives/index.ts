/**
 * W1-08 (#1505) — shared UI primitives barrel (`@rox/ui/primitives`).
 *
 * Entity-agnostic building blocks from UI-SPEC §4. Entity-aware pieces
 * (EntityChip, EntityCard, EntityPicker, BacklinksPanel, the preview
 * registry) live in `apps/electron/src/renderer/components/entities/`.
 * See ./README.md for the catalogue and usage notes.
 */
export * from '../status-badge'
export * from '../progress-bar'
export * from '../person-field'
export * from '../subscribers-picker'
export * from '../contextual-date'
export * from '../privacy-field'
export * from '../reactions'
export * from '../comments'
export * from '../activity-timeline'
export * from '../gantt'
export * from '../tree-table'
export { FOCUS_RING, HOVER_TINT, MOTION_FAST, POPOVER_SURFACE, SELECTED_TINT, initialsOf } from './tokens'
