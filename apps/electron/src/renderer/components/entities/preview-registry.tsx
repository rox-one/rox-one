/**
 * W1-08 (#1505) — per-kind preview renderers (`registerPreview`).
 *
 * Modules may register a custom Chip label, HoverCard body or Card body for
 * their kind. Unregistered kinds use the generic preview-driven renderers in
 * EntityChip / EntityHoverCard / EntityCard. Restricted previews never reach
 * a registered renderer: the generic "Нет доступа" body is always used.
 */
import type { ComponentType } from 'react'
import type { EntityKind, PreviewModel } from '@rox/core/entities'

export interface EntityPreviewRenderers {
  /** Inline content of the chip (icon + label are already provided). */
  ChipLabel?: ComponentType<{ preview: PreviewModel }>
  /** Body of the hover card under the shared header. */
  HoverCardBody?: ComponentType<{ preview: PreviewModel }>
  /** Body of the embed / card under the shared header. */
  CardBody?: ComponentType<{ preview: PreviewModel }>
}

const registry = new Map<EntityKind, EntityPreviewRenderers>()

export function registerPreview(kind: EntityKind, renderers: EntityPreviewRenderers): () => void {
  registry.set(kind, renderers)
  return () => {
    if (registry.get(kind) === renderers) registry.delete(kind)
  }
}

export function previewRenderersFor(kind: EntityKind): EntityPreviewRenderers | undefined {
  return registry.get(kind)
}

/** Test helper. */
export function resetPreviewRegistry(): void {
  registry.clear()
}
