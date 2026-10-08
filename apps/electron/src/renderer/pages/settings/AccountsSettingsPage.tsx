/**
 * AccountsSettingsPage — profile, service connections, Notes, and security.
 *
 * The Notes section is the sole owner of its cloud connection. Generic service
 * connections deliberately exclude Notes providers so users never see the same
 * connection represented twice.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { SettingsCard, SettingsRow, SettingsSection } from '@/components/settings'
import { Button } from '@/components/ui/button'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useActiveWorkspace } from '@/context/AppShellContext'
import type {
  CredentialHealthStatus,
  IdentityState,
  ServiceConnection,
  ServiceProvider,
} from '../../../shared/types'
import { navigate, routes } from '@/lib/navigate'
import { CredentialMigrationCard } from './CredentialMigrationCard'
import { isClaimableLive } from '@rox/core/rox2'
import { settingsPageActionResult } from './settings-rox2-surface'
import { toErrorMessage } from '@/lib/errors'
import { useNotesTitleKey } from '@/platform/useNotesTitleKey'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'accounts',
}

const STATUS_TONE: Record<ServiceConnection['status'], string> = {
  connected: 'text-success',
  syncing: 'text-accent',
  expired: 'text-warning',
  error: 'text-destructive',
  disconnected: 'text-muted-foreground',
}

function providerLabel(provider: ServiceProvider | string, t: (k: string) => string): string {
  const key = `settings.accounts.provider.${provider}`
  const translated = t(key)
  return translated === key ? String(provider) : translated
}


export default function AccountsSettingsPage() {
  const { t } = useTranslation()
  const notesTitleKey = useNotesTitleKey('sidebar.notes')
  const activeWorkspace = useActiveWorkspace()
  const workspaceId = activeWorkspace?.id

  const [state, setState] = React.useState<IdentityState | null>(null)
  const [displayName, setDisplayName] = React.useState('')
  const [savingProfile, setSavingProfile] = React.useState(false)
  const [health, setHealth] = React.useState<CredentialHealthStatus | null>(null)
  const [checkingHealth, setCheckingHealth] = React.useState(false)
  const [connecting, setConnecting] = React.useState(false)
  const [cloudLabel, setCloudLabel] = React.useState('')
  const [cloudToken, setCloudToken] = React.useState('')
  const [cloudFormOpen, setCloudFormOpen] = React.useState(false)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    try {
      const next = await window.electronAPI.identityGetState(
        workspaceId ? { workspaceId } : undefined,
      )
      setState(next)
      setDisplayName(next.profile.displayName)
    } catch (error) {
      toast.error(t('settings.accounts.loadFailed', { message: toErrorMessage(error) }))
    }
  }, [t, workspaceId])

  React.useEffect(() => {
    void load()
    const unsub = window.electronAPI.onIdentityChanged?.(() => {
      void load()
    })
    return () => {
      unsub?.()
    }
  }, [load])

  const runHealthCheck = React.useCallback(async () => {
    setCheckingHealth(true)
    try {
      const result = await window.electronAPI.getCredentialHealth()
      setHealth(result)
    } catch (error) {
      toast.error(t('settings.accounts.healthFailed', { message: toErrorMessage(error) }))
    } finally {
      setCheckingHealth(false)
    }
  }, [t])

  React.useEffect(() => {
    void runHealthCheck()
  }, [runHealthCheck])

  const handleSaveProfile = async () => {
    const trimmed = displayName.trim()
    if (!trimmed) return
    const gate = settingsPageActionResult({
      pageId: 'accounts',
      action: 'profile-write',
      source: 'native',
    })
    if (!isClaimableLive(gate)) return
    setSavingProfile(true)
    try {
      const next = await window.electronAPI.identityUpdateProfile({ displayName: trimmed })
      setState(next)
      toast.success(t('settings.accounts.profileSaved'))
    } catch (error) {
      toast.error(t('settings.accounts.profileSaveFailed', { message: toErrorMessage(error) }))
    } finally {
      setSavingProfile(false)
    }
  }

  const handleConnectCloud = async () => {
    if (!workspaceId) {
      toast.error(t('settings.accounts.noWorkspace'))
      return
    }
    const token = cloudToken.trim()
    if (!token) {
      toast.error(t('settings.accounts.tokenRequired'))
      return
    }
    const gate = settingsPageActionResult({
      pageId: 'accounts',
      action: 'identity-connect',
      source: 'native',
      granted: true,
    })
    if (!isClaimableLive(gate)) return
    setConnecting(true)
    try {
      const next = await window.electronAPI.identityConnect({
        provider: 'siyuan-cloud',
        workspaceId,
        accountLabel: cloudLabel.trim() || undefined,
        credentialValue: token,
        connectionId: 'svc-siyuan-cloud',
      })
      setState(next)
      setCloudToken('')
      setCloudFormOpen(false)
      toast.success(t('settings.accounts.connected'))
    } catch {
      setCloudToken('')
      toast.error(t('settings.accounts.connectFailed', { message: t('common.failed') }))
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = async (connectionId: string) => {
    const gate = settingsPageActionResult({
      pageId: 'accounts',
      action: 'connection-delete',
      source: 'native',
      granted: true,
    })
    if (!isClaimableLive(gate)) return
    setBusyId(connectionId)
    try {
      const next = await window.electronAPI.identityDisconnect({ connectionId })
      setState(next)
      toast.success(t('settings.accounts.disconnected'))
    } catch (error) {
      toast.error(t('settings.accounts.disconnectFailed', { message: toErrorMessage(error) }))
    } finally {
      setBusyId(null)
    }
  }

  const handleRefresh = async () => {
    try {
      const next = await window.electronAPI.identityRefreshStatus(
        workspaceId ? { workspaceId } : undefined,
      )
      setState(next)
    } catch (error) {
      toast.error(t('settings.accounts.refreshFailed', { message: toErrorMessage(error) }))
    }
  }

  const handleReset = async () => {
    try {
      const confirmed = await window.electronAPI.showLogoutConfirmation()
      if (!confirmed) return
      const gate = settingsPageActionResult({
        pageId: 'accounts',
        action: 'identity-reset',
        source: 'native',
        granted: true,
      })
      if (!isClaimableLive(gate)) return
      await window.electronAPI.logout()
      toast.success(t('settings.accounts.resetDone'))
      void load()
      void runHealthCheck()
    } catch (error) {
      toast.error(t('settings.accounts.resetFailed', { message: toErrorMessage(error) }))
    }
  }

  const connections = state?.connections ?? []
  const genericConnections = connections.filter(
    (connection) => connection.provider !== 'siyuan-cloud' && connection.provider !== 'siyuan-local',
  )
  const owned = genericConnections.filter((connection) => !connection.readOnly)
  const reflections = genericConnections.filter((connection) => connection.readOnly)
  const notesCloud = connections.find(
    (connection) => connection.provider === 'siyuan-cloud' && !connection.readOnly,
  )
  const notesLocal = connections.find((connection) => connection.provider === 'siyuan-local')
  const entitlement = state?.entitlements.find(
    (item) => item.provider === 'siyuan-cloud' && item.product === 'cloud-sync',
  )

  const healthOk = health ? health.healthy : null
  const issueCount = health?.issues?.length ?? 0
  const profileDirty = Boolean(state) && displayName.trim() !== (state?.profile.displayName ?? '').trim()
  const notesCloudActive = Boolean(notesCloud && notesCloud.status !== 'disconnected')
  const showCloudForm = cloudFormOpen

  const statusText = (status: ServiceConnection['status']) => t(`settings.accounts.status.${status}`)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title={t('settings.accounts.title')}
        actions={<HeaderMenu route={routes.view.settings('accounts')} />}
      />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="mx-auto w-full max-w-3xl space-y-8 px-5 py-7">
        {/* PROFILE */}
        <SettingsSection title={t('settings.accounts.profileSection')}>
          <SettingsCard>
            <SettingsRow
              label={t('settings.accounts.displayName')}
              description={t('settings.accounts.displayNameHint')}
              wrapDescription
            >
              <div className="flex items-center gap-2">
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && profileDirty) void handleSaveProfile()
                  }}
                  className="h-8 w-56"
                  aria-label={t('settings.accounts.displayName')}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void handleSaveProfile()}
                  disabled={savingProfile || !displayName.trim() || !profileDirty}
                >
                  {t('common.save')}
                </Button>
              </div>
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>

        {/* SERVICE CONNECTIONS */}
        <SettingsSection
          title={t('settings.accounts.connectionsSection')}
          action={
            <Button variant="ghost" size="sm" onClick={() => void handleRefresh()}>
              {t('settings.accounts.refresh')}
            </Button>
          }
        >
          <SettingsCard>
            {genericConnections.length === 0 && (
              <SettingsRow
                label={t('settings.accounts.notConnected')}
                description={t('settings.accounts.noConnections')}
                wrapDescription
              />
            )}
            {owned.map((conn) => (
              <SettingsRow
                key={conn.id}
                label={providerLabel(conn.provider, t)}
                description={conn.accountLabel || undefined}
              >
                <span className={`text-xs ${STATUS_TONE[conn.status]}`}>{statusText(conn.status)}</span>
                {conn.status !== 'disconnected' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyId === conn.id}
                    onClick={() => void handleDisconnect(conn.id)}
                  >
                    {t('settings.accounts.signOut')}
                  </Button>
                )}
              </SettingsRow>
            ))}
            {reflections.map((conn) => (
              <SettingsRow
                key={conn.id}
                label={providerLabel(conn.provider, t)}
                description={
                  conn.accountLabel
                    ? `${conn.accountLabel} · ${t('settings.accounts.managedInAi')}`
                    : t('settings.accounts.managedInAi')
                }
              >
                <span className={`text-xs ${STATUS_TONE[conn.status]}`}>{statusText(conn.status)}</span>
                <Button size="sm" variant="ghost" onClick={() => navigate(routes.view.settings('ai'))}>
                  {t('settings.accounts.openAiSettings')}
                </Button>
              </SettingsRow>
            ))}
          </SettingsCard>
        </SettingsSection>

        {/* NOTES — sole owner of Notes connection presentation */}
        <SettingsSection title={t(notesTitleKey)}>
          <SettingsCard>
            {notesLocal && (
              <SettingsRow
                label={t('settings.accounts.provider.siyuan-local')}
                description={
                  notesLocal.readOnly
                    ? t('settings.accounts.managedInKnowledge')
                    : notesLocal.accountLabel || undefined
                }
              >
                <span className={`text-xs ${STATUS_TONE[notesLocal.status]}`}>{statusText(notesLocal.status)}</span>
                {notesLocal.readOnly ? (
                  <Button size="sm" variant="ghost" onClick={() => navigate(routes.view.settings('knowledge'))}>
                    {t('settings.accounts.openKnowledgeSettings')}
                  </Button>
                ) : notesLocal.status !== 'disconnected' ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyId === notesLocal.id}
                    onClick={() => void handleDisconnect(notesLocal.id)}
                  >
                    {t('settings.accounts.signOut')}
                  </Button>
                ) : null}
              </SettingsRow>
            )}

            <SettingsRow
              label={t('settings.accounts.provider.siyuan-cloud')}
              description={
                notesCloudActive
                  ? notesCloud?.accountLabel || t('settings.accounts.notesCloudConnectedHint')
                  : t('settings.accounts.notesCloudHint')
              }
              wrapDescription
            >
              <span
                className={`text-xs ${notesCloud ? STATUS_TONE[notesCloud.status] : 'text-muted-foreground'}`}
              >
                {notesCloud ? statusText(notesCloud.status) : t('settings.accounts.notConnected')}
              </span>
              {!showCloudForm && (
                <Button
                  size="sm"
                  variant={notesCloudActive ? 'ghost' : 'secondary'}
                  disabled={connecting || !workspaceId}
                  onClick={() => {
                    setCloudLabel(notesCloud?.accountLabel || '')
                    setCloudToken('')
                    setCloudFormOpen(true)
                  }}
                >
                  {notesCloudActive ? t('settings.accounts.reconnect') : t('settings.accounts.connect')}
                </Button>
              )}
              {notesCloud && notesCloudActive && !showCloudForm && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyId === notesCloud.id}
                  onClick={() => void handleDisconnect(notesCloud.id)}
                >
                  {t('settings.accounts.signOut')}
                </Button>
              )}
            </SettingsRow>

            {entitlement && (
              <SettingsRow label={t('settings.accounts.subscription')}>
                <span className="text-sm text-muted-foreground">
                  {t(`settings.accounts.entitlement.${entitlement.status}`, {
                    product: entitlement.product,
                  })}
                </span>
              </SettingsRow>
            )}

            {showCloudForm && (
              <form
                className="grid gap-3 px-4 pb-4 pt-1 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  void handleConnectCloud()
                }}
              >
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">{t('settings.accounts.accountLabelField')}</span>
                  <Input
                    placeholder={t('settings.accounts.accountLabelPlaceholder')}
                    value={cloudLabel}
                    onChange={(e) => setCloudLabel(e.target.value)}
                    autoComplete="email"
                    className="h-8"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">{t('settings.accounts.tokenField')}</span>
                  <Input
                    placeholder={t('settings.accounts.tokenPlaceholder')}
                    value={cloudToken}
                    onChange={(e) => setCloudToken(e.target.value)}
                    type="password"
                    autoComplete="off"
                    className="h-8"
                  />
                </label>
                <p className="text-xs text-muted-foreground sm:col-span-2">{t('settings.accounts.tokenStorageHint')}</p>
                <div className="flex gap-2 sm:col-span-2">
                  <Button
                    type="submit"
                    size="sm"
                    variant="secondary"
                    disabled={connecting || !workspaceId || !cloudToken.trim()}
                  >
                    {notesCloudActive ? t('settings.accounts.reconnect') : t('settings.accounts.connect')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={connecting}
                    onClick={() => {
                      setCloudFormOpen(false)
                      setCloudToken('')
                    }}
                  >
                    {t('common.cancel')}
                  </Button>
                </div>
              </form>
            )}
          </SettingsCard>
        </SettingsSection>

        {/* ACCOUNT & SECURITY */}
        <SettingsSection
          title={t('settings.accounts.securitySection')}
          description={t('settings.accounts.localProfileDesc')}
        >
          <SettingsCard>
            <SettingsRow
              label={t('settings.accounts.roxServerUrl')}
              description={t('settings.accounts.roxServerUrlHint')}
              wrapDescription
            >
              <Button size="sm" variant="ghost" onClick={() => navigate(routes.view.settings('server'))}>
                {t('settings.accounts.openServerSettings')}
              </Button>
            </SettingsRow>
            <SettingsRow
              label={t('settings.accounts.credentialHealth')}
              description={
                health
                  ? t('settings.accounts.healthSummary', {
                      status: healthOk ? t('settings.accounts.healthOk') : t('settings.accounts.healthIssues'),
                      count: issueCount,
                    })
                  : t('settings.accounts.healthUnknown')
              }
              wrapDescription
            >
              <span className={`text-xs ${healthOk === null ? 'text-muted-foreground' : healthOk ? 'text-success' : 'text-warning'}`}>
                {healthOk === null ? '' : healthOk ? t('settings.accounts.healthOk') : t('settings.accounts.healthIssues')}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={checkingHealth}
                onClick={() => void runHealthCheck()}
              >
                {t('settings.accounts.runHealthCheck')}
              </Button>
            </SettingsRow>
            {health && issueCount > 0 && (
              <ul className="space-y-1 px-4 pb-3 text-xs text-muted-foreground">
                {health.issues.map((issue, index) => (
                  <li key={`${issue.type}-${index}`} className="break-words">
                    • {issue.message}
                  </li>
                ))}
              </ul>
            )}
          </SettingsCard>
          <CredentialMigrationCard />
          <SettingsCard>
            <SettingsRow
              label={t('settings.accounts.resetAppData')}
              description={t('settings.accounts.resetAppDataDesc')}
              wrapDescription
            >
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void handleReset()}>
                {t('settings.accounts.resetAppData')}
              </Button>
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
