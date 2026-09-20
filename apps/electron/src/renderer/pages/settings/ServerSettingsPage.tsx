/**
 * ServerSettingsPage
 *
 * Configure the Electron app to act as a remote server,
 * accessible from other machines on the network.
 */

import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Eye, EyeOff, AlertTriangle, RotateCw } from 'lucide-react'
import { toast } from 'sonner'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Spinner } from '@craft-agent/ui'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { ServerConfig, ServerStatus } from '@craft-agent/shared/config/server-config'
import { nativeSidecarHealthView, type NativeSidecarHealthView } from './native-sidecar-health'
import { settingsPageActionAllowed, settingsRuntimeSource } from './settings-rox2-surface'

import {
  SettingsSection,
  SettingsCard,
  SettingsCardFooter,
  SettingsRow,
  SettingsToggle,
  SettingsInputRow,
} from '@/components/settings'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'server',
}

interface ServerFormState {
  enabled: boolean
  port: string
  tlsCertPath: string
  tlsKeyPath: string
  token: string
}

function configToForm(config: ServerConfig): ServerFormState {
  return {
    enabled: config.enabled,
    port: String(config.port),
    tlsCertPath: config.tlsCertPath ?? '',
    tlsKeyPath: config.tlsKeyPath ?? '',
    token: config.token ?? '',
  }
}

function formToConfig(form: ServerFormState): ServerConfig {
  return {
    enabled: form.enabled,
    port: parseInt(form.port, 10) || 9100,
    tlsCertPath: form.tlsCertPath.trim() || undefined,
    tlsKeyPath: form.tlsKeyPath.trim() || undefined,
    token: form.token || undefined,
  }
}

export default function ServerSettingsPage() {
  const { t } = useTranslation()

  const [form, setForm] = useState<ServerFormState>({
    enabled: false,
    port: '9100',
    tlsCertPath: '',
    tlsKeyPath: '',
    token: '',
  })
  const [savedForm, setSavedForm] = useState<ServerFormState>(form)
  const [status, setStatus] = useState<ServerStatus | null>(null)
  const [sidecar, setSidecar] = useState<NativeSidecarHealthView>({ tone: 'off', detail: 'disabled' })
  // config-read is device-read: the server config, cert paths and token are
  // only read after the user explicitly grants it. Opening the page is not a grant.
  const [granted, setGranted] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [tokenVisible, setTokenVisible] = useState(false)
  const [error, setError] = useState<string>()

  const isDirty = JSON.stringify(form) !== JSON.stringify(savedForm)

  const loadSettings = useCallback(async (isGranted: boolean) => {
    const allowed = settingsPageActionAllowed({
      pageId: 'server',
      action: 'config-read',
      source: settingsRuntimeSource(),
      granted: isGranted,
    })
    if (!allowed) return
    setIsLoading(true)
    try {
      const [config, serverStatus, health] = await Promise.all([
        window.electronAPI.getServerConfig(),
        window.electronAPI.getServerStatus(),
        typeof window.electronAPI.getServerHealth === 'function'
          ? window.electronAPI.getServerHealth().catch(() => null)
          : Promise.resolve(null),
      ])
      const formState = configToForm(config)
      setForm(formState)
      setSavedForm(formState)
      setStatus(serverStatus)
      setSidecar(nativeSidecarHealthView(health?.checks))
    } catch (err) {
      console.error('Failed to load server settings:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!granted) return
    void loadSettings(granted)
  }, [granted, loadSettings])

  const handleSave = async () => {
    setError(undefined)
    const port = parseInt(form.port, 10)
    if (isNaN(port) || port < 1024 || port > 65535) {
      setError(t('settings.server.portValidation'))
      return
    }
    if (form.tlsCertPath && !form.tlsKeyPath) {
      setError(t('settings.server.privateKeyRequired'))
      return
    }
    if (form.tlsKeyPath && !form.tlsCertPath) {
      setError(t('settings.server.certificateRequired'))
      return
    }

    setIsSaving(true)
    try {
      const allowed = settingsPageActionAllowed({
        pageId: 'server',
        action: 'pref-write',
        source: settingsRuntimeSource(),
      })
      if (!allowed) {
        setIsSaving(false)
        return
      }
      await window.electronAPI.setServerConfig(formToConfig(form))
      setSavedForm(form)
      const newStatus = await window.electronAPI.getServerStatus()
      setStatus(newStatus)
      toast.success(t('settings.server.saved'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      toast.error(t('settings.server.failedToSave', { message: msg }))
    } finally {
      setIsSaving(false)
    }
  }

  const handleReset = () => {
    setForm(savedForm)
    setError(undefined)
  }

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    toast.success(t('settings.server.copiedToClipboard', { label }))
  }

  const handleBrowseCert = async () => {
    const allowed = settingsPageActionAllowed({
      pageId: 'server',
      action: 'config-read',
      source: settingsRuntimeSource(),
      granted,
    })
    if (!allowed) return
    const paths = await window.electronAPI.openFileDialog()
    if (paths.length > 0) {
      setForm(f => ({ ...f, tlsCertPath: paths[0]! }))
    }
  }

  const handleBrowseKey = async () => {
    const allowed = settingsPageActionAllowed({
      pageId: 'server',
      action: 'config-read',
      source: settingsRuntimeSource(),
      granted,
    })
    if (!allowed) return
    const paths = await window.electronAPI.openFileDialog()
    if (paths.length > 0) {
      setForm(f => ({ ...f, tlsKeyPath: paths[0]! }))
    }
  }

  const hasTls = !!(form.tlsCertPath && form.tlsKeyPath)
  const needsRestart = status?.needsRestart ?? false
  const showServerDetails = form.enabled || savedForm.enabled

  if (!granted || isLoading) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PanelHeader title={t("settings.server.title")} />
        <div className="flex-1 min-h-0 mask-fade-y">
          <ScrollArea className="h-full">
            <div className="px-5 py-7 max-w-3xl mx-auto space-y-5">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Spinner />
                </div>
              ) : (
                <SettingsSection title={t("settings.server.remoteAccess")}>
                  <SettingsCard className="px-4 py-3.5">
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {t("settings.server.loadConfigDesc")}
                      </p>
                      <Button size="sm" onClick={() => setGranted(true)}>
                        {t("settings.server.loadConfig")}
                      </Button>
                    </div>
                  </SettingsCard>
                </SettingsSection>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title={t("settings.server.title")} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
        <div className="px-5 py-7 max-w-3xl mx-auto space-y-5">

          {/* Enable toggle + restart banner */}
          <SettingsSection title={t("settings.server.remoteAccess")}>
            <SettingsCard>
              <SettingsToggle
                label={t("settings.server.enableServerMode")}
                description={t("settings.server.allowRemoteConnections")}
                checked={form.enabled}
                onCheckedChange={(enabled) => setForm(f => ({ ...f, enabled }))}
              />
            </SettingsCard>

            {needsRestart && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-warning/10 border border-warning/20 text-xs text-warning">
                <RotateCw className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1">{t("settings.server.restartRequired")}</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[11px] px-2"
                  onClick={() => {
                    const allowed = settingsPageActionAllowed({
                      pageId: 'server',
                      action: 'toggle',
                      source: settingsRuntimeSource(),
                    })
                    if (!allowed) return
                    window.electronAPI.relaunchApp()
                  }}
                >
                  {t("settings.server.restartNow")}
                </Button>
              </div>
            )}
          </SettingsSection>

          <SettingsSection title={t('settings.server.nativeSidecar')}>
            <SettingsCard>
              <SettingsRow
                label={t(
                  sidecar.tone === 'ok'
                    ? 'settings.server.nativeSidecarLive'
                    : sidecar.tone === 'fail'
                      ? 'settings.server.nativeSidecarDown'
                      : 'settings.server.nativeSidecarOff',
                )}
                description={t('settings.server.nativeSidecarHint')}
              >
                <span className="text-xs text-muted-foreground font-mono truncate max-w-[280px]" title={sidecar.detail}>
                  {sidecar.detail}
                </span>
              </SettingsRow>
            </SettingsCard>
          </SettingsSection>

          {/* Connection + TLS — only visible when server mode is relevant */}
          {showServerDetails && (
            <SettingsSection title={t("settings.server.connectionSection")}>
              <SettingsCard>
                <SettingsInputRow
                  label={t("settings.server.port")}
                  value={form.port}
                  onChange={(port) => setForm(f => ({ ...f, port }))}
                  placeholder="9100"
                />

                {status && form.enabled && (
                  <>
                    <SettingsRow label={t("common.url")}>
                      <div className="flex items-center gap-1.5">
                        <code className="text-xs font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">
                          {status.url}
                        </code>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleCopy(status.url, t('common.url'))}>
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </SettingsRow>

                    <SettingsRow label={t("settings.server.token")}>
                      <div className="flex items-center gap-1.5">
                        <code className="text-xs font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded max-w-[180px] truncate">
                          {tokenVisible ? status.token : '••••••••••••••••'}
                        </code>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setTokenVisible(v => !v)}>
                          {tokenVisible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleCopy(status.token, t('settings.server.token'))}>
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </SettingsRow>
                  </>
                )}

                <SettingsRow label={t("settings.server.certificate")}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                      {form.tlsCertPath || t('settings.server.notConfigured')}
                    </span>
                    <Button variant="outline" size="sm" className="h-6 text-[11px] px-2 shrink-0" onClick={handleBrowseCert}>
                      {t('common.browse')}
                    </Button>
                  </div>
                </SettingsRow>

                <SettingsRow label={t("settings.server.privateKey")}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                      {form.tlsKeyPath || t('settings.server.notConfigured')}
                    </span>
                    <Button variant="outline" size="sm" className="h-6 text-[11px] px-2 shrink-0" onClick={handleBrowseKey}>
                      {t('common.browse')}
                    </Button>
                  </div>
                </SettingsRow>
              </SettingsCard>

              {form.enabled && !hasTls && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-warning/10 border border-warning/20 text-xs text-warning">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>
                    {status?.insecureWarning
                      ? t("settings.server.insecureWarning")
                      : t("settings.server.noTlsWarning")}
                  </span>
                </div>
              )}
            </SettingsSection>
          )}

          {/* Save/Reset */}
          {error && (
            <p className="text-xs text-destructive px-1">{error}</p>
          )}
          {(isDirty || error) && (
            <SettingsCardFooter>
              <Button variant="outline" size="sm" onClick={handleReset} disabled={isSaving}>
                {t('common.reset')}
              </Button>
              <Button size="sm" onClick={handleSave} disabled={isSaving}>
                {isSaving ? <Spinner className="mr-1.5" /> : null}
                {t('common.save')}
              </Button>
            </SettingsCardFooter>
          )}

        </div>
      </ScrollArea>
      </div>
    </div>
  )
}
