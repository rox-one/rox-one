import { loadSession as defaultLoadStoredSession, updateSessionMetadata as defaultUpdateSessionMetadata } from '@craft-agent/shared/sessions'
import type { SessionEvent, ShareResult } from '@craft-agent/shared/protocol'

export interface ShareLogger {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

export interface ShareSessionRecord {
  sharedUrl?: string
  sharedId?: string
  sharedOwnerKey?: string
  isAsyncOperationOngoing?: boolean
  workspace: { id: string; rootPath: string }
}

export interface ShareCapabilityHost {
  getSession(sessionId: string): ShareSessionRecord | undefined
  sendEvent(event: SessionEvent, workspaceId: string): void
  log: ShareLogger
}

export interface ShareCapabilityDeps {
  fetch?: (url: string, init?: RequestInit) => Promise<Response> | Response
  getViewerUrl?: () => Promise<string>
  loadStoredSession?: (rootPath: string, sessionId: string) => unknown
  updateSessionMetadata?: (
    rootPath: string,
    sessionId: string,
    patch: { sharedUrl?: string; sharedId?: string; sharedOwnerKey?: string },
  ) => Promise<void>
}

/**
 * SECURITY: sharedOwnerKey is persisted locally as the share mutation
 * capability. It must never cross into renderer payloads — strip it from
 * any object built via pickSessionFields / managedToSession.
 */
export function stripSharedOwnerKey<T extends object>(fields: T): T {
  delete (fields as { sharedOwnerKey?: unknown }).sharedOwnerKey
  return fields
}

/** Bearer header for share update/revoke/delete. Empty when no key is persisted. */
export function ownerCapabilityHeaders(ownerKey: string | undefined): Record<string, string> {
  return ownerKey ? { Authorization: `Bearer ${ownerKey}` } : {}
}

export function applyShareGranted(
  session: { sharedUrl?: string; sharedId?: string; sharedOwnerKey?: string },
  data: { url: string; id: string; ownerKey?: string },
): void {
  session.sharedUrl = data.url
  session.sharedId = data.id
  session.sharedOwnerKey = data.ownerKey
}

export function applyShareRevoked(session: {
  sharedUrl?: string
  sharedId?: string
  sharedOwnerKey?: string
}): void {
  delete session.sharedUrl
  delete session.sharedId
  delete session.sharedOwnerKey
}

/**
 * Map a failed share-API response to a typed ShareResult.
 * Reads the API's JSON error body ({ error, code }) defensively so the UI can
 * distinguish legacy-immutable shares from missing/invalid owner keys.
 */
export async function mapShareApiError(
  response: Response,
  fallback: string,
): Promise<{ success: false; error: string; errorCode?: string }> {
  let code: string | undefined
  let serverMessage: string | undefined
  try {
    const body = await response.json() as { error?: unknown; code?: unknown }
    if (typeof body.code === 'string') code = body.code
    if (typeof body.error === 'string') serverMessage = body.error
  } catch {
    // Non-JSON error body (proxy error pages etc.) — fall through to status mapping.
  }

  if (response.status === 413 || code === 'SHARE_TOO_LARGE') {
    return { success: false, error: 'Session file is too large to share', errorCode: 'SHARE_TOO_LARGE' }
  }
  if (code === 'LEGACY_SHARE_IMMUTABLE') {
    return {
      success: false,
      error: 'This share was created before share protection existed and can no longer be modified or revoked. Create a new share instead.',
      errorCode: 'LEGACY_SHARE_IMMUTABLE',
    }
  }
  if (response.status === 401 || response.status === 403) {
    return {
      success: false,
      error: serverMessage || 'Share authorization failed. Re-share the session to generate a new owner key.',
      errorCode: code ?? (response.status === 401 ? 'SHARE_OWNER_KEY_REQUIRED' : 'SHARE_OWNER_KEY_INVALID'),
    }
  }
  if (response.status === 429) {
    return { success: false, error: 'Share service rate limit exceeded, please retry later', errorCode: code ?? 'RATE_LIMITED' }
  }
  return { success: false, error: serverMessage || fallback, errorCode: code }
}

async function defaultViewerUrl(): Promise<string> {
  const { VIEWER_URL } = await import('@craft-agent/shared/branding')
  return VIEWER_URL
}

function resolveDeps(deps: ShareCapabilityDeps = {}) {
  return {
    fetch: deps.fetch ?? globalThis.fetch.bind(globalThis),
    getViewerUrl: deps.getViewerUrl ?? defaultViewerUrl,
    loadStoredSession: deps.loadStoredSession ?? defaultLoadStoredSession,
    updateSessionMetadata: deps.updateSessionMetadata ?? defaultUpdateSessionMetadata,
  }
}

function beginAsyncOperation(host: ShareCapabilityHost, managed: ShareSessionRecord, sessionId: string): void {
  managed.isAsyncOperationOngoing = true
  host.sendEvent({ type: 'async_operation', sessionId, isOngoing: true }, managed.workspace.id)
}

function endAsyncOperation(host: ShareCapabilityHost, managed: ShareSessionRecord, sessionId: string): void {
  managed.isAsyncOperationOngoing = false
  host.sendEvent({ type: 'async_operation', sessionId, isOngoing: false }, managed.workspace.id)
}

/**
 * Share session to the web viewer.
 * Uploads session data and returns shareable URL.
 */
export async function shareToViewer(
  host: ShareCapabilityHost,
  sessionId: string,
  deps: ShareCapabilityDeps = {},
): Promise<ShareResult> {
  const managed = host.getSession(sessionId)
  if (!managed) {
    return { success: false, error: 'Session not found' }
  }

  beginAsyncOperation(host, managed, sessionId)

  const { fetch, getViewerUrl, loadStoredSession, updateSessionMetadata } = resolveDeps(deps)

  try {
    const storedSession = loadStoredSession(managed.workspace.rootPath, sessionId)
    if (!storedSession) {
      return { success: false, error: 'Session file not found' }
    }

    const viewerUrl = await getViewerUrl()
    const response = await fetch(`${viewerUrl}/s/api`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(storedSession),
    })

    if (!response.ok) {
      host.log.error(`Share failed with status ${response.status}`)
      return mapShareApiError(response, 'Failed to upload session')
    }

    const data = await response.json() as { id: string; url: string; ownerKey?: string }

    // Store shared info in session. The ownerKey is the mutation capability
    // for this share — persisted locally, sent as Bearer on update/revoke,
    // and never exposed to renderer payloads (managedToSession strips it).
    applyShareGranted(managed, data)
    const workspaceRootPath = managed.workspace.rootPath
    await updateSessionMetadata(workspaceRootPath, sessionId, {
      sharedUrl: data.url,
      sharedId: data.id,
      sharedOwnerKey: data.ownerKey,
    })

    host.log.info(`Session ${sessionId} shared at ${data.url}`)
    host.sendEvent({ type: 'session_shared', sessionId, sharedUrl: data.url }, managed.workspace.id)
    return { success: true, url: data.url }
  } catch (error) {
    host.log.error('Share error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  } finally {
    endAsyncOperation(host, managed, sessionId)
  }
}

/**
 * Update an existing shared session.
 * Re-uploads session data to the same URL.
 */
export async function updateShare(
  host: ShareCapabilityHost,
  sessionId: string,
  deps: ShareCapabilityDeps = {},
): Promise<ShareResult> {
  const managed = host.getSession(sessionId)
  if (!managed) {
    return { success: false, error: 'Session not found' }
  }
  if (!managed.sharedId) {
    return { success: false, error: 'Session not shared' }
  }

  beginAsyncOperation(host, managed, sessionId)

  const { fetch, getViewerUrl, loadStoredSession } = resolveDeps(deps)

  try {
    const storedSession = loadStoredSession(managed.workspace.rootPath, sessionId)
    if (!storedSession) {
      return { success: false, error: 'Session file not found' }
    }

    const viewerUrl = await getViewerUrl()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...ownerCapabilityHeaders(managed.sharedOwnerKey),
    }
    const response = await fetch(`${viewerUrl}/s/api/${managed.sharedId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(storedSession),
    })

    if (!response.ok) {
      host.log.error(`Update share failed with status ${response.status}`)
      return mapShareApiError(response, 'Failed to update shared session')
    }

    host.log.info(`Session ${sessionId} share updated at ${managed.sharedUrl}`)
    return { success: true, url: managed.sharedUrl }
  } catch (error) {
    host.log.error('Update share error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  } finally {
    endAsyncOperation(host, managed, sessionId)
  }
}

/**
 * Revoke a shared session.
 * Deletes from viewer and clears local shared state.
 */
export async function revokeShare(
  host: ShareCapabilityHost,
  sessionId: string,
  deps: ShareCapabilityDeps = {},
): Promise<ShareResult> {
  const managed = host.getSession(sessionId)
  if (!managed) {
    return { success: false, error: 'Session not found' }
  }
  if (!managed.sharedId) {
    return { success: false, error: 'Session not shared' }
  }

  beginAsyncOperation(host, managed, sessionId)

  const { fetch, getViewerUrl, updateSessionMetadata } = resolveDeps(deps)

  try {
    const viewerUrl = await getViewerUrl()
    const headers: Record<string, string> = {
      ...ownerCapabilityHeaders(managed.sharedOwnerKey),
    }
    const response = await fetch(
      `${viewerUrl}/s/api/${managed.sharedId}`,
      { method: 'DELETE', headers },
    )

    if (!response.ok) {
      host.log.error(`Revoke failed with status ${response.status}`)
      return mapShareApiError(response, 'Failed to revoke share')
    }

    applyShareRevoked(managed)
    const workspaceRootPath = managed.workspace.rootPath
    await updateSessionMetadata(workspaceRootPath, sessionId, {
      sharedUrl: undefined,
      sharedId: undefined,
      sharedOwnerKey: undefined,
    })

    host.log.info(`Session ${sessionId} share revoked`)
    host.sendEvent({ type: 'session_unshared', sessionId }, managed.workspace.id)
    return { success: true }
  } catch (error) {
    host.log.error('Revoke error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  } finally {
    endAsyncOperation(host, managed, sessionId)
  }
}
