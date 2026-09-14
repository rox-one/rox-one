import { useTranslation } from 'react-i18next'
import { Check, ExternalLink, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CatalogDisclosure } from '../tasks/CatalogPanel'
import { i18nKeyForProposalError, type MeetingProposalRow } from './proposal-rpc'

export type { MeetingProposalRow }

export default function ProposalInbox(props: {
  proposals: MeetingProposalRow[]
  onApprove?: (proposal: MeetingProposalRow) => void
  onReject?: (proposal: MeetingProposalRow) => void
  onOpenTarget?: (proposal: MeetingProposalRow) => void
  pendingId?: string | null
  pendingIds?: ReadonlySet<string>
}) {
  const { t } = useTranslation()

  return (
    <section data-testid="proposal-inbox" className="min-w-0 space-y-2 border-t border-border pt-3">
      <h3 className="flex items-center gap-2 text-[13px] font-medium">{t('meetings.proposals')}<span className="text-[11px] font-normal tabular-nums text-muted-foreground">{props.proposals.length}</span></h3>
      {props.proposals.length === 0 ? <p className="py-2 text-[12px] text-muted-foreground">{t('meetings.noProposals')}</p> : null}
      {props.proposals.map((proposal) => {
        const pending = props.pendingId === proposal.id || props.pendingIds?.has(proposal.id)
        return (
          <article key={proposal.id} data-testid="meeting-proposal" className="min-w-0 rounded-lg border border-border bg-surface-elevated p-3 text-[13px]" aria-busy={!!pending}>
            <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
              <h4 className="min-w-0 flex-1 break-words font-medium">{proposal.title}</h4>
              <span className="rounded bg-foreground/5 px-1.5 py-0.5 text-[11px] text-muted-foreground">{t(proposal.type === 'create_task' ? 'meetings.kindTask' : 'meetings.kindNote')}</span>
            </div>
            <p data-testid="operation-verification" className="mt-1 text-[11px] text-muted-foreground">
              {proposal.status === 'applied' && proposal.revisionId ? t('meetings.verified') : t('meetings.notApplied')}
            </p>
            {proposal.errorCode ? <p data-testid="proposal-error" role="alert" className="mt-2 text-[12px] text-destructive">{t(i18nKeyForProposalError(proposal.errorCode))}</p> : null}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {proposal.status === 'proposed' ? (
                <>
                  <Button type="button" size="sm" variant="secondary" data-testid="proposal-approve" disabled={!props.onApprove || pending} onClick={() => props.onApprove?.(proposal)}><Check size={14} />{t('meetings.approve')}</Button>
                  <Button type="button" size="sm" variant="ghost" data-testid="proposal-reject" disabled={!props.onReject || pending} onClick={() => props.onReject?.(proposal)}><X size={14} />{t('meetings.reject')}</Button>
                </>
              ) : null}
              <Button type="button" size="sm" variant="ghost" data-testid="proposal-target-link" disabled={!proposal.revisionId || !props.onOpenTarget} onClick={() => props.onOpenTarget?.(proposal)}><ExternalLink size={14} />{t('meetings.openTarget')}</Button>
            </div>
            <div className="mt-2"><CatalogDisclosure title={t('common.info')}>
              <p className="break-words text-[11px] text-muted-foreground">{t('meetings.source')}: {proposal.source}</p>
              {proposal.revisionId ? <p data-testid="proposal-revision" className="break-all font-mono text-[11px] text-muted-foreground">{t('meetings.revision', { id: proposal.revisionId })}</p> : null}
            </CatalogDisclosure></div>
          </article>
        )
      })}
    </section>
  )
}
