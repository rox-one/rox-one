import { useTranslation } from 'react-i18next'
import { ScanSearch } from 'lucide-react'
import { cn } from '@/lib/utils'

export type InspectDestructiveKind = 'submit' | 'purchase' | 'publish'

export interface ElementInspectConfirmProps {
  inspectMode: boolean
  onToggleInspect: () => void
  comment?: string
  stale?: boolean
  pendingDestructiveKind?: InspectDestructiveKind | null
  previewPending?: boolean
  onApproveDestructive?: () => void
  onDenyDestructive?: () => void
  onApproveEdit?: () => void
  onDiscardEdit?: () => void
}

export function ElementInspectConfirm({
  inspectMode,
  onToggleInspect,
  comment,
  stale,
  pendingDestructiveKind,
  previewPending,
  onApproveDestructive,
  onDenyDestructive,
  onApproveEdit,
  onDiscardEdit,
}: ElementInspectConfirmProps) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-2 border-t border-border bg-background/90 px-3 py-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-pressed={inspectMode}
          aria-label={inspectMode ? t('browser.inspect.modeOff') : t('browser.inspect.modeOn')}
          onClick={onToggleInspect}
          className={cn(
            'h-7 w-7 flex items-center justify-center rounded-[6px]',
            inspectMode ? 'bg-foreground/10' : 'hover:bg-foreground/5',
          )}
        >
          <ScanSearch className="h-4 w-4 text-foreground/70" strokeWidth={1.7} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-foreground/80">{t('browser.inspect.title')}</p>
          <p className="text-[11px] text-muted-foreground">{t('browser.inspect.pageUnchanged')}</p>
        </div>
      </div>
      {comment ? (
        <p className="text-[12px] text-foreground/80">
          {t('browser.inspect.comment')}: {comment}
        </p>
      ) : null}
      {stale ? (
        <p className="text-[12px] text-amber-600">{t('browser.inspect.stale')}</p>
      ) : null}
      {previewPending ? (
        <div className="flex items-center gap-2">
          <p className="text-[12px] text-foreground/80">{t('browser.inspect.previewHint')}</p>
          <button type="button" className="text-[12px] underline" onClick={onApproveEdit}>
            {t('browser.inspect.approve')}
          </button>
          <button type="button" className="text-[12px] underline" onClick={onDiscardEdit}>
            {t('browser.inspect.discard')}
          </button>
        </div>
      ) : null}
      {pendingDestructiveKind ? (
        <div className="flex items-center gap-2">
          <p className="text-[12px] text-foreground/80">
            {t('browser.inspect.pendingDestructive', { kind: pendingDestructiveKind })}
          </p>
          <button type="button" className="text-[12px] underline" onClick={onApproveDestructive}>
            {t('browser.inspect.approveDestructive', { kind: pendingDestructiveKind })}
          </button>
          <button type="button" className="text-[12px] underline" onClick={onDenyDestructive}>
            {t('browser.inspect.deny')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
