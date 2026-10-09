/**
 * Quick look modal for a Rox History entry: full-resolution image or complete
 * text (fetched lazily through `getClipboardEntry`), metadata, tags and the
 * copy/star/tags actions. Space or Escape closes it; the dialog primitives own
 * the focus trap.
 */
import { Copy, Star, Tag, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ClipEntryDetail, ClipEntrySummary } from '@rox/shared/clipboard-history'
import { Badge, Button } from '@/components/mode-screen/ModeScreen'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  detectTextKind,
  formatChars,
  formatImageMeta,
  formatRelativeTime,
  imageFormatBadge,
  usesMonoPreview,
  visibleEntryTags,
} from './clipboard-history-model'

export function ClipboardQuickLook({
  entry,
  detail,
  loading,
  now,
  onClose,
  onCopy,
  onToggleStar,
  onEditTags,
}: {
  entry: ClipEntrySummary | null
  detail: ClipEntryDetail | null
  loading: boolean
  now: number
  onClose: () => void
  onCopy: (id: number) => void
  onToggleStar: (entry: ClipEntrySummary) => void
  onEditTags: (entry: ClipEntrySummary) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'ru'
  const open = entry !== null
  const isImage = entry?.kind === 'image'
  const text = detail?.text ?? entry?.text ?? ''
  const tags = entry ? visibleEntryTags(entry.tags) : []
  const imageSrc = detail?.imageDataUrl ?? entry?.thumbDataUrl ?? null
  const mono = !isImage && usesMonoPreview(detectTextKind(text))

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent
        data-testid="clipboard-quick-look"
        className="sm:max-w-3xl"
        onKeyDown={(event) => { if (event.key === ' ') { event.preventDefault(); onClose() } }}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{t('clipboard.quickLook.title')}</DialogTitle>
        </DialogHeader>

        {entry && isImage ? (
          imageSrc ? (
            <img
              src={imageSrc}
              alt=""
              data-testid="clipboard-quick-look-image"
              className="max-h-[60vh] w-full rounded-[var(--radius-card)] border border-border object-contain"
            />
          ) : (
            <p className="text-small text-text-muted" aria-busy={loading}>{t('clipboard.image.label')}</p>
          )
        ) : entry ? (
          <pre
            data-testid="clipboard-quick-look-text"
            className={cn(
              'max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-card)] bg-surface-hover p-3 text-small leading-5',
              mono && 'font-mono text-caption',
            )}
          >
            {text || entry.preview}
          </pre>
        ) : null}

        {entry ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-text-muted" data-testid="clipboard-quick-look-details">
              <span className="uppercase tracking-wide">{t('clipboard.quickLook.details')}</span>
              {isImage ? <Badge tone="info">{imageFormatBadge(entry.imageFormat, entry.thumbDataUrl) ?? t('clipboard.image.label')}</Badge> : null}
              {isImage && formatImageMeta(t, entry, locale) ? <span>{formatImageMeta(t, entry, locale)}</span> : null}
              {!isImage && entry.charCount != null ? <span>{formatChars(t, entry.charCount)}</span> : null}
              <span className="tabular-nums">{formatRelativeTime(t, entry.createdAt, now)}</span>
              {entry.sourceApp ? <span className="min-w-0 truncate">{entry.sourceApp}</span> : null}
            </div>

            {tags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <span key={tag} className="rounded-[var(--radius-control)] bg-surface-pressed px-1.5 text-caption text-text-secondary">#{tag}</span>
                ))}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-1">
              <Button variant="primary" onClick={() => onCopy(entry.id)} data-testid="clipboard-quick-look-copy">
                <Copy aria-hidden className="icon-caption" />
                {t('clipboard.action.copy')}
              </Button>
              <Button variant="secondary" aria-pressed={entry.starred} onClick={() => onToggleStar(entry)} data-testid="clipboard-quick-look-star">
                <Star aria-hidden className="icon-caption" fill={entry.starred ? 'currentColor' : 'none'} />
                {t(entry.starred ? 'clipboard.action.unstar' : 'clipboard.action.star')}
              </Button>
              <Button variant="ghost" onClick={() => onEditTags(entry)} data-testid="clipboard-quick-look-tags">
                <Tag aria-hidden className="icon-caption" />
                {t('clipboard.action.tags')}
              </Button>
              <Button variant="ghost" className="ml-auto" onClick={onClose} data-testid="clipboard-quick-look-close">
                <X aria-hidden className="icon-caption" />
                {t('clipboard.quickLook.close')}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}