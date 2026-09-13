import { authorizeMeetingAction, type MeetingAction, type MeetingGrant } from '@craft-agent/shared/meeting-agents'

export function authorizeMainMeetingAction(grant: MeetingGrant | null, action: MeetingAction) {
  return authorizeMeetingAction(grant, action)
}
