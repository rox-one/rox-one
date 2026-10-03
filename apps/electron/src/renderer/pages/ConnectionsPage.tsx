import { useAtom } from 'jotai'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useTourTarget, useTourSignals, type TourObservation } from '@/features/product-tour/runtime/hooks'
import { connectionCapabilities } from '@/features/product-tour/adapters/connections'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { selectedConnectionAtom } from '@/atoms/connections'
import { useActiveWorkspace } from '@/context/AppShellContext'
import {
  sanitizeConnectionAuditRows,
  sanitizeConnectionBindingRows,
  sanitizeConnectionRows,
  type ConnectionAuditRow,
  type ConnectionBindingRow,
  type ConnectionListRow,
} from './connections-list'
import {
  IMPORT_PLACEHOLDERS,
  createDraftError,
  firstPickedPath,
  grantDraftError,
  isImportPanelVisible,
  matchesConnectSource,
  parseCsvList,
  removeCommittedPreview,
  type ConnectSource,
  type PreviewSource,
} from './connections-ui'
import { ConnectionLifecyclePanel } from './ConnectionLifecyclePanel'
import { GithubDeviceLoginPanel } from './GithubDeviceLoginPanel'
import { ConnectionsOverview, OverviewGroup, OverviewRow, type OverviewStatus } from './connections-overview'
import { ProjectAuthorityConnectionPanel } from '@/components/projects/ProjectAuthorityConnectionPanel'

const TABS = ['services', 'credentials', 'imports', 'policies', 'audit'] as const
const CONNECT_SOURCES = ['github-env', 'git-helper', 'docker', 'aws', 'keychain', 'adc', 'ssh-agent', 'github-oauth'] as const
type ConnectionsTab = (typeof TABS)[number]
type PreviewRow = {
  candidateId: string
  label: string
  maskedSummary: string
  source: PreviewSource
}
type SurfaceState = 'ready' | 'unavailable' | 'error'

function classifyFailClosed(error: unknown): SurfaceState {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (/unsupported_test|_unavailable|unavailable/i.test(message)) return 'unavailable'
  if (/not found/i.test(message)) return 'error'
  return 'error'
}

function ImportPanel({
  source,
  active,
  children,
}: {
  source: PreviewSource
  active: ConnectSource | null
  children: ReactNode
}) {
  if (!isImportPanelVisible(source, active)) return null
  return (
    <div data-testid="connections-import-panel" data-source={source} className="space-y-3">
      {children}
    </div>
  )
}

export default function ConnectionsPage() {
  const { t } = useTranslation()
  const workspace = useActiveWorkspace()
  const servicesTarget = useTourTarget('connections.services', { workspaceId: workspace?.id })
  const auditTarget = useTourTarget('connections.audit', { workspaceId: workspace?.id })
  const tour = useTourSignals({ workspaceId: workspace?.id })
  const captureTour = useRef(tour.capture)
  captureTour.current = tour.capture
  const auditObservation = useRef<TourObservation | null>(null)
  const auditViewReady = useRef(false)
  const [auditSurface, setAuditSurface] = useState<SurfaceState | 'loading'>('loading')
  const [tab, setTab] = useState<ConnectionsTab>('services')
  const [selected, setSelected] = useAtom(selectedConnectionAtom)
  const [rows, setRows] = useState<ConnectionListRow[] | null>(null)
  const [rowsWorkspaceId, setRowsWorkspaceId] = useState<string | null>(null)
  const [auditWorkspaceId, setAuditWorkspaceId] = useState<string | null>(null)
  const [surface, setSurface] = useState<SurfaceState>('ready')
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [rotatingId, setRotatingId] = useState<string | null>(null)
  const [convertingId, setConvertingId] = useState<string | null>(null)
  const [unbindingId, setUnbindingId] = useState<string | null>(null)
  const [envPath, setEnvPath] = useState('')
  const [gitConfigPath, setGitConfigPath] = useState('')
  const [dockerConfigPath, setDockerConfigPath] = useState('')
  const [awsCredentialsPath, setAwsCredentialsPath] = useState('')
  const [awsConfigPath, setAwsConfigPath] = useState('')
  const [adcPath, setAdcPath] = useState('')
  const [previews, setPreviews] = useState<PreviewRow[]>([])
  const [auditRows, setAuditRows] = useState<ConnectionAuditRow[]>([])
  const [bindingRows, setBindingRows] = useState<ConnectionBindingRow[]>([])
  const [activeSource, setActiveSource] = useState<ConnectSource | null>(null)
  const [createIntegration, setCreateIntegration] = useState('github')
  const [createCredentialRef, setCreateCredentialRef] = useState('')
  const [createStorageMode, setCreateStorageMode] = useState<'copy' | 'reference'>('copy')
  const [grantConsumer, setGrantConsumer] = useState('')
  const [grantPurpose, setGrantPurpose] = useState('')
  const [grantActions, setGrantActions] = useState('github.api')
  const [grantResources, setGrantResources] = useState('github:user')
  const [grantTargetId, setGrantTargetId] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [rowStatus, setRowStatus] = useState<Record<string, OverviewStatus>>({})
  const [rowNote, setRowNote] = useState<Record<string, string>>({})
  const [showCreate, setShowCreate] = useState(false)
  const currentWorkspace = useRef<string | undefined>(undefined)
  const listGeneration = useRef(0)
  useLayoutEffect(() => {
    const id = workspace?.id
    currentWorkspace.current = id; listGeneration.current++
    setRows(null); setSelected(null)
    return () => { if (currentWorkspace.current === id) currentWorkspace.current = undefined; listGeneration.current++ }
  }, [workspace?.id, setSelected])

  useEffect(() => {
    const workspaceId = workspace?.id
    const listConnections = window.electronAPI?.workgraph?.listConnections
    if (!workspaceId || typeof listConnections !== 'function') {
      setRows([])
      setSurface('unavailable')
      return
    }
    let stale = false
    setRows(null)
    const request = ++listGeneration.current
    listConnections(workspaceId)
      .then((raw) => {
        if (stale || currentWorkspace.current !== workspaceId || request !== listGeneration.current) return
        setRows(sanitizeConnectionRows(raw).filter(row => row.workspaceId === workspaceId))
        setRowsWorkspaceId(workspaceId)
        setSurface('ready')
      })
      .catch((error) => {
        if (stale || currentWorkspace.current !== workspaceId || request !== listGeneration.current) return
        setRows([])
        setSurface(classifyFailClosed(error))
      })
    return () => {
      stale = true
      setSelected(null)
      setConfirmingId(null)
      setRotatingId(null)
      setConvertingId(null)
      setUnbindingId(null)
    }
  }, [workspace?.id, setSelected])

  useEffect(() => {
    if (tab !== 'audit') return
    setAuditSurface('loading')
    const workspaceId = workspace?.id
    const listConnectionAudit = window.electronAPI?.workgraph?.listConnectionAudit
    if (!workspaceId || typeof listConnectionAudit !== 'function') {
      setAuditRows([])
      setAuditSurface('unavailable')
      return
    }
    let stale = false
    auditObservation.current = captureTour.current()
    listConnectionAudit({ workspaceId })
      .then((raw) => {
        if (stale) return
        setAuditRows(sanitizeConnectionAuditRows(raw))
        setAuditSurface('ready')
        setAuditWorkspaceId(workspaceId)
      })
      .catch(() => {
        if (stale) return
        setAuditRows([])
        setAuditSurface('unavailable')
      })
    return () => {
      stale = true
    }
  }, [tab, workspace?.id])

  useEffect(() => {
    if (tab !== 'policies') return
    const workspaceId = workspace?.id
    const listConnectionBindings = window.electronAPI?.workgraph?.listConnectionBindings
    if (!workspaceId || typeof listConnectionBindings !== 'function') {
      setBindingRows([])
      return
    }
    let stale = false
    listConnectionBindings({ workspaceId })
      .then((raw) => {
        if (!stale) setBindingRows(sanitizeConnectionBindingRows(raw))
      })
      .catch(() => {
        if (!stale) setBindingRows([])
      })
    return () => {
      stale = true
    }
  }, [tab, workspace?.id])

  useEffect(() => {
    const fabric = surface !== 'ready' ? surface : rowsWorkspaceId !== workspace?.id || rows === null ? 'loading' : tab === 'audit' ? auditSurface : 'ready'
    return tour.capability('connection-fabric.available', connectionCapabilities({ fabric })['connection-fabric.available']!)
  }, [tour, surface, rows, tab, auditSurface, rowsWorkspaceId, workspace?.id])

  auditViewReady.current = tab === 'audit' && surface === 'ready' && rows !== null && auditSurface === 'ready' && rowsWorkspaceId === workspace?.id && auditWorkspaceId === workspace?.id
  useEffect(() => {
    if (!auditViewReady.current) return
    // The native read keeps the attempt captured before it began. A late
    // completion must never be stamped with a replacement tour's binding.
    tour.emit(auditObservation.current, 'connections.audit-visible', 'observed', 'ui-observation')
  }, [tour, tab, surface, rows, auditSurface, rowsWorkspaceId, auditWorkspaceId, workspace?.id])
  useEffect(() => {
    // Starting a tour on an already loaded Audit view is a new visibility
    // observation; a read that is still pending cannot enter this branch.
    if (auditViewReady.current) tour.emit(tour.capture(), 'connections.audit-visible', 'observed', 'ui-observation')
  }, [tour])

  const refreshRows = async (workspaceId: string) => {
    if (currentWorkspace.current !== workspaceId) return
    const request = ++listGeneration.current
    const listConnections = window.electronAPI?.workgraph?.listConnections
    if (typeof listConnections !== 'function') {
      setSurface('unavailable')
      return
    }
    try {
      const next = sanitizeConnectionRows(await listConnections(workspaceId)).filter(row => row.workspaceId === workspaceId)
      if (currentWorkspace.current !== workspaceId || request !== listGeneration.current) return
      setRows(next)
      setRowsWorkspaceId(workspaceId)
      setSurface('ready')
    } catch (error) {
      if (currentWorkspace.current !== workspaceId || request !== listGeneration.current) return
      setRows([])
      setSurface(classifyFailClosed(error))
    }
  }

  const listed = rows ?? []
  const services = tab === 'services' ? listed : []
  const credentialRows = tab === 'credentials' ? listed : []
  const policyRows = tab === 'policies' ? listed : []
  const failClosed = tab === 'services' && surface !== 'ready'
  const visiblePreviews = matchesConnectSource(previews, activeSource)

  const confirmRevoke = async (connectionId: string) => {
    const workspaceId = workspace?.id
    const revokeConnection = window.electronAPI?.workgraph?.revokeConnection
    if (!workspaceId || typeof revokeConnection !== 'function') {
      setSurface('unavailable')
      return
    }
    try {
      await revokeConnection({ workspaceId, connectionId })
      if (selected?.id === connectionId) setSelected(null)
      setConfirmingId(null)
      await refreshRows(workspaceId)
    } catch (error) {
      actionError(connectionId, error)
    }
  }

  const confirmRotate = async (connectionId: string) => {
    const workspaceId = workspace?.id
    const rotateConnection = window.electronAPI?.workgraph?.rotateConnection
    if (!workspaceId || typeof rotateConnection !== 'function') {
      setSurface('unavailable')
      return
    }
    try {
      await rotateConnection({ workspaceId, connectionId })
      setRotatingId(null)
      await refreshRows(workspaceId)
    } catch (error) {
      actionError(connectionId, error)
    }
  }

  const confirmConvert = async (connectionId: string) => {
    const workspaceId = workspace?.id
    const convertConnection = window.electronAPI?.workgraph?.convertConnection
    if (!workspaceId || typeof convertConnection !== 'function') {
      setSurface('unavailable')
      return
    }
    try {
      await convertConnection({ workspaceId, connectionId })
      setConvertingId(null)
      await refreshRows(workspaceId)
    } catch (error) {
      actionError(connectionId, error)
    }
  }

  const confirmUnbind = async (bindingId: string) => {
    const workspaceId = workspace?.id
    const revokeConnectionBinding = window.electronAPI?.workgraph?.revokeConnectionBinding
    if (!workspaceId || typeof revokeConnectionBinding !== 'function') {
      setSurface('unavailable')
      return
    }
    try {
      await revokeConnectionBinding({ workspaceId, bindingId })
      setUnbindingId(null)
      const listConnectionBindings = window.electronAPI?.workgraph?.listConnectionBindings
      if (typeof listConnectionBindings === 'function') {
        setBindingRows(sanitizeConnectionBindingRows(await listConnectionBindings({ workspaceId })))
      }
    } catch (error) {
      setSurface(classifyFailClosed(error))
    }
  }

  function formError(error: unknown) {
    if (classifyFailClosed(error) === 'unavailable') {
      setSurface('unavailable')
      return
    }
    toast.error(error instanceof Error ? error.message : String(error ?? ''))
  }

  function actionError(connectionId: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error ?? '')
    if (classifyFailClosed(error) === 'unavailable') {
      setSurface('unavailable')
      return
    }
    setRowStatus((current) => ({ ...current, [connectionId]: 'error' }))
    setRowNote((current) => ({ ...current, [connectionId]: message }))
    toast.error(message || t('chat.connectionUnavailable'))
  }

  const runTest = async (connectionId: string) => {
    const workspaceId = workspace?.id
    const testConnection = window.electronAPI?.workgraph?.testConnection
    if (!workspaceId || typeof testConnection !== 'function') {
      setSurface('unavailable')
      return
    }
    try {
      const result = await testConnection({ workspaceId, connectionId })
      setRowStatus((current) => ({ ...current, [connectionId]: 'connected' }))
      setRowNote((current) => ({ ...current, [connectionId]: result?.login ?? '' }))
    } catch (error) {
      actionError(connectionId, error)
    }
  }

  const runRepair = async (connectionId: string) => {
    const workspaceId = workspace?.id
    const repairConnection = window.electronAPI?.workgraph?.repairConnection
    if (!workspaceId || typeof repairConnection !== 'function') {
      setSurface('unavailable')
      return
    }
    try {
      await repairConnection({ workspaceId, connectionId })
      await refreshRows(workspaceId)
      await runTest(connectionId)
    } catch (error) {
      actionError(connectionId, error)
    }
  }

  const confirmCreate = async () => {
    const workspaceId = workspace?.id
    const createConnection = window.electronAPI?.workgraph?.createConnection
    if (!workspaceId || typeof createConnection !== 'function') {
      setSurface('unavailable')
      return
    }
    if (createDraftError({ integrationId: createIntegration, credentialRefId: createCredentialRef })) return
    try {
      await createConnection({
        workspaceId,
        integrationId: createIntegration.trim(),
        credentialRefId: createCredentialRef.trim(),
        storageMode: createStorageMode,
      })
      setCreateCredentialRef('')
      await refreshRows(workspaceId)
    } catch (error) {
      formError(error)
    }
  }

  const confirmGrant = async () => {
    const workspaceId = workspace?.id
    const grantConnection = window.electronAPI?.workgraph?.grantConnection
    if (!workspaceId || typeof grantConnection !== 'function') {
      setSurface('unavailable')
      return
    }
    const connectionId = grantTargetId.trim() || selected?.id || ''
    const actions = parseCsvList(grantActions)
    const resources = parseCsvList(grantResources)
    if (grantDraftError({
      connectionId,
      consumerId: grantConsumer,
      purpose: grantPurpose,
      actions: grantActions,
      resources: grantResources,
    })) return
    try {
      await grantConnection({
        workspaceId,
        connectionId,
        consumerId: grantConsumer.trim(),
        purpose: grantPurpose.trim(),
        actions,
        resources,
      })
      setGrantConsumer('')
      setGrantPurpose('')
      const listConnectionBindings = window.electronAPI?.workgraph?.listConnectionBindings
      if (typeof listConnectionBindings === 'function') {
        setBindingRows(sanitizeConnectionBindingRows(await listConnectionBindings({ workspaceId })))
      }
    } catch (error) {
      formError(error)
    }
  }

  const pickImportPath = async (setPath: (path: string) => void) => {
    const openFileDialog = window.electronAPI?.openFileDialog
    if (typeof openFileDialog !== 'function') return
    const next = firstPickedPath(await openFileDialog())
    if (next) setPath(next)
  }

  const pathField = (
    labelKey: string,
    value: string,
    setValue: (path: string) => void,
    placeholder: string,
  ) => (
    <label className="block">
      <span className="text-muted-foreground">{t(labelKey)}</span>
      <div className="mt-1 flex gap-1">
        <input
          className="w-full rounded-md bg-foreground/[0.04] px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-accent/40"
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          spellCheck={false}
        />
        <button
          type="button"
          data-testid="connections-pick-path"
          aria-label={t(labelKey)}
          className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
          onClick={() => void pickImportPath(setValue)}
        >
          …
        </button>
      </div>
    </label>
  )

  const renderRevokeControls = (row: ConnectionListRow) => (
    confirmingId === row.id ? (
      <div className="flex flex-col items-end gap-1">
        <div className="font-mono text-[11px]" data-testid="connections-confirm-target">
          {row.id} {row.credentialRefId}
        </div>
        <div className="flex gap-1">
        <button type="button" className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground" onClick={() => confirmRevoke(row.id)}>
          {t('connections.revokeConfirm')}
        </button>
        <button type="button" className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground" onClick={() => setConfirmingId(null)}>
          {t('connections.revokeCancel')}
        </button>
        </div>
      </div>
    ) : (
      <button type="button" className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground" onClick={() => setConfirmingId(row.id)}>
        {t('connections.revoke')}
      </button>
    )
  )

  const renderRotateControls = (row: ConnectionListRow) => (
    rotatingId === row.id ? (
      <div className="flex gap-1">
        <button type="button" className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground" onClick={() => confirmRotate(row.id)}>
          {t('connections.rotateConfirm')}
        </button>
        <button type="button" className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground" onClick={() => setRotatingId(null)}>
          {t('connections.rotateCancel')}
        </button>
      </div>
    ) : (
      <button type="button" className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground" onClick={() => setRotatingId(row.id)}>
        {t('connections.rotate')}
      </button>
    )
  )

  const empty = (
    <div className="flex flex-1 items-center justify-center">
      <p className="text-sm">{t('connections.empty')}</p>
    </div>
  )

  const refreshAll = () => {
    setReloadKey((key) => key + 1)
    if (workspace?.id) void refreshRows(workspace.id)
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="connections-page">
      <div className="mx-auto flex w-full max-w-4xl items-center gap-3 px-6 pt-5 pb-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-foreground">{t('connections.title')}</h1>
          <p className="truncate text-sm text-muted-foreground">{t('connections.subtitle')}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={refreshAll} aria-label={t('common.refresh')}>
          <RefreshCw className="h-3.5 w-3.5" />
          {t('common.refresh')}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setTab('imports')}>
          {t('connections.connect')}
        </Button>
      </div>
      <div role="tablist" aria-label={t('sidebar.connections')} className="mx-auto flex w-full max-w-4xl gap-1 px-3 pb-2">
        {TABS.map((id) => (
          <button
            key={id}
            ref={id === 'audit' ? auditTarget : undefined}
            data-product-tour-target={id === 'audit' ? 'connections.audit' : undefined}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${tab === id ? 'bg-foreground/[0.07] text-foreground' : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground'}`}
            onClick={() => setTab(id)}
          >
            {t(`connections.tabs.${id}`)}
          </button>
        ))}
      </div>
      <ScrollArea className="flex-1 min-h-0">
      <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pt-2 pb-16 text-muted-foreground">
        {tab === 'services' && <ProjectAuthorityConnectionPanel />}
        {tab === 'imports' ? (
          <div className="space-y-3 text-sm text-foreground">
            <ul className="flex flex-wrap gap-2 text-xs">
              {CONNECT_SOURCES.map((source) => (
                <li key={source}>
                  <button
                    type="button"
                    data-testid="connections-source-chip"
                    aria-pressed={activeSource === source}
                    className={`rounded-md px-2.5 py-1 ${activeSource === source ? 'bg-foreground/[0.08] text-foreground' : 'bg-foreground/[0.03] text-muted-foreground hover:text-foreground'}`}
                    onClick={() => setActiveSource((current) => current === source ? null : source)}
                  >
                    {source}
                  </button>
                </li>
              ))}
            </ul>
            <ImportPanel source="github-oauth" active={activeSource}>
              {workspace?.id && <GithubDeviceLoginPanel workspaceId={workspace.id} onImported={() => void refreshRows(workspace.id)} />}
            </ImportPanel>
            <ImportPanel source="env" active={activeSource}>
              {pathField('connections.import.envPath', envPath, setEnvPath, IMPORT_PLACEHOLDERS.env)}
              <button
                type="button"
                className="rounded-md bg-foreground/[0.05] px-3 py-1.5 text-xs text-foreground hover:bg-foreground/[0.08]"
                onClick={async () => {
                  const previewGithubEnv = window.electronAPI?.workgraph?.previewGithubEnv
                  if (typeof previewGithubEnv !== 'function' || !envPath) {
                    setPreviews((current) => current.filter((row) => row.source !== 'env'))
                    return
                  }
                  const next = await previewGithubEnv(envPath)
                  setPreviews((current) => [
                    ...current.filter((row) => row.source !== 'env'),
                    ...next.map((row) => ({ ...row, source: 'env' as const })),
                  ])
                }}
              >
                {t('connections.import.discover')}
              </button>
            </ImportPanel>
            <ImportPanel source="git-helper" active={activeSource}>
              {pathField('connections.import.gitConfigPath', gitConfigPath, setGitConfigPath, IMPORT_PLACEHOLDERS.gitConfig)}
              <button
                type="button"
                className="rounded-md bg-foreground/[0.05] px-3 py-1.5 text-xs text-foreground hover:bg-foreground/[0.08]"
                onClick={async () => {
                  const previewGitHelper = window.electronAPI?.workgraph?.previewGitHelper
                  if (typeof previewGitHelper !== 'function' || !gitConfigPath) {
                    setPreviews((current) => current.filter((row) => row.source !== 'git-helper'))
                    return
                  }
                  const next = await previewGitHelper(gitConfigPath)
                  setPreviews((current) => [
                    ...current.filter((row) => row.source !== 'git-helper'),
                    ...next.map((row) => ({ ...row, source: 'git-helper' as const })),
                  ])
                }}
              >
                {t('connections.import.discoverGitHelper')}
              </button>
            </ImportPanel>
            <ImportPanel source="docker" active={activeSource}>
              {pathField('connections.import.dockerConfigPath', dockerConfigPath, setDockerConfigPath, IMPORT_PLACEHOLDERS.dockerConfig)}
              <button
                type="button"
                className="rounded-md bg-foreground/[0.05] px-3 py-1.5 text-xs text-foreground hover:bg-foreground/[0.08]"
                onClick={async () => {
                  const previewDockerHelper = window.electronAPI?.workgraph?.previewDockerHelper
                  if (typeof previewDockerHelper !== 'function' || !dockerConfigPath) {
                    setPreviews((current) => current.filter((row) => row.source !== 'docker'))
                    return
                  }
                  const next = await previewDockerHelper(dockerConfigPath)
                  setPreviews((current) => [
                    ...current.filter((row) => row.source !== 'docker'),
                    ...next.map((row) => ({ ...row, source: 'docker' as const })),
                  ])
                }}
              >
                {t('connections.import.discoverDocker')}
              </button>
            </ImportPanel>
            <ImportPanel source="aws" active={activeSource}>
              {pathField('connections.import.awsCredentialsPath', awsCredentialsPath, setAwsCredentialsPath, IMPORT_PLACEHOLDERS.awsCredentials)}
              {pathField('connections.import.awsConfigPath', awsConfigPath, setAwsConfigPath, IMPORT_PLACEHOLDERS.awsConfig)}
              <button
                type="button"
                className="rounded-md bg-foreground/[0.05] px-3 py-1.5 text-xs text-foreground hover:bg-foreground/[0.08]"
                onClick={async () => {
                  const previewAwsProfiles = window.electronAPI?.workgraph?.previewAwsProfiles
                  if (typeof previewAwsProfiles !== 'function') {
                    setPreviews((current) => current.filter((row) => row.source !== 'aws'))
                    return
                  }
                  const next = await previewAwsProfiles({ credentialsPath: awsCredentialsPath, configPath: awsConfigPath })
                  setPreviews((current) => [
                    ...current.filter((row) => row.source !== 'aws'),
                    ...next.map((row) => ({ ...row, source: 'aws' as const })),
                  ])
                }}
              >
                {t('connections.import.discoverAws')}
              </button>
            </ImportPanel>
            <ImportPanel source="keychain" active={activeSource}>
              <button
                type="button"
                className="rounded-md bg-foreground/[0.05] px-3 py-1.5 text-xs text-foreground hover:bg-foreground/[0.08]"
                onClick={async () => {
                  const previewKeychain = window.electronAPI?.workgraph?.previewKeychain
                  if (typeof previewKeychain !== 'function') {
                    setPreviews((current) => current.filter((row) => row.source !== 'keychain'))
                    return
                  }
                  const next = await previewKeychain()
                  setPreviews((current) => [
                    ...current.filter((row) => row.source !== 'keychain'),
                    ...next.map((row) => ({ ...row, source: 'keychain' as const })),
                  ])
                }}
              >
                {t('connections.import.discoverKeychain')}
              </button>
            </ImportPanel>
            <ImportPanel source="adc" active={activeSource}>
              {pathField('connections.import.adcPath', adcPath, setAdcPath, IMPORT_PLACEHOLDERS.adc)}
              <button
                type="button"
                className="rounded-md bg-foreground/[0.05] px-3 py-1.5 text-xs text-foreground hover:bg-foreground/[0.08]"
                onClick={async () => {
                  const previewAdc = window.electronAPI?.workgraph?.previewAdc
                  if (typeof previewAdc !== 'function' || !adcPath) {
                    setPreviews((current) => current.filter((row) => row.source !== 'adc'))
                    return
                  }
                  const next = await previewAdc(adcPath)
                  setPreviews((current) => [
                    ...current.filter((row) => row.source !== 'adc'),
                    ...next.map((row) => ({ ...row, source: 'adc' as const })),
                  ])
                }}
              >
                {t('connections.import.discoverAdc')}
              </button>
            </ImportPanel>
            <ImportPanel source="ssh-agent" active={activeSource}>
              <button
                type="button"
                className="rounded-md bg-foreground/[0.05] px-3 py-1.5 text-xs text-foreground hover:bg-foreground/[0.08]"
                onClick={async () => {
                  const previewSshAgent = window.electronAPI?.workgraph?.previewSshAgent
                  if (typeof previewSshAgent !== 'function') {
                    setPreviews((current) => current.filter((row) => row.source !== 'ssh-agent'))
                    return
                  }
                  const next = await previewSshAgent()
                  setPreviews((current) => [
                    ...current.filter((row) => row.source !== 'ssh-agent'),
                    ...next.map((row) => ({ ...row, source: 'ssh-agent' as const })),
                  ])
                }}
              >
                {t('connections.import.discoverSshAgent')}
              </button>
            </ImportPanel>
            <ul className="space-y-2">
              {visiblePreviews.map((row) => (
                <li key={`${row.source}:${row.candidateId}`} className="flex items-center justify-between rounded-[var(--radius-control)] bg-foreground/[0.02] px-3 py-2">
                  <div>
                    <div className="font-medium">{row.label}</div>
                    <div className="font-mono text-xs text-muted-foreground">{row.maskedSummary}</div>
                  </div>
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
                    onClick={async () => {
                      const workspaceId = workspace?.id
                      const api = window.electronAPI?.workgraph
                      if (!workspaceId || !api) return
                      if (row.source === 'env' && api.importGithubEnv) {
                        await api.importGithubEnv({ envPath, candidateId: row.candidateId, workspaceId })
                      } else if (row.source === 'git-helper' && api.importGitHelper) {
                        await api.importGitHelper({ configPath: gitConfigPath, candidateId: row.candidateId, workspaceId })
                      } else if (row.source === 'docker' && api.importDockerHelper) {
                        await api.importDockerHelper({ configPath: dockerConfigPath, candidateId: row.candidateId, workspaceId })
                      } else if (row.source === 'aws' && api.importAwsProfile) {
                        await api.importAwsProfile({ credentialsPath: awsCredentialsPath, configPath: awsConfigPath, candidateId: row.candidateId, workspaceId })
                      } else if (row.source === 'keychain' && api.importKeychain) {
                        await api.importKeychain({ candidateId: row.candidateId, workspaceId })
                      } else if (row.source === 'adc' && api.importAdc) {
                        await api.importAdc({ credentialsPath: adcPath, candidateId: row.candidateId, workspaceId })
                      } else if (row.source === 'ssh-agent' && api.importSshAgent) {
                        await api.importSshAgent({ candidateId: row.candidateId, workspaceId })
                      }
                      setPreviews((current) => removeCommittedPreview(current, row))
                      await refreshRows(workspaceId)
                    }}
                  >
                    {t('connections.import.commit')}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : tab === 'services' ? (
          <div ref={servicesTarget} className="space-y-6 text-sm text-foreground" data-product-tour-target="connections.services">
            {workspace?.id ? <ConnectionsOverview workspaceId={workspace.id} reloadKey={reloadKey} /> : null}
            <OverviewGroup
              title={t('connections.overview.credentials')}
              count={services.length}
              action={
                <Button size="sm" variant="ghost" onClick={() => setShowCreate((open) => !open)}>
                  {t('connections.create')}
                </Button>
              }
            >
              {failClosed ? (
                <li
                  className="px-4 py-3 text-sm text-muted-foreground"
                  data-testid="connections-services-unavailable"
                  role="alert"
                >
                  {t(surface === 'unavailable' ? 'sidebar.connectionsUnavailable' : 'chat.connectionUnavailable')}
                </li>
              ) : services.length > 0 ? (
                services.map((row) => (
                  <OverviewRow
                    key={row.id}
                    testId="connections-credential-row"
                    icon={<span className="h-5 w-5 rounded-[var(--radius-card)] bg-foreground/10 text-center text-[11px] font-semibold leading-5 text-foreground/70">{row.integrationId.slice(0, 1).toUpperCase()}</span>}
                    title={row.integrationId}
                    subtitle={[row.credentialRefId, row.storageMode, rowNote[row.id]].filter(Boolean).join(' · ')}
                    status={rowStatus[row.id] ?? 'pending'}
                  >
                    <button
                      type="button"
                      data-testid="connections-row"
                      aria-selected={selected?.id === row.id}
                      className={`rounded-md px-2 py-1 text-xs ${selected?.id === row.id ? 'bg-accent/10 text-accent' : 'text-muted-foreground hover:bg-foreground/[0.05]'}`}
                      onClick={() => setSelected(row)}
                    >
                      {t('connections.overview.details')}
                    </button>
                    <Button size="sm" variant="secondary" onClick={() => runTest(row.id)}>
                      {t('connections.test')}
                    </Button>
                    {rowStatus[row.id] === 'error' ? (
                      <Button size="sm" variant="ghost" onClick={() => runRepair(row.id)}>
                        {t('connections.repair')}
                      </Button>
                    ) : null}
                    {renderRotateControls(row)}
                    {renderRevokeControls(row)}
                  </OverviewRow>
                ))
              ) : (
                <li className="px-4 py-3 text-sm text-muted-foreground">{t('connections.overview.noCredentials')}</li>
              )}
            </OverviewGroup>
            {selected && workspace?.id && selected.workspaceId === workspace.id && <ConnectionLifecyclePanel connection={selected} workspaceId={workspace.id} />}
            {showCreate ? (
              <div data-testid="connections-create-form" className="grid gap-3 rounded-[var(--radius-card)] bg-foreground/[0.02] p-4 sm:grid-cols-3">
                <label className="block">
                  <span className="text-xs text-muted-foreground">{t('connections.createIntegration')}</span>
                  <input
                    className="mt-1 h-8 w-full rounded-md bg-foreground/[0.04] px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-accent/40"
                    value={createIntegration}
                    onChange={(event) => setCreateIntegration(event.target.value)}
                    spellCheck={false}
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-muted-foreground">{t('connections.createCredentialRef')}</span>
                  <input
                    className="mt-1 h-8 w-full rounded-md bg-foreground/[0.04] px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-accent/40"
                    value={createCredentialRef}
                    onChange={(event) => setCreateCredentialRef(event.target.value)}
                    spellCheck={false}
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-muted-foreground">{t('connections.createStorageMode')}</span>
                  <select
                    className="mt-1 h-8 w-full rounded-md bg-foreground/[0.04] px-2 font-mono text-xs outline-none"
                    value={createStorageMode}
                    onChange={(event) => setCreateStorageMode(event.target.value === 'reference' ? 'reference' : 'copy')}
                  >
                    <option value="copy">copy</option>
                    <option value="reference">reference</option>
                  </select>
                </label>
                <div className="sm:col-span-3">
                  <Button size="sm" variant="secondary" onClick={() => void confirmCreate()}>
                    {t('connections.create')}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : tab === 'credentials' && credentialRows.length > 0 ? (
          <ul className="space-y-2 text-sm text-foreground">
            {credentialRows.map((row) => (
              <li key={row.id} className="flex items-center gap-2 rounded-[var(--radius-control)] bg-foreground/[0.02] px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{row.integrationId}</div>
                  <div className="font-mono text-xs">{row.credentialRefId}</div>
                  <div className="text-muted-foreground">{row.storageMode}</div>
                </div>
                {row.storageMode === 'copy' ? (
                  convertingId === row.id ? (
                    <div className="flex flex-col items-end gap-1">
                      <div className="font-mono text-[11px]">{row.id} {row.credentialRefId}</div>
                      <div className="flex gap-1">
                        <button type="button" className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground" onClick={() => confirmConvert(row.id)}>
                          {t('connections.convertConfirm')}
                        </button>
                        <button type="button" className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground" onClick={() => setConvertingId(null)}>
                          {t('connections.convertCancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground" onClick={() => setConvertingId(row.id)}>
                      {t('connections.convert')}
                    </button>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        ) : tab === 'policies' ? (
          <div className="space-y-4 text-sm text-foreground">
            <div data-testid="connections-grant-form" className="space-y-2 rounded-[var(--radius-card)] bg-foreground/[0.02] p-4">
              <label className="block">
                <span className="text-muted-foreground">{t('connections.grantConsumer')}</span>
                <input
                  className="mt-1 w-full rounded-md bg-foreground/[0.04] px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-accent/40"
                  value={grantConsumer}
                  onChange={(event) => setGrantConsumer(event.target.value)}
                  spellCheck={false}
                />
              </label>
              <label className="block">
                <span className="text-muted-foreground">{t('connections.grantPurpose')}</span>
                <input
                  className="mt-1 w-full rounded-md bg-foreground/[0.04] px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-accent/40"
                  value={grantPurpose}
                  onChange={(event) => setGrantPurpose(event.target.value)}
                  spellCheck={false}
                />
              </label>
              <label className="block">
                <span className="text-muted-foreground">{t('connections.grantActions')}</span>
                <input
                  className="mt-1 w-full rounded-md bg-foreground/[0.04] px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-accent/40"
                  value={grantActions}
                  onChange={(event) => setGrantActions(event.target.value)}
                  spellCheck={false}
                />
              </label>
              <label className="block">
                <span className="text-muted-foreground">{t('connections.grantResources')}</span>
                <input
                  className="mt-1 w-full rounded-md bg-foreground/[0.04] px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-accent/40"
                  value={grantResources}
                  onChange={(event) => setGrantResources(event.target.value)}
                  spellCheck={false}
                />
              </label>
              <label className="block">
                <span className="text-muted-foreground">{t('connections.grantTarget')}</span>
                <select
                  className="mt-1 w-full rounded-md bg-foreground/[0.04] px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-accent/40"
                  value={grantTargetId || selected?.id || ''}
                  onChange={(event) => setGrantTargetId(event.target.value)}
                >
                  <option value="">{t('connections.empty')}</option>
                  {listed.map((row) => (
                    <option key={row.id} value={row.id}>{row.id}</option>
                  ))}
                </select>
              </label>
              <button type="button" className="rounded-md bg-foreground/[0.05] px-3 py-1.5 text-xs text-foreground hover:bg-foreground/[0.08]" onClick={() => void confirmGrant()}>
                {t('connections.grant')}
              </button>
            </div>
            {policyRows.length > 0 ? (
              <ul className="space-y-2">
                {policyRows.map((row) => (
                  <li key={row.id} className="rounded-[var(--radius-card)] bg-foreground/[0.02] px-3 py-2">
                    <div className="font-medium">{row.integrationId}</div>
                    <div className="font-mono text-xs">{row.scopes.join(', ') || '—'}</div>
                  </li>
                ))}
              </ul>
            ) : null}
            {bindingRows.length > 0 ? (
              <ul className="space-y-2">
                {bindingRows.map((row) => (
                  <li key={row.id} className="flex items-center gap-2 rounded-[var(--radius-control)] bg-foreground/[0.02] px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{row.consumerId}</div>
                      <div className="text-muted-foreground">{row.purpose}</div>
                      <div className="font-mono text-xs">{row.actions.join(', ')}</div>
                    </div>
                    {unbindingId === row.id ? (
                      <div className="flex gap-1">
                        <button type="button" className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground" onClick={() => confirmUnbind(row.id)}>
                          {t('connections.unbindConfirm')}
                        </button>
                        <button type="button" className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground" onClick={() => setUnbindingId(null)}>
                          {t('connections.unbindCancel')}
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground" onClick={() => setUnbindingId(row.id)}>
                        {t('connections.unbind')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : tab === 'audit' && auditRows.length > 0 ? (
          <ul className="space-y-2 text-sm text-foreground">
            {auditRows.map((row) => (
              <li key={`${row.connectionId}:${row.occurredAt}:${row.payloadDigest}`} className="rounded-[var(--radius-card)] bg-foreground/[0.02] px-3 py-2">
                <div className="font-medium">{row.eventType}</div>
                <div className="text-muted-foreground">{row.outcome}</div>
                <div className="font-mono text-xs">{row.connectionId}</div>
                <div className="font-mono text-xs">{row.payloadDigest}</div>
                {row.action ? <div className="font-mono text-xs">{row.action}</div> : null}
              </li>
            ))}
          </ul>
        ) : (
          empty
        )}
      </div>
      </ScrollArea>
    </div>
  )
}
