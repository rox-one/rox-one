import { parseInviteUrl, requireRemoteSessionProjection, type JoinResult, type RemoteSessionProjection } from '@rox/shared/collaboration'
import { VIEWER_URL } from '@rox/shared/branding'
import type { SessionCommand } from '@rox/shared/protocol'

export const JOIN_SESSION_EVENT = 'craft:join-session'
export const SESSION_LINK_EVENT = 'craft:session-link'

export type SessionLinkKind = 'share' | 'invite'
export interface SessionLink {
  kind: SessionLinkKind
  url: string
  expiresAt?: number
  copied: boolean
  /** Workspace that requested publication; stale results must not open elsewhere. */
  workspaceId?: string
}

export class SessionLinkError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message)
  }
}

export type SessionLinkDestination =
  | { kind: 'invite'; url: string; sessionId: string }
  | { kind: 'viewer'; url: string }

export interface JoinedSessionTarget {
  sessionId: string
  workspaceId?: string
  remoteSession?: RemoteSessionProjection
}

/** A join action must never open an arbitrary URL found on the clipboard. */
export function parseSessionLink(raw: string): SessionLinkDestination | null {
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
    const invite = parseInviteUrl(url.href)
    if (invite) return { kind: 'invite', url: url.href, sessionId: invite.sessionId }
    if (url.origin === new URL(VIEWER_URL).origin && /^\/s\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) && !/^\/s\/api\/?$/.test(url.pathname)) {
      return { kind: 'viewer', url: url.href }
    }
    return null
  } catch {
    return null
  }
}

type SessionCommandApi = (sessionId: string, command: SessionCommand) => Promise<unknown>

export async function createSessionLink(
  command: SessionCommandApi,
  sessionId: string,
  kind: SessionLinkKind,
): Promise<Omit<SessionLink, 'copied'>> {
  const result = await command(sessionId, { type: kind === 'share' ? 'shareToViewer' : 'inviteBro' }) as {
    success?: boolean; url?: string; error?: string; errorCode?: string; expiresAt?: number
  } | undefined
  if (!result?.success || !result.url) {
    throw new SessionLinkError(result?.error || '', result?.errorCode)
  }
  const destination = parseSessionLink(result.url)
  if (!destination || destination.kind !== (kind === 'invite' ? 'invite' : 'viewer')) {
    throw new SessionLinkError('', 'invalid')
  }
  if (destination.kind === 'invite' && destination.sessionId !== sessionId) throw new SessionLinkError('', 'invalid')
  return { kind, url: destination.url, expiresAt: result.expiresAt }
}

/** Publishing succeeded even if clipboard access failed: keep the URL visible. */
export async function copySessionLink(url: string, write: (text: string) => Promise<void>): Promise<boolean> {
  try {
    await write(url)
    return true
  } catch {
    return false
  }
}

export async function acceptSessionInvite(
  command: SessionCommandApi,
  destination: Extract<SessionLinkDestination, { kind: 'invite' }>,
): Promise<JoinedSessionTarget> {
  const result = await command(destination.sessionId, { type: 'joinBroInvite', url: destination.url }) as JoinResult | undefined
  if (!result?.ok) throw new SessionLinkError('', result?.error)
  if (result.sessionId !== destination.sessionId) throw new SessionLinkError('', 'invalid')
  if (result.remoteSession) {
    let remoteSession: RemoteSessionProjection
    try { remoteSession = requireRemoteSessionProjection(result.remoteSession) } catch { throw new SessionLinkError('', 'invalid') }
    if (remoteSession.id !== result.sessionId || remoteSession.workspaceId !== result.workspaceId) throw new SessionLinkError('', 'invalid')
    return { sessionId: result.sessionId, workspaceId: result.workspaceId, remoteSession }
  }
  return { sessionId: result.sessionId, workspaceId: result.workspaceId }
}

/** Resolve actual session data and workspace before the UI can report success. */
export async function joinAndOpenSession<T extends { id: string; workspaceId: string }>(
  destination: Extract<SessionLinkDestination, { kind: 'invite' }>,
  ports: {
    command: SessionCommandApi
    readSession(sessionId: string): Promise<T | null>
    currentWorkspace(): string | null
    switchWorkspace(workspaceId: string): Promise<void>
    openSession(session: T): Promise<void>
    openRemoteSession?(session: RemoteSessionProjection): Promise<void>
    /** Invalidates UI work when the caller leaves its original context. */
    isCurrent?(): boolean
  },
): Promise<void> {
  const requireCurrent = () => {
    if (ports.isCurrent && !ports.isCurrent()) throw new SessionLinkError('', 'cancelled')
  }
  requireCurrent()
  const target = await acceptSessionInvite(ports.command, destination)
  requireCurrent()
  if (target.remoteSession) {
    if (!ports.openRemoteSession) throw new SessionLinkError('', 'remote_unavailable')
    await ports.openRemoteSession(target.remoteSession)
    requireCurrent()
    return
  }
  const session = await ports.readSession(target.sessionId)
  requireCurrent()
  if (!session || session.id !== target.sessionId || !session.workspaceId
    || target.workspaceId && session.workspaceId !== target.workspaceId) {
    throw new SessionLinkError('', 'invalid')
  }
  if (session.workspaceId !== ports.currentWorkspace()) await ports.switchWorkspace(session.workspaceId)
  requireCurrent()
  await ports.openSession(session)
  requireCurrent()
}

export function requestJoinSession(): void {
  window.dispatchEvent(new Event(JOIN_SESSION_EVENT))
}

export function presentSessionLink(link: SessionLink): void {
  window.dispatchEvent(new CustomEvent(SESSION_LINK_EVENT, { detail: link }))
}
