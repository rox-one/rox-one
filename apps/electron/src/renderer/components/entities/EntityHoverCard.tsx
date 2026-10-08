/**
 * W1-08 (#1505) — 360 px hover card shown after 300 ms over an EntityChip.
 * Rendered only while `entities.previews.v1` is on (EntityChip gates it).
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { isRestrictedPreview, type EntityRef } from '@rox/core/entities'
import { POPOVER_SURFACE } from '@rox/ui/primitives'
import { cn } from '@/lib/utils'
import { EntityPreviewBody } from './EntityCard'
import { entityKindLabel } from './entity-format'
import type { EntityPreviewView } from './use-entity-preview'

export interface EntityHoverCardProps {
  entityRef: EntityRef
  preview: EntityPreviewView | null
  loading?: boolean
  onOpen?: (ref: EntityRef, event: React.MouseEvent) => void
  onCopyLink?: (link: string) => void
  className?: string
}

export function EntityHoverCard({ entityRef, preview, loading, onOpen, onCopyLink, className }: EntityHoverCardProps) {
  const { t } = useTranslation()
  const name = preview && !isRestrictedPreview(preview) && preview.title
    ? preview.title
    : entityKindLabel(t, entityRef.kind, preview?.kindLabel)
  return (
    <div
      role="group"
      aria-label={t('entities.ui.card.preview', { title: name })}
      data-entity-hover-card=""
      className={cn(POPOVER_SURFACE, 'w-[360px] max-w-[calc(100vw-24px)] p-3', className)}
    >
      <EntityPreviewBody entityRef={entityRef} preview={preview} loading={loading} variant="hover" onOpen={onOpen} onCopyLink={onCopyLink} />
    </div>
  )
}
