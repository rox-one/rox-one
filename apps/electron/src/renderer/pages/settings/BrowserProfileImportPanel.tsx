/**
 * Browser import preferences are separate from per-profile access grants.
 * Discovery is explicit; OS credential approval can only come from the host.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bookmark, ChevronDown, ChevronRight, Cookie, DownloadCloud, Globe2, History, KeyRound, RefreshCw, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react'
import { PremiumMenuSelect } from '@rox/ui'
import { answerChoice, type BrowserImportCategory } from '@rox/shared/environment'
import { SettingsCard, SettingsRow, SettingsSection, SettingsToggle } from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { BrowserCookieAutoStatus } from '../../../shared/types'
import { useActiveWorkspace } from '@/context/AppShellContext'
import type { BrowserDataAutoStatus, DiscoveredProfile, ImportSummary } from '@rox/shared/browser/profile-import'
import type { BrowserCredentialCapability } from '@rox/shared/browser/browser-credential-host'
import { browserImportConsent, browserImportProfileSelection } from './browser-import-consent'

const STATE_KEYS: Record<DiscoveredProfile['state'], string> = {
  ok: 'settings.browserImport.stateOk',
  locked: 'settings.browserImport.stateLocked',
  corrupt: 'settings.browserImport.stateCorrupt',
  running: 'settings.browserImport.stateRunning',
  unsupported: 'settings.browserImport.stateUnsupported',
}

const PREFERENCE_ROWS = [
  { category: 'history', key: 'onboarding.environment.browserImportHistory', icon: History, color: 'text-sky-500' },
  { category: 'bookmarks', key: 'onboarding.environment.browserImportBookmarks', icon: Bookmark, color: 'text-violet-500' },
  { category: 'cookies', key: 'settings.browserImport.consentCookies', icon: Cookie, color: 'text-amber-500' },
  { category: 'credentials', key: 'onboarding.environment.browserImportCredentials', icon: KeyRound, color: 'text-emerald-500' },
] as const

export default function BrowserProfileImportPanel() {
  const { t, i18n } = useTranslation()
  const workspace = useActiveWorkspace()
  const activeWorkspaceId = useRef(workspace?.id)
  activeWorkspaceId.current = workspace?.id
  const workspaceEpoch = useRef({ id: workspace?.id, generation: 0 })
  if (workspaceEpoch.current.id !== workspace?.id) {
    workspaceEpoch.current = { id: workspace?.id, generation: workspaceEpoch.current.generation + 1 }
  }
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<DiscoveredProfile[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [cookieDomains, setCookieDomains] = useState('')
  const [categories, setCategories] = useState<BrowserImportCategory[] | null>(null)
  const [savingPreferences, setSavingPreferences] = useState(false)
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [cookieAuto, setCookieAuto] = useState<BrowserCookieAutoStatus | null>(null)
  const [cookieError, setCookieError] = useState<string | null>(null)
  const [dataAuto, setDataAuto] = useState<BrowserDataAutoStatus | null>(null)
  const [dataBusy, setDataBusy] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [credentialCapability, setCredentialCapability] = useState<BrowserCredentialCapability | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.electronAPI.getEnvironmentSetup().then(({ prefs }) => {
      if (!cancelled) setCategories(prefs.browserImport.value ?? [])
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err))
    })
    const unsubscribe = window.electronAPI.onEnvironmentChanged?.((prefs) => {
      if (!cancelled) setCategories(prefs.browserImport.value ?? [])
    }) ?? (() => {})
    return () => { cancelled = true; unsubscribe() }
  }, [])

  const setPreference = useCallback(async (category: BrowserImportCategory, checked: boolean) => {
    if (!categories || savingPreferences) return
    const previous = categories
    const next = checked ? [...new Set([...categories, category])] : categories.filter((item) => item !== category)
    setCategories(next)
    setSavingPreferences(true)
    setError(null)
    try {
      const { prefs } = await window.electronAPI.saveEnvironmentSetup({ browserImport: answerChoice(next) })
      setCategories(prefs.browserImport.value ?? [])
    } catch (err) {
      setCategories(previous)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingPreferences(false)
    }
  }, [categories, savingPreferences])

  const refreshCookieAuto = useCallback(async () => {
    try {
      const status = await window.electronAPI.browserCookieAutoStatus()
      setCookieAuto(status)
      if (status.consent) {
        setCookieDomains((current) => current || status.domains?.join(', ') || '')
      }
    } catch (err) {
      setCookieError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const refreshDataAuto = useCallback(async () => {
    if (!workspace?.id) { setDataAuto(null); return }
    try {
      const status = await window.electronAPI.browserDataAutoImport({ workspaceId: workspace.id, action: 'status' })
      if (activeWorkspaceId.current !== workspace.id) return
      setDataAuto(status)
    } catch (err) {
      if (activeWorkspaceId.current !== workspace.id) return
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [workspace?.id])

  useEffect(() => {
    setDataAuto(null)
    setSelectedId(null)
    setSummary(null)
    setLoading(false)
    setError(null)
    void refreshDataAuto()
    const timer = window.setInterval(() => void refreshDataAuto(), 15_000)
    return () => window.clearInterval(timer)
  }, [refreshDataAuto])

  useEffect(() => {
    setSelectedId((current) => browserImportProfileSelection(workspace?.id, current, dataAuto, cookieAuto))
  }, [workspace?.id, dataAuto, cookieAuto])

  const updateDataAuto = useCallback(async (action: 'set' | 'run', enabled?: boolean) => {
    if (!workspace?.id || dataBusy) return
    setDataBusy(true)
    setError(null)
    try {
      const status = await window.electronAPI.browserDataAutoImport({
        workspaceId: workspace.id, action, enabled, profileId: enabled ? selectedId ?? undefined : undefined,
      })
      if (activeWorkspaceId.current === workspace.id) setDataAuto(status)
    } catch (err) {
      if (activeWorkspaceId.current === workspace.id) setError(err instanceof Error ? err.message : String(err))
    } finally { setDataBusy(false) }
  }, [workspace?.id, dataBusy, selectedId])

  const cookieBusy = cookieAuto?.state === 'importing'
  const profileBound = cookieAuto?.consent === true || dataAuto?.enabled === true
  const domains = cookieDomains.split(',').map((domain) => domain.trim()).filter(Boolean)
  const selectedProfile = profiles.find((profile) => profile.id === selectedId)
  const cookiePreferred = categories?.includes('cookies') ?? false
  const consent = browserImportConsent(categories ?? [], selectedProfile?.family, domains)
  const scopedCookies = consent.cookies
  const credentialSupported = credentialCapability?.supported === true
  const canImport = Boolean(workspace?.id && selectedId && categories &&
    (consent.historyBookmarks || consent.cookies || (consent.credentials && credentialSupported)) &&
    selectedProfile?.state !== 'locked' && selectedProfile?.state !== 'unsupported')
  const dataSelected = categories?.includes('history') || categories?.includes('bookmarks')
  const credentialDescription = !selectedId ? t('settings.browserImport.credentials.selectProfile')
    : credentialSupported ? t('settings.browserImport.credentials.available')
    : t('settings.browserImport.credentials.unavailable')
  const dataLine = !dataAuto?.enabled ? t('settings.browserImport.dataAuto.off')
    : !dataSelected ? t('settings.browserImport.dataAuto.paused')
    : dataAuto.error ? t('settings.browserImport.dataAuto.error')
    : !dataAuto.lastRunAt ? t('settings.browserImport.dataAuto.pending')
    : t('settings.browserImport.dataAuto.done', { history: dataAuto.imported.history, bookmarks: dataAuto.imported.bookmarks, time: new Date(dataAuto.lastRunAt).toLocaleString(i18n.language) })

  useEffect(() => {
    void refreshCookieAuto()
    const timer = window.setInterval(() => void refreshCookieAuto(), cookieBusy ? 1500 : 15_000)
    return () => window.clearInterval(timer)
  }, [refreshCookieAuto, cookieBusy])

  useEffect(() => {
    let cancelled = false
    setCredentialCapability(null)
    if (workspace?.id && selectedId) {
      void window.electronAPI.browserCredentialCapabilities({ workspaceId: workspace.id, profileId: selectedId })
        .then((capability) => { if (!cancelled) setCredentialCapability(capability) })
        .catch(() => { if (!cancelled) setCredentialCapability({ supported: false, mechanism: null }) })
    }
    return () => { cancelled = true }
  }, [workspace?.id, selectedId])

  const setCookieConsent = useCallback(async (on: boolean) => {
    setCookieError(null)
    const allowedDomains = cookieDomains.split(',').map((domain) => domain.trim()).filter(Boolean)
    if (on && (!selectedId || allowedDomains.length === 0)) {
      setCookieError(t('settings.browserImport.auto.scopeHint'))
      return
    }
    try {
      setCookieAuto(await window.electronAPI.browserCookieAutoSet({
        consent: on,
        profileId: on ? selectedId ?? undefined : undefined,
        domains: on ? allowedDomains : undefined,
      }))
    } catch (err) {
      setCookieError(err instanceof Error ? err.message : String(err))
    }
  }, [cookieDomains, selectedId, t])

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
    if (!cookieAuto.consent && cookieAuto.revocationReceipt) {
      return t('settings.browserImport.auto.revoked', {
        count: cookieAuto.revocationReceipt.cookiesRemoved,
        domains: cookieAuto.revocationReceipt.domains.join(', '),
        time: new Date(cookieAuto.revocationReceipt.revokedAt).toLocaleString(i18n.language),
      })
    }
    if (!cookieAuto.consent && cookieAuto.state === 'error') return t('settings.browserImport.auto.error', { error: cookieAuto.error ?? '' })
    if (!cookieAuto.supported) return t('settings.browserImport.auto.unsupported')
    if (!cookieAuto.consent) return t('settings.browserImport.auto.scopeHint')
    if (cookieAuto.state === 'importing') return t('settings.browserImport.auto.importing', { browser: cookieAuto.browser ?? '' })
    if (cookieAuto.state === 'error') return t('settings.browserImport.auto.error', { error: cookieAuto.error ?? '' })
    if (!cookieAuto.lastRunAt) return t('settings.browserImport.auto.pending', { browser: cookieAuto.browser ?? '' })
    return t('settings.browserImport.auto.done', {
      count: cookieAuto.imported,
      browser: cookieAuto.browser ?? '',
      profile: cookieAuto.profileName ?? '',
      time: new Date(cookieAuto.lastRunAt).toLocaleString(i18n.language),
    })
  })()

  const discover = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const found = await window.electronAPI.discoverBrowserProfiles({ consent: true })
      setProfiles(found)
      setSelectedId((current) => found.some((profile) => profile.id === current) ? current : null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const runImport = async (dryRun: boolean) => {
    if (!workspace?.id || !selectedId || !canImport || loading) return
    const generation = workspaceEpoch.current.generation
    setLoading(true)
    setError(null)
    setSummary(null)
    try {
      const result = await window.electronAPI.importBrowserProfile({ workspaceId: workspace.id, profileId: selectedId, consent, dryRun })
      if (activeWorkspaceId.current !== workspace.id || workspaceEpoch.current.generation !== generation) return
      setSummary(result)
      if (result.credentialAccess === 'cancelled' || result.credentialAccess === 'denied') {
        setError(t(`settings.browserImport.credentials.${result.credentialAccess}`))
      } else if (result.credentialAccess === 'unavailable') {
        setError(t('settings.browserImport.credentials.error'))
      }
    } catch (err) {
      if (activeWorkspaceId.current === workspace.id && workspaceEpoch.current.generation === generation) {
        const message = err instanceof Error ? err.message : String(err)
        setError(message.startsWith('browser-credentials-') || message.startsWith('protected-credential-')
          ? t('settings.browserImport.credentials.error') : message)
      }
    } finally {
      if (workspaceEpoch.current.generation === generation) setLoading(false)
    }
  }

  const rollback = useCallback(async () => {
    if (!workspace?.id || !summary?.rollbackToken || loading) return
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.rollbackBrowserProfileImport({ workspaceId: workspace.id, token: summary.rollbackToken })
      if (!result.ok) { setError(t('settings.browserImport.rollbackUnavailable')); return }
      setSummary(null)
      await refreshDataAuto()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [loading, summary?.rollbackToken, t, workspace?.id, refreshDataAuto])

  const removeImported = useCallback(async () => {
    if (!workspace?.id || loading) return
    setLoading(true)
    setError(null)
    try {
      const deleted = await window.electronAPI.deleteImportedBrowserProfile(workspace.id)
      setSummary({
        dryRun: false, profileId: selectedId ?? '',
        counts: { history: 0, bookmarks: 0, cookies: 0, credentials: 0, skipped: 0 },
        accessedStores: [], rollbackToken: null, deletionReceipt: deleted.deletionReceipt,
      })
      await refreshDataAuto()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [loading, selectedId, workspace?.id, refreshDataAuto])

  const profileItems = profiles.map((profile) => ({
    id: profile.id,
    label: `${profile.name} · ${profile.family}`,
    description: t(STATE_KEYS[profile.state]),
    icon: <Globe2 className="h-4 w-4 text-sky-500" />,
    disabled: profile.state === 'locked' || profile.state === 'unsupported',
  }))
  if (cookieAuto?.consent && cookieAuto.profileId && !profiles.some((profile) => profile.id === cookieAuto.profileId)) {
    profileItems.push({ id: cookieAuto.profileId, label: cookieAuto.profileName ?? t('settings.browserImport.profileLabel'), description: t('settings.browserImport.accessGranted'), icon: <Globe2 className="h-4 w-4 text-sky-500" />, disabled: false })
  }
  if (dataAuto?.enabled && dataAuto.profileId && !profileItems.some((profile) => profile.id === dataAuto.profileId)) {
    profileItems.push({ id: dataAuto.profileId, label: t('settings.browserImport.dataAuto.authorizedProfile'), description: t('settings.browserImport.accessGranted'), icon: <Globe2 className="h-4 w-4 text-sky-500" />, disabled: false })
  }

  return (
    <section className="space-y-6" data-testid="browser-profile-import" aria-busy={loading}>
      <SettingsSection title={t('settings.browserImport.preferencesTitle')} description={t('settings.browserImport.preferencesHint')}>
        <SettingsCard>
          {PREFERENCE_ROWS.map(({ category, key, icon: Icon, color }) => (
            <SettingsToggle key={category}
              label={<span className="flex items-center gap-2"><Icon className={`h-4 w-4 ${color}`} />{t(key)}</span>}
              checked={categories?.includes(category) ?? false}
              disabled={!categories || savingPreferences || loading}
              onCheckedChange={(checked) => void setPreference(category, checked)}
            />
          ))}
          <SettingsRow label={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-muted-foreground" />{t('settings.browserImport.osAccessTitle')}</span>}
            data-testid="browser-profile-os-access"
            description={credentialDescription} wrapDescription
            action={<span className="rounded-md bg-foreground/5 px-2 py-1 text-[11px] text-muted-foreground">{credentialSupported ? t('settings.browserImport.credentials.requiresAccess') : t('settings.browserImport.accessUnavailable')}</span>}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('settings.browserImport.dataAuto.title')} description={t('settings.browserImport.dataAuto.description')}>
        <SettingsCard>
          <SettingsRow label={t('settings.browserImport.profileLabel')} wrapDescription
            action={<div className="flex items-center gap-2">
              <PremiumMenuSelect items={profileItems} selectedId={selectedId} placeholder={t('settings.browserImport.selectProfile')}
                disabled={loading || profileItems.length === 0 || profileBound} className="h-8 max-w-[180px]"
                onSelect={(item) => setSelectedId(item.id)} />
              <Button size="sm" variant="secondary" disabled={loading || profileBound} onClick={() => void discover()}>
                <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />{t('settings.browserImport.discover')}
              </Button>
            </div>}
          />
          <SettingsToggle label={t('settings.browserImport.dataAuto.consent')} description={t('settings.browserImport.dataAuto.consentHint')}
            checked={dataAuto?.enabled ?? false}
            disabled={!dataAuto || dataBusy || loading || (!dataAuto.enabled && (!selectedId || !dataSelected || selectedProfile?.state === 'locked' || selectedProfile?.state === 'unsupported'))}
            onCheckedChange={(on) => void updateDataAuto('set', on)} />
          <SettingsRow label={t('settings.browserImport.auto.status')} description={dataLine} wrapDescription
            action={dataAuto?.enabled ? <Button size="sm" variant="secondary" disabled={dataBusy || !dataSelected} onClick={() => void updateDataAuto('run')}><RefreshCw className={`mr-1 h-3.5 w-3.5 ${dataBusy ? 'animate-spin' : ''}`} />{t('settings.browserImport.auto.runNow')}</Button> : undefined} />
          <div className="space-y-2 px-4 py-3.5">
            <label htmlFor="browser-import-domains" className="text-sm font-medium">{t('settings.browserImport.auto.domainsLabel')}</label>
            <Input id="browser-import-domains" value={cookieDomains} onChange={(event) => setCookieDomains(event.target.value)}
              placeholder={t('settings.browserImport.auto.domainsPlaceholder')} disabled={cookieAuto?.consent ?? false} />
          </div>
          <SettingsToggle label={t('settings.browserImport.auto.consent')} description={t('settings.browserImport.auto.consentHint')}
            checked={cookieAuto?.consent ?? false}
            disabled={!cookieAuto || !cookieAuto.supported || (!cookieAuto.consent && (!selectedId || selectedProfile?.family !== 'chromium' || domains.length === 0))}
            onCheckedChange={(on) => void setCookieConsent(on)} />
          <SettingsRow label={t('settings.browserImport.auto.status')} description={cookieLine} wrapDescription
            action={cookieAuto?.consent ? <Button size="sm" variant="secondary" disabled={cookieBusy} onClick={() => void runCookieImport()}><RefreshCw className="mr-1 h-3.5 w-3.5" />{t('settings.browserImport.auto.runNow')}</Button> : undefined} />
        </SettingsCard>
        {cookieError ? <p role="alert" className="mt-2 text-xs text-destructive">{cookieError}</p> : null}
      </SettingsSection>

      <button type="button" data-testid="browser-profile-manual-toggle" aria-expanded={manualOpen} aria-controls="browser-profile-manual"
        className="flex w-full items-center gap-2 rounded-xl border border-border/50 bg-background/40 px-4 py-3 text-sm font-medium transition-colors hover:bg-foreground/5"
        onClick={() => {
          const opening = !manualOpen
          setManualOpen(opening)
          if (opening && profiles.length === 0) void discover()
        }}>
        {manualOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {t('settings.browserImport.title')}
      </button>
      {manualOpen ? <div id="browser-profile-manual" className="space-y-4 rounded-xl border border-border/50 bg-background/30 p-4">
        <p className="text-sm text-muted-foreground">{t('settings.browserImport.description')}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={loading || !canImport} onClick={() => void runImport(true)}>{t('settings.browserImport.dryRun')}</Button>
          <Button size="sm" disabled={loading || !canImport} onClick={() => void runImport(false)}><DownloadCloud className="mr-1 h-3.5 w-3.5" />{t('settings.browserImport.import')}</Button>
          <Button size="sm" variant="outline" disabled={loading || !summary?.rollbackToken} onClick={() => void rollback()}><RotateCcw className="mr-1 h-3.5 w-3.5" />{t('settings.browserImport.rollback')}</Button>
          <Button size="sm" variant="ghost" disabled={loading || !workspace?.id} onClick={() => void removeImported()}><Trash2 className="mr-1 h-3.5 w-3.5" />{t('settings.browserImport.delete')}</Button>
        </div>
        {cookiePreferred && !scopedCookies ? <p className="text-xs text-muted-foreground">{t('settings.browserImport.cookiesSkippedHint')}</p> : null}
        {profiles.length === 0 && !loading ? <p className="text-sm text-muted-foreground">{t('settings.browserImport.empty')}</p> : <div className="grid gap-2 sm:grid-cols-2">
          {profiles.map((profile) => <label key={profile.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${selectedId === profile.id ? 'border-accent/40 bg-accent/5' : 'border-border/50 hover:bg-foreground/5'}`}>
            <input type="radio" name="browser-profile" className="mt-1 accent-accent" checked={selectedId === profile.id}
              disabled={loading || profileBound || profile.state === 'locked' || profile.state === 'unsupported'} onChange={() => setSelectedId(profile.id)} />
            <span className="min-w-0 text-sm"><span className="block truncate font-medium">{profile.name}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{profile.family} · {t(STATE_KEYS[profile.state])}</span>
              {profile.recommended ? <span className="mt-1 block text-xs text-accent">{t('settings.browserImport.recommended')}</span> : null}
            </span>
          </label>)}
        </div>}
        {summary ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="browser-profile-import-summary" aria-live="polite">
          {[
            ['onboarding.environment.browserImportBookmarks', summary.counts.bookmarks],
            ['onboarding.environment.browserImportHistory', summary.counts.history],
            ['settings.browserImport.consentCookies', summary.counts.cookies],
            ['onboarding.environment.browserImportCredentials', summary.counts.credentials],
            ['settings.browserImport.skipped', summary.counts.skipped],
          ].map(([key, count]) => <div key={key} className="rounded-lg bg-foreground/5 px-3 py-2"><span className="block text-lg font-semibold tabular-nums">{count}</span><span className="text-[11px] text-muted-foreground">{t(String(key))}</span></div>)}
        </div> : null}
        {summary?.unsupportedCredentials ? <p className="text-xs text-muted-foreground">{t('settings.browserImport.credentials.skipped')}</p> : null}
      </div> : null}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </section>
  )
}
