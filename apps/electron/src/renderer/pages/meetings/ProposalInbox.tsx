import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge, Button, EmptyState } from '@/components/mode-screen/ModeScreen'
import { i18nKeyForProposalError, type MeetingProposalRow } from './proposal-rpc'

export type { MeetingProposalRow }

export default function ProposalInbox(props: {
  proposals: MeetingProposalRow[]
  onApprove?: (proposal: MeetingProposalRow) => void
  onReject?: (proposal: MeetingProposalRow) => void
  onClarify?: (proposal: MeetingProposalRow) => void
  onOpenTarget?: (proposal: MeetingProposalRow) => void
  pendingId?: string | null
}) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<string[]>([])
  const batch = useMemo(
    () => props.proposals.filter((proposal) => selected.includes(proposal.id) && proposal.status === 'proposed'),
    [props.proposals, selected],
  )

  return (
    <div data-testid="proposal-inbox" className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <h3 className="text-[13px] font-semibold">{t('meetings.proposals')}</h3>
        <Button
          className="ml-auto"
          variant="primary"
          data-testid="proposal-batch-approve"
          disabled={batch.length === 0 || !props.onApprove}
          onClick={() => {
            for (const proposal of batch) props.onApprove?.(proposal)
          }}
        >
          {t('meetings.approve')}{batch.length ? ` (${batch.length})` : ''}
        </Button>
      </div>
      {props.proposals.length === 0 ? (
        <EmptyState title={t('meetings.screen.proposalsEmptyTitle')} body={t('meetings.screen.proposalsEmptyBody')} />
      ) : null}
      {props.proposals.map((proposal) => (
        <div key={proposal.id} data-testid="meeting-proposal" className="flex items-start gap-2 rounded-[6px] px-2 py-1.5 hover:bg-foreground/[0.04]">
          {proposal.status === 'proposed' ? (
            <input
              type="checkbox"
              className="mt-0.5 accent-[var(--accent)]"
              aria-label={proposal.title}
              checked={selected.includes(proposal.id)}
              disabled={!props.onApprove || props.pendingId === proposal.id}
              onChange={(event) => {
                setSelected((current) => (
                  event.target.checked
                    ? [...current, proposal.id]
                    : current.filter((id) => id !== proposal.id)
                ))
              }}
            />
          ) : <span className="w-[13px] shrink-0" />}
          <div className="min-w-0 flex-1">
            <p className="text-[13px]">{proposal.title}</p>
            <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-text-muted">
              <span>{proposal.type === 'create_note' ? t('meetings.kindNote') : t('meetings.kindTask')}</span>
              <span>·</span>
              <span>{t('meetings.source')}: {proposal.source}</span>
              <span data-testid="operation-verification">
                <Badge tone={proposal.status === 'applied' && proposal.revisionId ? 'success' : 'muted'}>
                  {proposal.status === 'applied' && proposal.revisionId ? t('meetings.verified') : t('meetings.notApplied')}
                </Badge>
              </span>
              {proposal.revisionId ? (
                <span data-testid="proposal-revision" className="font-mono">{t('meetings.revision', { id: proposal.revisionId })}</span>
              ) : null}
            </p>
            {proposal.errorCode ? (
              <p data-testid="proposal-error" className="text-[11px] text-destructive">{t(i18nKeyForProposalError(proposal.errorCode))}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {proposal.status === 'proposed' ? (
              <>
                <Button
                  data-testid="proposal-approve"
                  disabled={!props.onApprove || props.pendingId === proposal.id}
                  onClick={() => props.onApprove?.(proposal)}
                >
                  {t('meetings.approve')}
                </Button>
                <Button
                  variant="ghost"
                  data-testid="proposal-reject"
                  disabled={!props.onReject || props.pendingId === proposal.id}
                  onClick={() => props.onReject?.(proposal)}
                >
                  {t('meetings.reject')}
                </Button>
                {props.onClarify ? (
                  <Button
                    variant="ghost"
                    data-testid="proposal-clarify"
                    disabled={props.pendingId === proposal.id}
                    onClick={() => props.onClarify?.(proposal)}
                  >
                    {t('meetings.correctSegment')}
                  </Button>
                ) : null}
              </>
            ) : null}
            <Button
              variant="ghost"
              data-testid="proposal-target-link"
              disabled={!proposal.revisionId || !props.onOpenTarget}
              onClick={() => props.onOpenTarget?.(proposal)}
            >
              {t('meetings.openTarget')}
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}
