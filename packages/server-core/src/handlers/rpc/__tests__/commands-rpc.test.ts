import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { COMMAND_BUS_WORKBENCH_FLAG } from '@rox/shared/feature-flags'
import type { HandlerFn, RequestContext, RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'
import { InProcessEventBus } from '../../../commands/event-bus.ts'
import { createCommandRegistry } from '../../../commands/registry.ts'
import { registerCommandsHandlers, type CommandsHandlerRuntime } from '../commands.ts'

const roots: string[] = []
const shutdowns: Array<() => void> = []
let previousFlag: string | undefined

beforeEach(() => {
  previousFlag = process.env.CRAFT_FEATURE_COMMAND_BUS
  delete process.env.CRAFT_FEATURE_COMMAND_BUS
})

afterEach(() => {
  for (const dispose of shutdowns.splice(0)) dispose()
  if (previousFlag === undefined) delete process.env.CRAFT_FEATURE_COMMAND_BUS
  else process.env.CRAFT_FEATURE_COMMAND_BUS = previousFlag
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(runtime: CommandsHandlerRuntime = {}) {
  const root = mkdtempSync(join(tmpdir(), 'rox-commands-rpc-'))
  roots.push(root)
  const handlers = new Map<string, HandlerFn>()
  const pushes: Array<{ channel: string; target: unknown; args: unknown[] }> = []
  const server = {
    handle(channel: string, handler: HandlerFn) { handlers.set(channel, handler) },
    push(channel: string, target: unknown, ...args: unknown[]) { pushes.push({ channel, target, args }) },
    onShutdown(dispose: () => void) { shutdowns.push(dispose); return () => {} },
  } as unknown as RpcServer
  registerCommandsHandlers(server, {} as HandlerDeps, {
    workspaceFor: id => (id === 'ws' ? { id, rootPath: root } : null),
    registry: createCommandRegistry(),
    eventBus: new InProcessEventBus({ epoch: 'e' }),
    ...runtime,
  })
  const ctx: RequestContext = { clientId: 'c', workspaceId: 'ws', webContentsId: null }
  const execute = (ws: string, env: unknown, context = ctx) => Promise.resolve(handlers.get(RPC_CHANNELS.commands.EXECUTE)!(context, ws, env))
  const list = (ws: string) => Promise.resolve(handlers.get(RPC_CHANNELS.commands.LIST)!(ctx, ws))
  return { root, handlers, pushes, execute, list }
}

const ping = (commandId = 'p1') => ({ commandId, type: 'system.ping', payload: { nonce: 'n' }, issuedAt: '2026-10-08T00:00:00Z' })

describe('commands:* handlers', () => {
  it('registers exactly commands:execute and commands:list', () => {
    expect([...fixture().handlers.keys()].sort()).toEqual(['commands:execute', 'commands:list'])
  })

  it('is inert with the flag off: no store, no writes, no pushes', async () => {
    const f = fixture()
    expect(await f.execute('ws', ping())).toMatchObject({ commandId: 'p1', status: 'rejected', error: { code: 'UNAVAILABLE' } })
    expect(await f.list('ws')).toEqual({ enabled: false, commands: [] })
    expect(existsSync(join(f.root, '.rox'))).toBe(false)
    expect(f.pushes).toEqual([])
  })

  it('env override off wins over the workbench flag', async () => {
    process.env.CRAFT_FEATURE_COMMAND_BUS = '0'
    const f = fixture({ enabledWorkbenchFlags: new Set([COMMAND_BUS_WORKBENCH_FLAG]) })
    expect(await f.execute('ws', ping())).toMatchObject({ error: { code: 'UNAVAILABLE' } })
  })

  it('flag on: system.ping round-trips locally with receipt, stored event and a commands:event push', async () => {
    const f = fixture({ enabledWorkbenchFlags: () => new Set([COMMAND_BUS_WORKBENCH_FLAG]) })
    const receipt = await f.execute('ws', ping()) as { status: string; eventIds: string[] }
    expect(receipt).toMatchObject({ commandId: 'p1', status: 'applied', result: { pong: true, nonce: 'n', authority: 'local' } })
    expect(existsSync(join(f.root, '.rox', 'commands.sqlite'))).toBe(true)
    expect(f.pushes).toEqual([{
      channel: 'commands:event',
      target: { to: 'workspace', workspaceId: 'ws' },
      args: ['ws', { kind: 'realtime', frame: expect.objectContaining({ topic: 'user:local', type: 'system.pinged', seq: 1, eventId: receipt.eventIds[0], payload: { commandId: 'p1', nonce: 'n' } }) }],
    }])
    expect(await f.execute('ws', ping())).toMatchObject({ status: 'duplicate' })
    expect(f.pushes).toHaveLength(1)
  })

  it('flag on: capability discovery and workspace checks', async () => {
    const f = fixture({ enabledWorkbenchFlags: new Set([COMMAND_BUS_WORKBENCH_FLAG]) })
    const listed = await f.list('ws') as { enabled: boolean; commands: Array<{ type: string; available: boolean; reason?: string }> }
    expect(listed.enabled).toBe(true)
    expect(listed.commands.find(c => c.type === 'system.ping')).toMatchObject({ available: true })
    expect(listed.commands.find(c => c.type === 'tasks.update_status')).toMatchObject({ available: false, reason: 'flag_off' })
    await expect(f.execute('missing', ping())).rejects.toThrow(/Workspace not found/)
    const native: RequestContext = { clientId: 'n', workspaceId: 'ws', webContentsId: null, principal: { credentialId: 'cred' } as never }
    await expect(f.execute('other', ping(), native)).rejects.toThrow(/denied/)
  })

  it('workspace-authority commands without a workspace connection answer SERVER_REQUIRED', async () => {
    const f = fixture({ enabledWorkbenchFlags: new Set([COMMAND_BUS_WORKBENCH_FLAG]) })
    expect(await f.execute('ws', { ...ping('w1'), authorityHint: 'workspace' })).toMatchObject({ status: 'rejected', error: { code: 'SERVER_REQUIRED' } })
  })
})
