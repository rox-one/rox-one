import * as React from 'react'
import { cn } from '@/lib/utils'
import type { FileAttachment } from '../../../../../shared/types'
import { AttachmentTray } from './AttachmentTray'
import { DictationStrip } from './DictationStrip'

export interface ComposerDeckProps {
  attachments: FileAttachment[]
  onRemoveAttachment: (index: number) => void
  onRetryTranscription?: (index: number) => void
  /** In-flight attachment reads rendered as tray placeholders. */
  loadingCount?: number
  disabled?: boolean
  /** Capture cap used by the dictation strip's countdown. */
  dictationLimitSeconds?: number
  /** Composer-level error line, rendered above the chip row. */
  errorText?: string | null
  /** Axis chips (Файлы / Модель / Режим / Папка / Контекст). */
  chips?: React.ReactNode
  /** Trailing actions (improve / dictate / send). */
  trailing?: React.ReactNode
  /** Overlay chrome for the chip row (escape-interrupt / browser status). */
  statusSlot?: React.ReactNode
  /** Base focus order for tray removals. */
  focusOrderBase?: number
  className?: string
  /** The writing area — the existing rich-text input, never rewritten. */
  children: React.ReactNode
}

/**
 * G5 composer deck: the attachment tray on top, the live dictation strip, the
 * writing area, then one 28 px chip row carrying the controls that shape the
 * next request plus the trailing actions. The deck is the only chrome — the
 * tray and chip row are separated by token hairlines, never nested boxes.
 *
 * Presentation-only: every control is passed in by the composer, so this file
 * owns no composer state and reuses the real selectors.
 */
export function ComposerDeck({
  attachments,
  onRemoveAttachment,
  onRetryTranscription,
  loadingCount,
  disabled,
  dictationLimitSeconds,
  errorText,
  chips,
  trailing,
  statusSlot,
  focusOrderBase = 10,
  className,
  children,
}: ComposerDeckProps) {
  return (
    <div data-g05-deck data-disabled={disabled ? 'true' : undefined} className={cn('flex min-w-0 flex-col', className)}>
      <AttachmentTray
        attachments={attachments}
        onRemove={onRemoveAttachment}
        onRetryTranscription={onRetryTranscription}
        disabled={disabled}
        loadingCount={loadingCount}
        focusOrderBase={focusOrderBase}
      />

      <DictationStrip limitSeconds={dictationLimitSeconds} focusOrder={focusOrderBase + 10} />

      {children}

      {errorText && (
        <p className="px-3 pb-1.5 text-caption text-[var(--destructive-text)]" role="alert">
          {errorText}
        </p>
      )}

      <div className="relative">
        {statusSlot}
        <div
          data-g05-chips
          className={cn(
            'flex flex-wrap items-center gap-1.5 border-t border-border-subtle px-2 py-1.5',
            'motion-safe:transition-colors motion-safe:duration-[var(--motion-fast)] motion-reduce:transition-none',
          )}
        >
          {chips}
          <span className="min-w-0 flex-1" />
          {trailing}
        </div>
      </div>
    </div>
  )
}