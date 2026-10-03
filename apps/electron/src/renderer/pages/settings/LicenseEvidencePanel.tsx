import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { Button } from '@/components/ui/button'
import { SettingsCard, SettingsSection } from '@/components/settings'
import type { LicenseComponent, LicenseEventPage } from '../../../../../../packages/shared/src/workspace-domain/licenses/contracts.ts'
import type { LicenseAuditIntentView } from '../../../shared/license-audit-intent'
import { createLicenseAuditIntent, LICENSE_PAGE_LIMIT, requireLicenseAuditReadback, requireLicenseAuditResult,
  requireLicenseAuditEventReplay, requireLicenseCommand, requireLicenseComponent, requireLicenseEvents, requireLicensePage } from '../../../shared/license-evidence'
import { projectAuthorityErrorMessageKey, safeProjectAuthorityCode } from '../../../shared/project-authority'

type ViewState = 'loading' | 'ready' | 'empty' | 'permission_denied' | 'retryable_error' | 'unconfigured' | 'offline'
/** Existing Settings surface, existing authority and existing encrypted intent backend. */
export function LicenseEvidencePanel() {
  const { t } = useTranslation()
  const workspaceId = useActiveWorkspace()?.id ?? null
  const generation = useRef(0)
  const scope = useRef(0)
  const [viewWorkspaceId, setViewWorkspaceId] = useState<string | null>(null)
  const scopeIsCurrent = workspaceId !== null && viewWorkspaceId === workspaceId
  const [state, setState] = useState<ViewState>('loading')
  const [items, setItems] = useState<readonly LicenseComponent[]>([])
  const [selected, setSelected] = useState<LicenseComponent | null>(null)
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [intent, setIntent] = useState<LicenseAuditIntentView>({ state: 'none', eligible: false })
  const [busy, setBusy] = useState(false)
  const [verifiedReceipt, setVerifiedReceipt] = useState<string | null>(null)
  const [historyEvents, setHistoryEvents] = useState<LicenseEventPage['events']>([])
  const [historyCursor, setHistoryCursor] = useState<string | undefined>()
  const [lastEventRevision, setLastEventRevision] = useState<string | null>(null)

  const retractDenied = useCallback((code: string): boolean => {
    if (!['FORBIDDEN', 'UNAUTHENTICATED', 'AUTH_FAILED', 'WORKSPACE_MISMATCH'].includes(code)) return false
    setItems([]); setSelected(null); setHistoryEvents([]); setHistoryCursor(undefined); setNextCursor(undefined)
    setVerifiedReceipt(null); setLastEventRevision(null); setIntent({ state: 'none', eligible: false })
    setErrorCode(code); setState('permission_denied')
    return true
  }, [])

  const refresh = useCallback(async (cursor?: string) => {
    const current = ++generation.current
    setViewWorkspaceId(null); setItems([]); setSelected(null); setVerifiedReceipt(null); setLastEventRevision(null); setHistoryEvents([]); setHistoryCursor(undefined); setErrorCode(null)
    setNextCursor(undefined); setIntent({ state: 'none', eligible: false }); setState('loading')
    if (!workspaceId) { setState('unconfigured'); return }
    try {
      const [connection, configuration, pending] = await Promise.all([window.electronAPI.getProjectAuthorityState(),
        window.electronAPI.getProjectAuthorityConfiguration(workspaceId), window.electronAPI.getLicenseAuditIntent(workspaceId)])
      if (current !== generation.current) return
      if (pending.state === 'queued' || pending.state === 'uncertain') {
        const command = requireLicenseCommand(pending.command)
        if (!configuration || command.workspaceId !== configuration.workspaceId) throw Object.assign(new Error('WORKSPACE_MISMATCH'), { code: 'WORKSPACE_MISMATCH' })
      }
      setViewWorkspaceId(workspaceId)
      if (connection === 'denied') { retractDenied('AUTH_FAILED'); return }
      if (pending.state === 'blocked' && retractDenied(pending.code)) return
      setIntent(pending)
      if (connection !== 'ready' || !configuration) {
        setState(connection === 'unconfigured' ? 'unconfigured' : 'offline')
        return
      }
      const page = requireLicensePage(await window.electronAPI.getLicenseComponents(workspaceId,
        { limit: LICENSE_PAGE_LIMIT, ...(cursor ? { cursor } : {}) }), configuration.workspaceId)
      if (current !== generation.current) return
      setItems(page.items); setNextCursor(page.nextCursor); setState(page.items.length ? 'ready' : 'empty')
    } catch (error) {
      if (current !== generation.current) return
      const code = safeProjectAuthorityCode(error)
      setViewWorkspaceId(workspaceId); setErrorCode(code); setIntent({ state: 'none', eligible: false })
      if (!retractDenied(code)) setState('retryable_error')
    }
  }, [workspaceId, retractDenied])

  useEffect(() => {
    ++scope.current
    setBusy(false)
    void refresh()
    const changed = () => { ++scope.current; setBusy(false); void refresh() }
    const unsubscribe = window.electronAPI.onProjectAuthorityChanged(changed)
    window.addEventListener('focus', changed)
    return () => { ++scope.current; ++generation.current; unsubscribe(); window.removeEventListener('focus', changed) }
  }, [refresh])

  const open = async (item: LicenseComponent) => {
    if (!workspaceId || !scopeIsCurrent || busy) return
    const current = ++generation.current
    setSelected(null); setVerifiedReceipt(null); setLastEventRevision(null); setErrorCode(null); setBusy(true)
    try {
      const detail = requireLicenseComponent(await window.electronAPI.getLicenseComponent(workspaceId, { entityId: item.entity.entityId }), item.entity.workspaceId)
      const history = requireLicenseEvents(await window.electronAPI.getLicenseEvents(workspaceId,
        { entityId: item.entity.entityId, limit: LICENSE_PAGE_LIMIT }), item.entity.workspaceId, item.entity.entityId)
      if (current !== generation.current) return
      setSelected(detail); setLastEventRevision(history.events.at(-1)?.aggregateRevision ?? null); setHistoryEvents(history.events); setHistoryCursor(history.nextCursor)
    } catch (error) {
      if (current !== generation.current) return
      const code = safeProjectAuthorityCode(error); setErrorCode(code)
      retractDenied(code)
    } finally { if (current === generation.current) setBusy(false) }
  }

  const retry = async () => {
    if (!workspaceId || busy) return
    const currentScope = scope.current
    setBusy(true); setVerifiedReceipt(null); setErrorCode(null)
    try {
      const pending = await window.electronAPI.getLicenseAuditIntent(workspaceId)
      if (currentScope !== scope.current) return
      if (pending.state !== 'queued' && pending.state !== 'uncertain') { if (currentScope === scope.current) setIntent(pending); return }
      const command = requireLicenseCommand(pending.command)
      const attempt = await window.electronAPI.retryLicenseAudit(workspaceId)
      if (currentScope !== scope.current) return
      if (attempt.state !== 'applied') {
        setIntent(attempt)
        if (attempt.state === 'blocked') retractDenied(attempt.code)
        return
      }
      const result = await requireLicenseAuditResult(attempt.result, command, command.workspaceId)
      if (currentScope !== scope.current) return
      const event = await requireLicenseAuditEventReplay(result, attempt.event.actorPrincipalId,
        cursor => window.electronAPI.getLicenseEvents(workspaceId, { entityId: result.entity.entityId,
          limit: LICENSE_PAGE_LIMIT, ...(cursor ? { cursor } : {}) }), () => currentScope === scope.current)
      if (event.id !== attempt.event.id) throw Object.assign(new Error('INVALID_PAYLOAD'), { code: 'INVALID_PAYLOAD' })
      if (currentScope !== scope.current) return
      const readback = requireLicenseAuditReadback(await window.electronAPI.getLicenseComponent(workspaceId,
        { entityId: result.entity.entityId }), result)
      const history = requireLicenseEvents(await window.electronAPI.getLicenseEvents(workspaceId,
        { entityId: result.entity.entityId, limit: LICENSE_PAGE_LIMIT }), command.workspaceId, result.entity.entityId)
      if (currentScope !== scope.current) return
      setItems(previous => previous.map(item => item.entity.entityId === readback.entity.entityId ? readback : item))
      setSelected(readback); setVerifiedReceipt(result.receiptId); setLastEventRevision(history.events.at(-1)?.aggregateRevision ?? null); setHistoryEvents(history.events); setHistoryCursor(history.nextCursor)
      setIntent({ state: 'none', eligible: true }); setState('ready')
    } catch (error) {
      if (currentScope === scope.current) {
        const code = safeProjectAuthorityCode(error); setErrorCode(code); retractDenied(code)
      }
    }
    finally { if (currentScope === scope.current) setBusy(false) }
  }
  const audit = async () => {
    if (!workspaceId || !scopeIsCurrent || !selected?.canAudit || busy || intent.state !== 'none') return
    const currentScope = scope.current
    setBusy(true); setErrorCode(null); setVerifiedReceipt(null)
    try {
      const queued = await window.electronAPI.queueLicenseAudit(workspaceId, createLicenseAuditIntent(workspaceId, selected))
      if (currentScope === scope.current) {
        setIntent(queued)
        if (queued.state === 'queued' || queued.state === 'uncertain') {
          const connection = await window.electronAPI.getProjectAuthorityState()
          if (currentScope !== scope.current) return
          if (connection === 'ready') await retry()
        }
      }
    } catch (error) {
      if (currentScope === scope.current) {
        const code = safeProjectAuthorityCode(error); setErrorCode(code); retractDenied(code)
      }
    }
    finally { if (currentScope === scope.current) setBusy(false) }
  }
  const cancel = async () => {
    if (!workspaceId || busy) return
    const currentScope = scope.current; setBusy(true)
    try { const value = await window.electronAPI.cancelLicenseAudit(workspaceId); if (currentScope === scope.current) setIntent(value) }
    catch (error) {
      if (currentScope === scope.current) {
        const code = safeProjectAuthorityCode(error); setErrorCode(code); retractDenied(code)
      }
    }
    finally { if (currentScope === scope.current) setBusy(false) }
  }

  const replayActivity = async () => {
    if(!workspaceId||!scopeIsCurrent||!selected||!historyCursor||busy)return
    const current=generation.current,currentScope=scope.current;setBusy(true);setErrorCode(null)
    try{
      const page=requireLicenseEvents(await window.electronAPI.getLicenseEvents(workspaceId,{entityId:selected.entity.entityId,limit:LICENSE_PAGE_LIMIT,cursor:historyCursor}),selected.entity.workspaceId,selected.entity.entityId)
      if(current!==generation.current||currentScope!==scope.current)return
      setHistoryEvents(previous=>{const ids=new Set(previous.map(event=>event.id));return [...previous,...page.events.filter(event=>!ids.has(event.id))]})
      setHistoryCursor(page.nextCursor);setLastEventRevision(previous=>page.events.at(-1)?.aggregateRevision??previous)
    }catch(error){if(current===generation.current&&currentScope===scope.current){const code=safeProjectAuthorityCode(error);setErrorCode(code);retractDenied(code)}}
    finally{if(current===generation.current&&currentScope===scope.current)setBusy(false)}
  }
  const visibleItems = scopeIsCurrent ? items : []
  const visibleSelected = scopeIsCurrent ? selected : null
  const visibleIntent: LicenseAuditIntentView = scopeIsCurrent ? intent : { state: 'none', eligible: false }
  return <SettingsSection title={t('licenseAudit.title')}>
    <SettingsCard className="p-4 space-y-3">
      <p className="text-sm text-muted-foreground">{t('licenseAudit.description')}</p>
      <p role="status" aria-live="polite" className="text-sm">{t('licenseAudit.state.' + (scopeIsCurrent ? state : workspaceId ? 'loading' : 'unconfigured'))}</p>
      {errorCode && <p role="alert" className="text-sm text-destructive">{t(projectAuthorityErrorMessageKey(errorCode))}</p>}
      {visibleIntent.state === 'blocked' && <p role="alert">{t(visibleIntent.pendingOperation ? 'licenseAudit.intentConflict' : projectAuthorityErrorMessageKey(visibleIntent.code))}</p>}
      {(visibleIntent.state === 'queued' || visibleIntent.state === 'uncertain') && <div className="space-y-2" role="status">
        <p>{t(visibleIntent.state === 'queued' ? 'licenseAudit.offlineQueued' : 'licenseAudit.uncertain')}</p>
        <p className="font-mono text-xs break-all">{visibleIntent.command.commandId}</p>
        <Button size="sm" onClick={() => void retry()} disabled={busy}>{t('licenseAudit.retry')}</Button>
        <Button size="sm" variant="outline" onClick={() => void cancel()} disabled={busy}>{t('licenseAudit.cancel')}</Button>
      </div>}
      {visibleIntent.state === 'blocked' && !visibleIntent.pendingOperation && <Button variant="outline" size="sm" onClick={() => void cancel()} disabled={busy}>{t('licenseAudit.cancel')}</Button>}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void refresh()}>{t('licenseAudit.refresh')}</Button>
        {nextCursor && <Button variant="outline" size="sm" disabled={busy} onClick={() => void refresh(nextCursor)}>{t('licenseAudit.next')}</Button>}
      </div>
      {visibleItems.length > 0 && <ul className="space-y-2" aria-label={t('licenseAudit.artifacts')}>
        {visibleItems.map(item => <li key={item.entity.entityId}><Button variant="outline" size="sm" disabled={busy}
          onClick={() => void open(item)}>{item.label}</Button></li>)}
      </ul>}
      {visibleSelected && <section aria-label={t('licenseAudit.evidence')} className="space-y-3">
        <h3 className="text-sm font-semibold">{visibleSelected.label}</h3>
        <p>{t(visibleSelected.evidence?.state === 'reviewed_exact_artifact' ? 'licenseAudit.reviewed' : 'licenseAudit.reviewRequired')}</p>
        <p className="text-xs text-muted-foreground">{t('licenseAudit.ownerBootstrap')}</p>
        <dl className="text-xs space-y-2">
          {([
            ['artifactDigest', visibleSelected.artifactDigest], ['sbomDigest', visibleSelected.sbomDigest], ['revision', visibleSelected.revision],
            ['policyEpoch', visibleSelected.policyEpoch], ['reviewRevision', visibleSelected.decisionManifest.reviewRevision],
            ['reviewDigest', visibleSelected.decisionManifest.reviewSha256], ['checkerRevision', visibleSelected.decisionManifest.checkerRevision],
            ['checkerDigest', visibleSelected.decisionManifest.checkerSha256], ['buildDigest', visibleSelected.decisionManifest.buildSha256],
            ['auditDigest', visibleSelected.auditDigest ?? t('licenseAudit.none')], ['auditedAt', visibleSelected.auditedAt ?? t('licenseAudit.none')],
            ['watermark', visibleSelected.projectionWatermark], ['eventRevision', lastEventRevision ?? t('licenseAudit.none')],
          ] satisfies readonly (readonly [string, string])[]).map(([key, value]) => <div key={key}>
            <dt className="text-muted-foreground">{t('licenseAudit.' + key)}</dt><dd className="font-mono break-all">{value}</dd>
          </div>)}
        </dl>
        {visibleSelected.evidence && <>
          <ul aria-label={t('licenseAudit.findings')} className="text-xs space-y-1">{visibleSelected.evidence.findings.map((finding, index) =>
            <li key={index}><code>{finding.code}</code> — <span className="break-all">{finding.subject}</span></li>)}</ul>
          <div className="overflow-x-auto"><table className="text-xs w-full"><caption className="text-left">{t('licenseAudit.components')}</caption>
            <thead><tr><th scope="col">{t('licenseAudit.component')}</th><th scope="col">{t('licenseAudit.version')}</th><th scope="col">{t('licenseAudit.license')}</th><th scope="col">{t('licenseAudit.componentDigest')}</th></tr></thead>
            <tbody>{visibleSelected.evidence.components.map(component => <tr key={component.id}>
              <td>{component.name}</td><td>{component.version}</td><td>{component.licenseExpression ?? t('licenseAudit.none')}</td><td className="font-mono break-all">{component.componentSha256}</td>
            </tr>)}</tbody></table></div>
        </>}
        <section aria-label={t('licenseAudit.activity')} className="space-y-2">
          <h4 className="text-sm font-medium">{t('licenseAudit.activity')}</h4>
          <ul className="text-xs space-y-1">{historyEvents.map(event=><li key={event.id}>
            <span>{t('licenseAudit.revision')} {event.aggregateRevision}</span> · <time>{event.at}</time>
            <div className="font-mono break-all">{event.causationId} / {event.correlationId}</div>
          </li>)}</ul>
          {historyCursor&&<Button variant="outline" size="sm" disabled={busy} onClick={()=>void replayActivity()}>{t('licenseAudit.replayActivity')}</Button>}
        </section>
        {visibleSelected.canAudit && <Button size="sm" disabled={busy || visibleIntent.state !== 'none' || !visibleIntent.eligible} onClick={() => void audit()}>{t('licenseAudit.audit')}</Button>}
      </section>}
      {scopeIsCurrent && verifiedReceipt && <p role="status" className="text-sm">{t('licenseAudit.appliedVerified')} <code className="break-all">{verifiedReceipt}</code></p>}
    </SettingsCard>
  </SettingsSection>
}
