import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sanitizeConnectionInspect, isStaleInspectSummary, type ConnectionInspectRow, type ConnectionListRow } from './connections-list'
import { MOVE_BACKENDS, formatConfirmLeases, formatReconnectLeases, sanitizeActiveLeases, sanitizeReconnectLeases, type ActiveLeaseView, type MoveBackend } from './connections-ui'
import { projectConnectionInspector } from '@/platform/connection-inspector-model'

type Action = 'test' | 'repair' | 'rotate' | 'reconnect' | 'move'
type Confirmation = { action: 'rotate' | 'reconnect' | 'move'; leases: ActiveLeaseView[] }
type Owner = { scope: string; generation: number }
const buttonClass = 'rounded-md border border-foreground/10 px-2 py-1 text-xs hover:bg-foreground/[0.05] disabled:opacity-50'
const confirmationKeys = {
  rotate: { confirm: 'connections.rotateConfirm', cancel: 'connections.rotateCancel' },
  reconnect: { confirm: 'connections.reconnectConfirm', cancel: 'connections.reconnectCancel' },
  move: { confirm: 'connections.moveConfirm', cancel: 'connections.moveCancel' },
} as const

/** Metadata-only lifecycle controls shared by the existing page and inspector. */
export function ConnectionLifecyclePanel({ connection, workspaceId }: { connection: ConnectionListRow; workspaceId: string }) {
  const { t } = useTranslation()
  const fields = useMemo(() => { try { return projectConnectionInspector(connection) } catch { return null } }, [connection])
  const scope = `${workspaceId}:${connection.id}:${connection.credentialRefId}`
  const owner = useRef<Owner | null>(null)
  const generation = useRef(0)
  const read = useRef(0)
  const mutation = useRef<Owner | null>(null)
  const [inspect, setInspect] = useState<ConnectionInspectRow | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading')
  const [busy, setBusy] = useState<Action | 'preview' | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [targetBackend, setTargetBackend] = useState<MoveBackend>(MOVE_BACKENDS[0])
  const [login, setLogin] = useState('')
  const [consumers, setConsumers] = useState('')
  const [leases, setLeases] = useState('')
  const [completed, setCompleted] = useState(false)
  const belongs = useCallback((captured: Owner) => owner.current === captured, [])
  const safeInspect = useCallback((raw: unknown) => {
    const projected = sanitizeConnectionInspect(raw)
    if (projected.connectionId !== connection.id || projected.credentialRefId !== connection.credentialRefId) throw new Error('Foreign inspect receipt')
    return projected
  }, [connection.id, connection.credentialRefId])

  useLayoutEffect(() => {
    const captured = { scope, generation: ++generation.current }
    owner.current = connection.workspaceId === workspaceId && fields ? captured : null
    mutation.current = null
    read.current++
    setInspect(null); setState(owner.current ? 'loading' : 'unavailable')
    setBusy(null); setConfirmation(null); setLogin(''); setConsumers(''); setLeases(''); setCompleted(false)
    setTargetBackend(MOVE_BACKENDS[0])
    return () => { if (owner.current === captured) owner.current = null; read.current++ }
  }, [scope, connection.workspaceId, workspaceId, !!fields])

  const refresh = useCallback(async () => {
    const captured = owner.current
    if (!captured || captured.scope !== scope) return
    const request = ++read.current
    const api = window.electronAPI?.workgraph?.inspectConnection
    if (typeof api !== 'function') { setState('unavailable'); return }
    setState('loading')
    try {
      const result = safeInspect(await api({ workspaceId, connectionId: connection.id }))
      if (!belongs(captured) || request !== read.current) return
      setInspect(result); setState('ready')
    } catch {
      if (!belongs(captured) || request !== read.current) return
      setInspect(null); setState('error')
    }
  }, [belongs, safeInspect, scope, workspaceId, connection.id])
  useEffect(() => { void refresh() }, [refresh])

  const prepare = async (action: Confirmation['action']) => {
    const captured = owner.current
    if (!captured || captured.scope !== scope || mutation.current) return
    mutation.current = captured; setBusy('preview'); setConfirmation(null); setCompleted(false)
    // Reconnect/move revoke leases. Present the actual metadata before consent.
    try {
      const api = window.electronAPI?.workgraph?.listConnectionLeases
      if (action !== 'rotate' && typeof api !== 'function') { if (belongs(captured)) setState('unavailable'); return }
      const active = action === 'rotate' ? [] : sanitizeActiveLeases(await api!({ workspaceId, connectionId: connection.id }))
      if (belongs(captured)) setConfirmation({ action, leases: active })
    } catch { if (belongs(captured)) setState('error') }
    finally { if (mutation.current === captured) { mutation.current = null; if (belongs(captured)) setBusy(null) } }
  }

  const perform = async (action: Action) => {
    const captured = owner.current
    if (!captured || captured.scope !== scope || mutation.current) return
    if ((action === 'reconnect' || action === 'move' || action === 'rotate') && confirmation?.action !== action) return
    const graph = window.electronAPI?.workgraph
    const api = action === 'test' ? graph?.testConnection : action === 'repair' ? graph?.repairConnection
      : action === 'rotate' ? graph?.rotateConnection : action === 'reconnect' ? graph?.reconnectConnection : graph?.moveConnection
    if (typeof api !== 'function') { setState('unavailable'); return }
    mutation.current = captured; read.current++; setBusy(action); setCompleted(false)
    const requestedBackend = targetBackend
    try {
      if (action === 'test') {
        const result = await graph!.testConnection({ workspaceId, connectionId: connection.id })
        if (!belongs(captured)) return
        if (typeof result.login !== 'string') throw new Error('Invalid login metadata')
        setLogin(result.login)
      } else if (action === 'repair' || action === 'rotate') {
        const result = await (action === 'repair' ? graph!.repairConnection : graph!.rotateConnection)({ workspaceId, connectionId: connection.id })
        const nextConsumers = formatReconnectLeases(sanitizeReconnectLeases(result.consumers))
        if (!belongs(captured)) return
        setConsumers(nextConsumers); setConfirmation(null)
      } else {
        const result = action === 'reconnect'
          ? await graph!.reconnectConnection({ workspaceId, connectionId: connection.id })
          : await graph!.moveConnection({ workspaceId, connectionId: connection.id, targetBackend: requestedBackend })
        const projected = safeInspect(result.inspect)
        const nextConsumers = formatReconnectLeases(sanitizeReconnectLeases(result.consumers))
        const nextLeases = formatReconnectLeases(sanitizeReconnectLeases(result.leases))
        if (action === 'move') {
          const moved = result as Awaited<ReturnType<NonNullable<typeof graph>['moveConnection']>>
          if (moved.connectionId !== connection.id || moved.credentialRefId !== connection.credentialRefId || moved.to !== requestedBackend) throw new Error('Foreign move receipt')
        }
        if (!belongs(captured)) return
        setInspect(projected); setConsumers(nextConsumers); setLeases(nextLeases); setConfirmation(null); setCompleted(true)
      }
      if (belongs(captured)) setState('ready')
    } catch { if (belongs(captured)) setState('error') }
    finally { if (mutation.current === captured) { mutation.current = null; if (belongs(captured)) setBusy(null) } }
  }

  if (connection.workspaceId !== workspaceId || !fields) return <section role="alert">{t('sidebar.connectionsUnavailable')}</section>
  const field = (label: string, value: string) => <div className="min-w-0"><dt className="text-xs text-muted-foreground">{t(label)}</dt><dd className="break-all font-mono text-xs text-foreground">{value || '—'}</dd></div>
  return <section data-testid="connection-lifecycle" data-connection-id={connection.id} className="space-y-3 px-2.5 py-2 text-foreground">
    <dl className="grid grid-cols-1 gap-2">
      {field('inspector.field.provider', fields.provider)}
      {field('inspector.field.tenant', workspaceId)}
      {field('inspector.field.storageMode', fields.storageMode)}
      {field('inspector.field.credentialRef', fields.credentialRef)}
      {field('inspector.field.scopes', fields.scopes)}
      {inspect && <>{field('inspector.field.health', inspect.health)}{field('inspector.field.expiry', inspect.expiry)}{field('inspector.field.provenance', inspect.provenance)}{field('inspector.field.fingerprint', inspect.fingerprint)}{field('inspector.field.credentialKind', inspect.kind)}{field('inspector.field.versionId', inspect.versionId)}</>}
      {login && field('inspector.field.testLogin', login)}{consumers && field('inspector.field.consumers', consumers)}{leases && field('inspector.field.leases', leases)}
    </dl>
    {state === 'loading' && <p role="status" className="text-xs text-muted-foreground">{t('common.loading')}</p>}
    {(state === 'error' || state === 'unavailable') && <p role="alert" className="text-xs">{t(state === 'error' ? 'chat.connectionUnavailable' : 'sidebar.connectionsUnavailable')}</p>}
    {inspect && isStaleInspectSummary(inspect) && <p className="text-xs">{t('connections.reconnectHint')}</p>}
    {completed && <p role="status" className="text-xs">{t('connections.reconnectDone')}</p>}
    <div className="flex flex-wrap gap-1">
      <button className={buttonClass} disabled={!!busy} onClick={() => void refresh()}>{t('common.refresh')}</button>
      <button className={buttonClass} disabled={!!busy} onClick={() => void perform('test')}>{t('connections.test')}</button>
      <button className={buttonClass} disabled={!!busy} onClick={() => void perform('repair')}>{t('connections.repair')}</button>
      <button className={buttonClass} disabled={!!busy} onClick={() => void prepare('rotate')}>{t('connections.rotate')}</button>
      <button className={buttonClass} disabled={!!busy} onClick={() => void prepare('reconnect')}>{t('connections.reconnect')}</button>
      <button className={buttonClass} disabled={!!busy} onClick={() => void prepare('move')}>{t('connections.move')}</button>
    </div>
    {confirmation && <div data-testid="connection-lifecycle-confirm" className="space-y-2 rounded-md border border-foreground/10 p-2">
      <p className="break-all font-mono text-xs">{formatConfirmLeases(connection, confirmation.leases)}</p>
      {confirmation.action !== 'rotate' && <p className="text-xs">{t('connections.reconnectLeases')}</p>}
      {confirmation.action === 'move' && <label className="block text-xs">{t('connections.moveTarget')}<select className="ml-2 rounded bg-background p-1" value={targetBackend} disabled={!!busy} onChange={event => { if (MOVE_BACKENDS.includes(event.target.value as MoveBackend)) setTargetBackend(event.target.value as MoveBackend) }}>{MOVE_BACKENDS.map(target => <option key={target} value={target}>{target}</option>)}</select></label>}
      <div className="flex gap-1"><button className={buttonClass} disabled={!!busy} onClick={() => void perform(confirmation.action)}>{t(confirmationKeys[confirmation.action].confirm)}</button><button className={buttonClass} disabled={!!busy} onClick={() => setConfirmation(null)}>{t(confirmationKeys[confirmation.action].cancel)}</button></div>
    </div>}
  </section>
}
