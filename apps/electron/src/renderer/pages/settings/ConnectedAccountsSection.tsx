/**
 * ConnectedAccountsSection — the per-person "Connected accounts" list on the
 * Profile (Accounts & Connections) settings page.
 *
 * It is a thin, honest view over the Identity Center fabric: IdentityStore
 * connections are listed with their status and signed out through
 * `identity.disconnect`; LLM connections owned by AI Settings are reflected as
 * read-only rows that link out instead of pretending to be disconnectable here.
 * There is no second credential path — connecting routes through
 * `identity.connect`, exactly the RPC the fabric already exposes.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { ServiceConnection, ServiceProvider } from '../../../shared/types'
import { SettingsCard, SettingsRow, SettingsSection } from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { connectionAccountSubtitle, connectionProviderLabel } from '@/lib/connection-labels'
import { navigate, routes } from '@/lib/navigate'
import { toErrorMessage } from '@/lib/errors'
import { isClaimableLive } from '@rox/core/rox2'
import { settingsPageActionResult } from './settings-rox2-surface'

/** Status → semantic tone. Shared with the page's Notes rows. */
export const connectionStatusTone: Record<ServiceConnection['status'], string> = {
  connected: 'text-success',
  syncing: 'text-accent',
  expired: 'text-warning',
  error: 'text-destructive',
  disconnected: 'text-muted-foreground',
}

/**
 * Providers this section may connect directly. Notes providers (siyuan-local /
 * siyuan-cloud) are deliberately omitted: the Notes section on the same page is
 * their sole owner, so they never appear twice.
 */
export const CONNECTABLE_PROVIDERS: ServiceProvider[] = [
  'github',
  'openai',
  'anthropic',
  'google',
  'slack',
  'custom',
]

export interface ConnectedAccountsSectionProps {
  /** Connections for the active profile/workspace, already scoped by the page. */
  connections: ServiceConnection[]
  /** Workspace the connections belong to; required to connect a new account. */
  workspaceId?: string
}

export function ConnectedAccountsSection({
  connections,
  workspaceId,
}: ConnectedAccountsSectionProps) {
  const { t } = useTranslation()
  const [formOpen, setFormOpen] = React.useState(false)
  const [provider, setProvider] = React.useState<ServiceProvider>('github')
  const [accountLabel, setAccountLabel] = React.useState('')
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [connecting, setConnecting] = React.useState(false)

  const statusText = (status: ServiceConnection['status']) => t(`settings.accounts.status.${status}`)

  const handleConnect = async () => {
    if (!workspaceId) return
    const gate = settingsPageActionResult({
      pageId: 'accounts',
      action: 'identity-connect',
      source: 'native',
      granted: true,
    })
    if (!isClaimableLive(gate)) return
    setConnecting(true)
    try {
      await window.electronAPI.identityConnect({
        provider,
        workspaceId,
        ...(accountLabel.trim() ? { accountLabel: accountLabel.trim() } : {}),
      })
      setAccountLabel('')
      setFormOpen(false)
      toast.success(t('settings.accounts.connected'))
    } catch (error) {
      toast.error(t('settings.accounts.connectFailed', { message: toErrorMessage(error) }))
    } finally {
      setConnecting(false)
    }
  }

  const handleSignOut = async (connectionId: string) => {
    const gate = settingsPageActionResult({
      pageId: 'accounts',
      action: 'connection-delete',
      source: 'native',
      granted: true,
    })
    if (!isClaimableLive(gate)) return
    setBusyId(connectionId)
    try {
      await window.electronAPI.identityDisconnect({ connectionId })
      toast.success(t('settings.accounts.disconnected'))
    } catch (error) {
      toast.error(t('settings.accounts.disconnectFailed', { message: toErrorMessage(error) }))
    } finally {
      setBusyId(null)
    }
  }

  const handleRefresh = async () => {
    try {
      await window.electronAPI.identityRefreshStatus(
        workspaceId ? { workspaceId } : undefined,
      )
    } catch (error) {
      toast.error(t('settings.accounts.refreshFailed', { message: toErrorMessage(error) }))
    }
  }

  return (
    <SettingsSection
      title={t('settings.accounts.connectedAccountsSection')}
      description={t('settings.accounts.connectedAccountsDesc')}
      action={
        <Button variant="ghost" size="sm" onClick={() => void handleRefresh()}>
          {t('settings.accounts.refresh')}
        </Button>
      }
    >
      <SettingsCard>
        {connections.length === 0 && (
          <SettingsRow
            label={t('settings.accounts.connectedAccountsEmpty')}
            wrapDescription
          />
        )}
        {connections.map((conn) => {
          const subtitle = connectionAccountSubtitle(
            conn.accountLabel,
            t('connections.account.connected'),
          )
          return (
            <SettingsRow
              key={conn.id}
              label={connectionProviderLabel(conn.provider, t)}
              description={conn.readOnly ? `${subtitle} · ${t('settings.accounts.managedInAi')}` : subtitle}
              wrapDescription
            >
              <span className={`text-xs ${connectionStatusTone[conn.status]}`}>
                {statusText(conn.status)}
              </span>
              {conn.readOnly ? (
                <Button size="sm" variant="ghost" onClick={() => navigate(routes.view.settings('ai'))}>
                  {t('settings.accounts.openAiSettings')}
                </Button>
              ) : conn.status !== 'disconnected' ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyId === conn.id}
                  onClick={() => void handleSignOut(conn.id)}
                >
                  {t('settings.accounts.signOut')}
                </Button>
              ) : null}
            </SettingsRow>
          )
        })}

        {!formOpen && (
          <SettingsRow
            label={t('settings.accounts.connectAccount')}
            description={t('settings.accounts.connectAccountHint')}
            wrapDescription
          >
            <Button
              size="sm"
              variant="secondary"
              disabled={!workspaceId}
              onClick={() => setFormOpen(true)}
            >
              {t('settings.accounts.connect')}
            </Button>
          </SettingsRow>
        )}

        {formOpen && (
          <form
            className="grid gap-3 px-4 pb-4 pt-1 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault()
              void handleConnect()
            }}
          >
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">
                {t('settings.accounts.connectProviderField')}
              </span>
              <Select
                value={provider}
                onValueChange={(value) => setProvider(value as ServiceProvider)}
              >
                <SelectTrigger
                  aria-label={t('settings.accounts.connectProviderField')}
                  className="h-8 w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONNECTABLE_PROVIDERS.map((candidate) => (
                    <SelectItem key={candidate} value={candidate}>
                      {connectionProviderLabel(candidate, t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">
                {t('settings.accounts.accountLabelField')}
              </span>
              <Input
                placeholder={t('settings.accounts.accountLabelPlaceholder')}
                value={accountLabel}
                onChange={(e) => setAccountLabel(e.target.value)}
                className="h-8"
              />
            </label>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" size="sm" variant="secondary" disabled={connecting || !workspaceId}>
                {t('settings.accounts.connect')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={connecting}
                onClick={() => {
                  setFormOpen(false)
                  setAccountLabel('')
                }}
              >
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        )}
      </SettingsCard>
    </SettingsSection>
  )
}