import { useTranslation } from 'react-i18next'
import type { MeetingArtifactView, MeetingKnowledgeView, MeetingPageItem, MeetingTrackerView } from './meeting-page-model'

export function MeetingDetail({
  meeting,
  knowledge,
  onOpenArtifact,
  onOpenTracker,
}: {
  meeting: MeetingPageItem
  knowledge?: MeetingKnowledgeView
  onOpenArtifact?: (artifact: MeetingArtifactView) => void
  onOpenTracker?: (tracker: MeetingTrackerView) => void
}) {
  const { t } = useTranslation()
  return (
    <article className="space-y-2" data-testid="meeting-detail" data-entity-id={meeting.id}>
      <h2 className="text-sm font-medium">{meeting.title}</h2>
      <section>
        <h3 className="text-xs text-muted-foreground">{t('meetings.manualNotes')}</h3>
        <p data-testid="meeting-manual-notes">{meeting.manualNotes ?? ''}</p>
      </section>
      {meeting.artifacts?.length ? (
        <section data-testid="meeting-materials">
          <h3 className="text-xs text-muted-foreground">{t('meetings.materials')}</h3>
          <ul>
            {meeting.artifacts.map((artifact) => (
              <li
                key={artifact.id}
                className="space-y-1 text-xs"
                data-testid="meeting-artifact"
                data-artifact-id={artifact.id}
              >
                <button
                  type="button"
                  data-testid="meeting-artifact-open"
                  className="underline"
                  onClick={() => onOpenArtifact?.(artifact)}
                >
                  {t('meetings.artifactOpen')}
                </button>
                <p data-testid="meeting-artifact-type">{t('meetings.artifactType')}: {artifact.mimeType}</p>
                <p data-testid="meeting-artifact-size">{t('meetings.artifactSize')}: {artifact.size}</p>
                <p data-testid="meeting-artifact-hash">{t('meetings.artifactHash')}: {artifact.sha256}</p>
                <p data-testid="operation-verification">
                  {artifact.verified ? t('meetings.artifactVerified') : t('meetings.artifactFailed')}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {meeting.trackers?.length ? (
        <section data-testid="meeting-actions">
          <h3 className="text-xs text-muted-foreground">{t('meetings.actions')}</h3>
          <ul>
            {meeting.trackers.map((tracker) => (
              <li
                key={tracker.id}
                className="space-y-1 text-xs"
                data-testid="meeting-tracker"
                data-entity-id={tracker.remoteId}
                data-provider={tracker.provider}
              >
                <p>{tracker.title}</p>
                <button
                  type="button"
                  data-testid="proposal-target-link"
                  className="underline"
                  onClick={() => onOpenTracker?.(tracker)}
                >
                  {t('meetings.trackerOpen')}
                </button>
                <p data-testid="meeting-tracker-url">{tracker.htmlUrl}</p>
                <p data-testid="operation-verification">
                  {tracker.unknown
                    ? t('meetings.trackerUnknown')
                    : tracker.verified && tracker.live
                      ? t('meetings.trackerVerified')
                      : tracker.fixture || !tracker.live
                        ? t('meetings.trackerFixture')
                        : t('meetings.trackerFailed')}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {knowledge ? (
        <section data-testid="meeting-knowledge-diff">
          <h3 className="text-xs text-muted-foreground">{t('meetings.knowledgeDiff')}</h3>
          {knowledge.conflict ? (
            <p data-testid="meeting-knowledge-conflict">{t('meetings.knowledgeConflict')}</p>
          ) : null}
          {knowledge.proposedNotApplied ? (
            <p data-testid="operation-verification">{t('meetings.knowledgeProposeNotApplied')}</p>
          ) : null}
          {knowledge.supersededTitle ? (
            <p data-testid="meeting-knowledge-superseded">
              {t('meetings.knowledgeSuperseded')}: {knowledge.supersededTitle}
            </p>
          ) : null}
          <dl className="text-xs">
            {knowledge.fields.map((field) => (
              <div key={field.field}>
                <dt>{field.field}</dt>
                <dd>{String(field.after ?? '')}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </article>
  )
}

export default MeetingDetail
