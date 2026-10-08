import * as React from "react"
import { X, Image as ImageIcon, RotateCw } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Spinner, FileTypeIcon, getFileTypeLabel } from "@rox/ui"
import { cn } from "@/lib/utils"
import type { FileAttachment } from "../../../shared/types"

// Re-export for backward compatibility
export { FileTypeIcon, getFileTypeLabel }

interface AttachmentPreviewProps {
  attachments: FileAttachment[]
  onRemove: (index: number) => void
  /** Re-run speech-to-text for an audio attachment whose transcription failed. */
  onRetryTranscription?: (index: number) => void
  disabled?: boolean
  loadingCount?: number
}

/**
 * AttachmentPreview - ChatGPT-style attachment preview strip
 *
 * Shows attached files as small bubbles above the textarea:
 * - Image thumbnails for image files (48x48px)
 * - Icon + filename for text/PDF/code files
 * - X button on hover to remove
 * - Horizontally scrollable when many files
 * - Loading placeholders while files are being read
 * - Audio files surface live transcription state (spinner / error + retry)
 */
export function AttachmentPreview({ attachments, onRemove, onRetryTranscription, disabled, loadingCount = 0 }: AttachmentPreviewProps) {
  if (attachments.length === 0 && loadingCount === 0) return null

  return (
    <div className="flex gap-2 px-4 py-3 border-b border-border/50 overflow-x-auto">
      {attachments.map((attachment, index) => (
        <AttachmentBubble
          key={`${attachment.path}-${index}`}
          attachment={attachment}
          onRemove={() => onRemove(index)}
          onRetry={onRetryTranscription ? () => onRetryTranscription(index) : undefined}
          disabled={disabled}
        />
      ))}
      {/* Loading placeholders */}
      {Array.from({ length: loadingCount }).map((_, i) => (
        <LoadingBubble key={`loading-${i}`} />
      ))}
    </div>
  )
}

function LoadingBubble() {
  return (
    <div className="h-16 w-16 rounded-[var(--radius-control)] bg-background shadow-minimal flex items-center justify-center shrink-0">
      <Spinner className="text-muted-foreground" />
    </div>
  )
}

interface AttachmentBubbleProps {
  attachment: FileAttachment
  onRemove: () => void
  onRetry?: () => void
  disabled?: boolean
}

function AttachmentBubble({ attachment, onRemove, onRetry, disabled }: AttachmentBubbleProps) {
  const { t } = useTranslation()
  const isImage = attachment.type === 'image'
  const hasThumbnail = !!attachment.thumbnailBase64
  const hasImageBase64 = isImage && attachment.base64

  // Audio attachments show live transcription progress instead of the plain
  // type label: spinner while ASR runs, error + retry when it failed.
  const transcript = attachment.type === 'audio' ? attachment.transcript : undefined
  const isTranscribing = transcript?.status === 'pending'
  const transcriptFailed = transcript?.status === 'error'

  // For images, use full base64; for docs, use Quick Look thumbnail
  const imageSrc = hasImageBase64
    ? `data:${attachment.mimeType};base64,${attachment.base64}`
    : hasThumbnail
      ? `data:image/png;base64,${attachment.thumbnailBase64}`
      : null

  return (
    <div className="relative group shrink-0 select-none">
      {/* Remove button - appears on hover */}
      {!disabled && (
        <button
          onClick={onRemove}
          data-touch-reveal="true"
          aria-label={t('common.remove')}
          className={cn(
            "absolute -top-1.5 -right-1.5 z-10",
            "h-5 w-5 rounded-full",
            "bg-muted-foreground/90 text-background",
            "flex items-center justify-center",
            "opacity-0 group-hover:opacity-100 transition-opacity",
            "hover:bg-muted-foreground"
          )}
        >
          <X className="h-3 w-3" />
        </button>
      )}

      {isImage ? (
        /* IMAGE: Square thumbnail only */
        <div className="h-16 w-16 rounded-[var(--radius-card)] overflow-hidden bg-background shadow-minimal">
          {imageSrc ? (
            <img src={imageSrc} alt={attachment.name} className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full flex items-center justify-center">
              <ImageIcon className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
        </div>
      ) : (
        /* DOCUMENT: Bubble with thumbnail/icon + 2-line text */
        <div className="h-16 flex items-center gap-2.5 rounded-[var(--radius-control)] bg-foreground/5 pl-1.5 pr-3">
          {/* A4-like preview */}
          <div className="relative h-12 w-9 rounded-[var(--radius-control)] overflow-hidden bg-background shadow-minimal flex items-center justify-center shrink-0">
            {hasThumbnail ? (
              <img
                src={`data:image/png;base64,${attachment.thumbnailBase64}`}
                alt={attachment.name}
                className="h-full w-full object-cover object-top"
              />
            ) : (
              <FileTypeIcon type={attachment.type} mimeType={attachment.mimeType} className="h-5 w-5" />
            )}
            {isTranscribing && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/70">
                <Spinner className="h-4 w-4 text-muted-foreground" />
              </div>
            )}
          </div>
          {/* 2-line filename + type */}
          <div className="flex flex-col min-w-0 max-w-[120px]">
            <span className="text-xs font-medium line-clamp-2 break-all" title={attachment.name}>
              {attachment.name}
            </span>
            {isTranscribing ? (
              /* eslint-disable-next-line rox/no-arbitrary-text-size -- 10px sub-caption is below the 11px type-token floor */
              <span className="text-[10px] text-muted-foreground">{t('chat.audioTranscribing')}</span>
            ) : transcriptFailed ? (
              /* eslint-disable-next-line rox/no-arbitrary-text-size -- 10px sub-caption is below the 11px type-token floor */
              <button type="button" onClick={onRetry} disabled={!onRetry} className="flex items-center gap-1 text-[10px] text-destructive hover:underline disabled:no-underline disabled:opacity-70">
                {/* eslint-disable-next-line rox/icon-size-tokens -- 10px icon is below the icon-token scale (icon-status starts at 12px) */}
                <RotateCw className="h-2.5 w-2.5" />
                {t('chat.audioTranscriptRetry')}
              </button>
            ) : (
              <span className="text-[10px] text-muted-foreground">
                {getFileTypeLabel(attachment.type, attachment.mimeType, attachment.name)}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
