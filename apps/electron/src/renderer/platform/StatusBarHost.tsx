/**
 * StatusBarHost — `PanelSlot` `status`. Ready transport/runtime + permission
 * mode. Failures stay in the existing banners; do not reuse ToolbarStatusSlot.
 */

import { useTranslation } from 'react-i18next'
import { isSessionsNavigation } from '../../shared/types'
import { useNavigationState } from '@/contexts/NavigationContext'
import { useSessionOptionsFor } from '@/context/AppShellContext'
import { useTransportConnectionState } from '@/hooks/useTransportConnectionState'
import { useToolchainStatus } from '@/hooks/useToolchainStatus'
import {
  permissionModeI18nKey,
  statusBarRuntimeKind,
  statusBarTransportKind,
} from './status-bar-model'

export const STATUS_BAR_HEIGHT = 22

export function StatusBarHost() {
  const { t } = useTranslation()
  const connectionState = useTransportConnectionState()
  const { available, getTool } = useToolchainStatus()
  const navState = useNavigationState()
  const sessionId = isSessionsNavigation(navState) && navState.details?.type === 'session'
    ? navState.details.sessionId
    : ''
  const { options } = useSessionOptionsFor(sessionId || '__workbench-status__')
  const transport = statusBarTransportKind(connectionState)
  const runtime = statusBarRuntimeKind(available ? getTool('omp') : undefined)

  return (
    <footer
      role="status"
      aria-label={t('statusBar.title')}
      className="flex shrink-0 items-center gap-3 border-t border-border/40 px-3 text-[11px] text-muted-foreground"
      style={{ height: STATUS_BAR_HEIGHT }}
    >
      {transport !== 'hidden' && (
        <span>
          {t('statusBar.transport')}:{' '}
          {transport === 'connected' ? t('statusBar.transportConnected') : t('statusBar.transportLocal')}
        </span>
      )}
      {runtime === 'ready' && (
        <span>
          {t('statusBar.runtime')}: {t('statusBar.runtimeReady')}
        </span>
      )}
      <span className="ml-auto">
        {t('statusBar.permissionMode')}: {t(permissionModeI18nKey(options.permissionMode))}
      </span>
    </footer>
  )
}
