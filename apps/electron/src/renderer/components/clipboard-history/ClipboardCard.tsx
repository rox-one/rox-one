/**
 * One Rox History entry: text preview (monospace for code-ish content) or image
 * thumbnail with `W×H · size` meta, relative time, source app, tags and the
 * copy/star/preview/tags/delete actions. Images render from data URLs only.
 */
import { Copy, Eye, Star, Tag, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ClipEntrySummary } from '@rox/shared/clipboard-history'
import { Badge, Button } from '@/components/mode-screen/ModeScreen'
import { cn } from '@/lib/utils'
import {
  detectTextKind,
  formatImageMeta,
  formatRelativeTime,
  imageFormatBadge,
  previewText,
  usesMonoPreview,
  visibleEntryTags,
} from './clipboard-history-model'

export interface ClipboardCardProps {
  entry: ClipEntrySummary
  selected: boolean
  now: number
  onSelect: (id: number) => void
  onCopy: (id: number) => void
  onToggleStar: (entry: ClipEntrySummary) => void
  onDelete: (id: number) => void
  onPreview: (id: number) => void
  onEditTags: (entry: ClipEntrySummary) => void
}

export function ClipboardCard({
  entry,
  selected,
  now,
  onSelect,
  onCopy,
  onToggleStar,
  onDelete,
  onPreview,
  onEditTags,
}: ClipboardCardProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'ru'
  const isImage = entry.kind === 'image'
  const tags = visibleEntryTags(entry.tags)
  const imageMeta = isImage ? formatImageMeta(t, entry, locale) : null
  const formatBadge = isImage ? imageFormatBadge(entry.imageFormat, entry.thumbDataUrl) : null
  const preview = isImage ? '' : previewText(entry.text ?? entry.preview)
  const mono = !isImage && usesMonoPreview(detectTextKind(entry.text))
  const label = `${t('clipboard.a11y.card')}: ${(entry.preview || t('clipboard.image.label')).slice(0, 80)}`

  return (
    <article
      role="listitem"
      aria-label={label}
      aria-current={selected ? 'true' : undefined}
      data-testid="clipboard-card"
      data-entry-id={entry.id}
      onClick={() => onSelect(entry.id)}
      className={cn(
        'mx-1.5 flex cursor-default flex-col gap-1.5 rounded-[var(--radius-card)] border-l-2 border-transparent px-2 py-1.5 transition-colors motion-reduce:transition-none',
        selected ? 'border-l-accent bg-surface-pressed' : 'hover:bg-surface-hover',
      )}
    >
      <div className="flex min-w-0 items-center gap-2 text-caption text-text-muted">
        {isImage ? <Badge tone="info">{formatBadge ?? t('clipboard.image.label')}</Badge> : null}
        {entry.sourceApp ? <span className="min-w-0 truncate">{entry.sourceApp}</span> : null}
        <span className="ml-auto shrink-0 numeric">{formatRelativeTime(t, entry.createdAt, now)}</span>
        <button
          type="button"
          aria-pressed={entry.starred}
          aria-label={t(entry.starred ? 'clipboard.action.unstar' : 'clipboard.action.star')}
          // eslint-disable-next-line rox/prefer-primitives -- ModeScreen Button/raw icon controls here do not forward a ref, so a Radix Tooltip trigger cannot anchor; keep the native title for parity
          title={t(entry.starred ? 'clipboard.action.unstar' : 'clipboard.action.star')}
          data-testid="clipboard-card-star"
          onClick={(event) => { event.stopPropagation(); onToggleStar(entry) }}
          className={cn(
            'grid size-6 shrink-0 place-items-center rounded-[var(--radius-control)] outline-none hover:bg-surface-pressed',
            entry.starred ? 'text-status-warning' : 'text-text-muted hover:text-foreground',
          )}
        >
          <Star aria-hidden className="icon-caption" fill={entry.starred ? 'currentColor' : 'none'} />
        </button>
      </div>

      {isImage ? (
        <div className="flex items-start gap-2">
          {entry.thumbDataUrl ? (
            <img
              src={entry.thumbDataUrl}
              alt=""
              data-testid="clipboard-card-thumb"
              className="max-h-28 max-w-[220px] rounded-[var(--radius-control)] border border-border object-contain"
            />
          ) : (
            <span className="grid h-16 w-24 place-items-center rounded-[var(--radius-control)] bg-surface-hover text-caption text-text-muted">
              {t('clipboard.image.label')}
            </span>
          )}
          {imageMeta ? <span className="pt-0.5 text-caption text-text-muted">{imageMeta}</span> : null}
        </div>
      ) : (
        <p
          data-testid="clipboard-card-preview"
          className={cn(
            'max-h-24 overflow-hidden whitespace-pre-wrap break-words text-small leading-5 text-foreground',
            mono && 'font-mono text-caption',
          )}
        >
          {preview || t('clipboard.empty.body')}
        </p>
      )}

      {tags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1" data-testid="clipboard-card-tags">
          {tags.slice(0, 5).map((tag) => (
            <span key={tag} className="rounded-[var(--radius-control)] bg-surface-pressed px-1.5 text-caption text-text-secondary">
              #{tag}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1">
        {/* eslint-disable-next-line rox/prefer-primitives -- ModeScreen Button does not forward a ref, so a Radix Tooltip trigger cannot anchor; keep the native title for parity */}
        <Button variant="ghost" className="px-1.5" aria-label={t('clipboard.action.copy')} title={t('clipboard.action.copy')} data-testid="clipboard-card-copy" onClick={(event) => { event.stopPropagation(); onCopy(entry.id) }}>
          <Copy aria-hidden className="icon-caption" />
          {t('clipboard.action.copy')}
        </Button>
        {/* eslint-disable-next-line rox/prefer-primitives -- ModeScreen Button does not forward a ref, so a Radix Tooltip trigger cannot anchor; keep the native title for parity */}
        <Button variant="ghost" className="px-1.5" aria-label={t('clipboard.action.preview')} title={t('clipboard.action.preview')} data-testid="clipboard-card-preview-button" onClick={(event) => { event.stopPropagation(); onPreview(entry.id) }}>
          <Eye aria-hidden className="icon-caption" />
        </Button>
        {/* eslint-disable-next-line rox/prefer-primitives -- ModeScreen Button does not forward a ref, so a Radix Tooltip trigger cannot anchor; keep the native title for parity */}
        <Button variant="ghost" className="px-1.5" aria-label={t('clipboard.action.tags')} title={t('clipboard.action.tags')} data-testid="clipboard-card-tags-button" onClick={(event) => { event.stopPropagation(); onEditTags(entry) }}>
          <Tag aria-hidden className="icon-caption" />
        </Button>
        {/* eslint-disable-next-line rox/prefer-primitives -- ModeScreen Button does not forward a ref, so a Radix Tooltip trigger cannot anchor; keep the native title for parity */}
        <Button variant="ghost" className="ml-auto px-1.5 text-text-muted hover:text-destructive" aria-label={t('clipboard.action.delete')} title={t('clipboard.action.delete')} data-testid="clipboard-card-delete" onClick={(event) => { event.stopPropagation(); onDelete(entry.id) }}>
          <Trash2 aria-hidden className="icon-caption" />
        </Button>
      </div>
    </article>
  )
}