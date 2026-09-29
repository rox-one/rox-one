/**
 * Settings → Import: privileged browser profile import (Issue 15).
 * Consent for cookies/credentials is separate from history/bookmarks.
 *
 * Top: automatic cookie/session import for the in-app browser behind ONE
 * explicit consent switch (default off). Below: the manual profile import.
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, DownloadCloud, RefreshCw, RotateCcw, Trash2 } from 'lucide-react'
import { SettingsCard, SettingsRow, SettingsSection, SettingsToggle } from '@/components/settings'
import { Button } from '@/components/ui/button'
import type { BrowserCookieAutoStatus } from '../../../shared/types'
import { useActiveWorkspace } from '@/context/AppShellContext'
import type { DiscoveredProfile, ImportConsent, ImportSummary } from '@craft-agent/shared/browser/profile-import'

const STATE_KEYS: Record<DiscoveredProfile['state'], string> = {
  ok: 'settings.browserImport.stateOk',
  locked: 'settings.browserImport.stateLocked',
  corrupt: 'settings.browserImport.stateCorrupt',
  running: 'settings.browserImport.stateRunning',
  unsupported: 'settings.browserImport.stateUnsupported',
}

export default function BrowserProfileImportPanel() {
  const { t } = useTranslation()
  const workspace = useActiveWorkspace()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<DiscoveredProfile[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [consent, setConsent] = useState<ImportConsent>({
    historyBookmarks: true,
    cookies: false,
    credentials: false,
    osCredentialsApproved: false,
  })
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [cookieAuto, setCookieAuto] = useState<BrowserCookieAutoStatus | null>(null)
  const [cookieError, setCookieError] = useState<string | null>(null)
  const [manualOpen, setManualOpen] = useState(false)

  const refreshCookieAuto = useCallback(async () => {
    try {
      setCookieAuto(await window.electronAPI.browserCookieAutoStatus())
    } catch (err) {
      setCookieError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const cookieBusy = cookieAuto?.state === 'importing'
  useEffect(() => {
    void refreshCookieAuto()
    const timer = window.setInterval(() => void refreshCookieAuto(), cookieBusy ? 1500 : 15_000)
    return () => window.clearInterval(timer)
  }, [refreshCookieAuto, cookieBusy])

  const setCookieConsent = useCallback(async (on: boolean) => {
    setCookieError(null)
    try {
      setCookieAuto(await window.electronAPI.browserCookieAutoSet({ consent: on }))
    } catch (err) {
      setCookieError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const runCookieImport = useCallback(async () => {
    setCookieError(null)
    setCookieAuto((prev) => (prev ? { ...prev, state: 'importing' } : prev))
    try {
      setCookieAuto(await window.electronAPI.browserCookieAutoRun())
    } catch (err) {
      setCookieError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const cookieLine = (() => {
    if (!cookieAuto) return t('settings.browserImport.auto.loading')
    if (!cookieAuto.supported) return t('settings.browserImport.auto.unsupported')
    if (cookieAuto.browsers.length === 0) return t('settings.browserImport.auto.noBrowsers')
    if (!cookieAuto.consent) {
      return t('settings.browserImport.auto.offDetected', { browsers: cookieAuto.browsers.join(', ') })
    }
    if (cookieAuto.state === 'importing') return t('settings.browserImport.auto.importing', { browser: cookieAuto.browser ?? '' })
    if (cookieAuto.state === 'error') {
      return t('settings.browserImport.auto.error', { error: cookieAuto.error ?? '' })
    }
    if (!cookieAuto.lastRunAt) return t('settings.browserImport.auto.pending', { browser: cookieAuto.browser ?? '' })
    return t('settings.browserImport.auto.done', {
      count: cookieAuto.imported,
      browser: cookieAuto.browser ?? '',
      profile: cookieAuto.profileName ?? '',
      time: new Date(cookieAuto.lastRunAt).toLocaleString(),
    })
  })()

  const discover = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const found = await window.electronAPI.discoverBrowserProfiles()
      setProfiles(found)
      const recommended = found.find((profile) => profile.recommended)
      setSelectedId(recommended?.id ?? found[0]?.id ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void discover()
  }, [discover])

  const runImport = useCallback(async (dryRun: boolean) => {
    if (!workspace?.id || !selectedId) return
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.importBrowserProfile({
        workspaceId: workspace.id,
        profileId: selectedId,
        consent,
        dryRun,
      })
      setSummary(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [consent, selectedId, workspace?.id])

  const rollback = useCallback(async () => {
    if (!workspace?.id || !summary?.rollbackToken) return
    setLoading(true)
    setError(null)
    try {
      await window.electronAPI.rollbackBrowserProfileImport({
        workspaceId: workspace.id,
        token: summary.rollbackToken,
      })
      setSummary(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [summary?.rollbackToken, workspace?.id])

  const removeImported = useCallback(async () => {
    if (!workspace?.id) return
    setLoading(true)
    setError(null)
    try {
      const deleted = await window.electronAPI.deleteImportedBrowserProfile(workspace.id)
      setSummary({
        dryRun: false,
        profileId: selectedId ?? '',
        counts: { history: 0, bookmarks: 0, cookies: 0, credentials: 0, skipped: 0 },
        accessedStores: [],
        rollbackToken: null,
        deletionReceipt: deleted.deletionReceipt,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [selectedId, workspace?.id])

  return (
    <section className="space-y-4" data-testid="browser-profile-import">
      <SettingsSection title={t('settings.browserImport.auto.title')} description={t('settings.browserImport.auto.description')}>
        <SettingsCard>
          <SettingsToggle
            label={t('settings.browserImport.auto.consent')}
            description={t('settings.browserImport.auto.consentHint')}
            checked={cookieAuto?.consent ?? false}
            disabled={!cookieAuto || !cookieAuto.supported || cookieAuto.browsers.length === 0}
            onCheckedChange={(on) => void setCookieConsent(on)}
          />
          <SettingsRow
            label={t('settings.browserImport.auto.status')}
            description={cookieLine}
            wrapDescription
            action={
              cookieAuto?.consent ? (
                <Button size="sm" variant="secondary" disabled={cookieBusy} onClick={() => void runCookieImport()}>
                  <RefreshCw className="w-3.5 h-3.5 mr-1" />
                  {t('settings.browserImport.auto.runNow')}
                </Button>
              ) : undefined
            }
          />
        </SettingsCard>
        {cookieError ? <div className="mt-2 text-xs text-destructive">{cookieError}</div> : null}
      </SettingsSection>
      <button
        type="button"
        data-testid="browser-profile-manual-toggle"
        onClick={() => setManualOpen((open) => !open)}
        className="inline-flex items-center gap-1 text-sm font-medium text-foreground/80 hover:text-foreground"
      >
        {manualOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        {t('settings.browserImport.title')}
      </button>
      {manualOpen ? (
      <div className="space-y-3">
      <p className="text-sm opacity-70">{t('settings.browserImport.description')}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void discover()}
          className="inline-flex items-center gap-1 text-xs border rounded-md px-2 py-1.5 hover:bg-muted"
        >
          <RefreshCw className="w-3 h-3" />
          {t('settings.browserImport.discover')}
        </button>
        <button
          type="button"
          onClick={() => void runImport(true)}
          className="inline-flex items-center gap-1 text-xs border rounded-md px-2 py-1.5 hover:bg-muted"
        >
          {t('settings.browserImport.dryRun')}
        </button>
        <button
          type="button"
          onClick={() => void runImport(false)}
          className="inline-flex items-center gap-1 text-xs border rounded-md px-2 py-1.5 hover:bg-muted"
        >
          <DownloadCloud className="w-3 h-3" />
          {t('settings.browserImport.import')}
        </button>
        <button
          type="button"
          onClick={() => void rollback()}
          disabled={!summary?.rollbackToken}
          className="inline-flex items-center gap-1 text-xs border rounded-md px-2 py-1.5 hover:bg-muted disabled:opacity-40"
        >
          <RotateCcw className="w-3 h-3" />
          {t('settings.browserImport.rollback')}
        </button>
        <button
          type="button"
          onClick={() => void removeImported()}
          className="inline-flex items-center gap-1 text-xs border rounded-md px-2 py-1.5 hover:bg-muted"
        >
          <Trash2 className="w-3 h-3" />
          {t('settings.browserImport.delete')}
        </button>
      </div>
      <div className="space-y-1 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={consent.historyBookmarks}
            onChange={(ev) => setConsent((prev) => ({ ...prev, historyBookmarks: ev.target.checked }))}
          />
          {t('settings.browserImport.consentBookmarks')}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={consent.cookies}
            onChange={(ev) => setConsent((prev) => ({ ...prev, cookies: ev.target.checked }))}
          />
          {t('settings.browserImport.consentCookies')}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={consent.credentials}
            onChange={(ev) => setConsent((prev) => ({ ...prev, credentials: ev.target.checked }))}
          />
          {t('settings.browserImport.consentCredentials')}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            data-testid="browser-profile-os-approved"
            checked={consent.osCredentialsApproved}
            onChange={(ev) => setConsent((prev) => ({ ...prev, osCredentialsApproved: ev.target.checked }))}
          />
          {t('settings.browserImport.osApproved')}
        </label>
      </div>
      {loading ? <p className="text-sm opacity-70">{t('settings.browserImport.discover')}</p> : null}
      {error ? <div className="text-xs text-destructive">{error}</div> : null}
      {profiles.length === 0 && !loading ? (
        <p className="text-sm opacity-60">{t('settings.browserImport.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {profiles.map((profile) => (
            <li key={profile.id} className="border rounded-md px-3 py-2 text-sm">
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="browser-profile"
                  checked={selectedId === profile.id}
                  onChange={() => setSelectedId(profile.id)}
                />
                <span>
                  <span className="font-medium">{profile.name}</span>
                  {profile.recommended ? (
                    <span className="ml-2 text-xs opacity-60">{t('settings.browserImport.recommended')}</span>
                  ) : null}
                  <span className="block text-xs opacity-60">
                    {profile.family} · {t(STATE_KEYS[profile.state])}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {summary ? (
        <p className="text-xs opacity-70" data-testid="browser-profile-import-summary">
          {summary.counts.bookmarks}/{summary.counts.history}/{summary.counts.cookies}/{summary.counts.credentials}
        </p>
      ) : null}
      </div>
      ) : null}
    </section>
  )
}
