import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Image as ImageIcon, RotateCw, X } from 'lucide-react'
import { Spinner, getFileTypeLabel } from '@rox/ui'
import { cn } from '@/lib/utils'
import type { FileAttachment } from '../../../../../shared/types'

/** Compact, localized file size: «2,1 КБ». Non-obvious unit ladder → named. */
function formatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} МБ`
}

export interface AttachmentTrayProps {
  attachments: FileAttachment[]
  /** Remove the attachment at `index` from the draft. */
  onRemove: (index: number) => void
  /** Re-run speech-to-text for a failed audio attachment. */
  onRetryTranscription?: (index: number) => void
  disabled?: boolean
  /** In-flight reads shown as placeholders while a file is loaded. */
  loadingCount?: number
  /** Focus order for the first removable chip; increments per entry. */
  focusOrderBase?: number
  className?: string
}

/**
 * Composer deck attachment tray (G5). One horizontal row above the writing
 * area: per-file metadata, a 32 px remove target, no height animation — the
 * tray is a stable slot in the deck, so its presence never moves the
 * conversation (colour/opacity only, reduced-motion instant).
 */
export function AttachmentTray({
  attachments,
  onRemove,
  onRetryTranscription,
  disabled,
  loadingCount = 0,
  focusOrderBase = 10,
  className,
}: AttachmentTrayProps) {
  if (attachments.length === 0 && loadingCount === 0) return null

  return (
    <div
      data-g05-tray
      className={cn(
        'flex items-center gap-2 overflow-x-auto border-b border-border-subtle px-3 py-2',
        'motion-safe:transition-colors motion-safe:duration-[var(--motion-fast)] motion-reduce:transition-none',
        className,
      )}
    >
      {attachments.map((attachment, index) => (
        <AttachmentChip
          key={`${attachment.path}-${index}`}
          attachment={attachment}
          disabled={disabled}
          focusOrder={focusOrderBase + index}
          onRemove={() => onRemove(index)}
          onRetry={onRetryTranscription ? () => onRetryTranscription(index) : undefined}
        />
      ))}
      {Array.from({ length: loadingCount }).map((_, index) => (
        <span
          key={`loading-${index}`}
          aria-hidden
          className="inline-flex h-9 w-40 shrink-0 items-center gap-2 rounded-[var(--radius-control)] border border-border-subtle bg-surface-elevated px-2 motion-safe:animate-pulse motion-reduce:animate-none"
        >
          <Spinner className="size-4 text-text-muted" />
          <span className="block h-2 w-20 rounded-[var(--radius-xs)] bg-foreground-5" />
        </span>
      ))}
    </div>
  )
}

function AttachmentChip({
  attachment,
  disabled,
  focusOrder,
  onRemove,
  onRetry,
}: {
  attachment: FileAttachment
  disabled?: boolean
  focusOrder?: number
  onRemove: () => void
  onRetry?: () => void
}) {
  const { t } = useTranslation()
  const isImage = attachment.type === 'image'
  const transcript = attachment.type === 'audio' ? attachment.transcript : undefined
  const isTranscribing = transcript?.status === 'pending'
  const transcriptFailed = transcript?.status === 'error'
  const imageSrc = isImage
    ? attachment.base64
      ? `data:${attachment.mimeType};base64,${attachment.base64}`
      : attachment.thumbnailBase64
        ? `data:image/png;base64,${attachment.thumbnailBase64}`
        : null
    : null
  const meta = isTranscribing
    ? t('composer.deck.attachment.transcribing', { defaultValue: 'расшифровка…' })
    : transcriptFailed
      ? t('composer.deck.attachment.transcriptFailed', { defaultValue: 'расшифровка не удалась' })
      : [getFileTypeLabel(attachment.type, attachment.mimeType, attachment.name), formatAttachmentSize(attachment.size)]
          .filter(Boolean)
          .join(' · ')

  return (
    <div
      data-g05-attachment={attachment.type}
      className={cn(
        'group inline-flex h-9 max-w-[260px] shrink-0 items-center gap-2 rounded-[var(--radius-control)] border border-border-subtle bg-surface-elevated pl-1.5 pr-0.5',
        'motion-safe:transition-colors motion-safe:duration-[var(--motion-fast)] motion-reduce:transition-none',
        disabled && 'opacity-45',
      )}
    >
      {isImage && imageSrc ? (
        <img src={imageSrc} alt="" className="size-6 shrink-0 rounded-[var(--radius-xs)] object-cover" />
      ) : (
        <span aria-hidden className="flex size-6 shrink-0 items-center justify-center text-text-muted">
          {isImage ? <ImageIcon className="icon-toolbar" /> : <FileText className="icon-toolbar" />}
        </span>
      )}
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-caption text-text-primary" title={attachment.name}>
          {attachment.name}
        </span>
        <span className={cn('truncate text-caption', transcriptFailed ? 'text-[var(--destructive-text)]' : 'text-text-secondary')}>
          {meta}
        </span>
      </span>
      {transcriptFailed && onRetry && (
        <button
          type="button"
          disabled={disabled}
          onClick={onRetry}
          aria-label={t('composer.deck.attachment.retry', { defaultValue: 'Повторить расшифровку' })}
          className="inline-flex min-h-[28px] shrink-0 items-center rounded-[var(--radius-control)] px-1 text-caption text-[var(--destructive-text)] hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-[length:var(--ring-width)] focus-visible:ring-focus-ring disabled:pointer-events-none"
        >
          <RotateCw className="icon-caption" />
        </button>
      )}
      <button
        type="button"
        aria-label={t('composer.deck.attachment.remove', { defaultValue: 'Убрать {{name}}', name: attachment.name })}
        data-focus-order={focusOrder}
        disabled={disabled}
        onClick={onRemove}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-text-muted hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-[length:var(--ring-width)] focus-visible:ring-focus-ring disabled:pointer-events-none"
      >
        <X className="icon-caption" />
      </button>
    </div>
  )
}