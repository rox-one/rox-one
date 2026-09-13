/**
 * Settings → Import: privileged browser profile import (Issue 15).
 * Consent for cookies/credentials is separate from history/bookmarks.
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DownloadCloud, RefreshCw, RotateCcw, Trash2 } from 'lucide-react'
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
    <section className="space-y-3 pt-6 border-t" data-testid="browser-profile-import">
      <h2 className="text-sm font-medium">{t('settings.browserImport.title')}</h2>
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
    </section>
  )
}
