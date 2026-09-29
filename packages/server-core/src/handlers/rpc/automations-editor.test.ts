import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer, RequestContext } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'

let workspaceRoot = ''

mock.module('@craft-agent/shared/config', () => ({
  getWorkspaceByNameOrId: (workspaceId: string) =>
    workspaceId === 'ws1' ? { id: 'ws1', name: 'ws1', rootPath: workspaceRoot } : null,
}))

import { registerAutomationsHandlers } from './automations'

type Handler = (context: RequestContext, ...args: unknown[]) => unknown | Promise<unknown>

function createHarness() {
  const handlers = new Map<string, Handler>()
  const pushes: Array<{ channel: string; args: unknown[] }> = []
  const server = {
    handle(channel: string, handler: Handler) { handlers.set(channel, handler) },
    push(channel: string, _target: unknown, ...args: unknown[]) { pushes.push({ channel, args }) },
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  } as unknown as RpcServer
  const deps = {
    sessionManager: {},
    platform: {
      appRootPath: '/', resourcesPath: '/', isPackaged: false, appVersion: '0.0.0-test', isDebugMode: true,
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      imageProcessor: { getMetadata: async () => null, process: async () => Buffer.from('') },
    },
  } as unknown as HandlerDeps
  registerAutomationsHandlers(server, deps)
  return {
    invoke: async (channel: string, ...args: unknown[]) => {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`Missing handler: ${channel}`)
      return handler({ clientId: 'c', workspaceId: 'ws1', webContentsId: null } as RequestContext, ...args)
    },
    pushes,
  }
}

const configPath = () => join(workspaceRoot, 'automations.json')
const readConfig = () => JSON.parse(readFileSync(configPath(), 'utf-8'))

function writeInitial() {
  writeFileSync(configPath(), JSON.stringify({
    version: 2,
    craftSeedVersion: 1,
    automations: {
      SchedulerTick: [{
        id: 'aaa111', name: 'Утренний план', cron: '0 9 * * 1-5', timezone: 'Europe/Moscow',
        attributeAllowList: ['keep'], actions: [{ type: 'prompt', prompt: 'План дня' }],
      }],
      LabelAdd: [{ id: 'bbb222', name: 'Urgent', matcher: 'urgent', enabled: false, actions: [{ type: 'prompt', prompt: 'Разбери' }] }],
    },
  }, null, 2))
}

beforeEach(() => { workspaceRoot = mkdtempSync(join(tmpdir(), 'rox-automation-editor-')) })
afterEach(() => { rmSync(workspaceRoot, { recursive: true, force: true }) })

describe('automations editor RPC', () => {
  test('toggle writes enabled flag and pushes CHANGED', async () => {
    writeInitial()
    const { invoke, pushes } = createHarness()
    await invoke(RPC_CHANNELS.automations.SET_ENABLED, 'ws1', 'SchedulerTick', 0, false)
    expect(readConfig().automations.SchedulerTick[0].enabled).toBe(false)
    await invoke(RPC_CHANNELS.automations.SET_ENABLED, 'ws1', 'LabelAdd', 0, true)
    expect('enabled' in readConfig().automations.LabelAdd[0]).toBe(false)
    expect(pushes.filter((p) => p.channel === RPC_CHANNELS.automations.CHANGED)).toHaveLength(2)
  })

  test('update edits fields in place, preserving id and unknown keys', async () => {
    writeInitial()
    const { invoke } = createHarness()
    const result = await invoke(RPC_CHANNELS.automations.UPDATE, 'ws1', 'SchedulerTick', 0, {
      event: 'SchedulerTick',
      matcher: { name: 'Новый план', cron: '30 8 * * *', labels: [], actions: [{ type: 'prompt', prompt: 'Новый', model: 'm1' }] },
    })
    expect(result).toEqual({ id: 'aaa111', event: 'SchedulerTick', matcherIndex: 0 })
    const m = readConfig().automations.SchedulerTick[0]
    expect(m).toMatchObject({ id: 'aaa111', name: 'Новый план', cron: '30 8 * * *', timezone: 'Europe/Moscow', attributeAllowList: ['keep'] })
    expect(m.actions[0]).toEqual({ type: 'prompt', prompt: 'Новый', model: 'm1' })
    expect('labels' in m).toBe(false)
  })

  test('update moves a matcher across events and drops cron fields', async () => {
    writeInitial()
    const { invoke } = createHarness()
    const result = await invoke(RPC_CHANNELS.automations.UPDATE, 'ws1', 'SchedulerTick', 0, {
      event: 'LabelAdd', matcher: { matcher: 'bug' },
    }) as { event: string; matcherIndex: number }
    expect(result).toMatchObject({ id: 'aaa111', event: 'LabelAdd', matcherIndex: 1 })
    const cfg = readConfig()
    expect(cfg.automations.SchedulerTick).toBeUndefined()
    expect(cfg.automations.LabelAdd[1]).toMatchObject({ id: 'aaa111', matcher: 'bug' })
    expect(cfg.automations.LabelAdd[1].cron).toBeUndefined()
  })

  test('update rejects an invalid matcher without writing', async () => {
    writeInitial()
    const before = readFileSync(configPath(), 'utf-8')
    const { invoke } = createHarness()
    await expect(invoke(RPC_CHANNELS.automations.UPDATE, 'ws1', 'LabelAdd', 0, {
      event: 'LabelAdd', matcher: { actions: [{ type: 'prompt', prompt: '' }] },
    })).rejects.toThrow()
    expect(readFileSync(configPath(), 'utf-8')).toBe(before)
  })

  test('create appends to a missing config without seeding defaults', async () => {
    const { invoke } = createHarness()
    const result = await invoke(RPC_CHANNELS.automations.CREATE, 'ws1', {
      event: 'SchedulerTick',
      matcher: { name: 'Новая', cron: '0 9 * * *', enabled: false, actions: [{ type: 'prompt', prompt: 'Сделай' }] },
    }) as { id: string; matcherIndex: number }
    expect(result.id).toMatch(/^[0-9a-f]{6}$/)
    const cfg = readConfig()
    expect(Object.keys(cfg.automations)).toEqual(['SchedulerTick'])
    expect(cfg.automations.SchedulerTick[0]).toMatchObject({ id: result.id, name: 'Новая', enabled: false })
  })

  test('duplicate returns the new id', async () => {
    writeInitial()
    const { invoke } = createHarness()
    const { id } = await invoke(RPC_CHANNELS.automations.DUPLICATE, 'ws1', 'LabelAdd', 0) as { id: string }
    const list = readConfig().automations.LabelAdd
    expect(list).toHaveLength(2)
    expect(list[1].id).toBe(id)
    expect(id).not.toBe('bbb222')
  })
})

test('last-executed detailed mode reports the last run status', async () => {
  writeInitial()
  writeFileSync(join(workspaceRoot, 'automations-history.jsonl'), [
    JSON.stringify({ id: 'aaa111', ts: 1, ok: true }),
    JSON.stringify({ id: 'aaa111', ts: 2, ok: false, error: 'boom' }),
    JSON.stringify({ id: 'bbb222', ts: 3, ok: true }),
  ].join('\n') + '\n')
  const { invoke } = createHarness()
  expect(await invoke(RPC_CHANNELS.automations.GET_LAST_EXECUTED, 'ws1')).toEqual({ aaa111: 2, bbb222: 3 })
  expect(await invoke(RPC_CHANNELS.automations.GET_LAST_EXECUTED, 'ws1', true)).toEqual({
    aaa111: { ts: 2, ok: false },
    bbb222: { ts: 3, ok: true },
  })
})
