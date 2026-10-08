import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import type { AuthenticatedActor } from '../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import { createWorkspaceHttpHandler, type WorkspaceHttpOptions } from '../src/http.ts'

export const TOKEN = 'aaa.bbb.ccc'

export function actor(workspaceIds: string[], principalId: string = randomUUID()): AuthenticatedActor {
  return { principalId, deviceId: 'device-1', sessionId: 'session-1', expiresAt: Date.now() + 600_000, authenticatedWorkspaceIds: workspaceIds }
}

/** Resolver double: one bound session whose actor can be swapped or revoked mid-request. */
export function fakeResolver(initial: AuthenticatedActor) {
  const state = { actor: initial as AuthenticatedActor | null, revalidations: 0, revokeAfter: Number.POSITIVE_INFINITY }
  const bound = () => {
    if (!state.actor) throw Object.assign(new Error('revoked'), { name: 'AuthenticationError' })
    const a = state.actor
    return { actor: a, identity: { issuer: 'urn:test', subject: a.principalId, principalId: a.principalId, sessionId: a.sessionId, deviceId: a.deviceId, expiresAt: a.expiresAt } }
  }
  const resolver = {
    async authenticate(token: string) {
      if (token !== TOKEN) throw new (await import('../src/auth/verified-actor.ts')).AuthenticationError()
      return bound()
    },
    async revalidate() {
      state.revalidations += 1
      if (state.revalidations > state.revokeAfter) state.actor = null
      if (!state.actor) throw new (await import('../src/auth/verified-actor.ts')).AuthenticationError()
      return bound()
    },
  }
  return { resolver: resolver as unknown as WorkspaceHttpOptions['actorResolver'], state }
}

export async function serve(options: WorkspaceHttpOptions): Promise<{ server: Server; url: string; close(): Promise<void> }> {
  const handler = createWorkspaceHttpHandler(options)
  const server = createServer((req, res) => { void handler(req, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no address')
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

export async function request(url: string, path: string, init: { method?: string; token?: string | null; body?: unknown; raw?: string; contentType?: string } = {}) {
  const headers: Record<string, string> = {}
  if (init.token !== null) headers.authorization = 'Bearer ' + (init.token ?? TOKEN)
  const body = init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body))
  if (body !== undefined) headers['content-type'] = init.contentType ?? 'application/json'
  const response = await fetch(url + path, { method: init.method ?? (body === undefined ? 'GET' : 'POST'), headers, ...(body !== undefined ? { body } : {}) })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null, allow: response.headers.get('allow') }
}
