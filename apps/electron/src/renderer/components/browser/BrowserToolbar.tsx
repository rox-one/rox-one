/**
 * BrowserToolbar
 *
 * Electron-specific wrapper around the shared BrowserControls component.
 * Derives control state from BrowserInstanceInfo.
 */

import { BrowserControls } from '@craft-agent/ui'
import type { BrowserInstanceInfo } from '../../../shared/types'
import { ElementInspectConfirm, type InspectDestructiveKind } from './ElementInspectConfirm'

interface BrowserToolbarProps {
  instanceInfo: BrowserInstanceInfo | null
  onNavigate: (url: string) => void
  onGoBack: () => void
  onGoForward: () => void
  onReload: () => void
  onStop: () => void
  compact?: boolean
  inspectMode?: boolean
  onToggleInspect?: () => void
  pendingDestructiveKind?: InspectDestructiveKind | null
  previewPending?: boolean
  comment?: string
  stale?: boolean
  onApproveDestructive?: () => void
  onDenyDestructive?: () => void
  onApproveEdit?: () => void
  onDiscardEdit?: () => void
}

export function BrowserToolbar({
  instanceInfo,
  onNavigate,
  onGoBack,
  onGoForward,
  onReload,
  onStop,
  compact = false,
  inspectMode = false,
  onToggleInspect,
  pendingDestructiveKind = null,
  previewPending = false,
  comment,
  stale,
  onApproveDestructive,
  onDenyDestructive,
  onApproveEdit,
  onDiscardEdit,
}: BrowserToolbarProps) {
  return (
    <div className="flex min-w-0 flex-col">
      <BrowserControls
        url={instanceInfo?.url ?? ''}
        loading={instanceInfo?.isLoading ?? false}
        canGoBack={instanceInfo?.canGoBack ?? false}
        canGoForward={instanceInfo?.canGoForward ?? false}
        onNavigate={onNavigate}
        onGoBack={onGoBack}
        onGoForward={onGoForward}
        onReload={onReload}
        onStop={onStop}
        compact={compact}
        showProgressBar={!compact}
        className={
          compact
            ? 'h-auto px-1.5 py-0.5 rounded-[8px] border border-foreground/10 bg-background/70 min-w-0'
            : 'h-auto px-2 py-1.5 border-b border-border bg-background/80'
        }
      />
      {onToggleInspect ? (
        <ElementInspectConfirm
          inspectMode={inspectMode}
          onToggleInspect={onToggleInspect}
          comment={comment}
          stale={stale}
          pendingDestructiveKind={pendingDestructiveKind}
          previewPending={previewPending}
          onApproveDestructive={onApproveDestructive}
          onDenyDestructive={onDenyDestructive}
          onApproveEdit={onApproveEdit}
          onDiscardEdit={onDiscardEdit}
        />
      ) : null}
    </div>
  )
}
