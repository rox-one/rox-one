import type { LocalMeeting } from '../../../../../../shared/meetings-local'
import type { AutomationListItem } from '../../../../../../renderer/components/automations/types'
import type { CapabilitySnapshot, TourScope, TourSignal } from '../../../contracts'
import type { TourObservation } from '../../../runtime/hooks'

export type MeetingArtifactTab = 'overview' | 'recording' | 'transcript' | 'decisions' | 'actions' | 'documents'

export function hasMeetingArtifact(meeting: LocalMeeting): boolean {
  return Boolean(meeting.summary?.text.trim() || (meeting.audio && meeting.audio.bytes > 0)
    || (['done', 'partial', 'cancelled', 'failed'].includes(meeting.transcript.status) && (meeting.transcript.segments ?? 0) > 0)
    || meeting.actions.length || meeting.documents.length || meeting.extractedDecisions?.length)
}

type MeetingsAvailability = {
  readonly surface: 'meetings'
  readonly apiAvailable: boolean
  readonly loadState: 'loading' | 'ready' | 'error'
  readonly workspaceId: string | null
  readonly selectedId?: string | null
  readonly meeting?: LocalMeeting | null
}
type AutomationAvailability = {
  readonly surface: 'automation'
  readonly apiAvailable: boolean
  readonly workspaceId: string | null | undefined
  readonly selectedId?: string | null
  readonly automation?: Pick<AutomationListItem, 'id' | 'revision'> | null
}

/** Read-only native state; no RPC, recorder or editor mutation port is exposed. */
export function meetingsAutomationCapabilities(input: MeetingsAvailability | AutomationAvailability): CapabilitySnapshot {
  if (input.surface === 'automation') {
    const available = Boolean(input.apiAvailable && input.workspaceId)
    return {
      'automations.available': available ? { state: 'ready' } : { state: 'unavailable', reason: 'api-unavailable' },
      'automation.entity-present': !available ? { state: 'unavailable', reason: 'api-unavailable' }
        : input.automation && input.selectedId === input.automation.id && input.automation.revision
          ? { state: 'ready' } : { state: 'pending', reason: 'missing-entity' },
    }
  }
  const available = Boolean(input.apiAvailable && input.workspaceId)
  const current = input.meeting && input.meeting.id === input.selectedId && input.meeting.workspaceId === input.workspaceId
  const state = !available || input.loadState === 'error' ? { state: 'unavailable' as const, reason: 'api-unavailable' as const }
    : input.loadState === 'loading' ? { state: 'pending' as const, reason: 'installing' as const }
      : { state: 'ready' as const }
  return {
    'meetings.available': state,
    'meeting.artifact-present': state.state !== 'ready' ? state
      : current && input.meeting && hasMeetingArtifact(input.meeting) ? { state: 'ready' }
        : { state: 'pending', reason: 'missing-entity' },
  }
}

export interface MeetingArtifactObservation {
  readonly scope: TourScope
  readonly observation: TourObservation | null
  readonly selectedId: string | null
  readonly meeting: LocalMeeting | null
  readonly expectedMeetingId: string
  readonly expectedUpdatedAt: number
  readonly artifactRendered: boolean
  readonly at: number
  readonly eventToken: string
}

/** A user opened loaded native content. Preserve the operation's original binding. */
export function deriveMeetingsAutomationSignals(input: MeetingArtifactObservation): readonly TourSignal[] {
  const { observation, scope, meeting } = input
  if (!observation || !meeting || !input.artifactRendered || !hasMeetingArtifact(meeting)
    || input.at < observation.at || !input.eventToken
    || meeting.id !== input.selectedId || meeting.id !== input.expectedMeetingId
    || meeting.updatedAt !== input.expectedUpdatedAt || meeting.workspaceId !== scope.workspaceId
    || (scope.entityId !== undefined && scope.entityId !== meeting.id)
    || observation.binding.workspaceId !== scope.workspaceId
    || observation.binding.panelId !== scope.panelId
    || observation.binding.sessionId !== scope.sessionId
    || observation.binding.entityId !== scope.entityId) return []
  return [{
    name: 'meeting.artifact-opened', binding: observation.binding,
    operationToken: observation.operationToken, operationStartedAt: observation.at,
    eventToken: input.eventToken, at: input.at, level: 'observed', origin: 'ui-observation',
  }]
}
