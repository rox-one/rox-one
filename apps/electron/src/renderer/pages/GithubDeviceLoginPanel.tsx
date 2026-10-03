import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { devicePollDelayMs, githubDeviceVerificationHref, sanitizeDeviceLoginStart, sanitizeDevicePoll, type DeviceLoginView, type DevicePollView } from './connections-ui'

type FlowOwner = { workspaceId: string; flow: DeviceLoginView | null; pending: boolean; pollPending: boolean; nextPollAt: number }
const buttonClass = 'rounded-md border border-foreground/10 px-3 py-1.5 text-xs disabled:opacity-50'

/** User-started device flow; only public code/approved URI ever enters the UI. */
export function GithubDeviceLoginPanel({ workspaceId, onImported }: { workspaceId: string; onImported: () => void }) {
  const { t } = useTranslation()
  const owner = useRef<FlowOwner | null>(null)
  const [flow, setFlow] = useState<DeviceLoginView | null>(null)
  const [result, setResult] = useState<DevicePollView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [revision, setRevision] = useState(0)
  const cancelRemote = async (flowId: string) => {
    try { await window.electronAPI?.workgraph?.cancelGithubDeviceLogin?.({ flowId }) } catch { /* No private OS/provider errors enter renderer state. */ }
  }
  useLayoutEffect(() => {
    const captured: FlowOwner = { workspaceId, flow: null, pending: false, pollPending: false, nextPollAt: 0 }
    owner.current = captured; setFlow(null); setResult(null); setBusy(false); setError(false)
    return () => {
      const active = owner.current
      if (active?.workspaceId === workspaceId) {
        owner.current = null
        if (active.flow) void cancelRemote(active.flow.flowId)
      }
    }
  }, [workspaceId])

  const start = async () => {
    const captured = owner.current
    if (!captured || captured.workspaceId !== workspaceId || captured.pending || captured.flow) return
    const api = window.electronAPI?.workgraph?.startGithubDeviceLogin
    if (typeof api !== 'function') { setError(true); return }
    captured.pending = true; setBusy(true); setError(false)
    let returnedFlowId: string | undefined
    try {
      const raw = await api()
      const descriptor = raw && typeof raw === 'object' ? Object.getOwnPropertyDescriptor(raw, 'flowId') : undefined
      if (descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string') returnedFlowId = descriptor.value
      const next = sanitizeDeviceLoginStart(raw)
      if (!githubDeviceVerificationHref(next.verificationUri, next.userCode)) throw new Error('Unapproved verification URI')
      if (owner.current !== captured) { void cancelRemote(next.flowId); return }
      captured.flow = next; captured.nextPollAt = Date.now() + (devicePollDelayMs(next) ?? 5000)
      setFlow(next); setResult({ status: 'pending', interval: next.interval }); setRevision(value => value + 1)
    } catch { if (returnedFlowId) void cancelRemote(returnedFlowId); if (owner.current === captured) setError(true) }
    finally { captured.pending = false; if (owner.current === captured) setBusy(false) }
  }
  const cancel = () => {
    const previous = owner.current
    if (!previous || previous.workspaceId !== workspaceId) return
    owner.current = { workspaceId, flow: null, pending: false, pollPending: false, nextPollAt: 0 }
    if (previous.flow) void cancelRemote(previous.flow.flowId)
    // Any late start receipt sees a replaced owner and cancels its own flow.
    setFlow(null); setResult(null); setBusy(false); setError(false); setRevision(value => value + 1)
  }
  const poll = async () => {
    const captured = owner.current
    if (!captured || captured.workspaceId !== workspaceId || !captured.flow || captured.pollPending || Date.now() < captured.nextPollAt) return
    const api = window.electronAPI?.workgraph?.pollGithubDeviceLogin
    if (typeof api !== 'function') { setError(true); return }
    const flowId = captured.flow.flowId
    captured.pollPending = true; setBusy(true)
    try {
      const next = sanitizeDevicePoll(await api({ workspaceId, flowId }))
      if (owner.current !== captured || captured.flow?.flowId !== flowId) return
      setError(false); setResult(next)
      const delay = devicePollDelayMs(next)
      if (delay !== null) {
        captured.nextPollAt = Date.now() + delay; setRevision(value => value + 1)
      } else {
        captured.flow = null; setFlow(null)
        if (next.status === 'imported') onImported()
      }
    } catch { if (owner.current === captured) { setError(true); captured.nextPollAt = Date.now() + 5000 } }
    finally { captured.pollPending = false; if (owner.current === captured) { setBusy(false); setRevision(value => value + 1) } }
  }
  useEffect(() => {
    const captured = owner.current
    if (!captured?.flow || captured.workspaceId !== workspaceId || captured.pollPending) return
    const timer = setTimeout(() => { if (owner.current === captured) void poll() }, Math.max(0, captured.nextPollAt - Date.now()))
    return () => clearTimeout(timer)
  }, [workspaceId, flow, revision])
  const href = flow ? githubDeviceVerificationHref(flow.verificationUri, flow.userCode) : null
  return <section data-testid="github-device-login" className="space-y-2 rounded-md border border-foreground/10 p-3">
    {!flow && <button className={buttonClass} disabled={busy} onClick={() => void start()}>{t('connections.import.discoverGithubOAuth')}</button>}
    {(flow || busy) && <button className={buttonClass} onClick={cancel}>{t('connections.import.githubOAuthCancel')}</button>}
    {flow && <><p className="font-mono text-sm" data-testid="github-device-code">{flow.userCode}</p>{href && <a className="block text-xs underline" href={href} target="_blank" rel="noopener noreferrer">{t('connections.import.githubOAuthOpen')}</a>}<button className={buttonClass} disabled={busy} onClick={() => void poll()}>{t('connections.import.githubOAuthPoll')}</button></>}
    {result && <p role="status" className="text-xs">{t(`connections.import.githubOAuthStatus.${result.status}`)}</p>}
    {error && <p role="alert" className="text-xs">{t('chat.connectionUnavailable')}</p>}
  </section>
}
