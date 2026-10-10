/**
 * DISPATCH A6 — compact bottom status bar.
 *
 * A ~24px strip at the bottom of the shell. Left: the workspace/sync state from
 * the existing transport source (same labels and model as StatusBarHost).
 * Right: the Rox balance from the shared account snapshot (no new request) and
 * the app version from the existing update channel (`getUpdateInfo`).
 *
 * Visibility is owned by the «Интерфейс» preference (`ui.statusBar`, default
 * visible); AppShell mounts this only when it is on and the layout is not
 * compact.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useTransportConnectionState } from '@/hooks/useTransportConnectionState'
import { cn } from '@/lib/utils'
import { buildStatusBarModel, type WorkspaceRuntimeMode } from '@/platform/status-model'
import { CHROME_DENSITY } from '@/platform/chrome-density'
import type { RoxAccountSnapshot } from '@rox/shared/auth'

const STATUS_BAR_HEIGHT = CHROME_DENSITY.statusBarHeight

function workspaceModeLabel(mode: WorkspaceRuntimeMode, t: (key: string) => string): string {
  switch (mode) {
    case 'local':
      return t('workbench.status.local')
    case 'remote':
      return t('workbench.status.remote')
    case 'offline':
      return t('workbench.status.offline')
    default: {
      const _exhaustive: never = mode
      return _exhaustive
    }
  }
}

export function StatusBar({ account }: { account: RoxAccountSnapshot | null }) {
  const { t } = useTranslation()
  const transport = useTransportConnectionState()
  const [version, setVersion] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    const api = window.electronAPI
    if (!api?.getUpdateInfo) return () => { cancelled = true }
    void api.getUpdateInfo()
      .then(info => { if (!cancelled) setVersion(info?.currentVersion ?? null) })
      .catch(() => { if (!cancelled) setVersion(null) })
    return () => { cancelled = true }
  }, [])

  const model = buildStatusBarModel({ transportMode: transport?.mode, transportStatus: transport?.status })
  const balance = account ? Number(account.balance.availableRox) : null
  const balanceKnown = balance !== null && Number.isFinite(balance)

  return (
    <div
      data-slot="status"
      data-testid="compact-status-bar"
      className="chrome-strip chrome-label-sm label-tracking flex shrink-0 items-center justify-between gap-2 px-2.5 text-muted-foreground"
      style={{ height: STATUS_BAR_HEIGHT }}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={cn(model.workspaceMode === 'offline' && 'text-destructive')}>
          {workspaceModeLabel(model.workspaceMode, t)}
        </span>
        <span>{model.syncOk ? t('workbench.status.syncOk') : t('workbench.status.offline')}</span>
      </div>
      <div className="flex min-w-0 items-center justify-end gap-1.5">
        <span data-testid="status-bar-balance" className="numeric">
          {t('profile.balanceLabel')} {balanceKnown ? t('profile.balance', { amount: balance }) : t('profile.balanceUnknown')}
        </span>
        {version ? (
          <span data-testid="status-bar-version" className="numeric">
            {t('statusBar.version', { version })}
          </span>
        ) : null}
      </div>
    </div>
  )
}