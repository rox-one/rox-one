/**
 * Settings → Extensions (S-05 / W5 Extension Center).
 *
 * Unified catalog + installed projections (skills/sources/automations/marketplace).
 * Install for curated marketplace entries delegates to marketplace.install.
 * Install for SiYuan Bazaar entries delegates to pluginBridge.installBazaar
 * (kernel-only; Craft never downloads the plugin zip).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Blocks,
  CheckCircle2,
  DownloadCloud,
  Package,
  RefreshCw,
  Shield,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Wrench,
  FileText,
  AlertTriangle,
  Globe,
} from 'lucide-react'

import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { Spinner } from '@craft-agent/ui'
import { navigate, routes } from '@/lib/navigate'
import { SIYUAN_FULL_SURFACE_ID } from '@/knowledge/siyuan-url'
import { isClaimableLive } from '@craft-agent/core/rox2'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type {
  CatalogCategory,
  CatalogEntry,
  ExtensionHostStatus,
  ExtensionPermission,
  ExtensionRecord,
  ExtensionRuntime,
  ExtensionsListCatalogResult,
  ExtensionsListInstalledResult,
} from '@craft-agent/shared/extensions/browser'
import {
  CATALOG_CATEGORIES,
  EXTENSION_CENTER_GROUPS,
  countInstalledExtensionRecords,
  groupExtensionCenterRecords,
  groupExtensionPermissions,
  HIGH_RISK_PERMISSIONS,
} from '@craft-agent/shared/extensions/browser'
import { useAtomValue } from 'jotai'
import { featureWorkbenchHarnessExtCenterV1Atom } from '@/atoms/unified-shell'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { settingsPageActionResult } from './settings-rox2-surface'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'extensions',
}

type SectionId =
  | 'catalog'
  | 'installed'
  | 'updates'
  | 'permissions'
  | 'disabled'
  | 'developer'
  | 'registries'

type CategoryFilter = CatalogCategory | 'all'

const SECTIONS: SectionId[] = [
  'catalog',
  'installed',
  'updates',
  'permissions',
  'disabled',
  'developer',
  'registries',
]

function isHighRisk(perm: ExtensionPermission): boolean {
  if (perm.startsWith('secrets.use:')) return true
  return (HIGH_RISK_PERMISSIONS as readonly string[]).includes(perm)
}

/** Parse compat level from extension tags (`compat-lN` or `level:N`). */
function parseCompatLevelFromTags(tags?: string[]): 0 | 1 | 2 | 3 | undefined {
  if (!tags?.length) return undefined
  for (const tag of tags) {
    const compat = /^compat-l([0-3])$/i.exec(tag)
    if (compat) return Number(compat[1]) as 0 | 1 | 2 | 3
    const level = /^level:([0-3])$/i.exec(tag)
    if (level) return Number(level[1]) as 0 | 1 | 2 | 3
  }
  return undefined
}

function tagsRequireFullChrome(tags?: string[]): boolean {
  if (!tags?.length) return false
  return tags.some((t) => t === 'requiresFullChrome' || t === 'requires-full-chrome')
}

function ExtensionCard({
  name,
  version,
  description,
  runtime,
  category,
  permissions,
  worksIn,
  installTarget,
  status,
  providerLabel,
  readOnly,
  busy,
  onInstall,
  onUpdate,
  onUninstall,
  onToggle,
  marketplaceId,
  compatLevel,
  requiresFullChrome,
  onOpenCompat,
  origin,
}: {
  name: string
  version: string
  description?: string
  runtime: ExtensionRuntime
  category: string
  permissions: ExtensionPermission[]
  worksIn: string[]
  installTarget?: string
  status?: string
  providerLabel?: string
  readOnly?: boolean
  busy?: boolean
  onInstall?: () => void
  onUpdate?: () => void
  onUninstall?: () => void
  onToggle?: (enabled: boolean) => void
  marketplaceId?: string
  compatLevel?: 0 | 1 | 2 | 3
  requiresFullChrome?: boolean
  onOpenCompat?: () => void
  origin?: string
}) {
  const { t } = useTranslation()
  const enabled = status === 'enabled' || status === 'installed' || status === 'update-available'
  const available = status === 'available' || (!status && marketplaceId)
  const updateAvailable = status === 'update-available'
  const showOpenFullSiyuan =
    runtime === 'siyuan-plugin' &&
    (compatLevel === 0 ||
      compatLevel === 1 ||
      Boolean(requiresFullChrome) ||
      typeof onOpenCompat === 'function')

  return (
    <div className="border rounded-lg p-4 space-y-3 bg-background/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold truncate">{name}</h3>
            <span className="text-xs opacity-60">v{version}</span>
            {compatLevel != null ? (
              <span
                className="text-[10px] uppercase tracking-wide border rounded px-1.5 py-0.5 font-mono opacity-80"
                title={t('extensions.card.compatLevelHint', {
                  level: compatLevel,
                })}
              >
                {t('extensions.card.compatLevel', {
                  level: compatLevel,
                })}
              </span>
            ) : null}
            {status ? (
              <span className="text-[10px] uppercase tracking-wide opacity-70 border rounded px-1.5 py-0.5">
                {t(`extensions.status.${status}`, { defaultValue: status })}
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-xs opacity-70 flex flex-wrap gap-2">
            <span>{t(`extensions.category.${category}`, { defaultValue: category })}</span>
            {providerLabel ? <span>· {providerLabel}</span> : null}
            {readOnly ? (
              <span className="inline-flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {t('extensions.card.readOnly')}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {showOpenFullSiyuan ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onOpenCompat?.()}
              className="inline-flex items-center gap-1 text-xs border rounded-md px-2 py-1 hover:bg-muted disabled:opacity-50"
            >
              {t('extensions.action.openFullSiyuan')}
            </button>
          ) : null}
          {permissions.includes('browser.open') ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => window.dispatchEvent(new CustomEvent('craft:open-vps-browser'))}
              className="inline-flex items-center gap-1 text-xs border rounded-md px-2 py-1 hover:bg-muted disabled:opacity-50"
              data-testid="extensions-open-browser"
            >
              <Globe className="w-3.5 h-3.5" />
              {t('extensions.action.openBrowser')}
            </button>
          ) : null}
          {onToggle && !available ? (
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              disabled={busy}
              onClick={() => onToggle(!enabled)}
              className={`inline-flex items-center gap-1.5 text-xs border rounded-md px-2 py-1 disabled:opacity-50 ${
                enabled
                  ? 'bg-emerald-500/15 border-emerald-600/40 text-emerald-800 dark:text-emerald-200'
                  : 'bg-muted/70 border-border text-muted-foreground'
              }`}
              title={
                enabled
                  ? t('extensions.action.disable')
                  : t('extensions.action.enable')
              }
            >
              {enabled ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
              <span className="font-medium">
                {enabled
                  ? t('extensions.status.enabled')
                  : t('extensions.status.disabled')}
              </span>
            </button>
          ) : null}
          {onUpdate && updateAvailable ? (
            <button
              type="button"
              disabled={busy}
              onClick={onUpdate}
              className="inline-flex items-center gap-1 text-xs border rounded-md px-2 py-1 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
            >
              {busy ? <Spinner className="w-3 h-3" /> : <RefreshCw className="w-3.5 h-3.5" />}
              {t('marketplace.update')}
            </button>
          ) : null}
          {onUninstall && !available ? (
            <button
              type="button"
              disabled={busy}
              onClick={onUninstall}
              className="inline-flex items-center gap-1 text-xs border rounded-md px-2 py-1 hover:bg-muted disabled:opacity-50"
            >
              {busy ? <Spinner className="w-3 h-3" /> : <Trash2 className="w-3.5 h-3.5" />}
              {t('marketplace.remove')}
            </button>
          ) : null}
          {onInstall && available ? (
            <button
              type="button"
              disabled={busy}
              onClick={onInstall}
              className="inline-flex items-center gap-1 text-xs border rounded-md px-2 py-1 hover:bg-muted disabled:opacity-50"
            >
              {busy ? <Spinner className="w-3 h-3" /> : <DownloadCloud className="w-3.5 h-3.5" />}
              {t('extensions.action.install')}
            </button>
          ) : null}
        </div>
      </div>

      {description ? <p className="text-sm opacity-80 line-clamp-3">{description}</p> : null}

      <div className="grid gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <RuntimeBadge runtime={runtime} />
          {origin ? (
            <span className="opacity-70" data-extension-origin={origin}>
              {t(`extensions.origin.${origin}`, { defaultValue: origin })}
            </span>
          ) : null}
          {installTarget ? (
            <span className="opacity-70">
              {t('extensions.card.installTarget')}:{' '}
              <span className="font-medium">
                {t(`extensions.installTarget.${installTarget}`, { defaultValue: installTarget })}
              </span>
            </span>
          ) : null}
        </div>
        <div>
          <div className="opacity-70 mb-1">
            {t('extensions.card.worksIn')}
          </div>
          <div className="flex flex-wrap gap-1">
            {worksIn.length ? (
              worksIn.map((w) => (
                <span key={w} className="rounded bg-muted px-1.5 py-0.5">
                  {w}
                </span>
              ))
            ) : (
              <span className="opacity-50">—</span>
            )}
          </div>
        </div>
        <div>
          <div className="opacity-70 mb-1">
            {t('extensions.card.permissions', {
              count: permissions.length,
            })}{' '}
            ({permissions.length})
          </div>
          <PermissionsList permissions={permissions} />
        </div>
      </div>
    </div>
  )
}

function RuntimeBadge({ runtime }: { runtime: ExtensionRuntime }) {
  const { t } = useTranslation()
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium opacity-90"
      title={t(`extensions.runtime.${runtime}.hint`, {
        defaultValue: runtime,
      })}
    >
      <span className="opacity-70">{t('extensions.card.runtime')}:</span>
      {t(`extensions.runtime.${runtime}`, { defaultValue: runtime })}
    </span>
  )
}

function PermissionsList({ permissions }: { permissions: ExtensionPermission[] }) {
  const { t } = useTranslation()
  if (!permissions.length) {
    return (
      <span className="text-xs opacity-60">
        {t('extensions.card.noPermissions')}
      </span>
    )
  }
  const groups = groupExtensionPermissions(permissions)
  return (
    <div className="space-y-2" data-testid="extensions-permission-groups">
      {groups.map((group) => (
        <div key={group.group} className="space-y-1">
          <div className="text-[10px] uppercase tracking-wide opacity-60 font-medium">
            {t(`extensions.permissionGroup.${group.group}`, { defaultValue: group.group })}
          </div>
          <div className="flex flex-wrap gap-1">
            {group.permissions.map((p) => (
              <span
                key={p}
                className={`rounded px-1.5 py-0.5 text-[10px] font-mono border ${
                  isHighRisk(p)
                    ? 'border-amber-500/60 text-amber-700 dark:text-amber-300 bg-amber-500/10'
                    : 'opacity-80'
                }`}
              >
                {p}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function ExtensionsSettingsPage() {
  const { t } = useTranslation()
  const unifiedCenter = useAtomValue(featureWorkbenchHarnessExtCenterV1Atom)
  const activeWorkspace = useActiveWorkspace()
  const workspaceId = activeWorkspace?.id
  const [section, setSection] = useState<SectionId>('catalog')
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [query, setQuery] = useState('')
  const [catalog, setCatalog] = useState<ExtensionsListCatalogResult | null>(null)
  const [installed, setInstalled] = useState<ExtensionsListInstalledResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [actionMsg, setActionMsg] = useState<string | null>(null)
  const [hostStatus, setHostStatus] = useState<ExtensionHostStatus | null>(null)
  const [allHosts, setAllHosts] = useState<Array<{ workspaceId: string } & ExtensionHostStatus>>([])
  const [allowlistExtId, setAllowlistExtId] = useState('')
  const [allowlistPrefixes, setAllowlistPrefixes] = useState<string[]>([])
  const [newPrefix, setNewPrefix] = useState('')
  type CapabilityLedgerRow = {
    tokenHash: string
    extensionId: string
    permission: string
    expiresAt: number
    mintedAt: number
    singleUse?: boolean
    revokedAt?: number
    status: 'active' | 'revoked' | 'expired'
  }
  const [capabilityLedger, setCapabilityLedger] = useState<{
    minted: CapabilityLedgerRow[]
    revoked: CapabilityLedgerRow[]
  }>({ minted: [], revoked: [] })

  type ExtensionHostDevApi = typeof window.electronAPI & {
    extensionHostStatus?: (args?: { workspaceId?: string | null }) => Promise<ExtensionHostStatus>
    extensionHostStatusAll?: () => Promise<Array<{ workspaceId: string } & ExtensionHostStatus>>
    extensionHostStart?: (args?: { workspaceId?: string | null }) => Promise<ExtensionHostStatus>
    extensionHostStop?: (args?: { workspaceId?: string | null }) => Promise<ExtensionHostStatus>
    extensionHostRestart?: (args?: { workspaceId?: string | null }) => Promise<ExtensionHostStatus>
    extensionHostGetUrlAllowlist?: (args: {
      extensionId: string
    }) => Promise<{ prefixes: string[] }>
    extensionHostSetUrlAllowlist?: (args: {
      extensionId: string
      prefixes: string[]
    }) => Promise<{ prefixes: string[] }>
    extensionHostListCapabilities?: (args?: {
      workspaceId?: string | null
    }) => Promise<{ minted: CapabilityLedgerRow[]; revoked: CapabilityLedgerRow[] }>
    extensionHostRevokeCapability?: (args: {
      tokenHash?: string
      extensionId?: string
      workspaceId?: string | null
    }) => Promise<{ ok: true }>
  }

  const prefixesFrom = (value: { prefixes: string[] } | string[] | null | undefined): string[] | null => {
    if (!value) return null
    if (Array.isArray(value)) return value
    return Array.isArray(value.prefixes) ? value.prefixes : null
  }

  const load = useCallback(async () => {
    try {
      const categoryFilter = unifiedCenter || category === 'all' ? undefined : category
      const filter =
        !categoryFilter && !query
          ? undefined
          : {
              category: categoryFilter,
              query: query.trim() || undefined,
            }
      const api = window.electronAPI as ExtensionHostDevApi
      const statusCall = api.extensionHostStatus
        ? api.extensionHostStatus({ workspaceId: workspaceId ?? undefined }).catch(() => null)
        : Promise.resolve(null)
      const statusAllCall = api.extensionHostStatusAll
        ? api.extensionHostStatusAll().catch(() => [] as Array<{ workspaceId: string } & ExtensionHostStatus>)
        : Promise.resolve([] as Array<{ workspaceId: string } & ExtensionHostStatus>)
      const allowlistCall =
        allowlistExtId.trim() && api.extensionHostGetUrlAllowlist
          ? api
              .extensionHostGetUrlAllowlist({ extensionId: allowlistExtId.trim() })
              .catch(() => null as { prefixes: string[] } | null)
          : Promise.resolve(null as { prefixes: string[] } | null)
      const ledgerCall = api.extensionHostListCapabilities
        ? api
            .extensionHostListCapabilities({ workspaceId: workspaceId ?? undefined })
            .catch(() => ({ minted: [] as CapabilityLedgerRow[], revoked: [] as CapabilityLedgerRow[] }))
        : Promise.resolve({ minted: [] as CapabilityLedgerRow[], revoked: [] as CapabilityLedgerRow[] })

      const [cat, inst, host, hosts, prefixes, ledger] = await Promise.all([
        window.electronAPI.extensionsListCatalog({ filter }),
        window.electronAPI.extensionsListInstalled({
          workspaceId: workspaceId ?? undefined,
        }),
        statusCall,
        statusAllCall,
        allowlistCall,
        ledgerCall,
      ])
      setCatalog(cat)
      setInstalled(inst)
      setHostStatus(host)
      setAllHosts(hosts ?? [])
      if (prefixes) {
        const list = prefixesFrom(prefixes)
        if (list) setAllowlistPrefixes(list)
      }
      setCapabilityLedger({
        minted: Array.isArray(ledger?.minted) ? ledger.minted : [],
        revoked: Array.isArray(ledger?.revoked) ? ledger.revoked : [],
      })
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [category, query, workspaceId, allowlistExtId, unifiedCenter])

  useEffect(() => {
    void load()
    const off = window.electronAPI.onExtensionsChanged?.(() => {
      void load()
    })
    const offMp = window.electronAPI.onMarketplaceChanged?.(() => {
      void load()
    })
    return () => {
      off?.()
      offMp?.()
    }
  }, [load])

  const runBusy = useCallback(
    async (id: string, fn: () => Promise<void>, action: 'install' | 'uninstall' | 'toggle' | 'pref-write') => {
      const gate = settingsPageActionResult({
        pageId: 'extensions',
        action,
        source: 'native',
        granted: action === 'toggle' || action === 'pref-write' ? undefined : true,
      })
      if (!isClaimableLive(gate)) {
        setError(t('settings.rox2.grantRequired'))
        return
      }
      setBusy((b) => ({ ...b, [id]: true }))
      try {
        await fn()
        setActionMsg(t('extensions.action.success'))
        window.setTimeout(() => setActionMsg(null), 2500)
        await load()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy((b) => {
          const next = { ...b }
          delete next[id]
          return next
        })
      }
    },
    [load, t],
  )

  const catalogEntries = catalog?.entries ?? []
  const installedRecords = installed?.records ?? []

  const filteredInstalled = useMemo(() => {
    let list = installedRecords
    if (!unifiedCenter && category !== 'all') list = list.filter((r) => r.category === category)
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      list = list.filter((r) =>
        [r.manifest.name, r.description ?? '', r.id, ...(r.tags ?? [])]
          .join(' ')
          .toLowerCase()
          .includes(q),
      )
    }
    return list
  }, [installedRecords, category, query, unifiedCenter])

  const centerGroups = useMemo(
    () => groupExtensionCenterRecords(filteredInstalled),
    [filteredInstalled],
  )

  const updates = useMemo(
    () => installedRecords.filter((r) => r.status === 'update-available'),
    [installedRecords],
  )
  const disabled = useMemo(
    () => installedRecords.filter((r) => r.status === 'disabled'),
    [installedRecords],
  )

  const installedCounts = useMemo(
    () => countInstalledExtensionRecords(filteredInstalled),
    [filteredInstalled],
  )

  const permissionRows = useMemo(() => {
    return installedRecords.map((r) => ({
      id: r.id,
      name: r.manifest.name,
      permissions: r.manifest.permissions,
      status: r.status,
    }))
  }, [installedRecords])

  const providerLabel = useCallback(
    (providerId: string) =>
      catalog?.providers.find((p) => p.id === providerId)?.label ?? providerId,
    [catalog],
  )

  const hostLifecycle = useCallback(
    async (action: 'start' | 'stop' | 'restart') => {
      const api = window.electronAPI as ExtensionHostDevApi
      const fn =
        action === 'start'
          ? api.extensionHostStart
          : action === 'stop'
            ? api.extensionHostStop
            : api.extensionHostRestart
      if (!fn) {
        setError(`extensionHost${action[0]!.toUpperCase()}${action.slice(1)} unavailable`)
        return
      }
      await runBusy(`host-${action}`, async () => {
        await fn({ workspaceId: workspaceId ?? undefined })
      }, 'pref-write')
    },
    [runBusy, workspaceId],
  )

  const loadAllowlist = useCallback(async () => {
    const id = allowlistExtId.trim()
    if (!id) {
      setAllowlistPrefixes([])
      return
    }
    const api = window.electronAPI as ExtensionHostDevApi
    if (!api.extensionHostGetUrlAllowlist) {
      setError('extensionHostGetUrlAllowlist unavailable')
      return
    }
    try {
      const result = await api.extensionHostGetUrlAllowlist({ extensionId: id })
      setAllowlistPrefixes(prefixesFrom(result) ?? [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [allowlistExtId])

  const saveAllowlist = useCallback(async () => {
    const id = allowlistExtId.trim()
    if (!id) return
    const api = window.electronAPI as ExtensionHostDevApi
    if (!api.extensionHostSetUrlAllowlist) {
      setError('extensionHostSetUrlAllowlist unavailable')
      return
    }
    await runBusy('allowlist-save', async () => {
      const next = await api.extensionHostSetUrlAllowlist!({
        extensionId: id,
        prefixes: allowlistPrefixes,
      })
      setAllowlistPrefixes(prefixesFrom(next) ?? allowlistPrefixes)
    }, 'pref-write')
  }, [allowlistExtId, allowlistPrefixes, runBusy])

  const addAllowlistPrefix = useCallback(() => {
    const prefix = newPrefix.trim()
    if (!prefix) return
    setAllowlistPrefixes((prev) => (prev.includes(prefix) ? prev : [...prev, prefix]))
    setNewPrefix('')
  }, [newPrefix])

  const removeAllowlistPrefix = useCallback((prefix: string) => {
    setAllowlistPrefixes((prev) => prev.filter((p) => p !== prefix))
  }, [])

  const revokeCapabilityHash = useCallback(
    async (tokenHash: string) => {
      const api = window.electronAPI as ExtensionHostDevApi
      if (!api.extensionHostRevokeCapability) {
        setError('extensionHostRevokeCapability unavailable')
        return
      }
      await runBusy(`cap-revoke-${tokenHash.slice(0, 8)}`, async () => {
        await api.extensionHostRevokeCapability!({
          tokenHash,
          workspaceId: workspaceId ?? undefined,
        })
      }, 'uninstall')
    },
    [runBusy, workspaceId],
  )

  const openSiyuanCompat = useCallback(() => {
    navigate(routes.view.siyuan({ kind: 'notebook', id: SIYUAN_FULL_SURFACE_ID }))
  }, [])


  const renderCatalogCard = (entry: CatalogEntry) => {
    const installedMatch = installedRecords.find((r) => r.id === entry.id)
    const status = installedMatch?.status ?? 'available'
    const marketplaceId = entry.marketplaceId ?? installedMatch?.marketplaceId
    const curatedInstalled = Boolean(marketplaceId && installedMatch)
    const tags = entry.tags ?? installedMatch?.tags
    const compatLevel = parseCompatLevelFromTags(tags)
    const requiresFullChrome = tagsRequireFullChrome(tags)
    const bazaarCoords = entry.bazaar
    const isSiyuanBazaar =
      entry.providerId === 'siyuan-bazaar' || entry.runtime === 'siyuan-plugin'
    const canInstallBazaar =
      Boolean(bazaarCoords) && status === 'available' && isSiyuanBazaar
    const canInstallMarketplace = Boolean(marketplaceId) && status === 'available'
    const bareBazaarName = entry.id.startsWith('siyuan-plugin:')
      ? entry.id.slice('siyuan-plugin:'.length)
      : entry.id
    const canUninstallBazaar =
      isSiyuanBazaar && Boolean(installedMatch) && !installedMatch?.readOnly
    return (
      <ExtensionCard
        key={entry.id}
        name={entry.name}
        version={entry.version}
        description={entry.description}
        runtime={entry.runtime}
        category={entry.category}
        permissions={entry.permissions}
        worksIn={entry.worksIn}
        installTarget={entry.installTarget}
        status={status}
        providerLabel={providerLabel(entry.providerId)}
        busy={Boolean(busy[entry.id])}
        marketplaceId={marketplaceId}
        compatLevel={compatLevel}
        requiresFullChrome={requiresFullChrome}
        onOpenCompat={
          entry.runtime === 'siyuan-plugin' || installedMatch?.manifest.runtime === 'siyuan-plugin'
            ? openSiyuanCompat
            : undefined
        }
        onInstall={
          canInstallBazaar && bazaarCoords
            ? () =>
                void runBusy(entry.id, async () => {
                  await window.electronAPI.pluginBridgeInstallBazaar({
                    packageName: bazaarCoords.packageName,
                    repoURL: bazaarCoords.repoURL,
                    repoHash: bazaarCoords.repoHash,
                  })
                }, 'install')
            : canInstallMarketplace
              ? () =>
                  void runBusy(entry.id, async () => {
                    await window.electronAPI.installMarketplaceEntry(marketplaceId!)
                  }, 'install')
              : undefined
        }
        onUpdate={
          curatedInstalled && status === 'update-available'
            ? () =>
                void runBusy(entry.id, async () => {
                  await window.electronAPI.updateMarketplaceEntry(marketplaceId!)
                }, 'install')
            : undefined
        }
        onUninstall={
          canUninstallBazaar
            ? () =>
                void runBusy(entry.id, async () => {
                  await window.electronAPI.pluginBridgeUninstallBazaar({
                    packageName: bareBazaarName,
                  })
                }, 'uninstall')
            : curatedInstalled
              ? () =>
                  void runBusy(entry.id, async () => {
                    await window.electronAPI.removeMarketplaceEntry(marketplaceId!)
                  }, 'uninstall')
              : undefined
        }
        onToggle={
          installedMatch
            ? (enabled) =>
                void runBusy(entry.id, async () => {
                  await window.electronAPI.extensionsSetEnabled({ id: entry.id, enabled })
                }, 'toggle')
            : undefined
        }
      />
    )
  }

  const renderRecordCard = (record: ExtensionRecord) => {
    const marketplaceId = record.marketplaceId
    const curated = Boolean(marketplaceId) && !record.readOnly
    const compatLevel = parseCompatLevelFromTags(record.tags)
    const requiresFullChrome = tagsRequireFullChrome(record.tags)
    const isSiyuanBazaar =
      record.providerId === 'siyuan-bazaar' || record.manifest.runtime === 'siyuan-plugin'
    const bareBazaarName = record.id.startsWith('siyuan-plugin:')
      ? record.id.slice('siyuan-plugin:'.length)
      : record.id
    const canUninstallBazaar = isSiyuanBazaar && !record.readOnly
    return (
      <ExtensionCard
        key={record.id}
        name={record.manifest.name}
        version={record.manifest.version}
        description={record.description}
        runtime={record.manifest.runtime}
        category={record.category}
        permissions={record.manifest.permissions}
        worksIn={record.worksIn}
        installTarget={record.installTarget}
        status={record.status}
        providerLabel={providerLabel(record.providerId)}
        origin={record.providerId}
        readOnly={record.readOnly}
        busy={Boolean(busy[record.id])}
        marketplaceId={marketplaceId}
        compatLevel={compatLevel}
        requiresFullChrome={requiresFullChrome}
        onOpenCompat={record.manifest.runtime === 'siyuan-plugin' ? openSiyuanCompat : undefined}
        onUpdate={
          curated && record.status === 'update-available'
            ? () =>
                void runBusy(record.id, async () => {
                  await window.electronAPI.updateMarketplaceEntry(marketplaceId!)
                }, 'install')
            : undefined
        }
        onUninstall={
          canUninstallBazaar
            ? () =>
                void runBusy(record.id, async () => {
                  await window.electronAPI.pluginBridgeUninstallBazaar({
                    packageName: bareBazaarName,
                  })
                }, 'uninstall')
            : curated
              ? () =>
                  void runBusy(record.id, async () => {
                    await window.electronAPI.removeMarketplaceEntry(marketplaceId!)
                  }, 'uninstall')
              : undefined
        }
        onToggle={(enabled) =>
          void runBusy(record.id, async () => {
            await window.electronAPI.extensionsSetEnabled({ id: record.id, enabled })
          }, 'toggle')
        }
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title={t('settings.extensions.title')}
        actions={<HeaderMenu route={routes.view.settings('extensions')} />}
      />

      <div className="flex-1 min-h-0 mask-fade-y">
      <ScrollArea className="h-full">
        <div className="px-5 pt-6 pb-10 max-w-3xl mx-auto w-full space-y-5">
          {/* Sections */}
          {!unifiedCenter ? (
          <div className="flex flex-wrap gap-1.5">
            {SECTIONS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={`text-xs rounded-md border px-2.5 py-1 ${
                  section === id ? 'bg-muted font-medium' : 'opacity-70 hover:opacity-100'
                }`}
              >
                {t(`extensions.section.${id}`, { defaultValue: id })}
              </button>
            ))}
          </div>
          ) : null}

          {(unifiedCenter || section === 'catalog' || section === 'installed') && (
            <div className="flex flex-wrap gap-1.5 items-center">
              {!unifiedCenter ? (
                <>
                  <button
                    type="button"
                    onClick={() => setCategory('all')}
                    className={`text-xs rounded-full border px-2.5 py-1 ${
                      category === 'all' ? 'bg-muted font-medium' : 'opacity-70'
                    }`}
                  >
                    {t('extensions.category.all')}
                  </button>
                  {CATALOG_CATEGORIES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCategory(c)}
                      className={`text-xs rounded-full border px-2.5 py-1 ${
                        category === c ? 'bg-muted font-medium' : 'opacity-70'
                      }`}
                    >
                      {t(`extensions.category.${c}`, { defaultValue: c })}
                    </button>
                  ))}
                </>
              ) : null}
              <input
                className="ml-auto border rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring bg-background min-w-[12rem]"
                placeholder={t('extensions.search')}
                value={query}
                onChange={(ev) => setQuery(ev.target.value)}
              />
              <button
                type="button"
                onClick={() => void load()}
                className="inline-flex items-center gap-1 text-xs border rounded-md px-2 py-1.5 hover:bg-muted"
              >
                <RefreshCw className="w-3 h-3" />
                {t('extensions.refresh')}
              </button>
            </div>
          )}

          {actionMsg ? (
            <div className="text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {actionMsg}
            </div>
          ) : null}
          {error ? (
            <div className="text-xs text-destructive border border-destructive/30 rounded-md px-3 py-2">
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="flex items-center gap-2 text-sm opacity-70 py-10 justify-center">
              <Spinner className="w-4 h-4" />
              {t('extensions.loading')}
            </div>
          ) : null}

          {!loading && unifiedCenter ? (
            <div className="space-y-8" data-testid="extension-center">
              {EXTENSION_CENTER_GROUPS.map((groupId) => {
                const records = centerGroups[groupId]
                const marketplace = groupId === 'marketplace' ? catalogEntries : []
                const extraInstalled =
                  groupId === 'marketplace'
                    ? records.filter((rec) => !marketplace.some((entry) => entry.id === rec.id))
                    : []
                const empty =
                  groupId === 'marketplace'
                    ? marketplace.length === 0 && extraInstalled.length === 0
                    : records.length === 0
                return (
                  <section key={groupId} className="space-y-3" data-testid={`extension-center-${groupId}`}>
                    <h2 className="text-sm font-medium">
                      {t(`extensions.center.${groupId}`)}
                    </h2>
                    {empty ? (
                      <p className="text-sm opacity-60">
                        {t('extensions.center.empty')}
                      </p>
                    ) : groupId === 'marketplace' ? (
                      <>
                        {marketplace.map(renderCatalogCard)}
                        {extraInstalled.map(renderRecordCard)}
                      </>
                    ) : (
                      records.map(renderRecordCard)
                    )}
                  </section>
                )
              })}
            </div>
          ) : null}

          {!loading && !unifiedCenter && section === 'catalog' ? (
            <div className="space-y-3">
              <div className="text-xs opacity-60 flex items-center gap-2">
                <Package className="w-3.5 h-3.5" />
                {t('extensions.catalog.count', {
                  count: catalogEntries.length,
                })}
              </div>
              {catalogEntries.length === 0 ? (
                <p className="text-sm opacity-60">
                  {t('extensions.catalog.empty')}
                </p>
              ) : (
                catalogEntries.map(renderCatalogCard)
              )}
            </div>
          ) : null}

          {!loading && !unifiedCenter && section === 'installed' ? (
            <div className="space-y-3">
              <div className="text-xs opacity-60 flex items-center gap-2 flex-wrap">
                <Blocks className="w-3.5 h-3.5" />
                {t('extensions.installed.countWithDisabled', {
                  count: installedCounts.total,
                  disabled: installedCounts.disabled,
                })}
              </div>
              {filteredInstalled.length === 0 ? (
                <p className="text-sm opacity-60">
                  {t('extensions.installed.empty')}
                </p>
              ) : (
                filteredInstalled.map(renderRecordCard)
              )}
            </div>
          ) : null}

          {!loading && !unifiedCenter && section === 'updates' ? (
            <div className="space-y-3">
              {updates.length === 0 ? (
                <p className="text-sm opacity-60">
                  {t('extensions.updates.empty')}
                </p>
              ) : (
                updates.map(renderRecordCard)
              )}
            </div>
          ) : null}

          {!loading && !unifiedCenter && section === 'permissions' ? (
            <div className="space-y-3">
              <div className="text-xs opacity-60 flex items-center gap-2">
                <Shield className="w-3.5 h-3.5" />
                {t('extensions.permissions.summary')}
              </div>
              {permissionRows.length === 0 ? (
                <p className="text-sm opacity-60">
                  {t('extensions.permissions.empty')}
                </p>
              ) : (
                permissionRows.map((row) => (
                  <div key={row.id} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm">{row.name}</span>
                      <span className="text-[10px] uppercase opacity-60">{row.status}</span>
                    </div>
                    <PermissionsList permissions={row.permissions} />
                  </div>
                ))
              )}
            </div>
          ) : null}

          {!loading && !unifiedCenter && section === 'disabled' ? (
            <div className="space-y-3">
              <div className="text-xs opacity-60">
                {t('extensions.disabled.count', {
                  count: disabled.length,
                })}
              </div>
              {disabled.length === 0 ? (
                <p className="text-sm opacity-60">
                  {t('extensions.disabled.empty')}
                </p>
              ) : (
                disabled.map(renderRecordCard)
              )}
            </div>
          ) : null}

          {!loading && !unifiedCenter && section === 'developer' ? (
            <div className="border rounded-lg p-4 space-y-4 text-sm">
              <div className="space-y-2">
                <div className="flex items-center gap-2 font-medium">
                  <Wrench className="w-4 h-4" />
                  {t('extensions.developer.title')}
                </div>
                <p className="opacity-70 text-xs leading-relaxed">
                  {t('extensions.developer.hint')}
                </p>
                <p className="opacity-70 text-xs leading-relaxed">
                  {t('extensions.developer.body')}
                </p>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium opacity-80">
                  {t('extensions.developer.hostStatus')}
                </div>
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs space-y-1 font-mono">
                  <div>
                    {t('extensions.developer.workspaceId')}:{' '}
                    <span className="font-semibold">{workspaceId ?? '—'}</span>
                  </div>
                  <div>
                    {t('extensions.developer.hostStatus')}:{' '}
                    <span className="font-semibold">{hostStatus?.status ?? 'unknown'}</span>
                    {hostStatus?.pid != null ? ` · pid ${hostStatus.pid}` : null}
                  </div>
                  <div className="opacity-70">
                    executesSiyuanPlugins: {String(hostStatus?.executesSiyuanPlugins ?? false)}
                  </div>
                  {hostStatus?.message ? (
                    <div className="opacity-60 break-words whitespace-pre-wrap">{hostStatus.message}</div>
                  ) : null}
                  {hostStatus?.loadedExtensions?.length ? (
                    <div className="opacity-60">loaded: {hostStatus.loadedExtensions.join(', ')}</div>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="text-xs px-2 py-1 rounded border hover:bg-muted/50 disabled:opacity-50"
                    disabled={Boolean(busy['host-start'])}
                    onClick={() => void hostLifecycle('start')}
                  >
                    {t('extensions.developer.hostStart')}
                  </button>
                  <button
                    type="button"
                    className="text-xs px-2 py-1 rounded border hover:bg-muted/50 disabled:opacity-50"
                    disabled={Boolean(busy['host-stop'])}
                    onClick={() => void hostLifecycle('stop')}
                  >
                    {t('extensions.developer.hostStop')}
                  </button>
                  <button
                    type="button"
                    className="text-xs px-2 py-1 rounded border hover:bg-muted/50 disabled:opacity-50"
                    disabled={Boolean(busy['host-restart'])}
                    onClick={() => void hostLifecycle('restart')}
                  >
                    {t('extensions.developer.hostRestart')}
                  </button>
                </div>

                <div className="space-y-1">
                  <div className="text-xs font-medium opacity-80">
                    {t('extensions.developer.allHosts')}
                  </div>
                  {allHosts.length === 0 ? (
                    <p className="text-xs opacity-60">
                      {t('extensions.developer.noHosts')}
                    </p>
                  ) : (
                    <ul className="rounded-md border divide-y text-xs font-mono">
                      {allHosts.map((h) => (
                        <li
                          key={h.workspaceId}
                          className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1"
                        >
                          <span>
                            {t('extensions.developer.workspaceId')}:{' '}
                            <span className="font-semibold">{h.workspaceId}</span>
                          </span>
                          <span>
                            status: <span className="font-semibold">{h.status}</span>
                          </span>
                          <span className="opacity-70">
                            pid: {h.pid != null ? h.pid : '—'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="space-y-2 border-t pt-3">
                <div className="text-xs font-medium opacity-80">
                  {t('extensions.developer.urlAllowlistTitle')}
                </div>
                <p className="text-xs opacity-60 leading-relaxed">
                  {t('extensions.developer.urlAllowlistHint')}
                </p>
                <div className="flex flex-wrap gap-2 items-center">
                  <label className="text-xs opacity-70 shrink-0">
                    {t('extensions.developer.urlAllowlistExtensionId')}
                  </label>
                  <input
                    type="text"
                    value={allowlistExtId}
                    onChange={(e) => setAllowlistExtId(e.target.value)}
                    className="flex-1 min-w-[12rem] text-xs px-2 py-1 rounded border bg-background font-mono"
                    placeholder={t('extensions.developer.extensionIdPlaceholder')}
                  />
                  <button
                    type="button"
                    className="text-xs px-2 py-1 rounded border hover:bg-muted/50"
                    onClick={() => void loadAllowlist()}
                  >
                    {t('extensions.developer.urlAllowlistLoad')}
                  </button>
                </div>

                {allowlistPrefixes.length === 0 ? (
                  <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>
                      {t('extensions.developer.urlAllowlistEmpty')}
                    </span>
                  </div>
                ) : (
                  <ul className="space-y-1">
                    {allowlistPrefixes.map((prefix) => (
                      <li
                        key={prefix}
                        className="flex items-center gap-2 text-xs font-mono rounded border px-2 py-1"
                      >
                        <span className="flex-1 break-all">{prefix}</span>
                        <button
                          type="button"
                          className="shrink-0 text-xs px-1.5 py-0.5 rounded border hover:bg-muted/50"
                          onClick={() => removeAllowlistPrefix(prefix)}
                        >
                          {t('extensions.developer.urlAllowlistRemove')}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="flex flex-wrap gap-2 items-center">
                  <input
                    type="text"
                    value={newPrefix}
                    onChange={(e) => setNewPrefix(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addAllowlistPrefix()
                      }
                    }}
                    className="flex-1 min-w-[12rem] text-xs px-2 py-1 rounded border bg-background font-mono"
                    placeholder={t('extensions.developer.urlPrefixPlaceholder')}
                  />
                  <button
                    type="button"
                    className="text-xs px-2 py-1 rounded border hover:bg-muted/50"
                    onClick={addAllowlistPrefix}
                  >
                    {t('extensions.developer.urlAllowlistAdd')}
                  </button>
                  <button
                    type="button"
                    className="text-xs px-2 py-1 rounded border hover:bg-muted/50 disabled:opacity-50"
                    disabled={!allowlistExtId.trim() || Boolean(busy['allowlist-save'])}
                    onClick={() => void saveAllowlist()}
                  >
                    {t('extensions.developer.urlAllowlistSave')}
                  </button>
                </div>
              </div>

              <div className="space-y-2 border-t pt-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-medium opacity-80">
                    {t('extensions.developer.capabilitiesTitle')}
                  </div>
                  <button
                    type="button"
                    className="text-xs px-2 py-1 rounded border hover:bg-muted/50"
                    onClick={() => void load()}
                  >
                    {t('extensions.developer.capabilitiesRefresh')}
                  </button>
                </div>
                <p className="text-xs opacity-60 leading-relaxed">
                  {t('extensions.developer.capabilitiesHint')}
                </p>
                {capabilityLedger.minted.length === 0 && capabilityLedger.revoked.length === 0 ? (
                  <p className="text-xs opacity-60">
                    {t('extensions.developer.capabilitiesEmpty')}
                  </p>
                ) : (
                  <ul className="rounded-md border divide-y text-xs font-mono">
                    {capabilityLedger.minted.map((row) => (
                      <li
                        key={`m-${row.tokenHash}`}
                        className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1"
                      >
                        <span className="font-semibold">active</span>
                        <span>{row.extensionId}</span>
                        <span className="opacity-80">{row.permission}</span>
                        <span className="opacity-50">{row.tokenHash.slice(0, 12)}</span>
                        <button
                          type="button"
                          className="ml-auto text-xs px-1.5 py-0.5 rounded border hover:bg-muted/50"
                          onClick={() => void revokeCapabilityHash(row.tokenHash)}
                        >
                          {t('extensions.developer.capabilitiesRevoke')}
                        </button>
                      </li>
                    ))}
                    {capabilityLedger.revoked.map((row) => (
                      <li
                        key={`r-${row.tokenHash}`}
                        className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 opacity-70"
                      >
                        <span className="font-semibold">revoked</span>
                        <span>{row.extensionId}</span>
                        <span className="opacity-80">{row.permission}</span>
                        <span className="opacity-50">{row.tokenHash.slice(0, 12)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="text-xs font-mono opacity-60 break-all">
                state keys: {Object.keys(installed?.state.enabled ?? {}).length}
              </div>
            </div>
          ) : null}

          {!loading && !unifiedCenter && section === 'registries' ? (
            <div className="space-y-3">
              <div className="text-xs opacity-60 flex items-center gap-2">
                <FileText className="w-3.5 h-3.5" />
                {t('extensions.registries.title')}
              </div>
              <p className="text-xs opacity-70 leading-relaxed">
                {t('extensions.registries.hint')}
              </p>
              {(catalog?.providers ?? []).map((p) => (
                <div key={p.id} className="border rounded-lg p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-sm">
                      {t(`extensions.registries.provider.${p.id}`, { defaultValue: p.id })}
                    </div>
                    <div className="text-xs opacity-60 font-mono">{p.id}</div>
                    {p.docsUrl ? (
                      <button
                        type="button"
                        className="mt-1 text-xs text-primary underline inline-flex items-center gap-1"
                        onClick={() => void window.electronAPI.openUrl(p.docsUrl!)}
                      >
                        {t('extensions.registries.docsLink')}
                      </button>
                    ) : null}
                  </div>
                  <span className="text-[10px] uppercase opacity-60 shrink-0">
                    {p.community
                      ? t('extensions.registries.community')
                      : t('extensions.registries.active')}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </ScrollArea>
      </div>
    </div>
  )
}
