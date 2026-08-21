import { useAtom } from 'jotai'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { selectedConnectionAtom } from '@/atoms/connections'
import { useActiveWorkspace } from '@/context/AppShellContext'
import {
  inspectSummaryFromRaw,
  isStaleInspectSummary,
  sanitizeConnectionAuditRows,
  sanitizeConnectionBindingRows,
  sanitizeConnectionRows,
  type ConnectionAuditRow,
  type ConnectionBindingRow,
  type ConnectionInspectSummary,
  type ConnectionListRow,
} from './connections-list'
import {
  CONNECT_SOURCES,
  IMPORT_PLACEHOLDERS,
  MOVE_BACKENDS,
  createDraftError,
  errorMessage,
  firstPickedPath,
  formatConfirmLeases,
  formatReconnectLeases,
  grantDraftError,
  isImportPanelVisible,
  matchesConnectSource,
  parseCsvList,
  removeCommittedPreview,
  sanitizeActiveLeases,
  sanitizeDeviceLoginStart,
  sanitizeDevicePoll,
  sanitizeReconnectLeases,
  devicePollDelayMs,
  githubDeviceVerificationHref,
  importedConnectionFromList,
  tabFromKey,
  testStatusFromError,
  testStatusFromResult,
  type ActiveLeaseView,
  type ConnectSource,
  type DeviceLoginView,
  type DevicePollView,
  type MoveBackend,
  type PreviewSource,
  type TestStatus,
} from './connections-ui'

const TABS = ['services', 'credentials', 'imports', 'policies', 'audit'] as const
type ConnectionsTab = (typeof TABS)[number]
type PreviewRow = {
  candidateId: string
  label: string
  maskedSummary: string
  source: PreviewSource
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
  const [tab, setTab] = useState<ConnectionsTab>('services')
  const [selected, setSelected] = useAtom(selectedConnectionAtom)
  const [rows, setRows] = useState<ConnectionListRow[] | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [rotatingId, setRotatingId] = useState<string | null>(null)
  const [convertingId, setConvertingId] = useState<string | null>(null)
  const [unbindingId, setUnbindingId] = useState<string | null>(null)
  const [reconnectingId, setReconnectingId] = useState<string | null>(null)
  const [envPath, setEnvPath] = useState('')
  const [gitConfigPath, setGitConfigPath] = useState('')
  const [dockerConfigPath, setDockerConfigPath] = useState('')
  const [awsCredentialsPath, setAwsCredentialsPath] = useState('')
  const [awsConfigPath, setAwsConfigPath] = useState('')
  const [adcPath, setAdcPath] = useState('')
  const [previews, setPreviews] = useState<PreviewRow[]>([])
  const [auditRows, setAuditRows] = useState<ConnectionAuditRow[]>([])
  const [bindingRows, setBindingRows] = useState<ConnectionBindingRow[]>([])
  const [importError, setImportError] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [auditError, setAuditError] = useState<string | null>(null)
  const [activeSource, setActiveSource] = useState<ConnectSource | null>(null)
  const [testById, setTestById] = useState<Record<string, TestStatus>>({})
  const [createIntegration, setCreateIntegration] = useState('github')
  const [createCredentialRef, setCreateCredentialRef] = useState('')
  const [createStorageMode, setCreateStorageMode] = useState<'copy' | 'reference'>('copy')
  const [grantConsumer, setGrantConsumer] = useState('')
  const [grantPurpose, setGrantPurpose] = useState('')
  const [grantActions, setGrantActions] = useState('github.api')
  const [grantResources, setGrantResources] = useState('github:user')
  const [grantTargetId, setGrantTargetId] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null)
  const [moveTarget, setMoveTarget] = useState<MoveBackend>(MOVE_BACKENDS[0])
  const [deviceLogin, setDeviceLogin] = useState<DeviceLoginView | null>(null)
  const [devicePoll, setDevicePoll] = useState<DevicePollView | null>(null)
  const [inspectById, setInspectById] = useState<Record<string, ConnectionInspectSummary>>({})
  const [leasesById, setLeasesById] = useState<Record<string, string>>({})
  const [revalidatedById, setRevalidatedById] = useState<Record<string, string>>({})
  const [leasePreviewById, setLeasePreviewById] = useState<Record<string, ActiveLeaseView[]>>({})

  useEffect(() => {
    const workspaceId = workspace?.id
    const listConnections = window.electronAPI?.workgraph?.listConnections
    if (!workspaceId || typeof listConnections !== 'function') {
      setRows([])
      setListError(null)
      return
    }
    let stale = false
    listConnections(workspaceId)
      .then((raw) => {
        if (!stale) {
          setListError(null)
          setRows(sanitizeConnectionRows(raw))
        }
      })
      .catch((err) => {
        if (!stale) {
          setRows([])
          setListError(errorMessage(err))
        }
      })
    return () => {
      stale = true
      setSelected(null)
      setConfirmingId(null)
      setRotatingId(null)
      setConvertingId(null)
      setUnbindingId(null)
      setReconnectingId(null)
      setLeasesById({})
      setRevalidatedById({})
      setLeasePreviewById({})
    }
  }, [workspace?.id, setSelected])

  useEffect(() => {
    if (tab !== 'audit') return
    const workspaceId = workspace?.id
    const listConnectionAudit = window.electronAPI?.workgraph?.listConnectionAudit
    if (!workspaceId || typeof listConnectionAudit !== 'function') {
      setAuditRows([])
      setAuditError(null)
      return
    }
    let stale = false
    listConnectionAudit({ workspaceId })
      .then((raw) => {
        if (!stale) {
          setAuditError(null)
          setAuditRows(sanitizeConnectionAuditRows(raw))
        }
      })
      .catch((err) => {
        if (!stale) {
          setAuditRows([])
          setAuditError(errorMessage(err))
        }
      })
    return () => {
      stale = true
    }
  }, [tab, workspace?.id])

  useEffect(() => {
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
  }, [workspace?.id])

  const refreshRows = async (workspaceId: string) => {
    const listConnections = window.electronAPI?.workgraph?.listConnections
    if (typeof listConnections !== 'function') return []
    try {
      setListError(null)
      const listed = sanitizeConnectionRows(await listConnections(workspaceId))
      setRows(listed)
      return listed
    } catch (err) {
      setListError(errorMessage(err))
      return []
    }
  }

  const applyDevicePoll = async (workspaceId: string, next: DevicePollView) => {
    setDevicePoll(next)
    if (next.status !== 'imported') return
    setDeviceLogin(null)
    const listed = await refreshRows(workspaceId)
    const created = importedConnectionFromList(listed, next.connectionId)
    if (created) setSelected(created)
  }

  const cancelDeviceLogin = async () => {
    const flowId = deviceLogin?.flowId
    const cancelGithubDeviceLogin = window.electronAPI?.workgraph?.cancelGithubDeviceLogin
    setDeviceLogin(null)
    setDevicePoll(null)
    if (!flowId || typeof cancelGithubDeviceLogin !== 'function') return
    try {
      await cancelGithubDeviceLogin({ flowId })
    } catch (err) {
      setImportError(errorMessage(err))
    }
  }

  useEffect(() => {
    const workspaceId = workspace?.id
    const inspectConnection = window.electronAPI?.workgraph?.inspectConnection
    if (!workspaceId || typeof inspectConnection !== 'function' || !rows) {
      if (rows && rows.length === 0) setInspectById({})
      return
    }
    let stale = false
    void Promise.all(rows.map(async (row) => {
      try {
        return [row.id, inspectSummaryFromRaw(await inspectConnection({
          workspaceId,
          connectionId: row.id,
        }))] as const
      } catch {
        return null
      }
    })).then((entries) => {
      if (stale) return
      const next: Record<string, ConnectionInspectSummary> = {}
      for (const entry of entries) {
        if (entry) next[entry[0]] = entry[1]
      }
      setInspectById(next)
    })
    return () => {
      stale = true
    }
  }, [workspace?.id, rows])

  useEffect(() => {
    if (!deviceLogin || importError) return
    const delay = devicePollDelayMs(devicePoll ?? { interval: deviceLogin.interval, status: 'pending' })
    if (delay == null) return
    const workspaceId = workspace?.id
    const pollGithubDeviceLogin = window.electronAPI?.workgraph?.pollGithubDeviceLogin
    if (!workspaceId || typeof pollGithubDeviceLogin !== 'function') return
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const next = sanitizeDevicePoll(await pollGithubDeviceLogin({
            flowId: deviceLogin.flowId,
            workspaceId,
          }))
          await applyDevicePoll(workspaceId, next)
        } catch (err) {
          setImportError(errorMessage(err))
        }
      })()
    }, delay)
    return () => window.clearTimeout(timer)
  }, [deviceLogin, devicePoll, importError, workspace?.id])

  const runPreview = async (
    source: PreviewSource,
    load: () => Promise<Array<{ candidateId: string; label: string; maskedSummary: string }>>,
  ) => {
    try {
      setImportError(null)
      const next = await load()
      setPreviews((current) => [
        ...current.filter((row) => row.source !== source),
        ...next.map((row) => ({ ...row, source })),
      ])
    } catch (err) {
      setImportError(errorMessage(err))
      setPreviews((current) => current.filter((row) => row.source !== source))
    }
  }

  const pickImportPath = async (setPath: (path: string) => void) => {
    const openFileDialog = window.electronAPI?.openFileDialog
    if (typeof openFileDialog !== 'function') return
    try {
      const next = firstPickedPath(await openFileDialog())
      if (next) setPath(next)
    } catch (err) {
      setImportError(errorMessage(err))
    }
  }

  const listed = rows ?? []
  const services = tab === 'services' ? listed : []
  const credentialRows = tab === 'credentials' ? listed : []
  const policyRows = tab === 'policies' ? listed : []
  const visiblePreviews = matchesConnectSource(previews, activeSource)

  const applyRevokedLeases = (connectionId: string, leases: unknown) => {
    const next = formatReconnectLeases(sanitizeReconnectLeases(leases))
    setLeasesById((current) => ({
      ...current,
      [connectionId]: next === '—' ? '' : next,
    }))
  }

  const applyRevalidated = (connectionId: string, consumers: unknown) => {
    const next = formatReconnectLeases(sanitizeReconnectLeases(consumers))
    setRevalidatedById((current) => ({
      ...current,
      [connectionId]: next === '—' ? '' : next,
    }))
  }

  const applyInspect = (connectionId: string, inspect: unknown) => {
    setInspectById((current) => ({
      ...current,
      [connectionId]: inspectSummaryFromRaw(inspect),
    }))
  }

  const visibleInspectValue = (value: string) => (value && value !== '—' ? value : '')

  const applySelectedRow = (listed: ConnectionListRow[], connectionId: string) => {
    if (selected?.id !== connectionId) return
    const next = importedConnectionFromList(listed, connectionId)
    if (next) setSelected(next)
  }

  const confirmRevoke = async (connectionId: string) => {
    const workspaceId = workspace?.id
    const revokeConnection = window.electronAPI?.workgraph?.revokeConnection
    if (!workspaceId || typeof revokeConnection !== 'function') return
    try {
      setListError(null)
      const result = await revokeConnection({ workspaceId, connectionId })
      applyRevokedLeases(connectionId, result.leases)
      applyInspect(connectionId, result.inspect)
      if (selected?.id === connectionId) setSelected(null)
      setConfirmingId(null)
      await refreshRows(workspaceId)
    } catch (err) {
      setListError(errorMessage(err))
    }
  }

  const confirmRotate = async (connectionId: string) => {
    const workspaceId = workspace?.id
    const rotateConnection = window.electronAPI?.workgraph?.rotateConnection
    if (!workspaceId || typeof rotateConnection !== 'function') return
    try {
      setListError(null)
      const result = await rotateConnection({ workspaceId, connectionId })
      applyRevokedLeases(connectionId, result.leases)
      applyRevalidated(connectionId, result.consumers)
      applyInspect(connectionId, result.inspect)
      setRotatingId(null)
      const listed = await refreshRows(workspaceId)
      applySelectedRow(listed, connectionId)
    } catch (err) {
      setListError(errorMessage(err))
    }
  }

  const previewActiveLeases = async (connectionId: string) => {
    const workspaceId = workspace?.id
    const listConnectionLeases = window.electronAPI?.workgraph?.listConnectionLeases
    if (!workspaceId || typeof listConnectionLeases !== 'function') {
      setLeasePreviewById((current) => ({ ...current, [connectionId]: [] }))
      return
    }
    try {
      setListError(null)
      setLeasePreviewById((current) => ({
        ...current,
        [connectionId]: sanitizeActiveLeases(await listConnectionLeases({ workspaceId, connectionId })),
      }))
    } catch (err) {
      setListError(errorMessage(err))
      setLeasePreviewById((current) => ({ ...current, [connectionId]: [] }))
    }
  }

  const previewReconnect = async (connectionId: string) => {
    setReconnectingId(connectionId)
    await previewActiveLeases(connectionId)
  }

  const confirmReconnect = async (connectionId: string) => {
    const workspaceId = workspace?.id
    const reconnectConnection = window.electronAPI?.workgraph?.reconnectConnection
    if (!workspaceId || typeof reconnectConnection !== 'function') return
    try {
      setListError(null)
      const result = await reconnectConnection({ workspaceId, connectionId })
      applyInspect(connectionId, result.inspect)
      applyRevokedLeases(connectionId, result.leases)
      applyRevalidated(connectionId, result.consumers)
      setReconnectingId(null)
      const listed = await refreshRows(workspaceId)
      applySelectedRow(listed, connectionId)
    } catch (err) {
      setListError(errorMessage(err))
    }
  }

  const runTest = async (connectionId: string) => {
    const workspaceId = workspace?.id
    const testConnection = window.electronAPI?.workgraph?.testConnection
    if (!workspaceId || typeof testConnection !== 'function') return
    try {
      const result = await testConnection({ workspaceId, connectionId })
      setTestById((current) => ({ ...current, [connectionId]: testStatusFromResult(result) }))
    } catch (err) {
      setTestById((current) => ({ ...current, [connectionId]: testStatusFromError(err) }))
    }
  }

  const confirmConvert = async (connectionId: string) => {
    const workspaceId = workspace?.id
    const convertConnection = window.electronAPI?.workgraph?.convertConnection
    if (!workspaceId || typeof convertConnection !== 'function') return
    try {
      setListError(null)
      const result = await convertConnection({ workspaceId, connectionId })
      applyRevokedLeases(connectionId, result.leases)
      applyRevalidated(connectionId, result.consumers)
      applyInspect(connectionId, result.inspect)
      setConvertingId(null)
      const listed = await refreshRows(workspaceId)
      applySelectedRow(listed, connectionId)
    } catch (err) {
      setListError(errorMessage(err))
    }
  }

  const confirmMove = async (connectionId: string) => {
    const workspaceId = workspace?.id
    const moveConnection = window.electronAPI?.workgraph?.moveConnection
    if (!workspaceId || typeof moveConnection !== 'function') return
    try {
      setListError(null)
      const result = await moveConnection({ workspaceId, connectionId, targetBackend: moveTarget })
      applyRevokedLeases(connectionId, result.leases)
      applyRevalidated(connectionId, result.consumers)
      applyInspect(connectionId, result.inspect)
      setMovingId(null)
      const listed = await refreshRows(workspaceId)
      applySelectedRow(listed, connectionId)
    } catch (err) {
      setListError(errorMessage(err))
    }
  }

  const confirmUnbind = async (bindingId: string) => {
    const workspaceId = workspace?.id
    const revokeConnectionBinding = window.electronAPI?.workgraph?.revokeConnectionBinding
    if (!workspaceId || typeof revokeConnectionBinding !== 'function') return
    const binding = bindingRows.find((row) => row.id === bindingId)
    try {
      setListError(null)
      await revokeConnectionBinding({ workspaceId, bindingId })
      setUnbindingId(null)
      const listConnectionBindings = window.electronAPI?.workgraph?.listConnectionBindings
      if (typeof listConnectionBindings === 'function') {
        setBindingRows(sanitizeConnectionBindingRows(await listConnectionBindings({ workspaceId })))
      }
      if (binding) {
        const listed = await refreshRows(workspaceId)
        applySelectedRow(listed, binding.connectionId)
      }
    } catch (err) {
      setListError(errorMessage(err))
    }
  }

  const runRepair = async (connectionId: string) => {
    const workspaceId = workspace?.id
    const repairConnection = window.electronAPI?.workgraph?.repairConnection
    if (!workspaceId || typeof repairConnection !== 'function') return
    try {
      setListError(null)
      const result = await repairConnection({ workspaceId, connectionId })
      applyInspect(connectionId, result.inspect)
      applyRevalidated(connectionId, result.consumers)
      const listed = await refreshRows(workspaceId)
      applySelectedRow(listed, connectionId)
    } catch (err) {
      setListError(errorMessage(err))
    }
  }

  const confirmCreate = async () => {
    const workspaceId = workspace?.id
    const createConnection = window.electronAPI?.workgraph?.createConnection
    if (!workspaceId || typeof createConnection !== 'function') return
    const draftError = createDraftError({
      integrationId: createIntegration,
      credentialRefId: createCredentialRef,
    })
    if (draftError) {
      setFormError(draftError)
      return
    }
    try {
      setListError(null)
      setFormError(null)
      const created = await createConnection({
        workspaceId,
        integrationId: createIntegration.trim(),
        credentialRefId: createCredentialRef.trim() as `cred_${string}`,
        storageMode: createStorageMode,
      })
      setCreateCredentialRef('')
      const [row] = sanitizeConnectionRows([created])
      if (row) setSelected(row)
      const listed = await refreshRows(workspaceId)
      if (row) applySelectedRow(listed, row.id)
    } catch (err) {
      setListError(errorMessage(err))
    }
  }

  const confirmGrant = async () => {
    const workspaceId = workspace?.id
    const grantConnection = window.electronAPI?.workgraph?.grantConnection
    if (!workspaceId || typeof grantConnection !== 'function') return
    const connectionId = grantTargetId.trim() || selected?.id || ''
    const draftError = grantDraftError({
      connectionId,
      consumerId: grantConsumer,
      purpose: grantPurpose,
      actions: grantActions,
      resources: grantResources,
    })
    if (draftError) {
      setFormError(draftError)
      return
    }
    const actions = parseCsvList(grantActions)
    const resources = parseCsvList(grantResources)
    try {
      setListError(null)
      setFormError(null)
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
      const listed = await refreshRows(workspaceId)
      applySelectedRow(listed, connectionId)
    } catch (err) {
      setListError(errorMessage(err))
    }
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
          className="w-full rounded border bg-transparent px-2 py-1 font-mono text-xs"
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          spellCheck={false}
        />
        <button
          type="button"
          data-testid="connections-pick-path"
          aria-label={t(labelKey)}
          className="rounded border px-2 py-1"
          onClick={() => pickImportPath(setValue)}
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
          {formatConfirmLeases(row, leasePreviewById[row.id] ?? [])}
        </div>
        <div className="flex gap-1">
        <button type="button" className="rounded border px-2 py-1" onClick={() => confirmRevoke(row.id)}>
          {t('connections.revokeConfirm')}
        </button>
        <button type="button" className="rounded border px-2 py-1" onClick={() => setConfirmingId(null)}>
          {t('connections.revokeCancel')}
        </button>
        </div>
      </div>
    ) : (
      <button type="button" className="rounded border px-2 py-1" onClick={() => {
        setConfirmingId(row.id)
        void previewActiveLeases(row.id)
      }}>
        {t('connections.revoke')}
      </button>
    )
  )

  const renderReconnectControls = (row: ConnectionListRow) => {
    const inspect = inspectById[row.id]
    if (!inspect || !isStaleInspectSummary(inspect)) return null
    return reconnectingId === row.id ? (
      <div className="flex flex-col items-end gap-1" data-testid="connections-row-reconnect">
        <div className="font-mono text-[11px]" data-testid="connections-row-reconnect-confirm-target">
          {formatConfirmLeases(row, leasePreviewById[row.id] ?? [])}
        </div>
        <p className="text-[11px] text-muted-foreground">{t('connections.reconnectLeases')}</p>
        <div className="flex gap-1">
          <button type="button" className="rounded border px-2 py-1" onClick={() => confirmReconnect(row.id)}>
            {t('connections.reconnectConfirm')}
          </button>
          <button type="button" className="rounded border px-2 py-1" onClick={() => setReconnectingId(null)}>
            {t('connections.reconnectCancel')}
          </button>
        </div>
      </div>
    ) : (
      <div data-testid="connections-row-reconnect">
        <button type="button" className="rounded border px-2 py-1" onClick={() => void previewReconnect(row.id)}>
          {t('connections.reconnect')}
        </button>
      </div>
    )
  }

  const renderRotateControls = (row: ConnectionListRow) => (
    rotatingId === row.id ? (
      <div className="flex flex-col items-end gap-1">
        <div className="font-mono text-[11px]" data-testid="connections-rotate-confirm-target">
          {formatConfirmLeases(row, leasePreviewById[row.id] ?? [])}
        </div>
        <div className="flex gap-1">
        <button type="button" className="rounded border px-2 py-1" onClick={() => confirmRotate(row.id)}>
          {t('connections.rotateConfirm')}
        </button>
        <button type="button" className="rounded border px-2 py-1" onClick={() => setRotatingId(null)}>
          {t('connections.rotateCancel')}
        </button>
        </div>
      </div>
    ) : (
      <button type="button" className="rounded border px-2 py-1" onClick={() => {
        setRotatingId(row.id)
        void previewActiveLeases(row.id)
      }}>
        {t('connections.rotate')}
      </button>
    )
  )

  const renderConvertMoveControls = (row: ConnectionListRow) => (
    <>
      {row.storageMode === 'copy' ? (
        convertingId === row.id ? (
          <div className="flex flex-col items-end gap-1">
            <div className="font-mono text-[11px]" data-testid="connections-convert-confirm-target">
              {formatConfirmLeases(row, leasePreviewById[row.id] ?? [])}
            </div>
            <div className="flex gap-1">
              <button type="button" className="rounded border px-2 py-1" onClick={() => confirmConvert(row.id)}>
                {t('connections.convertConfirm')}
              </button>
              <button type="button" className="rounded border px-2 py-1" onClick={() => setConvertingId(null)}>
                {t('connections.convertCancel')}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="rounded border px-2 py-1" onClick={() => {
            setConvertingId(row.id)
            void previewActiveLeases(row.id)
          }}>
            {t('connections.convert')}
          </button>
        )
      ) : null}
      {movingId === row.id ? (
        <div className="flex flex-col items-end gap-1">
          <div className="font-mono text-[11px]" data-testid="connections-move-confirm-target">
            {formatConfirmLeases(row, leasePreviewById[row.id] ?? [])}
          </div>
          <select
            className="rounded border bg-transparent px-2 py-1 font-mono text-xs"
            value={moveTarget}
            onChange={(event) => setMoveTarget(event.target.value === 'local-alt' ? 'local-alt' : MOVE_BACKENDS[0])}
          >
            {MOVE_BACKENDS.map((backend) => (
              <option key={backend} value={backend}>{backend}</option>
            ))}
          </select>
          <div className="flex gap-1">
            <button type="button" className="rounded border px-2 py-1" onClick={() => confirmMove(row.id)}>
              {t('connections.moveConfirm')}
            </button>
            <button type="button" className="rounded border px-2 py-1" onClick={() => setMovingId(null)}>
              {t('connections.moveCancel')}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="rounded border px-2 py-1" onClick={() => {
          setMovingId(row.id)
          void previewActiveLeases(row.id)
        }}>
          {t('connections.move')}
        </button>
      )}
    </>
  )

  const empty = (
    <div className="flex flex-1 items-center justify-center">
      {tab === 'audit' && auditError ? (
        <p className="text-sm" data-testid="connections-audit-error">{auditError}</p>
      ) : listError ? (
        <p className="text-sm" data-testid="connections-list-error">{listError}</p>
      ) : (
        <p className="text-sm">{t(tab === 'audit' ? 'connections.audit.empty' : 'connections.empty')}</p>
      )}
    </div>
  )

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="connections-page">
      <div
        role="tablist"
        aria-label={t('sidebar.connections')}
        className="flex gap-2 border-b px-4 pt-3"
        onKeyDown={(event) => {
          const next = tabFromKey(TABS, tab, event.key)
          if (!next || (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Home' && event.key !== 'End')) return
          event.preventDefault()
          setTab(next)
        }}
      >
        {TABS.map((id) => (
          <button
            key={id}
            id={`connections-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`connections-panel-${id}`}
            className={`rounded-t px-3 py-2 text-sm ${tab === id ? 'bg-accent/10 text-accent' : 'text-muted-foreground'}`}
            onClick={() => setTab(id)}
          >
            {t(`connections.tab.${id}`)}
          </button>
        ))}
        <button
          type="button"
          className="ml-auto rounded border px-3 py-1 text-sm text-foreground"
          onClick={() => setTab('imports')}
        >
          {t('connections.connect')}
        </button>
      </div>
      <div
        role="tabpanel"
        id={`connections-panel-${tab}`}
        aria-labelledby={`connections-tab-${tab}`}
        aria-busy={rows === null}
        className="flex flex-1 min-h-0 flex-col p-6 text-muted-foreground"
      >
        {tab === 'imports' ? (
          <div className="space-y-3 text-sm text-foreground">
            <ul className="flex flex-wrap gap-2 text-xs">
              {CONNECT_SOURCES.map((source) => (
                <li key={source}>
                  <button
                    type="button"
                    data-testid="connections-source-chip"
                    aria-pressed={activeSource === source}
                    className={`rounded border px-2 py-1 ${activeSource === source ? 'bg-accent/10 text-accent' : ''}`}
                    onClick={() => setActiveSource((current) => current === source ? null : source)}
                  >
                    {source}
                  </button>
                </li>
              ))}
            </ul>
            {importError ? (
              <p className="text-sm" data-testid="connections-import-error">{importError}</p>
            ) : null}
            <ImportPanel source="env" active={activeSource}>
              {pathField('connections.import.envPath', envPath, setEnvPath, IMPORT_PLACEHOLDERS.env)}
              <button
                type="button"
                className="rounded border px-3 py-1"
                onClick={async () => {
                  const previewGithubEnv = window.electronAPI?.workgraph?.previewGithubEnv
                  if (typeof previewGithubEnv !== 'function' || !envPath) {
                    setPreviews((current) => current.filter((row) => row.source !== 'env'))
                    return
                  }
                  await runPreview('env', () => previewGithubEnv(envPath))
                }}
              >
                {t('connections.import.discover')}
              </button>
            </ImportPanel>
            <ImportPanel source="git-helper" active={activeSource}>
              {pathField('connections.import.gitConfigPath', gitConfigPath, setGitConfigPath, IMPORT_PLACEHOLDERS.gitConfig)}
              <button
                type="button"
                className="rounded border px-3 py-1"
                onClick={async () => {
                  const previewGitHelper = window.electronAPI?.workgraph?.previewGitHelper
                  if (typeof previewGitHelper !== 'function' || !gitConfigPath) {
                    setPreviews((current) => current.filter((row) => row.source !== 'git-helper'))
                    return
                  }
                  await runPreview('git-helper', () => previewGitHelper(gitConfigPath))
                }}
              >
                {t('connections.import.discoverGitHelper')}
              </button>
            </ImportPanel>
            <ImportPanel source="docker" active={activeSource}>
              {pathField('connections.import.dockerConfigPath', dockerConfigPath, setDockerConfigPath, IMPORT_PLACEHOLDERS.dockerConfig)}
              <button
                type="button"
                className="rounded border px-3 py-1"
                onClick={async () => {
                  const previewDockerHelper = window.electronAPI?.workgraph?.previewDockerHelper
                  if (typeof previewDockerHelper !== 'function' || !dockerConfigPath) {
                    setPreviews((current) => current.filter((row) => row.source !== 'docker'))
                    return
                  }
                  await runPreview('docker', () => previewDockerHelper(dockerConfigPath))
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
                className="rounded border px-3 py-1"
                onClick={async () => {
                  const previewAwsProfiles = window.electronAPI?.workgraph?.previewAwsProfiles
                  if (typeof previewAwsProfiles !== 'function') {
                    setPreviews((current) => current.filter((row) => row.source !== 'aws'))
                    return
                  }
                  await runPreview('aws', () => previewAwsProfiles({ credentialsPath: awsCredentialsPath, configPath: awsConfigPath }))
                }}
              >
                {t('connections.import.discoverAws')}
              </button>
            </ImportPanel>
            <ImportPanel source="keychain" active={activeSource}>
              <button
                type="button"
                className="rounded border px-3 py-1"
                onClick={async () => {
                  const previewKeychain = window.electronAPI?.workgraph?.previewKeychain
                  if (typeof previewKeychain !== 'function') {
                    setPreviews((current) => current.filter((row) => row.source !== 'keychain'))
                    return
                  }
                  await runPreview('keychain', () => previewKeychain())
                }}
              >
                {t('connections.import.discoverKeychain')}
              </button>
            </ImportPanel>
            <ImportPanel source="adc" active={activeSource}>
              {pathField('connections.import.adcPath', adcPath, setAdcPath, IMPORT_PLACEHOLDERS.adc)}
              <button
                type="button"
                className="rounded border px-3 py-1"
                onClick={async () => {
                  const previewAdc = window.electronAPI?.workgraph?.previewAdc
                  if (typeof previewAdc !== 'function' || !adcPath) {
                    setPreviews((current) => current.filter((row) => row.source !== 'adc'))
                    return
                  }
                  await runPreview('adc', () => previewAdc(adcPath))
                }}
              >
                {t('connections.import.discoverAdc')}
              </button>
            </ImportPanel>
            <ImportPanel source="ssh-agent" active={activeSource}>
              <button
                type="button"
                className="rounded border px-3 py-1"
                onClick={async () => {
                  const previewSshAgent = window.electronAPI?.workgraph?.previewSshAgent
                  if (typeof previewSshAgent !== 'function') {
                    setPreviews((current) => current.filter((row) => row.source !== 'ssh-agent'))
                    return
                  }
                  await runPreview('ssh-agent', () => previewSshAgent())
                }}
              >
                {t('connections.import.discoverSshAgent')}
              </button>
            </ImportPanel>
            <ImportPanel source="github-oauth" active={activeSource}>
              <button
                type="button"
                className="rounded border px-3 py-1"
                onClick={async () => {
                  const startGithubDeviceLogin = window.electronAPI?.workgraph?.startGithubDeviceLogin
                  if (typeof startGithubDeviceLogin !== 'function') return
                  try {
                    setImportError(null)
                    setDevicePoll(null)
                    setDeviceLogin(sanitizeDeviceLoginStart(await startGithubDeviceLogin()))
                  } catch (err) {
                    setImportError(errorMessage(err))
                  }
                }}
              >
                {t('connections.import.discoverGithubOAuth')}
              </button>
              {deviceLogin ? (
                <div data-testid="connections-github-device" className="space-y-1 rounded border px-3 py-2">
                  <div className="font-mono text-xs" data-testid="connections-github-user-code">{deviceLogin.userCode}</div>
                  <div className="font-mono text-xs">{deviceLogin.verificationUri}</div>
                  {devicePoll ? (
                    <div className="text-xs text-muted-foreground">{t(`connections.import.githubOAuthStatus.${devicePoll.status}`)}</div>
                  ) : null}
                  {githubDeviceVerificationHref(deviceLogin.verificationUri, deviceLogin.userCode) ? (
                    <button
                      type="button"
                      data-testid="connections-github-device-open"
                      className="rounded border px-3 py-1"
                      onClick={() => {
                        const href = githubDeviceVerificationHref(deviceLogin.verificationUri, deviceLogin.userCode)
                        if (!href) return
                        void window.electronAPI?.openUrl?.(href)
                      }}
                    >
                      {t('connections.import.githubOAuthOpen')}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    data-testid="connections-github-device-cancel"
                    className="rounded border px-3 py-1"
                    onClick={() => void cancelDeviceLogin()}
                  >
                    {t('connections.import.githubOAuthCancel')}
                  </button>
                  <button
                    type="button"
                    className="rounded border px-3 py-1"
                    onClick={async () => {
                      const workspaceId = workspace?.id
                      const pollGithubDeviceLogin = window.electronAPI?.workgraph?.pollGithubDeviceLogin
                      if (!workspaceId || typeof pollGithubDeviceLogin !== 'function') return
                      try {
                        setImportError(null)
                        const next = sanitizeDevicePoll(await pollGithubDeviceLogin({
                          flowId: deviceLogin.flowId,
                          workspaceId,
                        }))
                        await applyDevicePoll(workspaceId, next)
                      } catch (err) {
                        setImportError(errorMessage(err))
                      }
                    }}
                  >
                    {t('connections.import.githubOAuthPoll')}
                  </button>
                </div>
              ) : null}
            </ImportPanel>
            <ul className="space-y-2">
              {visiblePreviews.map((row) => (
                <li key={`${row.source}:${row.candidateId}`} className="flex items-center justify-between rounded border px-3 py-2">
                  <div>
                    <div className="font-medium">{row.label}</div>
                    <div className="font-mono text-xs text-muted-foreground">{row.source}</div>
                    <div className="font-mono text-xs text-muted-foreground">{row.maskedSummary}</div>
                  </div>
                  <button
                    type="button"
                    className="rounded border px-2 py-1"
                    onClick={async () => {
                      const workspaceId = workspace?.id
                      const api = window.electronAPI?.workgraph
                      if (!workspaceId || !api) return
                      try {
                        setImportError(null)
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
                      } catch (err) {
                        setImportError(errorMessage(err))
                      }
                    }}
                  >
                    {t('connections.import.commit')}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : tab === 'services' && rows === null ? (
          <div data-testid="connections-loading" aria-busy="true" className="flex flex-1" />
        ) : tab === 'services' ? (
          <div className="space-y-4 text-sm text-foreground">
            <div data-testid="connections-create-form" className="space-y-2 rounded border p-3">
              <label className="block">
                <span className="text-muted-foreground">{t('connections.createIntegration')}</span>
                <input
                  className="mt-1 w-full rounded border bg-transparent px-2 py-1 font-mono text-xs"
                  value={createIntegration}
                  onChange={(event) => setCreateIntegration(event.target.value)}
                  spellCheck={false}
                />
              </label>
              <label className="block">
                <span className="text-muted-foreground">{t('connections.createCredentialRef')}</span>
                <input
                  className="mt-1 w-full rounded border bg-transparent px-2 py-1 font-mono text-xs"
                  value={createCredentialRef}
                  onChange={(event) => setCreateCredentialRef(event.target.value)}
                  spellCheck={false}
                />
              </label>
              <label className="block">
                <span className="text-muted-foreground">{t('connections.createStorageMode')}</span>
                <select
                  className="mt-1 w-full rounded border bg-transparent px-2 py-1 font-mono text-xs"
                  value={createStorageMode}
                  onChange={(event) => setCreateStorageMode(event.target.value === 'reference' ? 'reference' : 'copy')}
                >
                  <option value="copy">copy</option>
                  <option value="reference">reference</option>
                </select>
              </label>
              {formError ? (
                <p className="text-sm" data-testid="connections-form-error">{formError}</p>
              ) : null}
              <button type="button" className="rounded border px-3 py-1" onClick={() => void confirmCreate()}>
                {t('connections.create')}
              </button>
            </div>
            {listError ? (
              <p className="text-sm" data-testid="connections-list-error">{listError}</p>
            ) : null}
            {services.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('connections.empty')}</p>
            ) : (
          <ul className="space-y-2 text-sm text-foreground">
            {services.map((row) => {
              const status = testById[row.id]
              return (
              <li key={row.id} className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid="connections-row"
                  aria-selected={selected?.id === row.id}
                  className={`min-w-0 flex-1 rounded border px-3 py-2 text-left ${selected?.id === row.id ? 'bg-accent/10' : ''}`}
                  onClick={() => setSelected(row)}
                >
                  <div data-testid="connections-row-provider">
                    <div className="text-[11px] text-muted-foreground">{t('inspector.field.provider')}</div>
                    <div className="font-medium">{row.integrationId}</div>
                  </div>
                  <div data-testid="connections-row-storage">
                    <div className="text-[11px] text-muted-foreground">{t('inspector.field.storageMode')}</div>
                    <div className="text-muted-foreground">{row.storageMode}</div>
                  </div>
                  <div data-testid="connections-row-credential-ref">
                    <div className="text-[11px] text-muted-foreground">{t('inspector.field.credentialRef')}</div>
                    <div className="font-mono text-xs">{row.credentialRefId}</div>
                  </div>
                  <div data-testid="connections-row-tenant">
                    <div className="text-[11px] text-muted-foreground">{t('inspector.field.tenant')}</div>
                    <div className="font-mono text-xs">{row.workspaceId}</div>
                  </div>
                  {visibleInspectValue(row.scopes.join(', ')) ? (
                    <div data-testid="connections-row-scopes">
                      <div className="text-[11px] text-muted-foreground">{t('inspector.field.scopes')}</div>
                      <div className="font-mono text-xs">{row.scopes.join(', ') || '—'}</div>
                    </div>
                  ) : null}
                  {inspectById[row.id] ? (
                    <>
                      {visibleInspectValue(inspectById[row.id].health) ? (
                        <div data-testid="connections-row-health">
                          <div className="text-[11px] text-muted-foreground">{t('inspector.field.health')}</div>
                          <div className="font-mono text-xs">{inspectById[row.id].health}</div>
                        </div>
                      ) : null}
                      {visibleInspectValue(inspectById[row.id].kind) ? (
                        <div data-testid="connections-row-kind">
                          <div className="text-[11px] text-muted-foreground">{t('inspector.field.credentialKind')}</div>
                          <div className="font-mono text-xs">{inspectById[row.id].kind}</div>
                        </div>
                      ) : null}
                      {visibleInspectValue(inspectById[row.id].expiry) ? (
                        <div data-testid="connections-row-expiry">
                          <div className="text-[11px] text-muted-foreground">{t('inspector.field.expiry')}</div>
                          <div className="font-mono text-xs">{inspectById[row.id].expiry}</div>
                        </div>
                      ) : null}
                      {visibleInspectValue(inspectById[row.id].provenance) ? (
                        <div data-testid="connections-row-provenance">
                          <div className="text-[11px] text-muted-foreground">{t('inspector.field.provenance')}</div>
                          <div className="font-mono text-xs">{inspectById[row.id].provenance}</div>
                        </div>
                      ) : null}
                      {visibleInspectValue(inspectById[row.id].fingerprint) ? (
                        <div data-testid="connections-row-fingerprint">
                          <div className="text-[11px] text-muted-foreground">{t('inspector.field.fingerprint')}</div>
                          <div className="font-mono text-xs">{inspectById[row.id].fingerprint}</div>
                        </div>
                      ) : null}
                      {visibleInspectValue(inspectById[row.id].versionId) ? (
                        <div data-testid="connections-row-version">
                          <div className="text-[11px] text-muted-foreground">{t('inspector.field.versionId')}</div>
                          <div className="font-mono text-xs">{inspectById[row.id].versionId}</div>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  {leasesById[row.id] ? (
                    <>
                      <div data-testid="connections-row-leases">
                        <div className="text-[11px] text-muted-foreground">{t('inspector.field.leases')}</div>
                        <div className="font-mono text-xs">{leasesById[row.id]}</div>
                      </div>
                      <div className="text-[11px] text-muted-foreground">{t('connections.reconnectDone')}</div>
                    </>
                  ) : null}
                  {revalidatedById[row.id] ? (
                    <div data-testid="connections-row-revalidated">
                      <div className="text-[11px] text-muted-foreground">{t('inspector.field.revalidated')}</div>
                      <div className="font-mono text-xs">{revalidatedById[row.id]}</div>
                    </div>
                  ) : null}
                  {status && status.kind !== 'idle' ? (
                    <div data-testid="connections-test-status">
                      <div className="text-[11px] text-muted-foreground">{t('inspector.field.testLogin')}</div>
                      <div className="font-mono text-xs">{status.kind === 'ok' ? status.login : status.message}</div>
                    </div>
                  ) : null}
                </button>
                <button type="button" className="rounded border px-2 py-1" onClick={() => runTest(row.id)}>
                  {t('connections.test')}
                </button>
                <button type="button" className="rounded border px-2 py-1" onClick={() => runRepair(row.id)}>
                  {t('connections.repair')}
                </button>
                {renderReconnectControls(row)}
                {renderRevokeControls(row)}
                {renderRotateControls(row)}
                {renderConvertMoveControls(row)}
              </li>
              )
            })}
          </ul>
            )}
          </div>
        ) : tab === 'credentials' && rows === null ? (
          <div data-testid="connections-loading" aria-busy="true" className="flex flex-1" />
        ) : tab === 'credentials' && credentialRows.length > 0 ? (
          <ul className="space-y-2 text-sm text-foreground">
            {credentialRows.map((row) => {
              const status = testById[row.id]
              return (
              <li key={row.id} className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid="connections-credential-row"
                  aria-selected={selected?.id === row.id}
                  className={`min-w-0 flex-1 rounded border px-3 py-2 text-left ${selected?.id === row.id ? 'bg-accent/10' : ''}`}
                  onClick={() => setSelected(row)}
                >
                  <div data-testid="connections-credential-provider">
                    <div className="text-[11px] text-muted-foreground">{t('inspector.field.provider')}</div>
                    <div className="font-medium">{row.integrationId}</div>
                  </div>
                  <div data-testid="connections-credential-ref">
                    <div className="text-[11px] text-muted-foreground">{t('inspector.field.credentialRef')}</div>
                    <div className="font-mono text-xs">{row.credentialRefId}</div>
                  </div>
                  <div data-testid="connections-credential-storage">
                    <div className="text-[11px] text-muted-foreground">{t('inspector.field.storageMode')}</div>
                    <div className="text-muted-foreground">{row.storageMode}</div>
                  </div>
                  <div data-testid="connections-credential-tenant">
                    <div className="text-[11px] text-muted-foreground">{t('inspector.field.tenant')}</div>
                    <div className="font-mono text-xs">{row.workspaceId}</div>
                  </div>
                  {visibleInspectValue(row.scopes.join(', ')) ? (
                    <div data-testid="connections-credential-scopes">
                      <div className="text-[11px] text-muted-foreground">{t('inspector.field.scopes')}</div>
                      <div className="font-mono text-xs">{row.scopes.join(', ') || '—'}</div>
                    </div>
                  ) : null}
                  {inspectById[row.id] ? (
                    <>
                      {visibleInspectValue(inspectById[row.id].health) ? (
                        <div data-testid="connections-credential-health">
                          <div className="text-[11px] text-muted-foreground">{t('inspector.field.health')}</div>
                          <div className="font-mono text-xs">{inspectById[row.id].health}</div>
                        </div>
                      ) : null}
                      {visibleInspectValue(inspectById[row.id].kind) ? (
                        <div data-testid="connections-credential-kind">
                          <div className="text-[11px] text-muted-foreground">{t('inspector.field.credentialKind')}</div>
                          <div className="font-mono text-xs">{inspectById[row.id].kind}</div>
                        </div>
                      ) : null}
                      {visibleInspectValue(inspectById[row.id].expiry) ? (
                        <div data-testid="connections-credential-expiry">
                          <div className="text-[11px] text-muted-foreground">{t('inspector.field.expiry')}</div>
                          <div className="font-mono text-xs">{inspectById[row.id].expiry}</div>
                        </div>
                      ) : null}
                      {visibleInspectValue(inspectById[row.id].provenance) ? (
                        <div data-testid="connections-credential-provenance">
                          <div className="text-[11px] text-muted-foreground">{t('inspector.field.provenance')}</div>
                          <div className="font-mono text-xs">{inspectById[row.id].provenance}</div>
                        </div>
                      ) : null}
                      {visibleInspectValue(inspectById[row.id].fingerprint) ? (
                        <div data-testid="connections-credential-fingerprint">
                          <div className="text-[11px] text-muted-foreground">{t('inspector.field.fingerprint')}</div>
                          <div className="font-mono text-xs">{inspectById[row.id].fingerprint}</div>
                        </div>
                      ) : null}
                      {visibleInspectValue(inspectById[row.id].versionId) ? (
                        <div data-testid="connections-credential-version">
                          <div className="text-[11px] text-muted-foreground">{t('inspector.field.versionId')}</div>
                          <div className="font-mono text-xs">{inspectById[row.id].versionId}</div>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  {leasesById[row.id] ? (
                    <>
                      <div data-testid="connections-credential-leases">
                        <div className="text-[11px] text-muted-foreground">{t('inspector.field.leases')}</div>
                        <div className="font-mono text-xs">{leasesById[row.id]}</div>
                      </div>
                      <div className="text-[11px] text-muted-foreground">{t('connections.reconnectDone')}</div>
                    </>
                  ) : null}
                  {revalidatedById[row.id] ? (
                    <div data-testid="connections-credential-revalidated">
                      <div className="text-[11px] text-muted-foreground">{t('inspector.field.revalidated')}</div>
                      <div className="font-mono text-xs">{revalidatedById[row.id]}</div>
                    </div>
                  ) : null}
                  {status && status.kind !== 'idle' ? (
                    <div data-testid="connections-credential-test-status">
                      <div className="text-[11px] text-muted-foreground">{t('inspector.field.testLogin')}</div>
                      <div className="font-mono text-xs">{status.kind === 'ok' ? status.login : status.message}</div>
                    </div>
                  ) : null}
                </button>
                <button type="button" className="rounded border px-2 py-1" onClick={() => runTest(row.id)}>
                  {t('connections.test')}
                </button>
                <button type="button" className="rounded border px-2 py-1" onClick={() => runRepair(row.id)}>
                  {t('connections.repair')}
                </button>
                {renderReconnectControls(row)}
                {renderRevokeControls(row)}
                {renderRotateControls(row)}
                {renderConvertMoveControls(row)}
              </li>
              )
            })}
          </ul>
        ) : tab === 'policies' && rows === null ? (
          <div data-testid="connections-loading" aria-busy="true" className="flex flex-1" />
        ) : tab === 'policies' ? (
          <div className="space-y-4 text-sm text-foreground">
            <div data-testid="connections-grant-form" className="space-y-2 rounded border p-3">
              <label className="block">
                <span className="text-muted-foreground">{t('connections.grantConsumer')}</span>
                <input
                  className="mt-1 w-full rounded border bg-transparent px-2 py-1 font-mono text-xs"
                  value={grantConsumer}
                  onChange={(event) => setGrantConsumer(event.target.value)}
                  spellCheck={false}
                />
              </label>
              <label className="block">
                <span className="text-muted-foreground">{t('connections.grantPurpose')}</span>
                <input
                  className="mt-1 w-full rounded border bg-transparent px-2 py-1 font-mono text-xs"
                  value={grantPurpose}
                  onChange={(event) => setGrantPurpose(event.target.value)}
                  spellCheck={false}
                />
              </label>
              <label className="block">
                <span className="text-muted-foreground">{t('connections.grantActions')}</span>
                <input
                  className="mt-1 w-full rounded border bg-transparent px-2 py-1 font-mono text-xs"
                  value={grantActions}
                  onChange={(event) => setGrantActions(event.target.value)}
                  spellCheck={false}
                />
              </label>
              <label className="block">
                <span className="text-muted-foreground">{t('connections.grantResources')}</span>
                <input
                  className="mt-1 w-full rounded border bg-transparent px-2 py-1 font-mono text-xs"
                  value={grantResources}
                  onChange={(event) => setGrantResources(event.target.value)}
                  spellCheck={false}
                />
              </label>
              <label className="block">
                <span className="text-muted-foreground">{t('connections.grantTarget')}</span>
                <select
                  className="mt-1 w-full rounded border bg-transparent px-2 py-1 font-mono text-xs"
                  value={grantTargetId || selected?.id || ''}
                  onChange={(event) => setGrantTargetId(event.target.value)}
                >
                  <option value="">—</option>
                  {listed.map((row) => (
                    <option key={row.id} value={row.id}>{row.id}</option>
                  ))}
                </select>
              </label>
              {formError ? (
                <p className="text-sm" data-testid="connections-form-error">{formError}</p>
              ) : null}
              <button type="button" className="rounded border px-3 py-1" onClick={() => void confirmGrant()}>
                {t('connections.grant')}
              </button>
            </div>
            {policyRows.length > 0 ? (
              <ul className="space-y-2">
                {policyRows.map((row) => {
                  const status = testById[row.id]
                  return (
                  <li key={row.id} className="flex items-center gap-2">
                    <button
                      type="button"
                      data-testid="connections-policy-row"
                      aria-selected={selected?.id === row.id}
                      className={`min-w-0 flex-1 rounded border px-3 py-2 text-left ${selected?.id === row.id ? 'bg-accent/10' : ''}`}
                      onClick={() => setSelected(row)}
                    >
                      <div data-testid="connections-policy-provider">
                        <div className="text-[11px] text-muted-foreground">{t('inspector.field.provider')}</div>
                        <div className="font-medium">{row.integrationId}</div>
                      </div>
                      <div data-testid="connections-policy-storage">
                        <div className="text-[11px] text-muted-foreground">{t('inspector.field.storageMode')}</div>
                        <div className="text-muted-foreground">{row.storageMode}</div>
                      </div>
                      <div data-testid="connections-policy-credential-ref">
                        <div className="text-[11px] text-muted-foreground">{t('inspector.field.credentialRef')}</div>
                        <div className="font-mono text-xs">{row.credentialRefId}</div>
                      </div>
                      <div data-testid="connections-policy-tenant">
                        <div className="text-[11px] text-muted-foreground">{t('inspector.field.tenant')}</div>
                        <div className="font-mono text-xs">{row.workspaceId}</div>
                      </div>
                      {visibleInspectValue(row.scopes.join(', ')) ? (
                        <div data-testid="connections-policy-scopes">
                          <div className="text-[11px] text-muted-foreground">{t('inspector.field.scopes')}</div>
                          <div className="font-mono text-xs">{row.scopes.join(', ') || '—'}</div>
                        </div>
                      ) : null}
                      {inspectById[row.id] ? (
                        <>
                          {visibleInspectValue(inspectById[row.id].health) ? (
                            <div data-testid="connections-policy-health">
                              <div className="text-[11px] text-muted-foreground">{t('inspector.field.health')}</div>
                              <div className="font-mono text-xs">{inspectById[row.id].health}</div>
                            </div>
                          ) : null}
                          {visibleInspectValue(inspectById[row.id].kind) ? (
                            <div data-testid="connections-policy-kind">
                              <div className="text-[11px] text-muted-foreground">{t('inspector.field.credentialKind')}</div>
                              <div className="font-mono text-xs">{inspectById[row.id].kind}</div>
                            </div>
                          ) : null}
                          {visibleInspectValue(inspectById[row.id].expiry) ? (
                            <div data-testid="connections-policy-expiry">
                              <div className="text-[11px] text-muted-foreground">{t('inspector.field.expiry')}</div>
                              <div className="font-mono text-xs">{inspectById[row.id].expiry}</div>
                            </div>
                          ) : null}
                          {visibleInspectValue(inspectById[row.id].provenance) ? (
                            <div data-testid="connections-policy-provenance">
                              <div className="text-[11px] text-muted-foreground">{t('inspector.field.provenance')}</div>
                              <div className="font-mono text-xs">{inspectById[row.id].provenance}</div>
                            </div>
                          ) : null}
                          {visibleInspectValue(inspectById[row.id].fingerprint) ? (
                            <div data-testid="connections-policy-fingerprint">
                              <div className="text-[11px] text-muted-foreground">{t('inspector.field.fingerprint')}</div>
                              <div className="font-mono text-xs">{inspectById[row.id].fingerprint}</div>
                            </div>
                          ) : null}
                          {visibleInspectValue(inspectById[row.id].versionId) ? (
                            <div data-testid="connections-policy-version">
                              <div className="text-[11px] text-muted-foreground">{t('inspector.field.versionId')}</div>
                              <div className="font-mono text-xs">{inspectById[row.id].versionId}</div>
                            </div>
                          ) : null}
                        </>
                      ) : null}
                      {leasesById[row.id] ? (
                        <>
                          <div data-testid="connections-policy-leases">
                            <div className="text-[11px] text-muted-foreground">{t('inspector.field.leases')}</div>
                            <div className="font-mono text-xs">{leasesById[row.id]}</div>
                          </div>
                          <div className="text-[11px] text-muted-foreground">{t('connections.reconnectDone')}</div>
                        </>
                      ) : null}
                      {revalidatedById[row.id] ? (
                        <div data-testid="connections-policy-revalidated">
                          <div className="text-[11px] text-muted-foreground">{t('inspector.field.revalidated')}</div>
                          <div className="font-mono text-xs">{revalidatedById[row.id]}</div>
                        </div>
                      ) : null}
                      {status && status.kind !== 'idle' ? (
                        <div data-testid="connections-policy-test-status">
                          <div className="text-[11px] text-muted-foreground">{t('inspector.field.testLogin')}</div>
                          <div className="font-mono text-xs">{status.kind === 'ok' ? status.login : status.message}</div>
                        </div>
                      ) : null}
                    </button>
                    <button type="button" className="rounded border px-2 py-1" onClick={() => runTest(row.id)}>
                      {t('connections.test')}
                    </button>
                    <button type="button" className="rounded border px-2 py-1" onClick={() => runRepair(row.id)}>
                      {t('connections.repair')}
                    </button>
                    {renderReconnectControls(row)}
                    {renderRevokeControls(row)}
                    {renderRotateControls(row)}
                    {renderConvertMoveControls(row)}
                  </li>
                  )
                })}
              </ul>
            ) : null}
            {bindingRows.length > 0 ? (
              <ul className="space-y-2">
                {bindingRows.map((row) => (
                  <li key={row.id} className="flex items-center gap-2 rounded border px-3 py-2">
                    <button
                      type="button"
                      data-testid="connections-binding-row"
                      aria-selected={selected?.id === row.connectionId}
                      className={`min-w-0 flex-1 rounded px-1 py-1 text-left ${selected?.id === row.connectionId ? 'bg-accent/10' : ''}`}
                      onClick={() => {
                        const next = importedConnectionFromList(listed, row.connectionId)
                        if (next) setSelected(next)
                      }}
                    >
                      <div data-testid="connections-binding-consumer">
                        <div className="text-[11px] text-muted-foreground">{t('connections.grantConsumer')}</div>
                        <div className="font-medium">{row.consumerId}</div>
                      </div>
                      <div data-testid="connections-binding-purpose">
                        <div className="text-[11px] text-muted-foreground">{t('connections.grantPurpose')}</div>
                        <div className="text-muted-foreground">{row.purpose}</div>
                      </div>
                      <div data-testid="connections-binding-actions">
                        <div className="text-[11px] text-muted-foreground">{t('connections.grantActions')}</div>
                        <div className="font-mono text-xs">{row.actions.join(', ') || '—'}</div>
                      </div>
                      <div data-testid="connections-binding-resources">
                        <div className="text-[11px] text-muted-foreground">{t('connections.grantResources')}</div>
                        <div className="font-mono text-xs">{row.resources.join(', ') || '—'}</div>
                      </div>
                    </button>
                    {unbindingId === row.id ? (
                      <div className="flex gap-1">
                        <button type="button" className="rounded border px-2 py-1" onClick={() => confirmUnbind(row.id)}>
                          {t('connections.unbindConfirm')}
                        </button>
                        <button type="button" className="rounded border px-2 py-1" onClick={() => setUnbindingId(null)}>
                          {t('connections.unbindCancel')}
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="rounded border px-2 py-1" onClick={() => setUnbindingId(row.id)}>
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
              <li key={`${row.connectionId}:${row.occurredAt}:${row.payloadDigest}`}>
                <button
                  type="button"
                  data-testid="connections-audit-row"
                  aria-selected={selected?.id === row.connectionId}
                  className={`w-full rounded border px-3 py-2 text-left ${selected?.id === row.connectionId ? 'bg-accent/10' : ''}`}
                  onClick={() => {
                    const next = importedConnectionFromList(listed, row.connectionId)
                    if (next) setSelected(next)
                  }}
                >
                  <div data-testid="connections-audit-action">
                    <div className="text-[11px] text-muted-foreground">{t('connections.audit.action')}</div>
                    <div className="font-medium">{row.action ?? row.eventType}</div>
                  </div>
                  <div data-testid="connections-audit-outcome">
                    <div className="text-[11px] text-muted-foreground">{t('connections.audit.outcome')}</div>
                    <div className="text-muted-foreground">{row.outcome}</div>
                  </div>
                  <div data-testid="connections-audit-time">
                    <div className="text-[11px] text-muted-foreground">{t('connections.audit.time')}</div>
                    <div className="text-muted-foreground">{new Date(row.occurredAt).toISOString()}</div>
                  </div>
                  <div data-testid="connections-audit-actor">
                    <div className="text-[11px] text-muted-foreground">{t('connections.audit.actor')}</div>
                    <div className="font-mono text-xs">{row.actorId ?? '—'}</div>
                  </div>
                  <div data-testid="connections-audit-connection">
                    <div className="text-[11px] text-muted-foreground">{t('connections.audit.connection')}</div>
                    <div className="font-mono text-xs">{row.connectionId}</div>
                  </div>
                  <div data-testid="connections-audit-digest">
                    <div className="text-[11px] text-muted-foreground">{t('connections.audit.digest')}</div>
                    <div className="font-mono text-xs">{row.payloadDigest}</div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : rows === null && (tab === 'services' || tab === 'credentials' || tab === 'policies') ? (
          <div data-testid="connections-loading" aria-busy="true" className="flex flex-1" />
        ) : (
          empty
        )}
      </div>
    </div>
  )
}
