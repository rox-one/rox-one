import { createHash } from 'node:crypto'
import { chmodSync, closeSync, lstatSync, mkdirSync, openSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CodedError, type Session, type SessionCommand } from '@rox/shared/protocol'
import { SqliteBroInviteStore } from '@rox/shared/collaboration/durable-store'
import { parseInviteUrl, redactForPublication, slugifyUsername, type RoxAccount } from '@rox/shared/collaboration'
import { DatabaseSync } from '../../../../shared/src/utils/sqlite-runtime'
import { projectSessionForCollaboration } from '../../collaboration/session-publication-bridge'
import { shareToViewer, updateShare, revokeShare, type ShareSessionRecord, type ShareLogger } from '../../sessions/share-capability'
import type { NativeAuthority } from '../../authority/native-authority'
import type { RpcServer } from '../../transport/types'

/** Link ownership is independent of historical conversation authorship. */
export interface NativeSharingScope {
  issuer: string
  subject: string
  workspaceId: string
  workspaceRootPath: string
  sessionId: string
}

export const NATIVE_SHARING_COMMANDS = new Set([
  'shareToViewer', 'updateShare', 'revokeShare', 'inviteBro', 'revokeBroInvite', 'joinBroInvite', 'listBroPresence',
])

function identity(scope: NativeSharingScope): string {
  return createHash('sha256').update(JSON.stringify([scope.issuer, scope.subject])).digest('hex')
}

function invitationWorkspace(scope: NativeSharingScope): string {
  return `native:${createHash('sha256').update(JSON.stringify([scope.issuer, scope.workspaceId, scope.workspaceRootPath])).digest('hex')}`
}

function account(scope: NativeSharingScope, displayName: string): RoxAccount {
  const actor = identity(scope)
  return { accountId: `native:${actor}`, username: `${slugifyUsername(displayName).slice(0, 40)}-${actor.slice(0, 16)}`, displayName: displayName || scope.subject }
}

function linkKey(scope: NativeSharingScope): string {
  return JSON.stringify([scope.issuer, scope.subject, scope.workspaceId, scope.workspaceRootPath, scope.sessionId])
}

/** Only canonical visible conversation text crosses the public viewer boundary. */
export function projectNativeViewerSession(session: Session): object {
  const projection = projectSessionForCollaboration({ ...session,
    name: session.name ? redactForPublication(session.name).preview : undefined,
    workspaceName: redactForPublication(session.workspaceName).preview,
    messages: session.messages.filter(message => !message.hidden).map(message => ({ ...message, content: redactForPublication(message.content).preview })),
  })
  return {
    id: session.id,
    workspaceId: session.workspaceId,
    name: projection.name,
    createdAt: session.createdAt ?? 0,
    lastUsedAt: projection.lastMessageAt,
    messages: projection.messages.map(message => ({ id: message.id, type: message.role, content: message.content, timestamp: message.timestamp })),
    transcriptTruncated: projection.transcriptTruncated,
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 },
  }
}

function privateLinkDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  try { closeSync(openSync(path, 'wx', 0o600)) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const info = lstatSync(path)
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 ||
      typeof process.getuid === 'function' && info.uid !== process.getuid()) throw new Error('Native share registry must be a private regular file')
  }
  chmodSync(path, 0o600)
  const db = new DatabaseSync(path)
  db.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS native_share_links (scope TEXT PRIMARY KEY, id TEXT NOT NULL, url TEXT NOT NULL, owner_key TEXT NOT NULL)')
  return db
}

function privateDirectory(directory: string): string {
  try { mkdirSync(directory, { mode: 0o700 }) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  const info = lstatSync(directory)
  if (info.isSymbolicLink() || !info.isDirectory() ||
    typeof process.getuid === 'function' && info.uid !== process.getuid()) throw new Error('Native sharing custody directory is unsafe')
  chmodSync(directory, 0o700)
  return realpathSync(directory)
}

/** No Rox cloud account or host workspace JWT is consulted for a native actor. */
export class NativeSessionCollaboration {
  private readonly links: DatabaseSync
  private readonly invitations: SqliteBroInviteStore
  private readonly activeLinks = new Set<string>()

  constructor(directory: string) {
    directory = privateDirectory(directory)
    this.links = privateLinkDatabase(join(directory, 'native-share-links.sqlite'))
    try { this.invitations = new SqliteBroInviteStore(join(directory, 'native-bro-invites.sqlite')) }
    catch (error) { this.links.close(); throw error }
  }

  private record(scope: NativeSharingScope): ShareSessionRecord {
    const row = this.links.prepare('SELECT id,url,owner_key FROM native_share_links WHERE scope=?').get(linkKey(scope)) as
      { id: string; url: string; owner_key: string } | undefined
    return { workspace: { id: scope.workspaceId, rootPath: scope.workspaceRootPath },
      ...(row ? { sharedId: row.id, sharedUrl: row.url, sharedOwnerKey: row.owner_key } : {}) }
  }

  async command(
    scope: NativeSharingScope, command: SessionCommand, session: Session,
    assertCurrent: () => void, log: ShareLogger, displayName = '',
  ): Promise<unknown> {
    assertCurrent()
    if (session.id !== scope.sessionId || session.workspaceId !== scope.workspaceId) throw new CodedError('FORBIDDEN', 'Session access denied')
    const actor = account(scope, displayName)
    const workspaceId = invitationWorkspace(scope)
    switch (command.type) {
      case 'inviteBro': {
        if (command.role !== undefined && command.role !== 'editor' && command.role !== 'viewer') throw new CodedError('FORBIDDEN', 'Invalid invitation role')
        const card = this.invitations.createInvite({ sessionId: scope.sessionId, workspaceId, owner: actor, role: command.role })
        return { success: true, url: card.url, qrPayload: card.qrPayload, contactShareText: card.contactShareText, expiresAt: card.expiresAt, role: card.role }
      }
      case 'revokeBroInvite': {
        const invite = this.invitations.getInvite(command.joinKey)
        if (!invite || invite.workspaceId !== workspaceId || invite.sessionId !== scope.sessionId || invite.ownerAccountId !== actor.accountId) {
          throw new CodedError('FORBIDDEN', 'Invitation owner denied')
        }
        return { success: this.invitations.revoke(command.joinKey, actor.accountId) }
      }
      case 'joinBroInvite': {
        const parsed = parseInviteUrl(command.url)
        if (!parsed || parsed.sessionId !== scope.sessionId) return { ok: false, error: 'invalid' }
        const invite = this.invitations.getInvite(parsed.joinKey)
        // The invite confers no native workspace grant and cannot change the bound workspace.
        if (!invite || invite.workspaceId !== workspaceId || invite.sessionId !== scope.sessionId) return { ok: false, error: 'invalid' }
        const joined = this.invitations.join(command.url, actor)
        return joined.ok ? { ...joined, workspaceId: scope.workspaceId } : joined
      }
      case 'listBroPresence':
        return this.invitations.listPresence(scope.sessionId, workspaceId)
      case 'shareToViewer':
      case 'updateShare':
      case 'revokeShare': {
        const key = linkKey(scope)
        if (this.activeLinks.has(key)) return { success: false, error: 'Share operation already in progress', errorCode: 'SHARE_BUSY' }
        this.activeLinks.add(key)
        try {
        const managed = this.record(scope)
        const host = { getSession: (id: string) => id === scope.sessionId ? managed : undefined, sendEvent() {}, log }
        const deps = {
          assertAuthorized: assertCurrent,
          loadStoredSession: () => projectNativeViewerSession(session),
          updateSessionMetadata: async (_root: string, _id: string, patch: { sharedId?: string; sharedUrl?: string; sharedOwnerKey?: string }) => {
            assertCurrent()
            if (patch.sharedId && patch.sharedUrl && patch.sharedOwnerKey) {
              this.links.prepare('INSERT INTO native_share_links(scope,id,url,owner_key) VALUES(?,?,?,?) ON CONFLICT(scope) DO UPDATE SET id=excluded.id,url=excluded.url,owner_key=excluded.owner_key')
                .run(linkKey(scope), patch.sharedId, patch.sharedUrl, patch.sharedOwnerKey)
            } else if (patch.sharedId === undefined && patch.sharedUrl === undefined && patch.sharedOwnerKey === undefined) {
              this.links.prepare('DELETE FROM native_share_links WHERE scope=?').run(linkKey(scope))
            } else throw new Error('Share service did not return an owner capability')
          },
          fetch: async (url: string, init?: RequestInit) => {
            assertCurrent()
            const response = await globalThis.fetch(url, { ...init, redirect: 'error' })
            assertCurrent()
            if (response.ok && init?.method === 'POST') {
              const result = await response.clone().json() as { id?: unknown; url?: unknown; ownerKey?: unknown }
              assertCurrent()
              const shared = typeof result.url === 'string' ? new URL(result.url) : null
              const endpoint = new URL(url)
              if (typeof result.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(result.id) ||
                typeof result.ownerKey !== 'string' || !result.ownerKey || !shared || shared.origin !== endpoint.origin ||
                shared.username || shared.password || shared.search || shared.hash || shared.pathname !== `/s/${result.id}`) {
                throw new Error('Invalid share service capability')
              }
            }
            return response
          },
        }
        if (command.type === 'shareToViewer') {
          if (managed.sharedUrl) return { success: true, url: managed.sharedUrl }
          return await shareToViewer(host, scope.sessionId, deps)
        }
        if (command.type === 'updateShare') return await updateShare(host, scope.sessionId, deps)
        return await revokeShare(host, scope.sessionId, deps)
        } finally { this.activeLinks.delete(key) }
      }
      default: throw new CodedError('FORBIDDEN', 'Native collaboration command denied')
    }
  }

  close(): void { this.links.close(); this.invitations.close() }
}

const stores = new WeakMap<RpcServer, NativeSessionCollaboration>()
export function getNativeSessionCollaboration(server: RpcServer, authority: NativeAuthority): NativeSessionCollaboration {
  const existing = stores.get(server)
  if (existing) return existing
  const store = new NativeSessionCollaboration(join(authority.stateDirectory, 'native-session-sharing'))
  stores.set(server, store)
  server.onShutdown?.(() => { stores.delete(server); store.close() })
  return store
}
