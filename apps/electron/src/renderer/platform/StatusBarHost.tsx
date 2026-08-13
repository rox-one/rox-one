/**
 * Status Bar host — occupies platform slot `status` (ADR-0001).
 *
 * Mounted at the bottom of AppShell's main column. Hidden when the flag is
 * off, and not mounted in compact layout or on the session-load error screen.
 *
 * Durable Local/Remote/Offline + sync, run/approval placeholders, permission
 * label, presence/usage placeholders. Transport/toolchain banners stay for
 * failed/installing states that need intervention.
 */
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { featureWorkbenchStatusBarV1Atom } from '@/atoms/unified-shell'
import { focusedSessionIdAtom } from '@/atoms/panel-stack'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { useTransportConnectionState } from '@/hooks/useTransportConnectionState'
import { cn } from '@/lib/utils'
import { buildStatusBarModel } from './status-model'

const STATUS_BAR_HEIGHT = 28

function permissionLabel(
  mode: string | null,
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
  const permissionMode = focusedSessionId
    ? sessionMetaMap.get(focusedSessionId)?.permissionMode ?? null
    : null

  const model = buildStatusBarModel({
    transportMode: transport?.mode,
    transportStatus: transport?.status,
    permissionMode,
  })

  return (
    <div
      data-slot="status"
      className="flex shrink-0 items-center justify-between gap-3 border-t border-border/60 bg-background px-3 text-[11px] text-muted-foreground"
      style={{ height: STATUS_BAR_HEIGHT }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn(model.workspaceMode === 'offline' && 'text-destructive')}>
          {workspaceModeLabel(model.workspaceMode, t)}
        </span>
        {model.syncOk && <span>{t('workbench.status.syncOk')}</span>}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <span>{t('workbench.status.runs', { count: model.runCount })}</span>
        <span>{t('workbench.status.approvals', { count: model.approvalCount })}</span>
      </div>
      <div className="flex min-w-0 items-center justify-end gap-2">
        <span>{permissionLabel(model.permissionMode, t)}</span>
        <span>{t('workbench.status.people', { count: model.peopleCount })}</span>
        <span>{t('workbench.status.agents', { count: model.agentCount })}</span>
        <span>{t('workbench.status.usagePlaceholder')}</span>
      </div>
    </div>
  )
}

export function StatusBarHost() {
  const enabled = useAtomValue(featureWorkbenchStatusBarV1Atom)
  if (!enabled) return null
  return <StatusBarInner />
}
