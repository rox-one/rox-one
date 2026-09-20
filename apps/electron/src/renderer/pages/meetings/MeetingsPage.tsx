import { AgentReadiness, type AgentReadinessProps } from './AgentReadiness'
import { useLocalMeetingReadiness } from './use-local-meeting-readiness'

export type MeetingsPageProps = {
  meetingId?: string
  readiness?: AgentReadinessProps
}

/** Mounts AgentReadiness. Catalog/search/detail live on pages/MeetingsPage.tsx. */
export function MeetingsPage({ meetingId = 'local', readiness }: MeetingsPageProps) {
  const localReadiness = useLocalMeetingReadiness(meetingId)
  const readinessPanel = readiness ?? localReadiness

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="meetings-page">
      {readinessPanel ? (
        <div className="border-b border-border p-3">
          <AgentReadiness {...readinessPanel} />
        </div>
      ) : null}
    </div>
  )
}

export default MeetingsPage
