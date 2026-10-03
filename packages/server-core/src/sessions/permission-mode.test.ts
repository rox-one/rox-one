import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS, type SessionEvent } from '@craft-agent/shared/protocol'
import { loadSession } from '@craft-agent/shared/sessions'
import {
  cleanupModeState,
  getPermissionModeDiagnostics,
  setPermissionMode,
  type PermissionMode,
} from '@craft-agent/shared/agent/mode-manager'
import type { HandlerDeps } from '../handlers/handler-deps'
import { registerSessionsHandlers } from '../handlers/rpc/sessions'
import type { HandlerFn, RequestContext, RpcServer } from '../transport'
import { SessionManager } from './SessionManager'

type FixtureSession = {
  id: string
  workspace: { id: string; rootPath: string }
  permissionMode: PermissionMode
  previousPermissionMode?: PermissionMode
  agent: { setPermissionMode(mode: PermissionMode): void } | null
  messages: []
  messagesLoaded: boolean
  createdAt: number
}

const fixtures: Array<{ manager: SessionManager; session: FixtureSession }> = []

function createHarness(mode: PermissionMode = 'allow-all') {
  const rootPath = mkdtempSync(join(tmpdir(), 'session-permission-mode-'))
  const id = `permission-mode-${crypto.randomUUID()}`
  const agentModes: PermissionMode[] = []
  const events: SessionEvent[] = []
  const session: FixtureSession = {
    id,
    workspace: { id: 'permission-workspace', rootPath },
    permissionMode: mode,
    agent: { setPermissionMode: mode => agentModes.push(mode) },
    messages: [],
    messagesLoaded: true,
    createdAt: Date.now(),
  }
  const manager = new SessionManager()
  const internals = manager as unknown as {
    sessions: Map<string, FixtureSession>
    sendEvent(event: SessionEvent, workspaceId?: string): void
    memoryServiceFor(): null
  }
  internals.sessions.set(id, session)
  internals.sendEvent = event => events.push(event)
  // Keep the real session persistence queue; only unrelated memory work is disabled.
  internals.memoryServiceFor = () => null
  setPermissionMode(id, mode, { changedBy: 'restore' })
  fixtures.push({ manager, session })

  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = {
    handle: (channel, handler) => { handlers.set(channel, handler) },
    push() {},
    async invokeClient() {},
    hasClientCapability: () => false,
    findClientsWithCapability: () => [],
  }
  registerSessionsHandlers(server, {
    sessionManager: manager,
    platform: { logger: { error() {}, warn() {}, info() {}, debug() {} } },
  } as unknown as HandlerDeps)
  const context = { workspaceId: session.workspace.id } as RequestContext

  return {
    manager, session, events, agentModes,
    async change(mode: PermissionMode) {
      const handler = handlers.get(RPC_CHANNELS.sessions.COMMAND)!
      await handler(context, id, { type: 'setPermissionMode', mode })
    },
    async readback() {
      const handler = handlers.get(RPC_CHANNELS.sessions.GET_PERMISSION_MODE_STATE)!
      return await handler(context, id) as ReturnType<SessionManager['getSessionPermissionModeState']>
    },
  }
}

afterEach(async () => {
  for (const { manager, session } of fixtures.splice(0)) {
    await manager.flushSession(session.id)
    cleanupModeState(session.id)
    rmSync(session.workspace.rootPath, { recursive: true, force: true })
  }
})

describe('session permission mode RPC and authoritative state', () => {
  it('switches execution to safe, updates the agent, and persists the readback mode', async () => {
    const harness = createHarness()
    const before = await harness.readback()

    await harness.change('safe')
    const after = await harness.readback()
    await harness.manager.flushSession(harness.session.id)
    const stored = loadSession(harness.session.workspace.rootPath, harness.session.id)

    expect(harness.session.permissionMode).toBe('safe')
    expect(harness.agentModes).toEqual(['safe'])
    expect(after).toMatchObject({
      permissionMode: 'safe', previousPermissionMode: 'allow-all', changedBy: 'user',
    })
    expect(after!.modeVersion).toBe(before!.modeVersion + 1)
    expect(harness.events).toHaveLength(1)
    expect(harness.events[0]).toMatchObject({
      type: 'permission_mode_changed', sessionId: harness.session.id,
      permissionMode: 'safe', modeVersion: after!.modeVersion,
      previousPermissionMode: 'allow-all', changedBy: 'user', changedAt: after!.changedAt,
    })
    expect(stored).toMatchObject({ permissionMode: 'safe', previousPermissionMode: 'allow-all' })
  })

  it('heals drift on a repeated safe command and then treats a matching command as a no-op', async () => {
    const harness = createHarness('safe')
    setPermissionMode(harness.session.id, 'allow-all', { changedBy: 'system' })
    const driftVersion = getPermissionModeDiagnostics(harness.session.id).modeVersion

    await harness.change('safe')
    const repaired = await harness.readback()
    expect(repaired).toMatchObject({ permissionMode: 'safe', changedBy: 'restore' })
    expect(repaired!.modeVersion).toBe(driftVersion + 1)
    expect(harness.agentModes).toEqual(['safe'])
    expect(harness.events).toHaveLength(1)

    await harness.change('safe')
    expect(await harness.readback()).toEqual(repaired)
    expect(harness.agentModes).toEqual(['safe'])
    expect(harness.events).toHaveLength(1)
  })

  it('recovers persisted safe state and its previous mode after the mode manager is reset', async () => {
    const harness = createHarness()
    await harness.change('safe')
    await harness.manager.flushSession(harness.session.id)
    const stored = loadSession(harness.session.workspace.rootPath, harness.session.id)!
    expect(stored.permissionMode).toBe('safe')
    cleanupModeState(harness.session.id)

    // The disk metadata is authoritative during lazy startup restoration.
    harness.session.permissionMode = stored.permissionMode!
    harness.session.previousPermissionMode = stored.previousPermissionMode
    const restored = await harness.readback()

    expect(restored).toMatchObject({
      permissionMode: 'safe', previousPermissionMode: 'allow-all', changedBy: 'restore',
    })
    expect(restored!.modeVersion).toBeGreaterThan(0)
    expect(await harness.readback()).toEqual(restored)
  })
})
