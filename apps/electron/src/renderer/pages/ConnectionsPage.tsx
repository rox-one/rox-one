/**
 * ConnectionsPage (CF-6) — native Connection Fabric surface.
 *
 * Tabs: Services / Credentials / Imports / Policies / Audit.
 * RPC methods are optional; missing handlers render empty/disabled states.
 * Never renders secret payload fields (value / token / password / ciphertext).
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SettingsCard, SettingsSection } from '@/components/settings'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { routes } from '@/lib/navigate'

type ConnectionsTab = 'services' | 'credentials' | 'imports' | 'policies' | 'audit'

const TABS: readonly ConnectionsTab[] = [
  'services',
  'credentials',
  'imports',
  'policies',
  'audit',
] as const

const IMPORTER_IDS = [
  'dotenv',
  'git-credential',
  'macos-keychain',
  'docker-credential',
  'legacy-local',
  'aws-profile',
  'gcp-adc',
  'ssh-agent',
  'infisical',
] as const

type ConnectionRow = {
  id: string
  integrationId?: string
  providerId?: string
  storageMode?: string
  health?: string
  externalAccountId?: string
  scopes?: readonly string[]
}

type CredentialMeta = {
  id: string
  kind: string
  provider: string
  mode: string
}

type ImportCandidate = {
  id: string
  sourceId?: string
  label?: string
  kind?: string
  conflictKey?: string
  fingerprint?: string
}

type GrantRow = {
  id: string
  consumerId: string
  actions?: readonly string[]
  resources?: readonly string[]
  status?: string
}

type AuditRow = {
  time?: string | number
  timestamp?: number
  event?: string
  action?: string
  consumer?: string
  decision?: string
  digest?: string
  versionFingerprint?: string
}

/** Optional CF RPC surface — present only after main/preload wiring. */
type FabricApi = {
  fabricListConnections?: (workspaceId: string) => Promise<ConnectionRow[]>
  fabricListCredentials?: (workspaceId: string) => Promise<CredentialMeta[]>
  fabricDiscover?: (workspaceId: string, importerId: string) => Promise<ImportCandidate[]>
  fabricPreview?: (workspaceId: string, candidateId: string) => Promise<ImportCandidate | Record<string, unknown>>
  fabricCommitImport?: (workspaceId: string, candidateId: string) => Promise<unknown>
  fabricListGrants?: (workspaceId: string) => Promise<GrantRow[]>
  fabricPutGrant?: (
    workspaceId: string,
    grant: { consumerId: string; action: string; resource: string },
  ) => Promise<unknown>
  fabricListAudit?: (workspaceId: string) => Promise<AuditRow[]>
  fabricRevokeConnection?: (args: { workspaceId: string; connectionId: string }) => Promise<unknown>
  fabricGithubStatus?: (opts?: { probe?: boolean }) => Promise<{
    available: boolean
    reason?: string
    login?: string
  }>
  fabricInfisicalHealth?: () => Promise<{ available: boolean; reason?: string }>
}

function fabricApi(): FabricApi {
  return (window.electronAPI ?? {}) as FabricApi
}

function asMetaString(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return ''
}

/** Strip any accidental secret-shaped keys before rendering preview metadata. */
function sanitizePreviewMeta(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object') return {}
  const blocked = new Set(['value', 'token', 'password', 'ciphertext', 'secret', 'raw'])
  const out: Record<string, string> = {}
  for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
    if (blocked.has(key.toLowerCase())) continue
    if (val == null) continue
    if (typeof val === 'object') continue
    out[key] = String(val)
  }
  return out
}

function RuntimeNotWired({ label }: { label: string }) {
  return (
    <p className="text-sm text-muted-foreground py-6 text-center" role="status">
      {label}
    </p>
  )
}

type ProviderChip = {
  title: string
  available: boolean
  missing: string
  availableLabel: string
  detail?: string
}

function ProviderStatusStrip() {
  const { t } = useTranslation()
  const api = fabricApi()
  const [github, setGithub] = React.useState<{ available: boolean; login?: string } | null>(null)
  const [infisical, setInfisical] = React.useState<{ available: boolean } | null>(null)
  const [probing, setProbing] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    if (api.fabricGithubStatus) {
      void api
        .fabricGithubStatus()
        .then((next) => {
          if (!cancelled) {
            setGithub({
              available: Boolean(next?.available),
              login: typeof next?.login === 'string' ? next.login : undefined,
            })
          }
        })
        .catch(() => {
          if (!cancelled) setGithub({ available: false })
        })
    }
    if (api.fabricInfisicalHealth) {
      void api
        .fabricInfisicalHealth()
        .then((next) => {
          if (!cancelled) setInfisical({ available: Boolean(next?.available) })
        })
        .catch(() => {
          if (!cancelled) setInfisical({ available: false })
        })
    }
    return () => {
      cancelled = true
    }
  }, [api.fabricGithubStatus, api.fabricInfisicalHealth])

  const onProbeGithub = async () => {
    if (!api.fabricGithubStatus) return
    setProbing(true)
    try {
      const next = await api.fabricGithubStatus({ probe: true })
      setGithub({
        available: Boolean(next?.available),
        login: typeof next?.login === 'string' ? next.login : undefined,
      })
    } catch {
      setGithub({ available: false })
    } finally {
      setProbing(false)
    }
  }

  if (!api.fabricGithubStatus && !api.fabricInfisicalHealth) return null

  const chips: ProviderChip[] = []
  if (api.fabricGithubStatus && github) {
    chips.push({
      title: t('connections.github.title'),
      available: github.available,
      missing: t('connections.github.missing'),
      availableLabel: t('connections.github.available'),
      detail: github.login,
    })
  }
  if (api.fabricInfisicalHealth && infisical) {
    chips.push({
      title: t('connections.infisical.title'),
      available: infisical.available,
      missing: t('connections.infisical.missing'),
      availableLabel: t('connections.infisical.available'),
    })
  }
  if (chips.length === 0 && !api.fabricGithubStatus) return null

  return (
    <div className="flex flex-wrap gap-2 items-center" role="status">
      {chips.map((chip) => (
        <div
          key={chip.title}
          className="inline-flex items-center gap-2 rounded-md border border-border/60 px-3 py-1.5 text-sm"
        >
          <span className="font-medium">{chip.title}</span>
          <span className={chip.available ? 'text-primary' : 'text-muted-foreground'}>
            {chip.available ? chip.availableLabel : chip.missing}
          </span>
          {chip.detail ? <span className="font-mono text-xs">{chip.detail}</span> : null}
        </div>
      ))}
      {api.fabricGithubStatus ? (
        <Button
          type="button"
          variant="secondary"
          disabled={probing || github?.available === false}
          onClick={() => void onProbeGithub()}
        >
          {t('connections.github.login')}
        </Button>
      ) : null}
    </div>
  )
}

function ServicesTab({ workspaceId }: { workspaceId: string | undefined }) {
  const { t } = useTranslation()
  const api = fabricApi()
  const [rows, setRows] = React.useState<ConnectionRow[] | null>(null)
  const [wired, setWired] = React.useState(true)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  const reload = React.useCallback(async () => {
    const list = fabricApi().fabricListConnections
    if (!list || !workspaceId) {
      setWired(Boolean(list))
      setRows([])
      return
    }
    setWired(true)
    try {
      const next = await list(workspaceId)
      setRows(Array.isArray(next) ? next : [])
    } catch {
      setRows([])
    }
  }, [workspaceId])

  React.useEffect(() => {
    void reload()
  }, [reload])

  const onRevoke = async (connectionId: string) => {
    if (!workspaceId || !api.fabricRevokeConnection) return
    setBusyId(connectionId)
    try {
      await api.fabricRevokeConnection({ workspaceId, connectionId })
      await reload()
    } catch {
      // keep current rows
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4">
      <ProviderStatusStrip />
      {!wired ? (
        <RuntimeNotWired label={t('connections.services.runtimeNotWired')} />
      ) : !rows || rows.length === 0 ? (
        <RuntimeNotWired label={t('connections.services.empty')} />
      ) : (
        <SettingsCard className="p-0 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Integration</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Health</TableHead>
                {api.fabricRevokeConnection ? <TableHead /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">{row.id}</TableCell>
                  <TableCell>{asMetaString(row.integrationId)}</TableCell>
                  <TableCell>{asMetaString(row.providerId)}</TableCell>
                  <TableCell>{asMetaString(row.storageMode)}</TableCell>
                  <TableCell>{asMetaString(row.health)}</TableCell>
                  {api.fabricRevokeConnection ? (
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busyId === row.id || !workspaceId}
                        onClick={() => void onRevoke(row.id)}
                      >
                        Revoke
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SettingsCard>
      )}
    </div>
  )
}

function CredentialsTab({ workspaceId }: { workspaceId: string | undefined }) {
  const { t } = useTranslation()
  const [rows, setRows] = React.useState<CredentialMeta[] | null>(null)
  const [wired, setWired] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    const list = fabricApi().fabricListCredentials
    if (!list || !workspaceId) {
      setWired(Boolean(list))
      setRows([])
      return
    }
    setWired(true)
    void list(workspaceId)
      .then((next) => {
        if (!cancelled) {
          const safe = (Array.isArray(next) ? next : []).map((item) => ({
            id: asMetaString(item?.id),
            kind: asMetaString(item?.kind),
            provider: asMetaString(item?.provider),
            mode: asMetaString(item?.mode),
          }))
          setRows(safe)
        }
      })
      .catch(() => {
        if (!cancelled) setRows([])
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  if (!wired) {
    return <RuntimeNotWired label={t('connections.credentials.runtimeNotWired')} />
  }

  if (!rows || rows.length === 0) {
    return <RuntimeNotWired label={t('connections.credentials.empty')} />
  }

  return (
    <SettingsCard className="p-0 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('connections.credentials.columns.id')}</TableHead>
            <TableHead>{t('connections.credentials.columns.kind')}</TableHead>
            <TableHead>{t('connections.credentials.columns.provider')}</TableHead>
            <TableHead>{t('connections.credentials.columns.mode')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-mono text-xs">{row.id}</TableCell>
              <TableCell>{row.kind}</TableCell>
              <TableCell>{row.provider}</TableCell>
              <TableCell>{row.mode}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </SettingsCard>
  )
}

function ImportsTab({ workspaceId }: { workspaceId: string | undefined }) {
  const { t } = useTranslation()
  const api = fabricApi()
  const wired = Boolean(api.fabricDiscover)
  const [importerId, setImporterId] = React.useState<string>(IMPORTER_IDS[0])
  const [candidates, setCandidates] = React.useState<ImportCandidate[]>([])
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [preview, setPreview] = React.useState<Record<string, string> | null>(null)
  const [busy, setBusy] = React.useState(false)

  const onDiscover = async () => {
    if (!workspaceId || !api.fabricDiscover) return
    setBusy(true)
    setPreview(null)
    try {
      const next = await api.fabricDiscover(workspaceId, importerId)
      setCandidates(Array.isArray(next) ? next : [])
      setSelectedId(null)
    } catch {
      setCandidates([])
    } finally {
      setBusy(false)
    }
  }

  const onPreview = async () => {
    if (!workspaceId || !selectedId || !api.fabricPreview) return
    setBusy(true)
    try {
      const next = await api.fabricPreview(workspaceId, selectedId)
      setPreview(sanitizePreviewMeta(next))
    } catch {
      setPreview(null)
    } finally {
      setBusy(false)
    }
  }

  const onCommit = async () => {
    if (!workspaceId || !selectedId || !api.fabricCommitImport) return
    setBusy(true)
    try {
      await api.fabricCommitImport(workspaceId, selectedId)
      setPreview(null)
      setSelectedId(null)
      if (api.fabricDiscover) {
        const next = await api.fabricDiscover(workspaceId, importerId)
        setCandidates(Array.isArray(next) ? next : [])
      }
    } catch {
      // keep selection; UI stays metadata-only
    } finally {
      setBusy(false)
    }
  }

  if (!wired) {
    return <RuntimeNotWired label={t('connections.imports.runtimeNotWired')} />
  }

  return (
    <div className="space-y-4">
      <SettingsCard className="px-4 py-3.5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm min-w-[12rem]">
            <span className="text-muted-foreground">{t('connections.imports.importer')}</span>
            <select
              className="border border-border/60 rounded-md px-2 py-1.5 bg-background"
              value={importerId}
              onChange={(ev) => setImporterId(ev.target.value)}
              disabled={busy}
            >
              {IMPORTER_IDS.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <Button type="button" onClick={() => void onDiscover()} disabled={busy || !workspaceId}>
            {t('connections.imports.discover')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void onPreview()}
            disabled={busy || !selectedId || !api.fabricPreview}
          >
            {t('connections.imports.preview')}
          </Button>
          <Button
            type="button"
            onClick={() => void onCommit()}
            disabled={busy || !selectedId || !api.fabricCommitImport}
          >
            {t('connections.imports.commit')}
          </Button>
        </div>
      </SettingsCard>

      {candidates.length === 0 ? (
        <RuntimeNotWired label={t('connections.imports.empty')} />
      ) : (
        <SettingsCard className="p-0 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Fingerprint</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {candidates.map((c) => (
                <TableRow
                  key={c.id}
                  data-state={selectedId === c.id ? 'selected' : undefined}
                  className="cursor-pointer"
                  onClick={() => setSelectedId(c.id)}
                >
                  <TableCell className="font-mono text-xs">{c.id}</TableCell>
                  <TableCell>{asMetaString(c.sourceId ?? c.label)}</TableCell>
                  <TableCell>{asMetaString(c.kind)}</TableCell>
                  <TableCell className="font-mono text-xs">{asMetaString(c.fingerprint)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SettingsCard>
      )}

      {preview && Object.keys(preview).length > 0 ? (
        <SettingsCard className="px-4 py-3.5">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {Object.entries(preview).map(([k, v]) => (
              <React.Fragment key={k}>
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-mono text-xs break-all">{v}</dd>
              </React.Fragment>
            ))}
          </dl>
        </SettingsCard>
      ) : null}
    </div>
  )
}

function PoliciesTab({ workspaceId }: { workspaceId: string | undefined }) {
  const { t } = useTranslation()
  const api = fabricApi()
  const [grants, setGrants] = React.useState<GrantRow[]>([])
  const [wired, setWired] = React.useState(true)
  const [consumerId, setConsumerId] = React.useState('')
  const [action, setAction] = React.useState('')
  const [resource, setResource] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const reload = React.useCallback(async () => {
    const list = fabricApi().fabricListGrants
    if (!list || !workspaceId) {
      setWired(Boolean(list))
      setGrants([])
      return
    }
    setWired(true)
    try {
      const next = await list(workspaceId)
      setGrants(Array.isArray(next) ? next : [])
    } catch {
      setGrants([])
    }
  }, [workspaceId])

  React.useEffect(() => {
    void reload()
  }, [reload])

  const onAdd = async () => {
    if (!workspaceId || !api.fabricPutGrant) return
    const trimmedConsumer = consumerId.trim()
    const trimmedAction = action.trim()
    const trimmedResource = resource.trim()
    if (!trimmedConsumer || !trimmedAction || !trimmedResource) return
    setBusy(true)
    try {
      await api.fabricPutGrant(workspaceId, {
        consumerId: trimmedConsumer,
        action: trimmedAction,
        resource: trimmedResource,
      })
      setConsumerId('')
      setAction('')
      setResource('')
      await reload()
    } catch {
      // leave form filled
    } finally {
      setBusy(false)
    }
  }

  if (!wired && !api.fabricPutGrant) {
    return <RuntimeNotWired label={t('connections.policies.runtimeNotWired')} />
  }

  return (
    <div className="space-y-4">
      <SettingsCard className="px-4 py-3.5">
        <div className="flex flex-wrap gap-3 items-end">
          <label className="flex flex-col gap-1 text-sm min-w-[10rem] flex-1">
            <span className="text-muted-foreground">{t('connections.policies.consumerId')}</span>
            <Input
              value={consumerId}
              onChange={(ev) => setConsumerId(ev.target.value)}
              disabled={busy || !api.fabricPutGrant}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm min-w-[8rem] flex-1">
            <span className="text-muted-foreground">{t('connections.policies.action')}</span>
            <Input
              value={action}
              onChange={(ev) => setAction(ev.target.value)}
              disabled={busy || !api.fabricPutGrant}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm min-w-[8rem] flex-1">
            <span className="text-muted-foreground">{t('connections.policies.resource')}</span>
            <Input
              value={resource}
              onChange={(ev) => setResource(ev.target.value)}
              disabled={busy || !api.fabricPutGrant}
            />
          </label>
          <Button
            type="button"
            onClick={() => void onAdd()}
            disabled={busy || !api.fabricPutGrant || !workspaceId}
          >
            {t('connections.policies.add')}
          </Button>
        </div>
      </SettingsCard>

      {!wired ? (
        <RuntimeNotWired label={t('connections.policies.runtimeNotWired')} />
      ) : grants.length === 0 ? (
        <RuntimeNotWired label={t('connections.policies.empty')} />
      ) : (
        <SettingsCard className="p-0 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>{t('connections.policies.consumerId')}</TableHead>
                <TableHead>{t('connections.policies.action')}</TableHead>
                <TableHead>{t('connections.policies.resource')}</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grants.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="font-mono text-xs">{g.id}</TableCell>
                  <TableCell>{g.consumerId}</TableCell>
                  <TableCell>{(g.actions ?? []).join(', ')}</TableCell>
                  <TableCell>{(g.resources ?? []).join(', ')}</TableCell>
                  <TableCell>{asMetaString(g.status)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SettingsCard>
      )}
    </div>
  )
}

function AuditTab({ workspaceId }: { workspaceId: string | undefined }) {
  const { t } = useTranslation()
  const [rows, setRows] = React.useState<AuditRow[] | null>(null)
  const [wired, setWired] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    const list = fabricApi().fabricListAudit
    if (!list || !workspaceId) {
      setWired(Boolean(list))
      setRows([])
      return
    }
    setWired(true)
    void list(workspaceId)
      .then((next) => {
        if (!cancelled) setRows(Array.isArray(next) ? next : [])
      })
      .catch(() => {
        if (!cancelled) setRows([])
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  if (!wired) {
    return <RuntimeNotWired label={t('connections.audit.runtimeNotWired')} />
  }

  if (!rows || rows.length === 0) {
    return <RuntimeNotWired label={t('connections.audit.empty')} />
  }

  return (
    <SettingsCard className="p-0 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('connections.audit.columns.time')}</TableHead>
            <TableHead>{t('connections.audit.columns.event')}</TableHead>
            <TableHead>{t('connections.audit.columns.consumer')}</TableHead>
            <TableHead>{t('connections.audit.columns.action')}</TableHead>
            <TableHead>{t('connections.audit.columns.decision')}</TableHead>
            <TableHead>{t('connections.audit.columns.digest')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, idx) => {
            const time =
              row.time ??
              (typeof row.timestamp === 'number' ? new Date(row.timestamp).toISOString() : '')
            return (
              <TableRow key={`${asMetaString(row.digest)}-${idx}`}>
                <TableCell className="whitespace-nowrap text-xs">{asMetaString(time)}</TableCell>
                <TableCell>{asMetaString(row.event ?? row.action)}</TableCell>
                <TableCell>{asMetaString(row.consumer)}</TableCell>
                <TableCell>{asMetaString(row.action)}</TableCell>
                <TableCell>{asMetaString(row.decision)}</TableCell>
                <TableCell className="font-mono text-xs">
                  {asMetaString(row.digest ?? row.versionFingerprint)}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </SettingsCard>
  )
}

export default function ConnectionsPage() {
  const { t } = useTranslation()
  const workspace = useActiveWorkspace()
  const workspaceId = workspace?.id
  const [tab, setTab] = React.useState<ConnectionsTab>('services')

  return (
    <div className="h-full flex flex-col">
      <PanelHeader
        title={t('connections.title')}
        actions={<HeaderMenu route={routes.view.connections()} />}
      />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-4xl mx-auto space-y-6">
            <div
              role="tablist"
              aria-label={t('connections.title')}
              className="flex flex-wrap gap-1 border-b border-border/50 pb-2"
            >
              {TABS.map((id) => {
                const active = tab === id
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    id={`connections-tab-${id}`}
                    aria-selected={active}
                    aria-controls={`connections-panel-${id}`}
                    tabIndex={active ? 0 : -1}
                    onClick={() => setTab(id)}
                    className={
                      active
                        ? 'inline-flex items-center px-3 py-1.5 text-sm rounded-md bg-primary/10 text-primary font-medium'
                        : 'inline-flex items-center px-3 py-1.5 text-sm rounded-md text-muted-foreground hover:bg-muted/60'
                    }
                  >
                    {t(`connections.tabs.${id}`)}
                  </button>
                )
              })}
            </div>

            <div
              role="tabpanel"
              id={`connections-panel-${tab}`}
              aria-labelledby={`connections-tab-${tab}`}
            >
              <SettingsSection title={t(`connections.tabs.${tab}`)}>
                {tab === 'services' ? <ServicesTab workspaceId={workspaceId} /> : null}
                {tab === 'credentials' ? <CredentialsTab workspaceId={workspaceId} /> : null}
                {tab === 'imports' ? <ImportsTab workspaceId={workspaceId} /> : null}
                {tab === 'policies' ? <PoliciesTab workspaceId={workspaceId} /> : null}
                {tab === 'audit' ? <AuditTab workspaceId={workspaceId} /> : null}
              </SettingsSection>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
