import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { cleanupModeState } from '@craft-agent/shared/agent'
import { SessionManager, createManagedSession } from './SessionManager.ts'

describe('SessionManager permissionModeVersion payloads', () => {
  let sm: SessionManager
  const sessionIds: string[] = []
  const workspace = {
    id: 'ws_test',
    name: 'Test Workspace',
    rootPath: '/tmp/rox-permission-mode-version-test',
    createdAt: 1,
  }

  beforeEach(() => {
    sm = new SessionManager()
    sessionIds.length = 0
  })

  afterEach(() => {
    for (const id of sessionIds) cleanupModeState(id)
  })

  function seedSession(
    id: string,
    fields: Omit<Parameters<typeof createManagedSession>[0], 'id'> = {},
    overrides: Parameters<typeof createManagedSession>[2] = {},
  ) {
    sessionIds.push(id)
    const managed = createManagedSession({ ...fields, id, rank: fields.rank ?? 'M' }, workspace as never, overrides)
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(id, managed)
    return managed
  }

  it('getSessions exposes the restore-healed permission mode version', () => {
    seedSession('list-payload', {
      permissionMode: 'safe',
      previousPermissionMode: 'allow-all',
      lastMessageAt: 10,
    })

    const [session] = sm.getSessions('ws_test')
    const state = sm.getSessionPermissionModeState('list-payload')

    expect(session.permissionMode).toBe('safe')
    expect(session.permissionModeVersion).toBe(state?.modeVersion)
    expect(session.permissionModeVersion).toBeGreaterThan(0)
    expect(state?.previousPermissionMode).toBe('allow-all')
  })

  it('getSession exposes the same authoritative permission mode version as the reconcile endpoint', async () => {
    seedSession(
      'single-payload',
      {
        permissionMode: 'allow-all',
      },
      { messagesLoaded: true },
    )

    const session = await sm.getSession('single-payload')
    const state = sm.getSessionPermissionModeState('single-payload')

    expect(session?.permissionMode).toBe('allow-all')
    expect(session?.permissionModeVersion).toBe(state?.modeVersion)
    expect(session?.permissionModeVersion).toBeGreaterThan(0)
  })
})
