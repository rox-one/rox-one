import { chmodSync, closeSync, lstatSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from '../../../../../packages/shared/src/utils/sqlite-runtime.ts'
import { requireRemoteSessionProjection, type RemoteSessionProjection, type SessionPublicationInput } from '../../../../../packages/shared/src/collaboration/session-publication.ts'
import { IdentityDomainError, type AuthenticatedActor } from '../../../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import { requireActor, requireUuid } from '../identity/commands.ts'
import { requireSessionId, type HostedSessionScope } from './invitations.ts'

/** Canonical service registry. Identity comes exclusively from freshly authenticated Actor. */
export class SqliteHostedSessionRegistry implements HostedSessionScope {
  private readonly database: DatabaseSync
  private closed = false

  constructor(path: string, private readonly now: () => number = Date.now) {
    if (!path || path === ':memory:') throw new Error('Durable session registry path required')
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    try { const fd = openSync(path, 'wx', 0o600); closeSync(fd) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const info = lstatSync(path)
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (typeof process.getuid === 'function' && info.uid !== process.getuid())) {
        throw new Error('Session registry must be a private regular file')
      }
    }
    chmodSync(path, 0o600)
    this.database = new DatabaseSync(path)
    try {
      this.database.exec('PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS bro_session_publications (workspace_id TEXT NOT NULL, session_id TEXT NOT NULL, owner_principal_id TEXT NOT NULL, projection_json TEXT NOT NULL, PRIMARY KEY(workspace_id, session_id));')
    } catch (error) { this.database.close(); throw error }
  }

  async resolveSession(workspaceId: string, sessionId: string): Promise<{ ownerPrincipalId: string } | null> {
    const row = this.database.prepare('SELECT owner_principal_id FROM bro_session_publications WHERE workspace_id = ? AND session_id = ?').get(workspaceId, sessionId)
    return row ? { ownerPrincipalId: row.owner_principal_id as string } : null
  }

  publishSession(actor: AuthenticatedActor, workspaceId: string, sessionId: string, input: SessionPublicationInput): RemoteSessionProjection {
    requireActor(actor, requireUuid(workspaceId))
    requireSessionId(sessionId)
    const projection = requireRemoteSessionProjection({ ...input, id: sessionId, workspaceId, access: 'read-only', publishedAt: this.now() })
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const current = this.database.prepare('SELECT owner_principal_id FROM bro_session_publications WHERE workspace_id = ? AND session_id = ?').get(workspaceId, sessionId)
      if (current && current.owner_principal_id !== actor.principalId) throw new IdentityDomainError('FORBIDDEN')
      this.database.prepare('INSERT INTO bro_session_publications (workspace_id, session_id, owner_principal_id, projection_json) VALUES (?, ?, ?, ?) ON CONFLICT(workspace_id, session_id) DO UPDATE SET projection_json = excluded.projection_json').run(workspaceId, sessionId, actor.principalId, JSON.stringify(projection))
      this.database.exec('COMMIT')
      return projection
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
  }

  async readProjection(workspaceId: string, sessionId: string): Promise<RemoteSessionProjection | null> {
    const row = this.database.prepare('SELECT projection_json FROM bro_session_publications WHERE workspace_id = ? AND session_id = ?').get(workspaceId, sessionId)
    return row ? requireRemoteSessionProjection(JSON.parse(row.projection_json as string)) : null
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.database.close()
  }
}
