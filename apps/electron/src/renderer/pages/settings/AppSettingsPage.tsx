/**
 * AppSettingsPage
 *
 * Global app-level settings that apply across all workspaces.
 *
 * Settings:
 * - Notifications
 * - Network (proxy)
 * - About (version, updates)
 *
 * Note: AI settings (connections, model, thinking) have been moved to AiSettingsPage.
 * Note: Appearance settings (theme, font) have been moved to AppearanceSettingsPage.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { routes } from '@/lib/navigate'
import { Spinner } from '@rox/ui'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { NetworkProxySettings } from '../../../shared/types'

import {
  SettingsSection,
  SettingsCard,
  SettingsCardFooter,
  SettingsRow,
  SettingsToggle,
  SettingsInput,
} from '@/components/settings'
import { useUpdateChecker } from '@/hooks/useUpdateChecker'
import { EnvironmentSettingsSection } from './EnvironmentSettingsSection'
import { isClaimableLive } from '@rox/core/rox2'
import { settingsPageActionResult } from './settings-rox2-surface'
import { toast } from 'sonner'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'app',
}

// ============================================
// Proxy form helpers
// ============================================

interface ProxyFormState {
  enabled: boolean
  httpProxy: string
  httpsProxy: string
  noProxy: string
}

const EMPTY_PROXY_FORM: ProxyFormState = {
  enabled: false,
  httpProxy: '',
  httpsProxy: '',
  noProxy: '',
}

function toProxyFormState(settings?: NetworkProxySettings): ProxyFormState {
  if (!settings) return EMPTY_PROXY_FORM
  return {
    enabled: settings.enabled,
    httpProxy: settings.httpProxy ?? '',
    httpsProxy: settings.httpsProxy ?? '',
    noProxy: settings.noProxy ?? '',
  }
}

function toNetworkProxySettings(form: ProxyFormState): NetworkProxySettings {
  return {
    enabled: form.enabled,
    httpProxy: form.httpProxy.trim() || undefined,
    httpsProxy: form.httpsProxy.trim() || undefined,
    noProxy: form.noProxy.trim() || undefined,
  }
}

function validateProxyUrl(url: string): string | undefined {
  if (!url.trim()) return undefined
  try {
    const parsed = new URL(url.trim())
    if (!['http:', 'https:', 'socks4:', 'socks5:'].includes(parsed.protocol)) {
      return 'proxyErrorProtocol'
    }
    return undefined
  } catch {
    return 'proxyErrorFormat'
  }
}

type AppPreferenceKey = 'notifications' | 'keepAwake' | 'browserTool'
type FailedPreference = { value: boolean; message: string }

// ============================================
// Main Component
// ============================================

export default function AppSettingsPage() {
  const { t } = useTranslation()

  // Notifications state
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)

  // Power state
  const [keepAwakeEnabled, setKeepAwakeEnabled] = useState(false)

  // Tools state
  const [browserToolEnabled, setBrowserToolEnabled] = useState(true)
  const [failedPreferences, setFailedPreferences] = useState<Partial<Record<AppPreferenceKey, FailedPreference>>>({})
  const preferenceGeneration = useRef<Record<AppPreferenceKey, number>>({
    notifications: 0,
    keepAwake: 0,
    browserTool: 0,
  })
  const persistedPreferences = useRef<Record<AppPreferenceKey, boolean>>({
    notifications: true,
    keepAwake: false,
    browserTool: true,
  })
  const preferenceQueues = useRef<Record<AppPreferenceKey, Promise<void>>>({
    notifications: Promise.resolve(),
    keepAwake: Promise.resolve(),
    browserTool: Promise.resolve(),
  })

  // Proxy state
  const [proxyForm, setProxyForm] = useState<ProxyFormState>(EMPTY_PROXY_FORM)
  const [savedProxyForm, setSavedProxyForm] = useState<ProxyFormState>(EMPTY_PROXY_FORM)
  const [proxyError, setProxyError] = useState<string | undefined>()
  const [isSavingProxy, setIsSavingProxy] = useState(false)

  // Auto-update state (Check Now / Update Ready only shown in Electron, not WebUI)
  const isElectron = window.electronAPI.getRuntimeEnvironment() === 'electron'
  const updateChecker = useUpdateChecker()
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false)

  const handleCheckForUpdates = useCallback(async () => {
    setIsCheckingForUpdates(true)
    try {
      await updateChecker.checkForUpdates()
    } finally {
      setIsCheckingForUpdates(false)
    }
  }, [updateChecker])

  const setPreferenceValue = useCallback((key: AppPreferenceKey, value: boolean) => {
    if (key === 'notifications') setNotificationsEnabled(value)
    else if (key === 'keepAwake') setKeepAwakeEnabled(value)
    else setBrowserToolEnabled(value)
  }, [])

  const readPreference = useCallback(async (key: AppPreferenceKey): Promise<boolean> => {
    if (key === 'notifications') return window.electronAPI.getNotificationsEnabled()
    if (key === 'keepAwake') return window.electronAPI.getKeepAwakeWhileRunning()
    return window.electronAPI.getBrowserToolEnabled()
  }, [])

  // Load settings on mount
  const loadSettings = useCallback(async () => {
    if (!window.electronAPI) return
    const loadGeneration = { ...preferenceGeneration.current }
    try {
      const [notificationsOn, keepAwakeOn, browserToolOn, proxySettings] = await Promise.all([
        window.electronAPI.getNotificationsEnabled(),
        window.electronAPI.getKeepAwakeWhileRunning(),
        window.electronAPI.getBrowserToolEnabled(),
        window.electronAPI.getNetworkProxySettings(),
      ])
      if (preferenceGeneration.current.notifications === loadGeneration.notifications) {
        persistedPreferences.current.notifications = notificationsOn
        setNotificationsEnabled(notificationsOn)
      }
      if (preferenceGeneration.current.keepAwake === loadGeneration.keepAwake) {
        persistedPreferences.current.keepAwake = keepAwakeOn
        setKeepAwakeEnabled(keepAwakeOn)
      }
      if (preferenceGeneration.current.browserTool === loadGeneration.browserTool) {
        persistedPreferences.current.browserTool = browserToolOn
        setBrowserToolEnabled(browserToolOn)
      }
      const form = toProxyFormState(proxySettings)
      setProxyForm(form)
      setSavedProxyForm(form)
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
  }, [])


  useEffect(() => {
    loadSettings()
  }, [])

  const savePreference = useCallback(async (key: AppPreferenceKey, value: boolean) => {
    if (!window.electronAPI) return
    const gate = settingsPageActionResult({ pageId: 'app', action: 'pref-write', source: 'native' })
    if (!isClaimableLive(gate)) return

    const generation = ++preferenceGeneration.current[key]
    setPreferenceValue(key, value)
    setFailedPreferences((previous) => {
      const next = { ...previous }
      delete next[key]
      return next
    })

    const queuedWrite = preferenceQueues.current[key]
      .catch(() => undefined)
      .then(async () => {
        if (key === 'notifications') await window.electronAPI.setNotificationsEnabled(value)
        else if (key === 'keepAwake') await window.electronAPI.setKeepAwakeWhileRunning(value)
        else await window.electronAPI.setBrowserToolEnabled(value)
        persistedPreferences.current[key] = value
      })
    preferenceQueues.current[key] = queuedWrite.then(() => undefined, () => undefined)

    try {
      await queuedWrite
      if (preferenceGeneration.current[key] === generation) {
        setFailedPreferences((previous) => {
          const next = { ...previous }
          delete next[key]
          return next
        })
      }
    } catch (error) {
      if (preferenceGeneration.current[key] !== generation) return
      let persistedValue = persistedPreferences.current[key]
      try {
        persistedValue = await readPreference(key)
      } catch {
        // Keep the last confirmed value when a follow-up read is also unavailable.
      }
      if (preferenceGeneration.current[key] !== generation) return
      persistedPreferences.current[key] = persistedValue
      setPreferenceValue(key, persistedValue)

      const settingLabel = key === 'notifications'
        ? t('settings.notifications.desktopNotifications')
        : key === 'keepAwake'
          ? t('settings.power.keepScreenAwake')
          : t('settings.tools.builtInBrowser')
      const message = error instanceof Error ? error.message : t('toast.unknownError')
      setFailedPreferences((previous) => ({ ...previous, [key]: { value, message } }))
      toast.error(t('toast.failedToSaveSetting', { setting: settingLabel }), { description: message })
    }
  }, [readPreference, setPreferenceValue, t])

  const handleNotificationsEnabledChange = useCallback(
    (enabled: boolean) => { void savePreference('notifications', enabled) },
    [savePreference],
  )

  const handleKeepAwakeEnabledChange = useCallback(
    (enabled: boolean) => { void savePreference('keepAwake', enabled) },
    [savePreference],
  )

  const handleBrowserToolEnabledChange = useCallback(
    (enabled: boolean) => { void savePreference('browserTool', enabled) },
    [savePreference],
  )

  // Proxy handlers
  const isProxyDirty = useMemo(() => {
    return JSON.stringify(proxyForm) !== JSON.stringify(savedProxyForm)
  }, [proxyForm, savedProxyForm])

  const handleSaveProxy = useCallback(async () => {
    // Validate URLs
    const httpErr = validateProxyUrl(proxyForm.httpProxy)
    const httpsErr = validateProxyUrl(proxyForm.httpsProxy)
    if (httpErr || httpsErr) {
      setProxyError(httpErr || httpsErr)
      return
    }
    setProxyError(undefined)
    const gate = settingsPageActionResult({ pageId: 'app', action: 'pref-write', source: 'native' })
    if (!isClaimableLive(gate)) {
      setProxyError(t('settings.rox2.grantRequired'))
      return
    }
    setIsSavingProxy(true)
    try {
      const settings = toNetworkProxySettings(proxyForm)
      await window.electronAPI.setNetworkProxySettings(settings)
      // Re-read persisted state to confirm
      const persisted = await window.electronAPI.getNetworkProxySettings()
      const form = toProxyFormState(persisted)
      setProxyForm(form)
      setSavedProxyForm(form)
    } catch (error) {
      setProxyError(error instanceof Error ? error.message : t('settings.network.failedToSave'))
    } finally {
      setIsSavingProxy(false)
    }
  }, [proxyForm, t])

  const handleResetProxy = useCallback(() => {
    setProxyForm(savedProxyForm)
    setProxyError(undefined)
  }, [savedProxyForm])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title={t("settings.app.title")} actions={<HeaderMenu route={routes.view.settings('app')} helpFeature="app-settings" />} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
            <div className="space-y-8">
              <EnvironmentSettingsSection />

              {/* Notifications */}
              <SettingsSection title={t("settings.notifications.title")}>
                <SettingsCard>
                  <SettingsToggle
                    label={t("settings.notifications.desktopNotifications")}
                    description={t("settings.notifications.desktopNotificationsDesc")}
                    checked={notificationsEnabled}
                    onCheckedChange={handleNotificationsEnabledChange}
                  />
                  {failedPreferences.notifications && (
                    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3 text-sm text-destructive">
                      <span className="min-w-0 whitespace-normal break-words">
                        {t('toast.failedToSaveSetting', { setting: t('settings.notifications.desktopNotifications') })}: {failedPreferences.notifications.message}
                      </span>
                      <Button size="sm" variant="outline" onClick={() => {
                        const failed = failedPreferences.notifications
                        if (failed) void savePreference('notifications', failed.value)
                      }}>
                        {t('common.retry')}
                      </Button>
                    </div>
                  )}
                </SettingsCard>
              </SettingsSection>

              {/* Power */}
              <SettingsSection title={t("settings.power.title")}>
                <SettingsCard>
                  <SettingsToggle
                    label={t("settings.power.keepScreenAwake")}
                    description={t("settings.power.keepScreenAwakeDesc")}
                    checked={keepAwakeEnabled}
                    onCheckedChange={handleKeepAwakeEnabledChange}
                  />
                  {failedPreferences.keepAwake && (
                    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3 text-sm text-destructive">
                      <span className="min-w-0 whitespace-normal break-words">
                        {t('toast.failedToSaveSetting', { setting: t('settings.power.keepScreenAwake') })}: {failedPreferences.keepAwake.message}
                      </span>
                      <Button size="sm" variant="outline" onClick={() => {
                        const failed = failedPreferences.keepAwake
                        if (failed) void savePreference('keepAwake', failed.value)
                      }}>
                        {t('common.retry')}
                      </Button>
                    </div>
                  )}
                </SettingsCard>
              </SettingsSection>

              {/* Tools */}
              <SettingsSection title={t("settings.tools.title")}>
                <SettingsCard>
                  <SettingsToggle
                    label={t("settings.tools.builtInBrowser")}
                    description={t("settings.tools.builtInBrowserDesc")}
                    checked={browserToolEnabled}
                    onCheckedChange={handleBrowserToolEnabledChange}
                  />
                  {failedPreferences.browserTool && (
                    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3 text-sm text-destructive">
                      <span className="min-w-0 whitespace-normal break-words">
                        {t('toast.failedToSaveSetting', { setting: t('settings.tools.builtInBrowser') })}: {failedPreferences.browserTool.message}
                      </span>
                      <Button size="sm" variant="outline" onClick={() => {
                        const failed = failedPreferences.browserTool
                        if (failed) void savePreference('browserTool', failed.value)
                      }}>
                        {t('common.retry')}
                      </Button>
                    </div>
                  )}
                </SettingsCard>
              </SettingsSection>

              {/* Network */}
              <SettingsSection title={t("settings.network.title")}>
                <SettingsCard>
                  <SettingsToggle
                    label={t("settings.network.httpProxy")}
                    description={t("settings.network.httpProxyDesc")}
                    checked={proxyForm.enabled}
                    onCheckedChange={(enabled) => setProxyForm(prev => ({ ...prev, enabled }))}
                  />
                  {proxyForm.enabled && (
                    <>
                      <SettingsInput
                        label={t("settings.network.httpProxyLabel")}
                        value={proxyForm.httpProxy}
                        onChange={(value) => setProxyForm(prev => ({ ...prev, httpProxy: value }))}
                        placeholder={t("settings.network.proxyPlaceholder")}
                        inCard
                      />
                      <SettingsInput
                        label={t("settings.network.httpsProxyLabel")}
                        value={proxyForm.httpsProxy}
                        onChange={(value) => setProxyForm(prev => ({ ...prev, httpsProxy: value }))}
                        placeholder={t("settings.network.proxyPlaceholder")}
                        inCard
                      />
                      <SettingsInput
                        label={t("settings.network.bypassRules")}
                        value={proxyForm.noProxy}
                        onChange={(value) => setProxyForm(prev => ({ ...prev, noProxy: value }))}
                        placeholder={t("settings.network.bypassPlaceholder")}
                        inCard
                      />
                    </>
                  )}
                  {(isProxyDirty || proxyError) && (
                    <SettingsCardFooter>
                      {proxyError && (
                        <span className="text-destructive text-sm mr-auto">{proxyError === 'proxyErrorProtocol' ? t("settings.network.proxyErrorProtocol") : proxyError === 'proxyErrorFormat' ? t("settings.network.proxyErrorFormat") : proxyError}</span>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleResetProxy}
                        disabled={!isProxyDirty || isSavingProxy}
                      >
                        {t("common.reset")}
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSaveProxy}
                        disabled={!isProxyDirty || isSavingProxy}
                      >
                        {isSavingProxy ? (
                          <>
                            <Spinner className="mr-1.5" />
                            {t("common.saving")}
                          </>
                        ) : (
                          t("common.save")
                        )}
                      </Button>
                    </SettingsCardFooter>
                  )}
                </SettingsCard>
              </SettingsSection>

              {/* About */}
              <SettingsSection title={t("settings.about.title")}>
                <SettingsCard>
                  <SettingsRow label={t("settings.about.version")}>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">
                        {updateChecker.updateInfo?.currentVersion ?? t("common.loading")}
                      </span>
                      {isElectron && updateChecker.isDownloading && updateChecker.updateInfo?.latestVersion && (
                        <div className="flex items-center gap-2 text-muted-foreground text-sm">
                          <Spinner className="w-3 h-3" />
                          <span>{t("settings.about.downloading", { version: updateChecker.updateInfo.latestVersion, percent: updateChecker.downloadProgress })}</span>
                        </div>
                      )}
                    </div>
                  </SettingsRow>
                  {isElectron && (
                    <SettingsRow label={t("settings.about.checkForUpdates")}>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCheckForUpdates}
                        disabled={isCheckingForUpdates}
                      >
                        {isCheckingForUpdates ? (
                          <>
                            <Spinner className="mr-1.5" />
                            {t("common.checking")}
                          </>
                        ) : (
                          t("settings.about.checkNow")
                        )}
                      </Button>
                    </SettingsRow>
                  )}
                  {isElectron && updateChecker.isReadyToInstall && updateChecker.updateInfo?.latestVersion && (
                    <SettingsRow label={t("settings.about.updateReady")}>
                      <Button
                        size="sm"
                        onClick={updateChecker.installUpdate}
                      >
                        {t("settings.about.restartToUpdate", { version: updateChecker.updateInfo.latestVersion })}
                      </Button>
                    </SettingsRow>
                  )}
                </SettingsCard>
              </SettingsSection>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
