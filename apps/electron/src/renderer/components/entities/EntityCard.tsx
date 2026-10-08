/**
 * W1-08 (#1505) — preview-driven entity card (embeds) and the shared preview
 * body used by EntityHoverCard.
 *
 * Restricted previews render only the kind and «Нет доступа» — never the
 * title, fields or people (TECH-SPEC §3.3).
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Link2, Lock, Trash2, TriangleAlert } from 'lucide-react'
import {
  entityDeepLink,
  isRestrictedPreview,
  type EntityRef,
  type PreviewModel,
} from '@rox/core/entities'
import { FOCUS_RING, MOTION_FAST, PersonAvatar, ProgressBar } from '@rox/ui/primitives'
import { cn } from '@/lib/utils'
import { EntityKindIcon } from './kind-icons'
import { entityKindLabel, formatRelativeTime } from './entity-format'
import { previewRenderersFor } from './preview-registry'
import type { EntityPreviewView } from './use-entity-preview'

const BADGE_TONE: Record<string, string> = {
  success: 'text-status-success',
  warning: 'text-status-warning',
  danger: 'text-status-danger',
  info: 'text-status-info',
  neutral: 'text-text-muted',
}

export interface EntityPreviewBodyProps {
  entityRef: EntityRef
  preview: EntityPreviewView | null
  loading?: boolean
  variant: 'hover' | 'card' | 'embed'
  onOpen?: (ref: EntityRef, event: React.MouseEvent) => void
  /** Overrides the clipboard write (tests, other surfaces). */
  onCopyLink?: (link: string) => void
}

function copyToClipboard(text: string): void {
  try { void navigator.clipboard?.writeText(text) } catch { /* clipboard unavailable */ }
}

function RestrictedBody({ entityRef, preview }: { entityRef: EntityRef; preview: EntityPreviewView }) {
  const { t } = useTranslation()
  const kind = entityKindLabel(t, entityRef.kind, preview.kindLabel)
  const Icon = preview.status === 'tombstone' ? Trash2 : preview.status === 'unavailable' ? TriangleAlert : Lock
  const titleKey = preview.status === 'tombstone'
    ? 'entities.ui.chip.deleted'
    : preview.status === 'unavailable' ? 'entities.ui.chip.unavailable' : 'entities.ui.card.restrictedTitle'
  const bodyKey = preview.status === 'tombstone'
    ? 'entities.ui.card.deletedBody'
    : preview.status === 'unavailable' ? 'entities.ui.card.unavailableBody' : 'entities.ui.card.restrictedBody'
  return (
    <div className="flex items-start gap-2" data-entity-restricted={preview.status}>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-text-muted" />
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-foreground">{t(titleKey, { kind })}</p>
        <p className="text-[12px] text-text-secondary">{t(bodyKey)}</p>
      </div>
    </div>
  )
}

function ModelBody({ preview, variant }: { preview: PreviewModel; variant: EntityPreviewBodyProps['variant'] }) {
  const { t, i18n } = useTranslation()
  const custom = previewRenderersFor(preview.ref.kind)
  const Custom = variant === 'hover' ? custom?.HoverCardBody : custom?.CardBody
  if (Custom) return <Custom preview={preview} />
  const fields = (preview.fields ?? []).slice(0, variant === 'hover' ? 4 : 6)
  const people = (preview.people ?? []).slice(0, 5)
  const updated = formatRelativeTime(preview.updatedAt ?? preview.dates?.updated, i18n.language)
  return (
    <>
      {preview.badges && preview.badges.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
          {preview.badges.map((badge) => (
            <li key={badge.id} className={cn('inline-flex items-center gap-1', BADGE_TONE[badge.tone ?? 'neutral'])}>
              <span aria-hidden="true">●</span>
              {badge.label}
            </li>
          ))}
        </ul>
      )}
      {fields.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
          {fields.map((field) => (
            <React.Fragment key={field.id}>
              <dt className="text-text-muted">{field.label}</dt>
              <dd className="truncate text-foreground">{field.value}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
      {preview.progress && (
        <ProgressBar
          done={preview.progress.done}
          total={preview.progress.total}
          percent={preview.progress.percent}
        />
      )}
      {(people.length > 0 || updated) && (
        <div className="flex items-center justify-between gap-2 text-[12px] text-text-muted">
          <div className="flex -space-x-1.5">
            {people.map((person) => (
              <span key={`${person.ref.kind}:${person.ref.id}`} title={person.name}>
                <PersonAvatar person={{ name: person.name, avatarUrl: person.avatarUrl }} size={20} />
              </span>
            ))}
          </div>
          {updated && <span>{t('entities.ui.card.updated', { time: updated })}</span>}
        </div>
      )}
    </>
  )
}

/** Header + body shared by hover cards and cards. */
export function EntityPreviewBody({ entityRef, preview, loading, variant, onOpen, onCopyLink }: EntityPreviewBodyProps) {
  const { t } = useTranslation()
  if (loading || !preview) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-text-muted" aria-busy="true">
        <EntityKindIcon kind={entityRef.kind} className="size-4" />
        {t('entities.ui.chip.loading')}
      </div>
    )
  }
  if (isRestrictedPreview(preview)) return <RestrictedBody entityRef={entityRef} preview={preview} />
  const kind = entityKindLabel(t, entityRef.kind, preview.kindLabel)
  const copy = onCopyLink ?? copyToClipboard
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-text-muted">
        <EntityKindIcon kind={entityRef.kind} icon={preview.icon} className="size-3.5" />
        <span>{kind}</span>
      </div>
      <p className="line-clamp-2 text-[14px] font-medium text-foreground">{preview.title}</p>
      <ModelBody preview={preview} variant={variant} />
      <div className="flex items-center gap-1 pt-1" role="group" aria-label={t('entities.ui.card.actions')}>
        <button
          type="button"
          className={cn('rounded-[6px] px-2 py-1 text-[12px] text-accent hover:bg-foreground/[0.05]', MOTION_FAST, FOCUS_RING)}
          onClick={(event) => onOpen?.(entityRef, event)}
        >
          {t('entities.ui.card.open')}
        </button>
        <button
          type="button"
          className={cn('inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-[12px] text-text-secondary hover:bg-foreground/[0.05]', MOTION_FAST, FOCUS_RING)}
          onClick={() => copy(entityDeepLink(entityRef))}
        >
          <Link2 aria-hidden="true" className="size-3.5" />
          {t('entities.ui.card.copyLink')}
        </button>
      </div>
    </div>
  )
}

export interface EntityCardProps extends Omit<EntityPreviewBodyProps, 'variant'> {
  variant?: 'card' | 'embed'
  className?: string
}

/** Block card for an entity (used by EntityEmbed node views and lists). */
export function EntityCard({ variant = 'card', className, ...props }: EntityCardProps) {
  const { t } = useTranslation()
  const restricted = props.preview ? isRestrictedPreview(props.preview) : false
  const kind = entityKindLabel(t, props.entityRef.kind, props.preview?.kindLabel)
  return (
    <section
      className={cn('max-w-[420px] rounded-[8px] border border-border bg-background p-3', className)}
      data-entity-card={variant}
      data-entity-restricted={restricted ? 'true' : undefined}
      aria-label={variant === 'embed' ? t('entities.ui.card.embedLabel', { kind }) : kind}
    >
      <EntityPreviewBody {...props} variant={variant} />
    </section>
  )
}
