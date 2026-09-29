/**
 * ConnectionsOverview — one flat list of everything Rox is connected to,
 * built from real stores only (no placeholders):
 *  - workspace sources (MCP / API / local folders) from sourcesAtom + getSources
 *  - messengers from getMessagingConfig().runtime
 *  - service accounts from identityGetState
 *
 * Every row shows one normalized status (connected / error / not configured /
 * disabled), a primary action, and reconnect / remove where the store
 * supports it.
 */

import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { deriveConnectionStatus } from '@/components/ui/source-status-indicator'
import { MessagingPlatformIcon } from '@/components/messaging/MessagingPlatformIcon'
import { ReconnectCredentialDialog, reconnectFlavor } from '@/components/pages/PageSourceAuthBanner'
import { sourcesAtom } from '@/atoms/sources'
import { navigate, routes } from '@/lib/navigate'
import type { LoadedSource, MessagingPlatformRuntimeInfo, ServiceConnection } from '../../shared/types'

export type OverviewStatus = 'connected' | 'error' | 'notConfigured' | 'disabled' | 'pending'

const STATUS_DOT: Record<OverviewStatus, string> = {
  connected: 'bg-success',
  error: 'bg-destructive',
  notConfigured: 'bg-warning',
  disabled: 'bg-foreground/25',
  pending: 'bg-foreground/40',
}

const STATUS_TEXT: Record<OverviewStatus, string> = {
  connected: 'text-success',
  error: 'text-destructive',
  notConfigured: 'text-warning',
  disabled: 'text-muted-foreground',
  pending: 'text-muted-foreground',
}

export function sourceOverviewStatus(source: LoadedSource): OverviewStatus {
  if (source.config.enabled === false) return 'disabled'
  const status = deriveConnectionStatus(source)
  if (status === 'connected') return 'connected'
  if (status === 'failed') return 'error'
  if (status === 'needs_auth') return 'notConfigured'
  if (status === 'local_disabled') return 'disabled'
  return 'pending'
}

export function messagingOverviewStatus(runtime: MessagingPlatformRuntimeInfo | undefined): OverviewStatus {
  if (!runtime) return 'notConfigured'
  if (runtime.connected) return 'connected'
  if (runtime.state === 'error' || runtime.state === 'reconnect_required') return 'error'
  if (runtime.state === 'connecting') return 'pending'
  return runtime.configured ? 'error' : 'notConfigured'
}

export function serviceOverviewStatus(connection: ServiceConnection): OverviewStatus {
  if (connection.status === 'connected' || connection.status === 'syncing') return 'connected'
  if (connection.status === 'error') return 'error'
  if (connection.status === 'expired') return 'notConfigured'
  return 'disabled'
}

const MESSENGERS = ['telegram', 'discord', 'lark', 'wechat', 'whatsapp'] as const

function StatusBadge({ status }: { status: OverviewStatus }) {
  const { t } = useTranslation()
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 text-xs ${STATUS_TEXT[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden />
      {t(`connections.status.${status}`)}
    </span>
  )
}

export function OverviewRow({
  icon,
  title,
  subtitle,
  status,
  children,
  testId,
}: {
  icon: ReactNode
  title: string
  subtitle?: string
  status: OverviewStatus
  children?: ReactNode
  testId?: string
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3" data-testid={testId ?? 'connections-overview-row'}>
      <div className="flex h-6 w-6 shrink-0 items-center justify-center">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{title}</div>
        {subtitle ? <div className="truncate text-xs text-muted-foreground" title={subtitle}>{subtitle}</div> : null}
      </div>
      <StatusBadge status={status} />
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </li>
  )
}

export function OverviewGroup({
  title,
  count,
  action,
  children,
}: {
  title: string
  count?: number
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-sm font-semibold text-foreground">
          {title}
          {typeof count === 'number' ? <span className="ml-1.5 font-normal text-muted-foreground">{count}</span> : null}
        </h3>
        {action}
      </div>
      <ul className="divide-y divide-border/40 overflow-hidden rounded-[10px] bg-foreground/[0.02]">{children}</ul>
    </section>
  )
}

export function ConnectionsOverview({ workspaceId, reloadKey }: { workspaceId: string; reloadKey: number }) {
  const { t } = useTranslation()
  const atomSources = useAtomValue(sourcesAtom)
  const [sources, setSources] = useState<LoadedSource[]>(atomSources)
  const [runtime, setRuntime] = useState<Record<string, MessagingPlatformRuntimeInfo>>({})
  const [services, setServices] = useState<ServiceConnection[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [credentialTarget, setCredentialTarget] = useState<LoadedSource | null>(null)

  useEffect(() => {
    if (atomSources.length > 0) setSources(atomSources)
  }, [atomSources])

  const loadSources = useCallback(async () => {
    try {
      setSources(await window.electronAPI.getSources(workspaceId))
    } catch {
      /* keep last known list */
    }
  }, [workspaceId])

  const loadMessaging = useCallback(async () => {
    try {
      const cfg = await window.electronAPI.getMessagingConfig()
      setRuntime((cfg?.runtime ?? {}) as Record<string, MessagingPlatformRuntimeInfo>)
    } catch {
      setRuntime({})
    }
  }, [])

  const loadServices = useCallback(async () => {
    try {
      const state = await window.electronAPI.identityGetState({ workspaceId })
      setServices(state.connections)
    } catch {
      setServices([])
    }
  }, [workspaceId])

  useEffect(() => {
    void loadSources()
    void loadMessaging()
    void loadServices()
  }, [loadSources, loadMessaging, loadServices, reloadKey])

  useEffect(() => {
    const offSources = window.electronAPI.onSourcesChanged?.((wsId, next) => {
      if (wsId === workspaceId) setSources(next)
    })
    const offMessaging = window.electronAPI.onMessagingPlatformStatus?.((wsId, platform, status) => {
      if (wsId !== workspaceId) return
      setRuntime((current) => ({ ...current, [platform]: status }))
    })
    const offIdentity = window.electronAPI.onIdentityChanged?.(() => {
      void loadServices()
    })
    return () => {
      offSources?.()
      offMessaging?.()
      offIdentity?.()
    }
  }, [workspaceId, loadServices])

  const sortedSources = useMemo(
    () => [...sources].sort((a, b) => a.config.name.localeCompare(b.config.name)),
    [sources],
  )

  const reconnectSource = async (source: LoadedSource) => {
    const flavor = reconnectFlavor(source.config)
    const takesSingleSecret =
      (source.config.type === 'api' && source.config.api?.authType !== 'none') ||
      (source.config.type === 'mcp' && source.config.mcp?.authType === 'bearer')
    if (flavor === 'secret' && takesSingleSecret) {
      setCredentialTarget(source)
      return
    }
    if (flavor !== 'oauth') {
      navigate(routes.view.sources({ sourceSlug: source.config.slug }))
      return
    }
    setBusy(source.config.slug)
    try {
      const result = await window.electronAPI.performOAuth({ sourceSlug: source.config.slug })
      if (!result.success) {
        toast.error(t('toast.pageSourceReconnectFailed', { name: source.config.name }), {
          description: result.error,
        })
      }
      await loadSources()
    } catch (error) {
      toast.error(t('toast.pageSourceReconnectFailed', { name: source.config.name }), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(null)
    }
  }

  const removeSource = async (source: LoadedSource) => {
    setBusy(source.config.slug)
    try {
      await window.electronAPI.deleteSource(workspaceId, source.config.slug)
      toast.success(t('connections.overview.removed', { name: source.config.name }))
      setRemoving(null)
      await loadSources()
    } catch (error) {
      toast.error(t('connections.overview.removeFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(null)
    }
  }

  const disconnectService = async (connection: ServiceConnection) => {
    setBusy(connection.id)
    try {
      await window.electronAPI.identityDisconnect({ connectionId: connection.id })
      setRemoving(null)
      await loadServices()
    } catch (error) {
      toast.error(t('settings.accounts.disconnectFailed', {
        message: error instanceof Error ? error.message : String(error),
      }))
    } finally {
      setBusy(null)
    }
  }

  const confirmRemove = (id: string, onConfirm: () => void) =>
    removing === id ? (
      <>
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={busy === id} onClick={onConfirm}>
          {t('connections.overview.confirmRemove')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setRemoving(null)}>
          {t('common.cancel')}
        </Button>
      </>
    ) : (
      <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setRemoving(id)}>
        {t('common.remove')}
      </Button>
    )

  const sourceTypeLabel = (source: LoadedSource) => t(`connections.overview.sourceType.${source.config.type}`)

  return (
    <div className="space-y-6" data-testid="connections-overview">
      <OverviewGroup
        title={t('connections.overview.sources')}
        count={sortedSources.length}
        action={
          <Button size="sm" variant="ghost" onClick={() => navigate(routes.view.sources())}>
            {t('connections.overview.addSource')}
          </Button>
        }
      >
        {sortedSources.length === 0 ? (
          <li className="px-4 py-3 text-sm text-muted-foreground">{t('connections.overview.noSources')}</li>
        ) : (
          sortedSources.map((source) => {
            const status = sourceOverviewStatus(source)
            const slug = source.config.slug
            const subtitle = [sourceTypeLabel(source), source.config.connectionError || source.config.tagline]
              .filter(Boolean)
              .join(' · ')
            return (
              <OverviewRow
                key={slug}
                icon={<SourceAvatar source={source} size="sm" />}
                title={source.config.name}
                subtitle={subtitle}
                status={status}
              >
                {(status === 'error' || status === 'notConfigured') && source.config.type !== 'local' ? (
                  <Button size="sm" variant="secondary" disabled={busy === slug} onClick={() => void reconnectSource(source)}>
                    {status === 'notConfigured' ? t('connections.connect') : t('common.reconnect')}
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => navigate(routes.view.sources({ sourceSlug: slug }))}>
                    {t('common.open')}
                  </Button>
                )}
                {confirmRemove(`source:${slug}`, () => void removeSource(source))}
              </OverviewRow>
            )
          })
        )}
      </OverviewGroup>

      <OverviewGroup
        title={t('settings.messaging.title')}
        count={MESSENGERS.filter((platform) => runtime[platform]?.connected).length}
        action={
          <Button size="sm" variant="ghost" onClick={() => navigate(routes.view.settings('messaging'))}>
            {t('common.configure')}
          </Button>
        }
      >
        {MESSENGERS.map((platform) => {
          const info = runtime[platform]
          const status = messagingOverviewStatus(info)
          const subtitle = info?.connected
            ? info.identity || t(`settings.messaging.${platform}.connected`)
            : info?.lastError || t(`settings.messaging.${platform}.notConnected`)
          return (
            <OverviewRow
              key={platform}
              icon={<MessagingPlatformIcon platform={platform} size={20} />}
              title={t(`settings.messaging.${platform}.title`)}
              subtitle={subtitle}
              status={status}
            >
              <Button
                size="sm"
                variant={status === 'connected' ? 'ghost' : 'secondary'}
                onClick={() => navigate(routes.view.settings('messaging'))}
              >
                {status === 'connected'
                  ? t('common.configure')
                  : status === 'error'
                    ? t('common.reconnect')
                    : t('connections.connect')}
              </Button>
            </OverviewRow>
          )
        })}
      </OverviewGroup>

      <OverviewGroup
        title={t('connections.overview.accounts')}
        count={services.length}
        action={
          <Button size="sm" variant="ghost" onClick={() => navigate(routes.view.settings('accounts'))}>
            {t('common.configure')}
          </Button>
        }
      >
        {services.length === 0 ? (
          <li className="px-4 py-3 text-sm text-muted-foreground">{t('settings.accounts.noConnections')}</li>
        ) : (
          services.map((connection) => {
            const status = serviceOverviewStatus(connection)
            const key = `settings.accounts.provider.${connection.provider}`
            const label = t(key) === key ? String(connection.provider) : t(key)
            const managedElsewhere = connection.readOnly
            const target = connection.provider === 'siyuan-local'
              ? routes.view.settings('knowledge')
              : managedElsewhere
                ? routes.view.settings('ai')
                : routes.view.settings('accounts')
            return (
              <OverviewRow
                key={connection.id}
                icon={<span className="h-5 w-5 rounded-[5px] bg-foreground/10 text-center text-[11px] font-semibold leading-5 text-foreground/70">{label.slice(0, 1).toUpperCase()}</span>}
                title={label}
                subtitle={connection.accountLabel}
                status={status}
              >
                <Button
                  size="sm"
                  variant={status === 'connected' ? 'ghost' : 'secondary'}
                  onClick={() => navigate(target)}
                >
                  {status === 'connected' ? t('common.open') : t('common.reconnect')}
                </Button>
                {!managedElsewhere && connection.status !== 'disconnected'
                  ? confirmRemove(`service:${connection.id}`, () => void disconnectService(connection))
                  : null}
              </OverviewRow>
            )
          })
        )}
      </OverviewGroup>

      <ReconnectCredentialDialog
        workspaceId={workspaceId}
        source={credentialTarget}
        onClose={() => {
          setCredentialTarget(null)
          void loadSources()
        }}
      />
    </div>
  )
}
