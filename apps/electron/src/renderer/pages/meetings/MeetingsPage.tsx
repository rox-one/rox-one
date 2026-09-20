import { AgentReadiness, type AgentReadinessProps } from './AgentReadiness'
import MeetingsWorkspace from './MeetingsWorkspace'
import { useLocalMeetingReadiness } from './use-local-meeting-readiness'

export type MeetingsPageProps = {
  meetingId?: string
  readiness?: AgentReadinessProps
  workspaceId?: string | null
}

/** Mounts AgentReadiness and MeetingsWorkspace. Catalog/search/detail live on pages/MeetingsPage.tsx. */
export function MeetingsPage({ meetingId = 'local', readiness, workspaceId = null }: MeetingsPageProps) {
  const localReadiness = useLocalMeetingReadiness(meetingId)
  const readinessPanel = readiness ?? localReadiness

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="meetings-page">
      {readinessPanel ? (
        <div className="border-b border-border p-3">
          <AgentReadiness {...readinessPanel} />
        </div>
      ) : null}
      <MeetingsWorkspace workspaceId={workspaceId} />
    </div>
  )
}

export default MeetingsPage
