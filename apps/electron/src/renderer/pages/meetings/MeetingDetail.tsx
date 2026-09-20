import { useTranslation } from 'react-i18next'
import { ConationPanels, MailThreadList } from './ConationPanels'

type MeetingArtifactView = {
  id: string
  mimeType: string
  size: number
  sha256: string
  verified: boolean
}

type MeetingTrackerView = {
  id: string
  provider: 'github' | 'linear'
  remoteId: string
  htmlUrl: string
  title: string
  verified: boolean
  live: boolean
  fixture?: boolean
  unknown?: boolean
}

type MeetingKnowledgeView = {
  proposedNotApplied: boolean
  conflict?: boolean
  supersededTitle?: string
  fields: readonly { field: string; before?: unknown; after?: unknown }[]
}

export default function MeetingDetail(props: {
  meeting: {
    id: string
    title: string
    status: string
    artifacts?: readonly MeetingArtifactView[]
    trackers?: readonly MeetingTrackerView[]
  }
  knowledge?: MeetingKnowledgeView
  onOpenArtifact?: (artifact: MeetingArtifactView) => void
  onOpenTracker?: (tracker: MeetingTrackerView) => void
}) {
  const { t } = useTranslation()
  const { meeting, knowledge, onOpenArtifact, onOpenTracker } = props
  return (
    <article data-testid="meeting-detail" data-entity-id={`call:${meeting.id}`}>
      <h2>{meeting.title}</h2>
      <p>{t('meetings.status')}: {meeting.status}</p>
      {meeting.artifacts?.length ? (
        <section data-testid="meeting-materials">
          <ul>
            {meeting.artifacts.map((artifact) => (
              <li key={artifact.id} data-testid="meeting-artifact" data-artifact-id={artifact.id}>
                <button
                  type="button"
                  data-testid="meeting-artifact-open"
                  onClick={() => onOpenArtifact?.(artifact)}
                >
                  {t('meetings.openTarget')}
                </button>
                <p data-testid="meeting-artifact-type">{artifact.mimeType}</p>
                <p data-testid="meeting-artifact-size">{artifact.size}</p>
                <p data-testid="meeting-artifact-hash">{artifact.sha256}</p>
                <p data-testid="operation-verification">
                  {artifact.verified ? t('meetings.verified') : t('meetings.notApplied')}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {meeting.trackers?.length ? (
        <section data-testid="meeting-actions">
          <ul>
            {meeting.trackers.map((tracker) => (
              <li
                key={tracker.id}
                data-testid="meeting-tracker"
                data-entity-id={tracker.remoteId}
                data-provider={tracker.provider}
              >
                <p>{tracker.title}</p>
                <button
                  type="button"
                  data-testid="proposal-target-link"
                  onClick={() => onOpenTracker?.(tracker)}
                >
                  {t('meetings.openTarget')}
                </button>
                <p data-testid="meeting-tracker-url">{tracker.htmlUrl}</p>
                <p data-testid="operation-verification">
                  {tracker.unknown
                    ? t('meetings.notApplied')
                    : tracker.verified && tracker.live
                      ? t('meetings.verified')
                      : t('meetings.notApplied')}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {knowledge ? (
        <section data-testid="meeting-knowledge-diff">
          {knowledge.conflict ? <p data-testid="meeting-knowledge-conflict" /> : null}
          {knowledge.proposedNotApplied ? (
            <p data-testid="operation-verification">{t('meetings.notApplied')}</p>
          ) : null}
          {knowledge.supersededTitle ? (
            <p data-testid="meeting-knowledge-superseded">{knowledge.supersededTitle}</p>
          ) : null}
          <dl>
            {knowledge.fields.map((field) => (
              <div key={field.field}>
                <dt>{field.field}</dt>
                <dd>{String(field.after ?? '')}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      <ConationPanels credentialsPresent={false} />
      <MailThreadList credentialsPresent={false} />
    </article>
  )
}
