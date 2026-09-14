import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  canApproveProposal,
  isTerminalProposal,
  operationVerificationKey,
  selectedApproveRequests,
  type ProposalInboxItem,
} from './proposal-inbox-model'

export type ProposalInboxProps = {
  proposals: readonly ProposalInboxItem[]
  onApprove: (request: { proposalId: string; payloadHash: string; baseRevision: number; target?: string }) => void
  onReject: (proposalId: string) => void
  onEdit: (proposalId: string, payload: Record<string, unknown>) => void
  onClarify: (proposalId: string) => void
  onOpenTarget?: (target: string) => void
}

export function ProposalInbox({
  proposals,
  onApprove,
  onReject,
  onEdit,
  onClarify,
  onOpenTarget,
}: ProposalInboxProps) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<string[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const batch = useMemo(() => selectedApproveRequests(proposals, selected), [proposals, selected])

  return (
    <section className="flex h-full min-h-0 flex-col gap-3 p-4" data-testid="meeting-proposal-inbox">
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">{t('meetings.proposalInbox')}</h2>
        <button
          type="button"
          data-testid="proposal-batch-approve"
          className="rounded-md border border-border px-2 py-1 text-xs"
          disabled={batch.length === 0}
          onClick={() => {
            for (const request of batch) onApprove(request)
          }}
        >
          {t('meetings.proposalApprove')}
        </button>
      </header>
      {proposals.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('meetings.proposalEmpty')}</p>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
          {proposals.map((proposal) => {
            const draft = drafts[proposal.id] ?? JSON.stringify(proposal.payload, null, 2)
            const terminal = isTerminalProposal(proposal.status)
            return (
              <li
                key={proposal.id}
                data-testid="meeting-proposal"
                className="rounded-lg border border-border p-3"
              >
                <div className="mb-2 flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={selected.includes(proposal.id)}
                    disabled={!canApproveProposal(proposal.status)}
                    onChange={(event) => {
                      setSelected((current) => (
                        event.target.checked
                          ? [...current, proposal.id]
                          : current.filter((id) => id !== proposal.id)
                      ))
                    }}
                  />
                  <span data-testid="proposal-status">{proposal.status}</span>
                  <span className="text-muted-foreground">{t('meetings.proposalScope')}</span>
                </div>
                {proposal.status === 'stale' ? (
                  <p className="mb-2 text-xs text-amber-600">{t('meetings.proposalStale')}</p>
                ) : null}
                {proposal.status === 'approved' ? (
                  <p className="mb-2 text-xs" data-testid="proposal-approved-pending">
                    {t('meetings.proposalApprovedNotApplied')}
                  </p>
                ) : null}
                {operationVerificationKey(proposal) === 'meetings.artifactVerified' ? (
                  <p className="mb-2 text-xs" data-testid="operation-verification">
                    {t('meetings.artifactVerified')}
                  </p>
                ) : operationVerificationKey(proposal) === 'meetings.trackerUnknown' ? (
                  <p className="mb-2 text-xs" data-testid="operation-verification">
                    {t('meetings.trackerUnknown')}
                  </p>
                ) : operationVerificationKey(proposal) ? (
                  <p className="mb-2 text-xs" data-testid="operation-verification">
                    {t('meetings.trackerFailed')}
                  </p>
                ) : null}
                <textarea
                  className="mb-2 w-full rounded-md border border-border bg-background p-2 font-mono text-xs"
                  value={draft}
                  disabled={terminal}
                  onChange={(event) => setDrafts((current) => ({ ...current, [proposal.id]: event.target.value }))}
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    data-testid="proposal-approve"
                    className="rounded-md border border-border px-2 py-1 text-xs"
                    disabled={!canApproveProposal(proposal.status)}
                    onClick={() => onApprove({
                      proposalId: proposal.id,
                      payloadHash: proposal.payloadHash,
                      baseRevision: proposal.sourceRevision,
                      target: proposal.target,
                    })}
                  >
                    {t('meetings.proposalApprove')}
                  </button>
                  <button
                    type="button"
                    data-testid="proposal-reject"
                    className="rounded-md border border-border px-2 py-1 text-xs"
                    disabled={terminal}
                    onClick={() => onReject(proposal.id)}
                  >
                    {t('meetings.proposalReject')}
                  </button>
                  <button
                    type="button"
                    data-testid="proposal-edit"
                    className="rounded-md border border-border px-2 py-1 text-xs"
                    disabled={terminal}
                    onClick={() => {
                      const next = JSON.parse(drafts[proposal.id] ?? JSON.stringify(proposal.payload)) as Record<string, unknown>
                      onEdit(proposal.id, next)
                    }}
                  >
                    {t('meetings.proposalEdit')}
                  </button>
                  <button
                    type="button"
                    data-testid="proposal-clarify"
                    className="rounded-md border border-border px-2 py-1 text-xs"
                    disabled={terminal}
                    onClick={() => onClarify(proposal.id)}
                  >
                    {t('meetings.proposalClarify')}
                  </button>
                  {proposal.target ? (
                    <button
                      type="button"
                      data-testid="proposal-target-link"
                      className="rounded-md border border-border px-2 py-1 text-xs"
                      onClick={() => onOpenTarget?.(proposal.target!)}
                    >
                      {t('meetings.proposalTarget')}
                    </button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export default ProposalInbox
