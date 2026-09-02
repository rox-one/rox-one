import type { Session } from '../../shared/types'

export function getSessionsRequiringPermissionModeReconcile(
  sessions: Array<Pick<Session, 'id' | 'permissionModeVersion'>>,
): string[] {
  return sessions
    .filter((session) => typeof session.permissionModeVersion !== 'number')
    .map((session) => session.id)
}
