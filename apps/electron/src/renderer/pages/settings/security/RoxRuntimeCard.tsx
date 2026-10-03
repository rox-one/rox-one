import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Cpu, RefreshCw } from 'lucide-react'
import { RPC_CHANNELS, type ToolchainToolStatus } from '../../../../shared/types'
import { useAppShellContext } from '@/context/AppShellContext'
import { SettingsCard, SettingsSection } from '@/components/settings'
import { Button } from '@/components/ui/button'
import { navigate, routes } from '@/lib/navigate'
import { createSecurityResource, type SecurityResourceState } from './security-resource'

export function RoxRuntimeCard({ workspaceId, remote }: { workspaceId?: string; remote: boolean }) {
  const { t } = useTranslation()
  const { llmConnections } = useAppShellContext()
  const connection = llmConnections.find(item => item.isDefault) ?? llmConnections[0]
  const [resource, setResource] = React.useState<SecurityResourceState<ToolchainToolStatus | null>>({ scope: null, phase: 'loading', data: null })
  const [updating, setUpdating] = React.useState(false)
  const [updateFailed, setUpdateFailed] = React.useState(false)
  const loader = React.useMemo(() => createSecurityResource(setResource), [])
  const mounted = React.useRef(false)
  const scope = React.useRef({ workspaceId, generation: 0 })
  if (scope.current.workspaceId !== workspaceId) scope.current = { workspaceId, generation: scope.current.generation + 1 }
  const refresh = React.useCallback(() => {
    const api = window.electronAPI
    const canRead = typeof api?.getToolchainStatus === 'function'
      && (typeof api.isChannelAvailable !== 'function' || api.isChannelAvailable(RPC_CHANNELS.toolchain.STATUS))
    return loader.read(workspaceId ?? null, canRead ? async () => (await api.getToolchainStatus()).find(tool => tool.name === 'omp') ?? null : undefined)
  }, [loader, workspaceId])

  React.useEffect(() => {
    mounted.current = true
    const subscriptionScope = scope.current
    setUpdating(false); setUpdateFailed(false)
    void refresh()
    const unsubscribe = window.electronAPI?.onToolchainStatusChanged?.(tool => {
      if (mounted.current && scope.current === subscriptionScope && workspaceId && tool.name === 'omp') loader.replace(workspaceId, tool)
    })
    return () => { mounted.current = false; loader.cancel(); unsubscribe?.() }
  }, [loader, refresh, workspaceId])

  const current = resource.scope === (workspaceId ?? null) ? resource : { phase: 'loading' as const, data: null }
  const tool = current.data
  const canUpdate = !remote && typeof window.electronAPI?.updateToolchainTool === 'function'
    && window.electronAPI?.isChannelAvailable?.(RPC_CHANNELS.toolchain.UPDATE) === true
  const update = async () => {
    if (!workspaceId || !canUpdate || updating) return
    const operationScope = scope.current
    setUpdating(true); setUpdateFailed(false)
    try {
      const result = await window.electronAPI.updateToolchainTool('omp')
      if (mounted.current && scope.current === operationScope) loader.replace(workspaceId, result)
    } catch { if (mounted.current && scope.current === operationScope) setUpdateFailed(true) }
    finally { if (mounted.current && scope.current === operationScope) setUpdating(false) }
  }
  const actionable = tool && ['missing', 'error', 'outdated', 'offline'].includes(tool.phase)
  const status = current.phase === 'loading' ? t('security.loading')
    : current.phase === 'failed' ? t('security.rox.loadFailed')
    : current.phase === 'unavailable' || !tool ? t('security.rox.statusUnavailable')
    : tool.phase === 'ready' ? t('security.rox.ready') : t(`settings.toolchain.status.${tool.phase}`)

  return <SettingsSection title={t('security.rox.title')}>
    <SettingsCard divided={false} className="p-4" >
      <section data-testid="security-rox-runtime" aria-label={t('security.rox.title')} className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Cpu className="size-5" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{t('security.rox.description')}</p>
            <p role="status" aria-live="polite" data-testid="security-rox-status" className="mt-1 text-sm text-muted-foreground">{status}{tool?.installedVersion ? ` · v${tool.installedVersion}` : ''}</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t('security.rox.readyHint')}</p>
        {connection && <dl className="grid min-w-0 gap-3 rounded-lg bg-muted/40 p-3 sm:grid-cols-2">
          <div className="min-w-0"><dt className="text-xs text-muted-foreground">{t('settings.runtime.llmProvider')}</dt><dd className="mt-1 break-words text-sm font-medium">{connection.providerType === 'omp' ? 'Rox' : connection.name}</dd></div>
          <div className="min-w-0"><dt className="text-xs text-muted-foreground">{t('security.rox.model')}</dt><dd className="mt-1 break-words text-sm font-medium">{connection.defaultModel ?? t('security.rox.modelNotSelected')}</dd></div>
        </dl>}
        {updateFailed && <p role="alert" className="text-sm text-destructive">{t('security.rox.updateFailed')}</p>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={current.phase === 'loading' || updating || !workspaceId} onClick={() => void refresh()}><RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" />{t('security.rox.refresh')}</Button>
          {actionable && canUpdate && <Button size="sm" disabled={updating} onClick={() => void update()}>{updating ? t('security.loading') : tool.phase === 'missing' ? t('settings.toolchain.install') : tool.phase === 'outdated' ? t('settings.toolchain.updateNow') : t('settings.toolchain.retry')}</Button>}
          <Button size="sm" variant="ghost" onClick={() => navigate(routes.view.settings('runtime'))}>{t('security.rox.settings')}</Button>
        </div>
      </section>
    </SettingsCard>
  </SettingsSection>
}
