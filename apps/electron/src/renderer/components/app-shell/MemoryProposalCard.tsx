import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { MemoryProposal, MemoryProposalScope } from '@craft-agent/shared/memory/proposals'

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

  const learn = async () => {
    if (!workspaceId) return
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
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('memory.proposal.actionFailed'))
    }
  }

  if (!workspaceId) return null

  return (
    <div className="mt-3 flex flex-col gap-2 px-1" data-memory-proposal-lane={sessionId}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void learn()}
          className="inline-flex h-7 items-center rounded-md bg-info/15 px-2.5 text-xs font-medium text-info hover:bg-info/25"
        >
          {t('memory.proposal.learn')}
        </button>
        {preview.length > 0 && (
          <span className="text-[11px] text-muted-foreground">{t('memory.proposal.preview')}</span>
        )}
      </div>
      {disabled && <p className="text-xs text-muted-foreground">{t('memory.proposal.disabled')}</p>}
      {proposals.map((proposal) => (
        <MemoryProposalCard key={proposal.id} proposal={proposal} workspaceId={workspaceId} onChanged={reload} />
      ))}
    </div>
  )
}
