import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import type { MemoryProposal, MemoryProposalScope } from '@craft-agent/shared/memory/proposals'
import { consumeLearnFromSessionRequest, LEARN_FROM_SESSION_EVENT } from '@/lib/session-learn-request'

export interface MemoryProposalCardProps {
  proposal: MemoryProposal
  workspaceId: string
  onChanged?: () => void
}

export function MemoryProposalCard({ proposal, workspaceId, onChanged }: MemoryProposalCardProps) {
  const { t } = useTranslation()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(proposal.text)

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      onChanged?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('memory.proposal.actionFailed'))
    }
  }

  const approve = (scope: MemoryProposalScope) =>
    act(() => window.electronAPI.approveMemoryProposal(
      workspaceId,
      proposal.id,
      scope,
      editing ? draft : undefined,
      proposal.projectId,
    ))

  return (
    <article
      data-memory-proposal={proposal.id}
      className="rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-sm text-foreground"
    >
      <p className="line-clamp-3 text-[13px] leading-snug">{editing ? null : proposal.text}</p>
      {editing && (
        <textarea
          value={draft}
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
      {proposal.status === 'pending' && (
        <div className="mt-2 flex flex-wrap gap-1">
          <button type="button" className="h-6 rounded-md bg-accent/20 px-2 text-[11px] font-medium text-accent" onClick={() => void approve('global')}>
            {t('memory.proposal.approveGlobal')}
          </button>
          <button type="button" className="h-6 rounded-md bg-info/20 px-2 text-[11px] font-medium text-info" onClick={() => void approve('project')}>
            {t('memory.proposal.approveProject')}
          </button>
          <button type="button" className="h-6 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-foreground/10" onClick={() => { setEditing((v) => !v); setDraft(proposal.text) }}>
            {t('memory.proposal.edit')}
          </button>
          <button type="button" className="h-6 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-foreground/10" onClick={() => void act(() => window.electronAPI.rejectMemoryProposal(workspaceId, proposal.id))}>
            {t('memory.proposal.reject')}
          </button>
          <button type="button" className="h-6 rounded-md px-2 text-[11px] text-destructive hover:bg-destructive/10" onClick={() => void act(() => window.electronAPI.deleteMemoryProposal(workspaceId, proposal.id))}>
            {t('memory.proposal.delete')}
          </button>
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
  /** Result of the last explicit «learn» click; null until the user clicks. */
  const [lastRun, setLastRun] = React.useState<{ found: number; scanned: number } | null>(null)

  const reload = React.useCallback(() => {
    if (!workspaceId) return
    window.electronAPI.listMemoryProposals(workspaceId, sessionId)
      .then((items) => setProposals(items.filter((p) => p.status === 'pending')))
      .catch(() => setProposals([]))
  }, [workspaceId, sessionId])

  React.useEffect(() => {
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
      toast.error(t('memory.proposal.actionFailed'), {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setLearning(false)
    }
  }

  learnRef.current = learn

  if (!workspaceId) return null
  // Nothing to show until the user asks (session menu) or proposals exist.
  if (!learning && !disabled && !lastRun && proposals.length === 0) return null

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
      {proposals.map((proposal) => (
        <MemoryProposalCard key={proposal.id} proposal={proposal} workspaceId={workspaceId} onChanged={reload} />
      ))}
    </div>
  )
}
