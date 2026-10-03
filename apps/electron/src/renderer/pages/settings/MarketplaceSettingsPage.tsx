import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { Spinner, PremiumMenuSelect } from '@rox/ui'
import { SettingsCard, SettingsCardContent } from '@/components/settings'
import {
  ShoppingBag,
  Star,
  Clock,
  DownloadCloud,
  Package,
  CheckCircle2,
  FileText,
  Wrench,
  BookOpen,
  Server,
  ExternalLink,
} from 'lucide-react'

import { CAPABILITY_PACKS, CAPABILITY_TOOLS, buildOfflineCapabilityReport } from '@rox/shared/capabilities'
import { routes } from '@/lib/navigate'
import { isClaimableLive } from '@rox/core/rox2'
import { settingsPageActionResult } from './settings-rox2-surface'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type {
  MarketplaceCatalogResult,
  MarketplaceEntry,
  MarketplaceEntryKind,
  MarketplaceEntryStats,
  MarketplaceLockRecord,
} from '@rox/shared/marketplace'
import {
  isHighRiskMarketplacePermission,
  groupExtensionPermissions,
  permissionsForMarketplaceKind,
} from '@rox/shared/extensions/browser'
import { filterMarketplaceEntries } from '@rox/shared/marketplace'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'marketplace',
}

type SortKey = 'stars' | 'downloads' | 'updated' | 'name'
type BusyState = Record<string, 'busy' | undefined>

/** UI tabs map onto catalog kinds (+ rules = context-doc). */
type MarketplaceTab = 'skillpack' | 'tool' | 'service' | 'rule' | ''
type MarketplaceSavedGroup = { id: string; name: string; entryIds: string[] }
type MarketplacePreferences = {
  query?: string
  tab?: MarketplaceTab
  tags?: string[]
  sort?: SortKey
  installedOnly?: boolean
  selectedGroupId?: string
  groups?: MarketplaceSavedGroup[]
}

const MARKETPLACE_PREFERENCES_KEY = 'craft.marketplace.filters.v1'

function readMarketplacePreferences(): MarketplacePreferences {
  try {
    const raw = localStorage.getItem(MARKETPLACE_PREFERENCES_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const tab = ['', 'skillpack', 'tool', 'service', 'rule'].includes(String(parsed.tab))
      ? (parsed.tab as MarketplaceTab)
      : ''
    const sort = ['stars', 'downloads', 'updated', 'name'].includes(String(parsed.sort))
      ? (parsed.sort as SortKey)
      : 'stars'
    const groups = Array.isArray(parsed.groups)
      ? parsed.groups.flatMap((item): MarketplaceSavedGroup[] => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return []
          const group = item as Record<string, unknown>
          if (
            typeof group.id !== 'string' ||
            typeof group.name !== 'string' ||
            !group.name.trim() ||
            !Array.isArray(group.entryIds) ||
            !group.entryIds.every((id) => typeof id === 'string')
          ) return []
          return [{ id: group.id, name: group.name, entryIds: [...new Set(group.entryIds as string[])] }]
        })
      : []
    return {
      query: typeof parsed.query === 'string' ? parsed.query : '',
      tab,
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter((tag): tag is string => typeof tag === 'string') : [],
      sort,
      installedOnly: parsed.installedOnly === true,
      selectedGroupId: typeof parsed.selectedGroupId === 'string' ? parsed.selectedGroupId : '',
      groups,
    }
  } catch {
    return {}
  }
}

const KIND_ICONS: Record<MarketplaceEntryKind, typeof Package> = {
  skillpack: Package,
  tool: Wrench,
  'context-doc': FileText,
}

const TAB_ICONS: Record<Exclude<MarketplaceTab, ''>, typeof Package> = {
  skillpack: Package,
  tool: Wrench,
  service: Server,
  rule: BookOpen,
}

function formatCompact(n: number, locale: string): string {
  return Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

/** Human-readable package size hint (KB below 1 MB, MB above), locale-agnostic units. */
function formatSizeHint(kb: number): string {
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`
}

function daysElapsed(iso: string): number {
  // Full calendar days since pushedAt/refetch date; never negative.
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000))
}

function formatRelativeDays(
  t: (key: string, opts?: Record<string, unknown>) => string,
  iso: string,
  keyPrefix: 'marketplace.updatedDaysAgo' | 'marketplace.lastFetchDaysAgo',
): string {
  const days = daysElapsed(iso)
  if (days < 1) {
    return keyPrefix === 'marketplace.updatedDaysAgo'
      ? t('marketplace.updatedToday')
      : t('marketplace.today')
  }
  return t(keyPrefix, { count: days })
}

/** Map UI tab → catalog kind filter. Services currently empty (tools with service-ish tags). */
function entryMatchesTab(entry: MarketplaceEntry, tab: MarketplaceTab): boolean {
  if (!tab) return true
  if (tab === 'skillpack') return entry.kind === 'skillpack'
  if (tab === 'tool') return entry.kind === 'tool'
  if (tab === 'rule') return entry.kind === 'context-doc'
  if (tab === 'service') {
    // No dedicated kind yet — surface tools tagged service/hosting/api.
    if (entry.kind !== 'tool') return false
    const tags = (entry.tags ?? []).map((x) => x.toLowerCase())
    return tags.some((tag) =>
      ['service', 'services', 'hosting', 'api', 'saas', 'cloud'].includes(tag),
    )
  }
  return true
}

function githubTreeUrl(repo: string, ref: string): string | null {
  if (!repo || !ref) return null
  // owner/repo only
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return null
  return `https://github.com/${repo}/tree/${ref}`
}

function isArtifactInstalled(lock: MarketplaceLockRecord): boolean {
  return lock.status === 'installed' && (lock.kind === 'tool' || lock.targets.length > 0)
}
export default function MarketplaceSettingsPage() {
  const { t, i18n } = useTranslation()
  const [initialPreferences] = useState(readMarketplacePreferences)
  const [view, setView] = useState<MarketplaceCatalogResult | null>(null)
  const [statsMap, setStatsMap] = useState<Record<string, MarketplaceEntryStats>>({})
  const [busy, setBusy] = useState<BusyState>({})
  const [query, setQuery] = useState(initialPreferences.query ?? '')
  const [tab, setTab] = useState<MarketplaceTab>(initialPreferences.tab ?? '')
  const [selectedTags, setSelectedTags] = useState<string[]>(initialPreferences.tags ?? [])
  const [sortKey, setSortKey] = useState<SortKey>(initialPreferences.sort ?? 'stars')
  const [installedOnly, setInstalledOnly] = useState(initialPreferences.installedOnly ?? false)
  const [groups, setGroups] = useState<MarketplaceSavedGroup[]>(initialPreferences.groups ?? [])
  const [selectedGroupId, setSelectedGroupId] = useState(initialPreferences.selectedGroupId ?? '')
  const [groupName, setGroupName] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedReport, setCopiedReport] = useState(false)
  /** Short-lived success banner from run() (cleared after 3s or next action). */
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  /** Live install phase text per entry id (from marketplace:progress). */
  const [progressById, setProgressById] = useState<Record<string, string>>({})

  useEffect(() => {
    try {
      localStorage.setItem(
        MARKETPLACE_PREFERENCES_KEY,
        JSON.stringify({ query, tab, tags: selectedTags, sort: sortKey, installedOnly, selectedGroupId, groups }),
      )
    } catch {
      // The marketplace remains usable when browser storage is unavailable.
    }
  }, [query, tab, selectedTags, sortKey, installedOnly, selectedGroupId, groups])
  const progressLabel = useCallback(
    (phase: string, detail?: string): string => {
      const key = `marketplace.progress.${phase}`
      const translated = t(key)
      const phaseLabel = translated === key ? phase : translated
      return detail ? `${phaseLabel}: ${detail}` : phaseLabel
    },
    [t],
  )

  const load = useCallback(async () => {
    try {
      // Progressive: paint catalog first; stats fill in without blocking first paint.
      const cat = await window.electronAPI.getMarketplaceCatalog()
      setView(cat)
      setError(null)
      setLoading(false)

      void window.electronAPI
        .getMarketplaceStats()
        .then((st) => setStatsMap(st))
        .catch((err) => {
          // Stats are best-effort; keep catalog visible.
          console.warn('marketplace stats failed', err)
        })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }, [])

  const refreshCatalog = useCallback(async () => {
    setRefreshing(true)
    setActionSuccess(null)
    try {
      const cat = await window.electronAPI.refreshMarketplaceCatalog()
      setView(cat)
      try {
        const st = await window.electronAPI.getMarketplaceStats()
        setStatsMap(st)
      } catch (err) {
        console.warn('marketplace stats refresh failed', err)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const offChanged = window.electronAPI.onMarketplaceChanged(() => {
      void load()
    })
    const offProgress = window.electronAPI.onMarketplaceProgress((payload) => {
      setProgressById((prev) => ({
        ...prev,
        [payload.id]: progressLabel(payload.phase, payload.detail),
      }))
    })
    return () => {
      offChanged()
      offProgress()
    }
  }, [load, progressLabel])

  // Auto-refresh catalog when the settings page regains focus (no banner).
  useEffect(() => {
    const onFocus = () => {
      void refreshCatalog()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshCatalog])

  const run = useCallback(
    async (id: string, fn: () => Promise<unknown>, successKey: string, action: 'install' | 'uninstall') => {
      const gate = settingsPageActionResult({
        pageId: 'marketplace',
        action,
        source: 'native',
        granted: true,
      })
      if (!isClaimableLive(gate)) {
        setError(t('settings.rox2.grantRequired'))
        return
      }
      setBusy((b) => ({ ...b, [id]: 'busy' }))
      setActionSuccess(null)
      setError(null)
      setProgressById((p) => {
        const next = { ...p }
        delete next[id]
        return next
      })
      try {
        await fn()
        await load()
        const key = `marketplace.success.${successKey}`
        const translated = t(key)
        const label = translated === key ? successKey : translated
        setActionSuccess(label)
        window.setTimeout(() => {
          setActionSuccess((cur) => (cur === label ? null : cur))
        }, 3000)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy((b) => {
          const next = { ...b }
          delete next[id]
          return next
        })
        setProgressById((p) => {
          const next = { ...p }
          delete next[id]
          return next
        })
      }
    },
    [load, t],
  )

  const confirmRemove = useCallback(
    (id: string) => {
      if (!window.confirm(t('marketplace.removeConfirm'))) return
      void run(id, () => window.electronAPI.removeMarketplaceEntry(id), 'remove', 'uninstall')
    },
    [run, t],
  )

  const copyOfflineReport = useCallback(async () => {
    const installedIds = Object.entries(view?.installs ?? {})
      .filter(([, lock]) => isArtifactInstalled(lock))
      .map(([id]) => id)
    const report = buildOfflineCapabilityReport({
      installedIds,
      online: false,
      generatedAt: Date.now(),
    })
    await navigator.clipboard.writeText(report)
    setCopiedReport(true)
    window.setTimeout(() => setCopiedReport(false), 3000)
  }, [view])

  const allTags = useMemo(() => {
    if (!view) return []
    const tags = new Set<string>()
    for (const entry of view.catalog.entries) {
      for (const tag of entry.tags ?? []) tags.add(tag)
    }
    return [...tags].sort((a, b) => a.localeCompare(b))
  }, [view])

  const tabCounts = useMemo(() => {
    const counts: Record<Exclude<MarketplaceTab, ''>, number> = {
      skillpack: 0,
      tool: 0,
      service: 0,
      rule: 0,
    }
    if (!view) return counts
    for (const e of view.catalog.entries) {
      if (entryMatchesTab(e, 'skillpack')) counts.skillpack++
      if (entryMatchesTab(e, 'tool')) counts.tool++
      if (entryMatchesTab(e, 'service')) counts.service++
      if (entryMatchesTab(e, 'rule')) counts.rule++
    }
    return counts
  }, [view])

  const installs: Record<string, MarketplaceLockRecord> = view?.installs ?? {}
  const selectedGroup = groups.find((group) => group.id === selectedGroupId)
  const entries = useMemo(() => {
    if (!view) return []
    const installedIds = new Set(
      Object.entries(installs)
        .filter(([, lock]) => isArtifactInstalled(lock))
        .map(([id]) => id),
    )
    return filterMarketplaceEntries(view.catalog.entries, {
      query,
      kind: tab,
      tags: selectedTags,
      installedOnly,
      installedIds,
      groupIds: selectedGroup ? new Set(selectedGroup.entryIds) : undefined,
      sort: sortKey,
      stats: statsMap,
      locale: i18n.language,
    })
  }, [view, installs, query, tab, selectedTags, installedOnly, selectedGroup, sortKey, statsMap, i18n.language])
  const entryState = (e: MarketplaceEntry): 'available' | 'installed' | 'update' | 'deferred' => {
    const lock = installs[e.id]
    if (!lock) return 'available'
    if (lock.status === 'installed' && !isArtifactInstalled(lock)) return 'available'
    if (lock.status === 'deferred') return 'deferred'
    return lock.ref === e.source.ref ? 'installed' : 'update'
  }
  const saveVisibleGroup = () => {
    const name = groupName.trim()
    if (!name || entries.length === 0) return
    const group: MarketplaceSavedGroup = {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name,
      entryIds: entries.map((entry) => entry.id),
    }
    setGroups((previous) => [...previous.filter((item) => item.name !== name), group])
    setSelectedGroupId(group.id)
    setGroupName('')
  }

  const runGroupAction = async (action: 'install' | 'uninstall') => {
    const group = groups.find((item) => item.id === selectedGroupId)
    if (!group || !view) return
    const byId = new Map(view.catalog.entries.map((entry) => [entry.id, entry]))
    const targets = group.entryIds
      .map((id) => byId.get(id))
      .filter((entry): entry is MarketplaceEntry => Boolean(entry))
      .filter((entry) => {
        const lock = installs[entry.id]
        const installed = lock ? isArtifactInstalled(lock) : false
        return action === 'install'
          ? !installed || lock?.status === 'deferred' || lock?.ref !== entry.source.ref
          : Boolean(lock)
      })
    if (!targets.length) return
    const operationId = `group:${group.id}`
    setBusy((previous) => ({ ...previous, [operationId]: 'busy' }))
    setError(null)
    setActionSuccess(null)
    const failures: string[] = []
    try {
      for (const entry of targets) {
        try {
          if (action === 'uninstall') {
            await window.electronAPI.removeMarketplaceEntry(entry.id)
          } else if (installs[entry.id]) {
            await window.electronAPI.updateMarketplaceEntry(entry.id)
          } else {
            await window.electronAPI.installMarketplaceEntry(entry.id)
          }
        } catch (err) {
          failures.push(`${entry.title}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      await load()
      if (failures.length) setError(t('marketplace.groupPartialFailure', { failures: failures.join('; ') }))
      else setActionSuccess(t(action === 'install' ? 'marketplace.groupInstalled' : 'marketplace.groupRemoved'))
    } finally {
      setBusy((previous) => {
        const next = { ...previous }
        delete next[operationId]
        return next
      })
    }
  }

  const resetFilters = () => {
    setQuery('')
    setTab('')
    setSelectedTags([])
    setSortKey('stars')
    setInstalledOnly(false)
    setSelectedGroupId('')
  }


  const tabs: Array<{ id: MarketplaceTab; labelKey: string }> = [
    { id: '', labelKey: 'marketplace.tabAll' },
    { id: 'skillpack', labelKey: 'marketplace.tabSkills' },
    { id: 'tool', labelKey: 'marketplace.tabTools' },
    { id: 'service', labelKey: 'marketplace.tabServices' },
    { id: 'rule', labelKey: 'marketplace.tabRules' },
  ]

  if (loading) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PanelHeader
          title={t('settings.marketplace.title')}
          actions={<HeaderMenu route={routes.view.settings('marketplace')} />}
        />
        <div className="flex-1 min-h-0 mask-fade-y overflow-hidden">
          <div className="px-5 pt-6 space-y-3 max-w-3xl mx-auto w-full animate-pulse">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="border border-border/60 rounded-lg p-4 flex items-start gap-4">
                <div className="p-2 rounded-lg bg-foreground/10 mt-1 h-9 w-9" />
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-4 w-1/3 rounded bg-foreground/10" />
                  <div className="h-3 w-2/3 rounded bg-foreground/10" />
                  <div className="h-3 w-1/2 rounded bg-foreground/10" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title={t('settings.marketplace.title')}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void refreshCatalog()}
              disabled={refreshing}
              className="text-xs px-2 py-1 rounded-md border border-border/50 hover:bg-muted disabled:opacity-40 flex items-center gap-1.5"
              title={t('marketplace.refresh')}
            >
              {refreshing ? <Spinner className="w-3 h-3" /> : null}
              {t('marketplace.refresh')}
            </button>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('craft:open-vps-browser'))}
              className="text-xs px-2 py-1 rounded-md border border-border/50 hover:bg-muted flex items-center gap-1.5"
              data-testid="marketplace-open-browser"
              title={t('browser.newWindow')}
            >
              {t('extensions.action.openBrowser')}
            </button>
            <HeaderMenu route={routes.view.settings('marketplace')} />
          </div>
        }
      />

      <div className="px-5 pt-4 max-w-3xl mx-auto w-full">
        {error ? (
          <div className="mb-3 border border-destructive/40 bg-destructive/10 text-destructive text-sm rounded-lg px-4 py-2">
            {error}
          </div>
        ) : null}
        {actionSuccess ? (
          <div className="mb-3 border border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 text-sm rounded-lg px-4 py-2">
            {actionSuccess}
          </div>
        ) : null}

        <div className="mb-4" data-testid="capability-packs">
        <SettingsCard className="mb-0">
          <SettingsCardContent>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium">{t('capabilities.title')}</div>
                <div className="text-xs text-muted-foreground mt-1">{t('capabilities.availableOnly')}</div>
                <div className="text-xs text-muted-foreground mt-1">{t('capabilities.highRiskOff')}</div>
              </div>
              <button
                type="button"
                onClick={() => void copyOfflineReport()}
                className="text-xs px-2 py-1 rounded-md border border-border/50 hover:bg-muted shrink-0"
              >
                {copiedReport ? t('capabilities.copiedReport') : t('capabilities.offlineReport')}
              </button>
            </div>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {CAPABILITY_PACKS.map((pack) => {
                const tools = CAPABILITY_TOOLS.filter((item) => item.packId === pack.id)
                const installedCount = tools.filter((item) => installs[item.id]?.status === 'installed').length
                return (
                  <li key={pack.id} className="text-xs border border-border/50 rounded-md px-2 py-1.5">
                    <div className="font-medium">{t(`capabilities.pack.${pack.id}`)}</div>
                    <div className="text-muted-foreground">
                      {installedCount}/{tools.length}
                    </div>
                  </li>
                )
              })}
            </ul>
          </SettingsCardContent>
        </SettingsCard>
        </div>

        {/* Tabs: Skills | Tools | Services | Rules */}
        <div
          role="tablist"
          className="flex flex-wrap gap-1 mb-3 border-b border-border/50 pb-2"
        >
          {tabs.map((item) => {
            const active = tab === item.id
            const count =
              item.id === ''
                ? view?.catalog.entries.length ?? 0
                : tabCounts[item.id as Exclude<MarketplaceTab, ''>]
            const Icon = item.id ? TAB_ICONS[item.id] : ShoppingBag
            return (
              <button
                key={item.id || 'all'}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(item.id)}
                className={
                  active
                    ? 'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-primary/10 text-primary font-medium'
                    : 'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md text-muted-foreground hover:bg-muted/60'
                }
              >
                <Icon className="w-3.5 h-3.5 opacity-70" />
                {t(item.labelKey)}
                <span className="text-[10px] opacity-60 tabular-nums">{count}</span>
              </button>
            )
          })}
        </div>

        {/* Controls: search/tags left, sort right */}
        <div className="flex flex-wrap gap-2 mb-3 items-center text-sm">
          <input
            className="border border-border/60 rounded-md px-3 py-1.5 outline-none focus:ring-1 focus:ring-ring bg-background min-w-[12rem]"
            placeholder={t('marketplace.search')}
            aria-label={t('marketplace.search')}
            value={query}
            onChange={(ev) => setQuery(ev.target.value)}
          />
          <label className="inline-flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={installedOnly}
              onChange={(event) => setInstalledOnly(event.target.checked)}
            />
            {t('marketplace.installedOnly')}
          </label>
          <PremiumMenuSelect
            aria-label={t('marketplace.savedGroup')}
            className="h-8 max-w-[200px]"
            items={[
              { id: '__all__', label: t('marketplace.allGroups') },
              ...groups.map((group) => ({ id: group.id, label: group.name })),
            ]}
            placeholder={t('marketplace.savedGroup')}
            selectedId={selectedGroupId || '__all__'}
            onSelect={(item) => setSelectedGroupId(item.id === '__all__' ? '' : item.id)}
          />
          <PremiumMenuSelect
            aria-label={t('marketplace.sortLabel')}
            className="h-8 max-w-[180px]"
            items={[
              { id: 'stars', label: t('marketplace.sortStars') },
              { id: 'downloads', label: t('marketplace.sortDownloads') },
              { id: 'updated', label: t('marketplace.sortUpdated') },
              { id: 'name', label: t('marketplace.sortName') },
            ]}
            placeholder={t('marketplace.sortLabel')}
            selectedId={sortKey}
            onSelect={(item) => setSortKey(item.id as SortKey)}
          />
          <button
            type="button"
            className="text-xs px-2 py-1.5 rounded-md border border-border/50 hover:bg-muted"
            onClick={resetFilters}
          >
            {t('marketplace.resetFilters')}
          </button>
        </div>
        {allTags.length > 0 ? (
          <fieldset className="flex flex-wrap gap-x-3 gap-y-1 mb-3 text-xs">
            <legend className="sr-only">{t('marketplace.filterAllTags')}</legend>
            {allTags.map((tag) => (
              <label key={tag} className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={selectedTags.includes(tag)}
                  onChange={() =>
                    setSelectedTags((previous) =>
                      previous.includes(tag)
                        ? previous.filter((selected) => selected !== tag)
                        : [...previous, tag].sort((a, b) => a.localeCompare(b)),
                    )
                  }
                />
                <span>#{tag}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input
            className="border border-border/60 rounded-md px-3 py-1.5 text-xs bg-background"
            aria-label={t('marketplace.groupName')}
            placeholder={t('marketplace.groupName')}
            value={groupName}
            onChange={(event) => setGroupName(event.target.value)}
          />
          <button
            type="button"
            className="text-xs px-2.5 py-1.5 rounded-md border border-border/50 hover:bg-muted disabled:opacity-40"
            disabled={!groupName.trim() || entries.length === 0}
            onClick={saveVisibleGroup}
          >
            {t('marketplace.saveVisibleGroup')}
          </button>
          {selectedGroup ? (
            <>
              <button
                type="button"
                className="text-xs px-2.5 py-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40"
                disabled={Boolean(busy[`group:${selectedGroup.id}`])}
                onClick={() => void runGroupAction('install')}
              >
                {t('marketplace.groupInstall')}
              </button>
              <button
                type="button"
                className="text-xs px-2.5 py-1.5 rounded-md border border-border/50 hover:bg-muted disabled:opacity-40"
                disabled={Boolean(busy[`group:${selectedGroup.id}`])}
                onClick={() => void runGroupAction('uninstall')}
              >
                {t('marketplace.groupUninstall')}
              </button>
              <button
                type="button"
                className="text-xs px-2.5 py-1.5 rounded-md border border-border/50 hover:bg-muted"
                onClick={() => {
                  setGroups((previous) => previous.filter((group) => group.id !== selectedGroup.id))
                  setSelectedGroupId('')
                }}
              >
                {t('marketplace.groupDelete')}
              </button>
            </>
          ) : null}
        </div>
        <div className="text-xs text-muted-foreground mb-2" aria-live="polite">
          {t('marketplace.resultsCount', { count: entries.length })}
          {view ? ` · ${t('marketplace.catalogOrigin', { origin: t(`marketplace.origin.${view.origin}`) })}` : null}
        </div>
        {view?.error ? (
          <div className="text-xs text-amber-700 dark:text-amber-300 mb-3" role="status">
            {t('marketplace.catalogStale', { error: view.error })}
          </div>
        ) : null}
      </div>

      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 pb-8 space-y-3 max-w-3xl mx-auto w-full">
            {entries.length === 0 ? (
              <div className="text-center py-12 border border-border/60 rounded-lg">
                <ShoppingBag className="w-12 h-12 mx-auto mb-4 opacity-40" />
                <div className="text-sm font-medium">{t('marketplace.emptyTitle')}</div>
                <div className="text-xs opacity-70 mt-1">{t('marketplace.emptyDescription')}</div>
              </div>
            ) : (
              entries.map((e) => {
                const st = statsMap[e.id]
                const state = entryState(e)
                const isBusy = busy[e.id] === 'busy'
                const Icon = KIND_ICONS[e.kind]
                const ghUrl = githubTreeUrl(e.source.repo, e.source.ref)
                return (
                  <SettingsCard key={e.id} divided={false}>
                    <SettingsCardContent className="flex items-start gap-4">
                    <div className="p-2 rounded-lg bg-primary/10 text-primary mt-1">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                            {e.title}
                            <span className="text-xs px-2 py-0.5 border border-border/50 rounded-full opacity-70">
                              {t(`marketplace.kind.${e.kind}`)}
                            </span>
                            {typeof e.sizeHintKb === 'number' && e.sizeHintKb > 0 ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground whitespace-nowrap">
                                {formatSizeHint(e.sizeHintKb)}
                              </span>
                            ) : null}
                            {e.license ? (
                              <span className="text-[10px] opacity-60">{e.license}</span>
                            ) : null}
                          </div>
                          <div className="text-xs opacity-70 mt-1 break-words">
                            {e.descriptionRu}
                          </div>
                          {isBusy && progressById[e.id] ? (
                            <div className="text-[11px] mt-1 text-primary/80 font-mono truncate">
                              {progressById[e.id]}
                            </div>
                          ) : null}
                        </div>

                        <div className="text-xs text-right whitespace-nowrap shrink-0 min-w-[4.5rem]">
                          {st && !st.error ? (
                            <>
                              {typeof st.stars === 'number' ? (
                                <div className="flex items-center justify-end gap-1.5 font-medium">
                                  <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                                  {formatCompact(st.stars, i18n.language)}
                                </div>
                              ) : null}
                              {typeof st.npmWeeklyDownloads === 'number' ||
                              typeof st.githubReleaseDownloads === 'number' ? (
                                <div className="mt-1 opacity-80 flex items-center justify-end gap-1.5">
                                  <DownloadCloud className="w-3 h-3" />
                                  <span title={t('marketplace.downloadsHint')}>
                                    {formatCompact(
                                      (st.npmWeeklyDownloads ?? 0) +
                                        (st.githubReleaseDownloads ?? 0),
                                      i18n.language,
                                    )}
                                  </span>
                                </div>
                              ) : null}
                              {st.pushedAt ? (
                                <div className="mt-1 opacity-60 flex items-center justify-end gap-1.5">
                                  <Clock className="w-3 h-3" />
                                  {formatRelativeDays(t, st.pushedAt, 'marketplace.updatedDaysAgo')}
                                </div>
                              ) : null}
                              {st.stale ? (
                                <div className="mt-0.5 text-[10px] opacity-50">
                                  {t('marketplace.statsStale')}
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <div className="opacity-40 tabular-nums" title={t('marketplace.statsUnavailable')}>
                              —
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Wrapping footer: tags/permissions and actions never overlap. */}
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                          <span
                            title={`${e.source.repo}@${e.source.ref}`}
                            className="group relative text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground cursor-help inline-flex items-center gap-1"
                          >
                            {e.source.repo}@{e.source.ref.slice(0, 8)}
                            <span className="pointer-events-none absolute bottom-full left-0 z-30 mb-1 hidden w-max max-w-xs rounded-md border border-border bg-popover px-2 py-1.5 text-[10px] text-popover-foreground shadow-modal-small group-hover:block">
                              <span className="font-mono break-all">{e.source.ref}</span>
                              {ghUrl ? (
                                <a
                                  href={ghUrl}
                                  className="mt-1 flex items-center gap-1 text-primary underline pointer-events-auto"
                                  onClick={(ev) => {
                                    ev.preventDefault()
                                    void window.electronAPI.openUrl(ghUrl)
                                  }}
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  {t('marketplace.openOnGitHub')}
                                </a>
                              ) : null}
                            </span>
                          </span>
                          {groupExtensionPermissions(permissionsForMarketplaceKind(e.kind)).map((group) => (
                            <span key={group.group} className="inline-flex items-center gap-1 flex-wrap">
                              <span className="text-[10px] uppercase tracking-wide opacity-50">
                                {t(`extensions.permissionGroup.${group.group}`, { defaultValue: group.group })}
                              </span>
                              {group.permissions.map((permission) => (
                            <span
                              key={permission}
                              data-marketplace-permission={permission}
                              className={`text-[10px] px-2 py-0.5 rounded-full font-mono border ${
                                isHighRiskMarketplacePermission(permission)
                                  ? 'border-amber-500/60 text-amber-700 dark:text-amber-300 bg-amber-500/10'
                                  : 'bg-muted text-muted-foreground'
                              }`}
                            >
                              {permission}
                            </span>
                              ))}
                            </span>
                          ))}
                          {e.tags?.slice(0, 3).map((tag) => (
                            <span key={tag} className="text-[10px] opacity-60">
                              #{tag}
                            </span>
                          ))}
                        </div>
                        <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
                          {state === 'installed' ? (
                            <>
                              <span className="whitespace-nowrap text-xs py-1 px-3 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" />
                                {t('marketplace.installed')}
                              </span>
                              <button
                                type="button"
                                onClick={() => confirmRemove(e.id)}
                                disabled={isBusy}
                                className="text-xs px-3 py-1 rounded-md border hover:bg-muted disabled:opacity-40"
                              >
                                {t('marketplace.remove')}
                              </button>
                            </>
                          ) : state === 'deferred' ? (
                            <>
                              <div className="flex flex-col items-end gap-1">
                                <span className="text-xs py-1 px-3 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 flex items-center gap-1">
                                  {t('marketplace.deferred')}
                                </span>
                                <span className="text-[10px] opacity-60 max-w-[14rem] text-right leading-snug">
                                  {t('marketplace.deferredHint')}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  void run(e.id, () => window.electronAPI.updateMarketplaceEntry(e.id), 'update', 'install')
                                }
                                disabled={isBusy}
                                className="text-xs px-4 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 flex items-center gap-1.5 disabled:opacity-40"
                              >
                                {isBusy ? <Spinner className="w-3 h-3" /> : null}
                                {t('marketplace.retry')}
                              </button>
                              <button
                                type="button"
                                onClick={() => confirmRemove(e.id)}
                                disabled={isBusy}
                                className="text-xs px-3 py-1 rounded-md border hover:bg-muted disabled:opacity-40"
                              >
                                {t('marketplace.remove')}
                              </button>
                            </>
                          ) : state === 'update' ? (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  void run(e.id, () => window.electronAPI.updateMarketplaceEntry(e.id), 'update', 'install')
                                }
                                disabled={isBusy}
                                className="text-xs px-4 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 flex items-center gap-1.5 disabled:opacity-40"
                              >
                                {isBusy ? <Spinner className="w-3 h-3" /> : null}
                                {t('marketplace.update')}
                              </button>
                              <button
                                type="button"
                                onClick={() => confirmRemove(e.id)}
                                disabled={isBusy}
                                className="text-xs px-3 py-1 rounded-md border hover:bg-muted disabled:opacity-40"
                              >
                                {t('marketplace.remove')}
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                void run(e.id, () => window.electronAPI.installMarketplaceEntry(e.id), 'install', 'install')
                              }
                              disabled={isBusy}
                              className="text-xs px-4 py-1 rounded-md bg-primary text-primary-foreground hover:opacity-90 flex items-center gap-1.5 disabled:opacity-40"
                            >
                              {isBusy ? <Spinner className="w-3 h-3" /> : null}
                              {t('marketplace.install')}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    </SettingsCardContent>
                  </SettingsCard>
                )
              })
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
