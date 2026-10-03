import { join } from 'node:path'
import { getConfigDir } from '../../../../../packages/shared/src/config/paths.ts'
import { SqliteBroInviteStore } from '../../../../../packages/shared/src/collaboration/durable-store.ts'
import { WorkspaceBroInvitationAuthority } from './invitations.ts'
import { SqliteHostedSessionRegistry } from './session-publication-registry.ts'

/** Normal workspace-service composition, with durable invitation and publication authority. */
export function createDurableWorkspaceCollaboration(directory = join(getConfigDir(), 'collaboration')) {
  const invitations = new SqliteBroInviteStore(join(directory, 'workspace-service-invitations.sqlite'))
  let sessions: SqliteHostedSessionRegistry
  try { sessions = new SqliteHostedSessionRegistry(join(directory, 'workspace-service-sessions.sqlite')) }
  catch (error) { invitations.close(); throw error }
  let closed = false
  return {
    authority: new WorkspaceBroInvitationAuthority(invitations, sessions),
    close() {
      if (closed) return
      closed = true
      try { invitations.close() } finally { sessions.close() }
    },
  }
}
