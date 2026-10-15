/**
 * Diff preview on permission cards for file writes (top-50 #16). Shows what
 * Edit / MultiEdit / Write will change, line by line, so «Allow once / always /
 * deny» is an informed choice. Pure presentation; texts are capped upstream.
 */
import { useTranslation } from 'react-i18next'
import type { PermissionPreview } from '@rox/core/types'

export interface DiffLine { sign: '-' | '+'; text: string }

/** Old text as removed lines, new text as added lines (no LCS: hunks are small). */
export function hunkLines(oldText: string, newText: string): DiffLine[] {
  const split = (text: string) => (text === '' ? [] : text.replace(/\n$/, '').split('\n'))
  return [...split(oldText).map((text) => ({ sign: '-' as const, text })), ...split(newText).map((text) => ({ sign: '+' as const, text }))]
}

export function PermissionDiffPreview({ preview }: { preview: PermissionPreview }) {
  const { t } = useTranslation()
  const hunks = preview.kind === 'write' ? [{ oldText: '', newText: preview.newText }] : preview.hunks
  const caption =
    preview.kind === 'write' ? t('chat.approval.previewWrite', { path: preview.filePath })
    : preview.kind === 'overwrite' ? t('chat.approval.previewOverwrite', { path: preview.filePath })
    : preview.filePath
  return (
    <figure className="m-0" data-permission-preview={preview.kind}>
      <figcaption className="truncate pb-1 font-mono text-caption text-text-secondary" title={preview.filePath}>
        {caption}
      </figcaption>
      {preview.kind === 'edit' && preview.replaceAll !== undefined && (
        <p className="pb-1 text-caption text-text-secondary" data-permission-replace-all>
          {t('chat.approval.previewReplaceAll', { count: preview.replaceAll })}
        </p>
      )}
      {preview.kind === 'overwrite' && hunks.length === 0 && (
        <p className="pb-1 text-caption text-text-muted">{t('chat.approval.previewNoChanges')}</p>
      )}
      <div
        role="region"
        aria-label={t('chat.approval.previewLabel')}
        tabIndex={0}
        data-glass-slot="editor"
        className="max-h-48 overflow-auto rounded-[var(--radius-control)] bg-surface-input font-mono text-caption outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {hunks.map((hunk, index) => (
          <div key={index} className={index > 0 ? 'border-t border-border-subtle' : undefined}>
            {hunkLines(hunk.oldText, hunk.newText).map((line, lineIndex) => (
              <div
                key={lineIndex}
                className={line.sign === '-' ? 'whitespace-pre-wrap break-all px-2 text-[var(--destructive-text)]' : 'whitespace-pre-wrap break-all px-2 text-success'}
              >
                <span aria-hidden className="select-none pr-2">{line.sign}</span>
                <span className="sr-only">{line.sign === '-' ? t('chat.approval.removed') : t('chat.approval.added')}</span>
                {line.text}
              </div>
            ))}
          </div>
        ))}
      </div>
      {preview.truncated && <p className="pt-1 text-caption text-text-muted">{t('chat.approval.previewTruncated')}</p>}
    </figure>
  )
}
