/**
 * GitHub identity linking (device flow, link mode).
 *
 * Covers the wire contract the renderer depends on: the start view carries only
 * public codes, a successful poll links the workspace and returns the profile,
 * the token is used once (GET /user) and never leaked, and `get` reloads the
 * stored link. The credential-import behaviour is exercised in the sibling
 * github-oauth-import suite and is unchanged.
 */
import { describe, expect, it, mock } from 'bun:test'
import type { GithubOAuthHttpClient, GithubOAuthHttpRequest } from '@rox/shared/credentials'
import {
  createGithubDeviceLink,
  fetchGithubProfile,
  type GithubLinkProfileView,
} from '../github-oauth-import.ts'

const ACCESS_TOKEN = 'gho_super-secret-oauth-token'
const VERIFY_URI = 'https://github.com/login/device'

function memoryStore() {
  const records = new Map<string, GithubLinkProfileView>()
  return {
    records,
    store: {
      get: (workspaceId: string) => records.get(workspaceId) ?? null,
      set: (workspaceId: string, record: GithubLinkProfileView) => { records.set(workspaceId, record) },
    },
  }
}

function fakeHttp(overrides: {
  token?: string
  profile?: string
  calls?: GithubOAuthHttpRequest[]
} = {}): GithubOAuthHttpClient {
  return async (request) => {
    overrides.calls?.push(request)
    if (request.url.endsWith('/login/device/code')) {
      return {
        status: 200,
        body: JSON.stringify({
          device_code: 'hidden-device-code',
          user_code: 'ABCD-1234',
          verification_uri: VERIFY_URI,
          interval: 5,
          expires_in: 900,
        }),
      }
    }
    if (request.url.endsWith('/login/oauth/access_token')) {
      return { status: 200, body: overrides.token ?? JSON.stringify({ access_token: ACCESS_TOKEN, token_type: 'bearer' }) }
    }
    if (request.url === 'https://api.github.com/user') {
      return {
        status: 200,
        body: overrides.profile ?? JSON.stringify({
          login: 'octocat',
          id: 583231,
          name: 'The Octocat',
          avatar_url: 'https://avatars.githubusercontent.com/u/583231',
        }),
      }
    }
    throw new Error(`unexpected request: ${request.url}`)
  }
}

function createFlow(http: GithubOAuthHttpClient, options: { pendingFirst?: boolean } = {}) {
  const { store, records } = memoryStore()
  let tokenReads = 0
  const wrapped: GithubOAuthHttpClient = options.pendingFirst
    ? async (request) => {
        if (request.url.endsWith('/login/oauth/access_token') && (tokenReads += 1) === 1) {
          return { status: 200, body: JSON.stringify({ error: 'authorization_pending' }) }
        }
        return http(request)
      }
    : http
  const flow = createGithubDeviceLink({
    http: wrapped,
    clientId: 'client',
    store,
    newId: () => 'flow_1',
    now: () => 1_700_000_000_000,
  })
  return { flow, records }
}

describe('GitHub device link', () => {
  it('starts without returning the device code or access token', async () => {
    const { flow } = createFlow(fakeHttp())
    const started = await flow.start()
    expect(started).toEqual({
      flowId: 'flow_1',
      userCode: 'ABCD-1234',
      verificationUri: VERIFY_URI,
      interval: 5,
      expiresIn: 900,
    })
    expect(JSON.stringify(started)).not.toContain('hidden-device-code')
    expect(JSON.stringify(started)).not.toContain(ACCESS_TOKEN)
    expect(started).not.toHaveProperty('deviceCode')
    expect(started).not.toHaveProperty('accessToken')
  })

  it('fails closed without a client id', async () => {
    const { store } = memoryStore()
    const flow = createGithubDeviceLink({
      http: async () => { throw new Error('http_should_not_run') },
      clientId: '',
      store,
    })
    await expect(flow.start()).rejects.toThrow(/missing_client_id/)
  })

  it('polls pending without leaking a bearer', async () => {
    const { flow } = createFlow(fakeHttp(), { pendingFirst: true })
    await flow.start()
    const polled = await flow.poll({ flowId: 'flow_1', workspaceId: 'workspace_a' })
    expect(polled.status).toBe('pending')
    expect(JSON.stringify(polled)).not.toContain(ACCESS_TOKEN)
    expect(JSON.stringify(polled)).not.toContain('hidden-device-code')
  })

  it('links the workspace on approval, reads /user and never returns the token', async () => {
    const calls: GithubOAuthHttpRequest[] = []
    const { flow, records } = createFlow(fakeHttp({ calls }))
    await flow.start()
    const polled = await flow.poll({ flowId: 'flow_1', workspaceId: 'workspace_a' })
    expect(polled).toEqual({
      status: 'linked',
      profile: {
        githubLogin: 'octocat',
        githubId: 583231,
        avatarUrl: 'https://avatars.githubusercontent.com/u/583231',
        linkedAt: 1_700_000_000_000,
      },
    })
    expect(JSON.stringify(polled)).not.toContain(ACCESS_TOKEN)
    expect(JSON.stringify(polled)).not.toContain('hidden-device-code')
    expect(polled).not.toHaveProperty('accessToken')

    const userCall = calls.find(call => call.url === 'https://api.github.com/user')
    expect(userCall?.method).toBe('GET')
    expect(userCall?.headers?.authorization).toBe(`Bearer ${ACCESS_TOKEN}`)

    expect(records.get('workspace_a')).toEqual({
      githubLogin: 'octocat',
      githubId: 583231,
      avatarUrl: 'https://avatars.githubusercontent.com/u/583231',
      linkedAt: 1_700_000_000_000,
    })
    // The flow is consumed; a second poll fails closed.
    await expect(flow.poll({ flowId: 'flow_1', workspaceId: 'workspace_a' })).rejects.toThrow(/unknown_flow/)
  })

  it('reports denied and expired without storing a link', async () => {
    for (const error of ['access_denied', 'expired_token'] as const) {
      const http: GithubOAuthHttpClient = async (request) => {
        if (request.url.endsWith('/login/device/code')) {
          return { status: 200, body: JSON.stringify({ device_code: 'd', user_code: 'ABCD-1234', verification_uri: VERIFY_URI, interval: 5 }) }
        }
        return { status: 200, body: JSON.stringify({ error }) }
      }
      const { flow, records } = createFlow(http)
      await flow.start()
      const polled = await flow.poll({ flowId: 'flow_1', workspaceId: 'workspace_a' })
      expect(polled.status).toBe(error === 'access_denied' ? 'denied' : 'expired')
      expect(records.size).toBe(0)
    }
  })

  it('reads a stored link for reload, scoped to the workspace', async () => {
    const { flow } = createFlow(fakeHttp())
    expect(await flow.get({ workspaceId: 'workspace_a' })).toBeNull()
    await flow.start()
    await flow.poll({ flowId: 'flow_1', workspaceId: 'workspace_a' })
    const reloaded = await flow.get({ workspaceId: 'workspace_a' })
    expect(reloaded?.githubLogin).toBe('octocat')
    expect(await flow.get({ workspaceId: 'workspace_b' })).toBeNull()
  })

  it('fails the link when the profile call reports an unexpected shape', async () => {
    const { flow, records } = createFlow(fakeHttp({ profile: JSON.stringify({ login: 'octocat' }) }))
    await flow.start()
    await expect(flow.poll({ flowId: 'flow_1', workspaceId: 'workspace_a' })).rejects.toThrow(/github_profile_invalid_response/)
    expect(records.size).toBe(0)
  })
})

describe('fetchGithubProfile', () => {
  it('rejects a profile whose body echoes the token', async () => {
    const http: GithubOAuthHttpClient = async () => ({
      status: 200,
      body: JSON.stringify({ login: 'octocat', id: 1, avatar_url: 'https://a/x', token: ACCESS_TOKEN }),
    })
    await expect(fetchGithubProfile(http, ACCESS_TOKEN)).rejects.toThrow(/leaked a secret/)
  })

  it('carries the name only when present', async () => {
    const withName = await fetchGithubProfile(fakeHttp(), ACCESS_TOKEN)
    expect(withName).toEqual({
      login: 'octocat',
      id: 583231,
      name: 'The Octocat',
      avatarUrl: 'https://avatars.githubusercontent.com/u/583231',
    })
    const bare = await fetchGithubProfile(
      fakeHttp({ profile: JSON.stringify({ login: 'octocat', id: 1, avatar_url: 'https://a/x' }) }),
      ACCESS_TOKEN,
    )
    expect(bare).toEqual({ login: 'octocat', id: 1, avatarUrl: 'https://a/x' })
  })
})

it('rejects a profile request without a token', async () => {
  await expect(fetchGithubProfile(async () => ({ status: 200, body: '{}' }), '')).rejects.toThrow(/missing_access_token/)
})

it('surfaces a non-2xx profile response', async () => {
  const http = mock(async () => ({ status: 401, body: '{}' }))
  await expect(fetchGithubProfile(http, ACCESS_TOKEN)).rejects.toThrow(/github_profile_failed/)
})