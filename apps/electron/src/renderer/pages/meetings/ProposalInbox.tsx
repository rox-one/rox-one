import { useTranslation } from 'react-i18next'
import { i18nKeyForProposalError, type MeetingProposalRow } from './proposal-rpc'

export type { MeetingProposalRow }

export default function ProposalInbox(props: {
  proposals: MeetingProposalRow[]
  onApprove?: (proposal: MeetingProposalRow) => void
  approvingId?: string | null
}) {
  const { t } = useTranslation()

  return (
    <div data-testid="proposal-inbox" className="mt-4">
      <h3>{t('meetings.proposals')}</h3>
      {props.proposals.map((proposal) => (
        <div key={proposal.id} data-testid="meeting-proposal" className="border p-2">
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
            <button
              type="button"
              data-testid="proposal-approve"
              disabled={!props.onApprove || props.approvingId === proposal.id}
              onClick={() => props.onApprove?.(proposal)}
            >
              {t('meetings.approve')}
            </button>
          ) : null}
          <button type="button" data-testid="proposal-target-link">{t('meetings.openTarget')}</button>
        </div>
      ))}
    </div>
  )
}
