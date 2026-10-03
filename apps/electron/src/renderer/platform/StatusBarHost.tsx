/**
 * Status Bar host — occupies platform slot `status` (ADR-0001).
 *
 * Mounted at the bottom of AppShell's main column. Hidden when the flag is
 * off, and not mounted in compact layout or on the session-load error screen.
 *
 * Durable Local/Remote/Offline + sync, live run/approval counts, permission
 * label, and a model-fallback note only when a switch actually happened.
 * Balance/cost live only in the sidebar profile strip; the old presence
 * ("0 человек 0 агентов"), unverified-fallback and usage placeholders are gone.
 * Transport/toolchain banners stay for failed/installing states that need
 * intervention.
 */
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { featureWorkbenchHarnessAgentIntelV1Atom, featureWorkbenchStatusBarV1Atom } from '@/atoms/unified-shell'
import { resolveModelFallbackStatus } from '@rox/shared/agent/model-fallback-status'
import { focusedSessionIdAtom } from '@/atoms/panel-stack'
import { backgroundTasksAtomFamily, sessionMetaMapAtom } from '@/atoms/sessions'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import { useTransportConnectionState } from '@/hooks/useTransportConnectionState'
import { cn } from '@/lib/utils'
import { buildStatusBarModel, countActiveRuns, countPendingApprovals, statusBarPermissionMode } from './status-model'
import { CHROME_DENSITY } from './chrome-density'

const STATUS_BAR_HEIGHT = CHROME_DENSITY.statusBarHeight

function permissionLabel(
  mode: string,
  t: (key: string) => string,
): string {
  switch (mode) {
    case 'safe':
      return t('workbench.status.permission.safe')
    case 'ask':
      return t('workbench.status.permission.ask')
    case 'allow-all':
      return t('workbench.status.permission.allow-all')
    default:
      return t('workbench.status.permission')
  }
}

function workspaceModeLabel(
  mode: 'local' | 'remote' | 'offline',
  t: (key: string) => string,
): string {
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

function StatusBarInner() {
  const { t } = useTranslation()
  const transport = useTransportConnectionState()
  const focusedSessionId = useAtomValue(focusedSessionIdAtom)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const tasks = useAtomValue(backgroundTasksAtomFamily(focusedSessionId ?? ''))
  const pendingPermissions = useOptionalAppShellContext()?.pendingPermissions
  const focusedMeta = focusedSessionId ? sessionMetaMap.get(focusedSessionId) : undefined
  const permissionMode = statusBarPermissionMode(
    focusedSessionId,
    focusedMeta?.permissionMode,
  )
  const agentIntelEnabled = useAtomValue(featureWorkbenchHarnessAgentIntelV1Atom)
  const fallback = agentIntelEnabled ? resolveModelFallbackStatus(null) : null

  const model = buildStatusBarModel({
    transportMode: transport?.mode,
    transportStatus: transport?.status,
    permissionMode,
    runCount: countActiveRuns(tasks),
    approvalCount: countPendingApprovals(pendingPermissions),
    costUsd: focusedMeta?.tokenUsage?.costUsd ?? null,
  })

  return (
    <div
      data-slot="status"
      className="chrome-strip chrome-label-sm flex shrink-0 items-center justify-between gap-2 px-2.5 text-muted-foreground"
      style={{ height: STATUS_BAR_HEIGHT }}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={cn(model.workspaceMode === 'offline' && 'text-destructive')}>
          {workspaceModeLabel(model.workspaceMode, t)}
        </span>
        {model.syncOk && <span>{t('workbench.status.syncOk')}</span>}
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        <span>{t('workbench.status.runs', { count: model.runCount })}</span>
        <span>{t('workbench.status.approvals', { count: model.approvalCount })}</span>
      </div>
      <div className="flex min-w-0 items-center justify-end gap-1.5">
        {model.permissionMode ? <span>{permissionLabel(model.permissionMode, t)}</span> : null}
        {fallback?.kind === 'switched' && (
          <span data-testid="status-bar-fallback">
            {t('workbench.status.fallbackSwitched', { model: fallback.model })}
          </span>
        )}
      </div>
    </div>
  )
}

export function StatusBarHost() {
  const enabled = useAtomValue(featureWorkbenchStatusBarV1Atom)
  if (!enabled) return null
  return <StatusBarInner />
}
