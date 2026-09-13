import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export type MeetingProposalRow = {
  id: string
  title: string
  status: 'proposed' | 'approved' | 'applied' | 'rejected'
  source: string
}

export default function ProposalInbox(props: { proposals: MeetingProposalRow[] }) {
  const { t } = useTranslation()
  const [items, setItems] = useState(props.proposals)

  return (
    <div data-testid="proposal-inbox" className="mt-4">
      <h3>{t('meetings.proposals')}</h3>
      {items.map((proposal) => (
        <div key={proposal.id} data-testid="meeting-proposal" className="border p-2">
          <p>{proposal.title}</p>
          <p>{t('meetings.source')}: {proposal.source}</p>
          <p data-testid="operation-verification">
            {proposal.status === 'applied' ? t('meetings.verified') : t('meetings.notApplied')}
          </p>
          {proposal.status === 'proposed' ? (
            <button
              type="button"
              data-testid="proposal-approve"
              onClick={() => setItems((current) => current.map((item) => item.id === proposal.id ? { ...item, status: 'approved' } : item))}
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
