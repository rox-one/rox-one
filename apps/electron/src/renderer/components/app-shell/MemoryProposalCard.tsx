import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import type { MemoryProposal, MemoryProposalScope } from '@rox/shared/memory/proposals'
import { consumeLearnFromSessionRequest, LEARN_FROM_SESSION_EVENT } from '@/lib/session-learn-request'
import { workspaceProjectOptions } from '@/lib/workspace-work-client'
import { canUsePersonalMemory, hasDurableMemoryApproval } from '@/lib/memory-approval-receipt'

export interface MemoryProposalCardProps {
  proposal: MemoryProposal
  workspaceId: string
  onChanged?: () => void
}

export function MemoryProposalCard({ proposal, workspaceId, onChanged }: MemoryProposalCardProps) {
  const { t } = useTranslation()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(proposal.text)
  const [scope, setScope] = React.useState<MemoryProposalScope>(proposal.approval?.scope ?? 'workspace')
  const [projectId, setProjectId] = React.useState(proposal.approval?.projectId ?? proposal.projectId ?? '')
  const [projects, setProjects] = React.useState<{ id: string; name: string }[]>([])
  const [identity, setIdentity] = React.useState<Awaited<ReturnType<Window['electronAPI']['getOrgIdentity']>> | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [receipt, setReceipt] = React.useState(proposal.approval?.writtenAt ? proposal.approval : null)
  const pending = React.useRef(false)
  const cardScope = `${workspaceId}\0${proposal.id}`
  const currentCardScope = React.useRef(cardScope)
  currentCardScope.current = cardScope
  const personalAvailable = canUsePersonalMemory(identity, proposal)
  const approvalStarted = Boolean(proposal.approval)
  React.useEffect(() => {
    if (!proposal.approval) return
    setScope(proposal.approval.scope); setProjectId(proposal.approval.projectId ?? ''); setDraft(proposal.text); setEditing(false)
    if (proposal.approval.writtenAt) setReceipt(proposal.approval)
  }, [proposal.approval?.consentEventId, proposal.approval?.writtenAt, proposal.text])
  React.useEffect(() => {
    let active = true
    pending.current = false; setBusy(false)
    setIdentity(null); setProjects([]); setError(null); setReceipt(proposal.approval?.writtenAt ? proposal.approval : null)
    setScope(proposal.approval?.scope ?? 'workspace'); setProjectId(proposal.approval?.projectId ?? proposal.projectId ?? '')
    Promise.allSettled([
      Promise.resolve().then(() => window.electronAPI.getProjects(workspaceId)),
      Promise.resolve().then(() => window.electronAPI.getOrgIdentity()),
    ]).then(([projectResult, identityResult]) => {
      if (!active) return
      if (projectResult.status === 'fulfilled') {
        try { setProjects(workspaceProjectOptions(projectResult.value, workspaceId)) } catch { setError(t('memory.proposal.projectsUnavailable')) }
      } else setError(t('memory.proposal.projectsUnavailable'))
      if (identityResult.status === 'fulfilled') setIdentity(identityResult.value)
    })
    return () => { active = false }
  }, [workspaceId, proposal.id, t])

  const act = async (fn: () => Promise<unknown>) => {
    if (pending.current) return
    pending.current = true; setBusy(true); setError(null)
    try {
      await fn()
      if (currentCardScope.current !== cardScope) return
      onChanged?.()
    } catch (error) {
      if (currentCardScope.current !== cardScope) return
      setError(t('memory.proposal.actionFailed'))
      toast.error(t('memory.proposal.actionFailed'), { description: error instanceof Error ? error.message : undefined })
      onChanged?.()
    } finally {
      if (currentCardScope.current === cardScope) { pending.current = false; setBusy(false) }
    }
  }

  const approve = () => act(async () => {
    const result = await window.electronAPI.approveMemoryProposal(
      workspaceId,
      proposal.id,
      scope,
      approvalStarted ? undefined : editing ? draft : undefined,
      scope === 'project' ? projectId : undefined,
    )
    if (currentCardScope.current !== cardScope) return
    if (!hasDurableMemoryApproval(result, scope)) throw new Error(t('memory.proposal.writeUnconfirmed'))
    setReceipt(result.approval!)
    toast.success(t('memory.proposal.savedToTarget', { target: t(`memory.proposal.target.${scope}`) }))
  })

  return (
    <article
      data-memory-proposal={proposal.id}
      className="rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-sm text-foreground"
    >
      <p className="line-clamp-3 text-[13px] leading-snug">{editing ? null : proposal.text}</p>
      {editing && (
        <textarea
          value={draft}
          disabled={busy || approvalStarted}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          className="mb-2 w-full rounded-md border border-info/30 bg-background px-2 py-1 text-[13px]"
        />
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
        <span>{t(`memory.proposal.kind.${proposal.kind}`)}</span>
        {proposal.sessionId && <span>{t('memory.proposal.source')}: {proposal.sessionId}</span>}
        {proposal.provenance.consentEventId && (
          <span>{t('memory.proposal.consent')}: {proposal.provenance.consentEventId}</span>
        )}
        {proposal.conflicts.length > 0 && (
          <span className="text-warning">{t('memory.proposal.conflict')}</span>
        )}
      </div>
      {receipt?.writtenAt && <p role="status" className="mt-2 text-xs text-success">{t('memory.proposal.savedToTarget', { target: t(`memory.proposal.target.${receipt.scope}`) })} · {new Date(receipt.writtenAt).toLocaleString()}</p>}
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
      {proposal.status === 'pending' && (
        <div className="mt-2 space-y-2">
          <label className="flex flex-col gap-1 text-xs">{t('memory.proposal.targetLabel')}
            <select aria-label={t('memory.proposal.targetLabel')} value={scope} disabled={busy || approvalStarted} onChange={event => setScope(event.target.value as MemoryProposalScope)} className="rounded-md border border-foreground/15 bg-background px-2 py-1">
              {(['workspace', 'project', 'personal', 'global'] as MemoryProposalScope[]).map(target => <option key={target} value={target} disabled={target === 'personal' && !personalAvailable}>{t(`memory.proposal.target.${target}`)}</option>)}
            </select>
          </label>
          {scope === 'project' && <select aria-label={t('memory.proposal.projectLabel')} value={projectId} disabled={busy || approvalStarted} onChange={event => setProjectId(event.target.value)} className="w-full rounded-md border border-foreground/15 bg-background px-2 py-1 text-xs">
            <option value="">{t('memory.proposal.chooseProject')}</option>
            {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
            {projectId && !projects.some(project => project.id === projectId) && <option value={projectId} disabled>{t('memory.proposal.projectUnavailable')}</option>}
          </select>}
          {!personalAvailable && <p className="text-[11px] text-muted-foreground">{t('memory.proposal.personalUnavailable')}</p>}
          {approvalStarted && <p role="status" className="text-[11px] text-muted-foreground">{t('memory.proposal.retryPendingWrite')}</p>}
          <div className="flex flex-wrap gap-1">
          <button type="button" disabled={busy || (scope === 'personal' && !personalAvailable) || (scope === 'project' && (!projectId || (!approvalStarted && !projects.some(project => project.id === projectId))))} className="h-6 rounded-md bg-accent/20 px-2 text-[11px] font-medium text-accent disabled:opacity-40" onClick={() => void approve()}>
            {t(busy ? 'memory.proposal.saving' : approvalStarted ? 'memory.proposal.retryApproval' : 'memory.proposal.approveTarget')}
          </button>
          <button type="button" disabled={busy || approvalStarted} className="h-6 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-foreground/10 disabled:opacity-40" onClick={() => { setEditing((v) => !v); setDraft(proposal.text) }}>
            {t('memory.proposal.edit')}
          </button>
          <button type="button" disabled={busy || approvalStarted} className="h-6 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-foreground/10 disabled:opacity-40" onClick={() => void act(() => window.electronAPI.rejectMemoryProposal(workspaceId, proposal.id))}>
            {t('memory.proposal.reject')}
          </button>
          <button type="button" disabled={busy || approvalStarted} className="h-6 rounded-md px-2 text-[11px] text-destructive hover:bg-destructive/10 disabled:opacity-40" onClick={() => void act(() => window.electronAPI.deleteMemoryProposal(workspaceId, proposal.id))}>
            {t('memory.proposal.delete')}
          </button>
          </div>
        </div>
      )}
    </article>
  )
}

export interface SessionMemoryProposalLaneProps {
  workspaceId?: string
  sessionId: string
  projectId?: string
  messages: Array<{ id: string; role: string; content: string }>
}

export function SessionMemoryProposalLane({ workspaceId, sessionId, projectId, messages }: SessionMemoryProposalLaneProps) {
  const { t } = useTranslation()
  const [proposals, setProposals] = React.useState<MemoryProposal[]>([])
  const [disabled, setDisabled] = React.useState(false)
  const [preview, setPreview] = React.useState<string[]>([])
  const [learning, setLearning] = React.useState(false)
  const [reloadError, setReloadError] = React.useState(false)
  const scopeKey = `${workspaceId ?? ''}\0${sessionId}`
  const activeScope = React.useRef(scopeKey)
  activeScope.current = scopeKey
  const readGeneration = React.useRef(0)
  /** Result of the last explicit «learn» click; null until the user clicks. */
  const [lastRun, setLastRun] = React.useState<{ found: number; scanned: number } | null>(null)

  const reload = React.useCallback(() => {
    if (!workspaceId) return
    const key = `${workspaceId}\0${sessionId}`
    const generation = ++readGeneration.current
    window.electronAPI.listMemoryProposals(workspaceId, sessionId)
      .then((items) => {
        if (activeScope.current !== key || readGeneration.current !== generation) return
        setProposals(items.filter((p) => p.workspaceId === workspaceId && p.sessionId === sessionId && p.status === 'pending'))
        setReloadError(false)
      })
      .catch(() => { if (activeScope.current === key && readGeneration.current === generation) setReloadError(true) })
  }, [workspaceId, sessionId])

  React.useEffect(() => {
    setProposals([]); setReloadError(false); setLastRun(null); setPreview([]); setDisabled(false); setLearning(false)
    reload()
    if (!workspaceId) return
    return window.electronAPI.onMemoryChanged(() => reload())
  }, [reload, workspaceId])

  // The «learn» action lives in the session menu; it posts a request that
  // this lane (mounted in the open chat) consumes.
  const learnRef = React.useRef<() => Promise<void>>(async () => {})
  React.useEffect(() => {
    if (!workspaceId) return
    if (consumeLearnFromSessionRequest(sessionId)) void learnRef.current()
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail
      if (detail?.sessionId !== sessionId) return
      if (consumeLearnFromSessionRequest(sessionId)) void learnRef.current()
    }
    window.addEventListener(LEARN_FROM_SESSION_EVENT, onRequest)
    return () => window.removeEventListener(LEARN_FROM_SESSION_EVENT, onRequest)
  }, [workspaceId, sessionId])

  const learn = async () => {
    if (!workspaceId || learning) return
    setLearning(true)
    setLastRun(null)
    try {
      const result = await window.electronAPI.extractMemoryProposals({
        workspaceId,
        sessionId,
        projectId,
        trigger: 'brain',
        messages,
      })
      if (activeScope.current !== scopeKey) return
      setDisabled(result.disabled)
      setPreview(result.preview)
      setProposals(result.proposals)
      if (!result.disabled) {
        const scanned = result.scannedMessages
          ?? messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim()).length
        setLastRun({ found: result.proposals.length, scanned })
      }
      if (result.warning) {
        // The model call failed; the regex fallback ran instead. Show the real reason.
        toast.error(t('memory.proposal.llmFailed'), { description: result.warning })
      }
    } catch (error) {
      if (activeScope.current !== scopeKey) return
      toast.error(t('memory.proposal.actionFailed'), {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      if (activeScope.current === scopeKey) setLearning(false)
    }
  }

  learnRef.current = learn

  if (!workspaceId) return null
  // Nothing to show until the user asks (session menu) or proposals exist.
  if (!learning && !disabled && !lastRun && !reloadError && proposals.length === 0) return null

  return (
    <div className="mt-3 flex flex-col gap-2 px-1" data-memory-proposal-lane={sessionId}>
      {(learning || preview.length > 0) && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {learning && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          {learning ? t('memory.proposal.learning') : <span className="text-[11px]">{t('memory.proposal.preview')}</span>}
        </div>
      )}
      {!learning && !disabled && lastRun && lastRun.found === 0 && (
        <p role="status" className="text-xs text-muted-foreground" data-memory-proposal-empty>
          {t('memory.proposal.nothingFound', { n: lastRun.scanned })}
        </p>
      )}
      {disabled && <p className="text-xs text-muted-foreground">{t('memory.proposal.disabled')}</p>}
      {reloadError && <div role="alert" className="flex items-center gap-2 text-xs text-destructive">
        <span>{t('memory.proposal.reloadFailed')}</span>
        <button type="button" className="rounded-md border border-foreground/15 px-2 py-1 text-foreground" onClick={reload}>{t('memory.proposal.retryLoad')}</button>
      </div>}
      {proposals.map((proposal) => (
        <MemoryProposalCard key={proposal.id} proposal={proposal} workspaceId={workspaceId} onChanged={reload} />
      ))}
    </div>
  )
}
