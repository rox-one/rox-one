import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AgentReadiness, type AgentReadinessProps } from './AgentReadiness'
import { MeetingDetail } from './MeetingDetail'
import { ProposalInbox, type ProposalInboxProps } from './ProposalInbox'
import { useLocalMeetingReadiness } from './use-local-meeting-readiness'
import type { ProposalInboxItem } from './proposal-inbox-model'
import type { MeetingArtifactView, MeetingKnowledgeView, MeetingPageItem, MeetingPageState, MeetingTrackerView } from './meeting-page-model'

export type MeetingsPageProps = {
  items: readonly MeetingPageItem[]
  state: MeetingPageState
  selected?: MeetingPageItem
  proposals?: readonly ProposalInboxItem[]
  liveTranscript?: string
  onStart?: () => void
  onSearch?: (query: string) => void
  proposalHandlers?: Omit<ProposalInboxProps, 'proposals'>
  knowledge?: MeetingKnowledgeView
  onOpenArtifact?: (artifact: MeetingArtifactView) => void
  onOpenTracker?: (tracker: MeetingTrackerView) => void
  onDelete?: () => void
  onExport?: (format: 'json' | 'markdown') => void
  onShare?: (accountId: string) => void
  onRevokeShare?: (accountId: string) => void
  onSelect?: (id: string) => void
  actionStatus?: 'deleted' | 'exported' | 'shared' | 'revoked' | 'denied' | 'private-excluded'
  readiness?: AgentReadinessProps
  captureState?: string
}

export function MeetingsPage({
  items,
  state,
  selected,
  proposals = [],
  liveTranscript,
  onStart,
  onSearch,
  proposalHandlers,
  knowledge,
  onOpenArtifact,
  onOpenTracker,
  onDelete,
  onExport,
  onShare,
  onRevokeShare,
  onSelect,
  actionStatus,
  readiness,
  captureState,
}: MeetingsPageProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const localReadiness = useLocalMeetingReadiness(selected?.id ?? 'local')
  const readinessPanel = readiness ?? localReadiness

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="meetings-page">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <h1 className="text-sm font-medium">{t('meetings.pageTitle')}</h1>
        <input
          data-testid="meetings-search"
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm"
          placeholder={t('meetings.search')}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            onSearch?.(event.target.value)
          }}
        />
        <button
          type="button"
          data-testid="meetings-start"
          className="rounded-md border border-border px-2 py-1 text-xs"
          onClick={onStart}
        >
          {t('meetings.start')}
        </button>
        {captureState ? (
          <p className="text-xs" data-testid="meetings-capture-status">
            {captureState === 'denied'
              ? t('meetings.captureDenied')
              : captureState === 'unsupported'
                ? t('meetings.captureUnsupported')
                : captureState}
          </p>
        ) : null}
      </header>
      {state === 'denied' ? (
        <p className="p-3 text-sm" data-testid="meetings-denied">{t('meetings.denied')}</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {readinessPanel ? (
            <div className="border-b border-border p-3">
              <AgentReadiness {...readinessPanel} />
            </div>
          ) : null}
          {state === 'empty' ? (
            <p className="p-3 text-sm text-muted-foreground" data-testid="meetings-empty">{t('meetings.empty')}</p>
          ) : state === 'offline' ? (
            <p className="p-3 text-sm" data-testid="meetings-offline">{t('meetings.offline')}</p>
          ) : (
            <div className="flex min-h-0 flex-1">
              <ul className="w-64 overflow-auto border-r border-border p-2 text-sm">
                {items.map((meeting) => (
                  <li key={meeting.id} data-testid="meeting-row">
                    <button
                      type="button"
                      data-testid="meeting-select"
                      data-entity-id={meeting.id}
                      className="w-full text-left"
                      onClick={() => onSelect?.(meeting.id)}
                    >
                      {meeting.title}
                    </button>
                  </li>
                ))}
              </ul>
              <section className="flex min-h-0 flex-1 flex-col gap-3 p-3">
                <pre className="min-h-24 whitespace-pre-wrap text-sm" data-testid="meeting-live-transcript">
                  {liveTranscript ?? selected?.transcript ?? ''}
                </pre>
                {selected?.incomplete ? (
                  <p data-testid="meetings-incomplete">{t('meetings.incomplete')}</p>
                ) : null}
                {selected ? (
                  <MeetingDetail
                    meeting={selected}
                    knowledge={knowledge}
                    onOpenArtifact={onOpenArtifact}
                    onOpenTracker={onOpenTracker}
                    onDelete={onDelete}
                    onExport={onExport}
                    onShare={onShare}
                    onRevokeShare={onRevokeShare}
                    actionStatus={actionStatus}
                  />
                ) : null}
                {proposalHandlers ? (
                  <ProposalInbox proposals={proposals} {...proposalHandlers} />
                ) : null}
              </section>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default MeetingsPage
