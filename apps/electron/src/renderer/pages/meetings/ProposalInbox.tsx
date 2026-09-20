import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
    <div data-testid="proposal-inbox" className="mt-4">
      <h3>{t('meetings.proposals')}</h3>
      <button
        type="button"
        data-testid="proposal-batch-approve"
        disabled={batch.length === 0 || !props.onApprove}
        onClick={() => {
          for (const proposal of batch) props.onApprove?.(proposal)
        }}
      >
        {t('meetings.approve')}
      </button>
      {props.proposals.map((proposal) => (
        <div key={proposal.id} data-testid="meeting-proposal" className="border p-2">
          {proposal.status === 'proposed' ? (
            <input
              type="checkbox"
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
          ) : null}
          <p>{proposal.title}</p>
          <p>{t('meetings.source')}: {proposal.source}</p>
          <p data-testid="operation-verification">
            {proposal.status === 'applied' && proposal.revisionId ? t('meetings.verified') : t('meetings.notApplied')}
          </p>
          {proposal.revisionId ? (
            <p data-testid="proposal-revision">{t('meetings.revision', { id: proposal.revisionId })}</p>
          ) : null}
          {proposal.errorCode ? (
            <p data-testid="proposal-error">{t(i18nKeyForProposalError(proposal.errorCode))}</p>
          ) : null}
          {proposal.status === 'proposed' ? (
            <>
              <button
                type="button"
                data-testid="proposal-approve"
                disabled={!props.onApprove || props.pendingId === proposal.id}
                onClick={() => props.onApprove?.(proposal)}
              >
                {t('meetings.approve')}
              </button>
              <button
                type="button"
                data-testid="proposal-reject"
                disabled={!props.onReject || props.pendingId === proposal.id}
                onClick={() => props.onReject?.(proposal)}
              >
                {t('meetings.reject')}
              </button>
              <button
                type="button"
                data-testid="proposal-clarify"
                disabled={!props.onClarify || props.pendingId === proposal.id}
                onClick={() => props.onClarify?.(proposal)}
              >
                {t('meetings.correctSegment')}
              </button>
            </>
          ) : null}
          <button
            type="button"
            data-testid="proposal-target-link"
            disabled={!proposal.revisionId || !props.onOpenTarget}
            onClick={() => props.onOpenTarget?.(proposal)}
          >
            {t('meetings.openTarget')}
          </button>
        </div>
      ))}
    </div>
  )
}
