/**
 * Main-process meeting permission gate (issue #359 / I003).
 * Re-checks authorizeMeetingAction immediately before I/O.
 */

import {
  authorizeMeetingAction,
  revokeGrant,
  type MeetingActionRequest,
  type MeetingAuthz,
} from '@craft-agent/shared/meeting-agents'

export function assertMeetingPermission(request: MeetingActionRequest): MeetingAuthz {
  const result = authorizeMeetingAction(request)
  if (!result.ok) {
    throw new Error(result.message)
  }
  return result
}

export { authorizeMeetingAction, revokeGrant }
