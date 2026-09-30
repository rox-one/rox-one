import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { createProject } from '@craft-agent/shared/projects'
import type { RequestContext, RpcHandlerOptions, RpcServer } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'

let workspaceRoot = ''
let projectSlug = ''

mock.module('@craft-agent/shared/config', () => ({
  getWorkspaceByNameOrId: (workspaceId: string) =>
    workspaceId === 'ws1' ? { id: 'ws1', name: 'ws1', rootPath: workspaceRoot } : null,
}))

import { registerProjectsHandlers } from './projects'

type Handler = (context: RequestContext, ...args: unknown[]) => unknown | Promise<unknown>

function createHarness() {
  const handlers = new Map<string, Handler>()
  const options = new Map<string, RpcHandlerOptions | undefined>()
  const server = {
    handle(channel: string, handler: Handler, handlerOptions?: RpcHandlerOptions) {
      handlers.set(channel, handler)
      options.set(channel, handlerOptions)
    },
    push() {},
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  } as unknown as RpcServer
  const deps = {
    sessionManager: {},
    platform: {
      appRootPath: '/', resourcesPath: '/', isPackaged: false, appVersion: 'test', isDebugMode: false,
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    },
  } as unknown as HandlerDeps
  registerProjectsHandlers(server, deps)
  return {
    options,
    invoke(channel: string, context: RequestContext, ...args: unknown[]) {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`Missing handler: ${channel}`)
      return handler(context, ...args)
    },
  }
}

const caller: RequestContext = { clientId: 'client', workspaceId: 'ws1', webContentsId: null }

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'rox-project-okr-rpc-'))
  projectSlug = createProject(workspaceRoot, { name: 'Quarterly Goals' }).slug
})
afterEach(() => rmSync(workspaceRoot, { recursive: true, force: true }))

describe('project OKR RPC handlers', () => {
  it('uses revisioned workspace storage and returns stale-write conflicts without overwriting', async () => {
    const slug = projectSlug
    const { invoke } = createHarness()
    const initial = await invoke(RPC_CHANNELS.projects.GET_OKR, caller, 'ws1', slug) as {
      projectId: string; revision: number; cycles: unknown[]
    }

    expect(initial.revision).toBe(0)
    const saved = await invoke(RPC_CHANNELS.projects.SAVE_OKR, caller, 'ws1', slug, 0, initial) as {
      projectId: string; revision: number; cycles: unknown[]
    }
    expect(saved.revision).toBe(1)

    const conflict = await invoke(RPC_CHANNELS.projects.SAVE_OKR, caller, 'ws1', slug, 0, initial)
    expect(conflict).toEqual({ conflict: true, expectedRevision: 0, actualRevision: 1 })
    expect(await invoke(RPC_CHANNELS.projects.GET_OKR, caller, 'ws1', slug)).toEqual(saved)
  })

  it('binds reads and writes to the caller workspace and declares native grants', async () => {
    const { invoke, options } = createHarness()
    expect(options.get(RPC_CHANNELS.projects.GET_OKR)?.nativeAction).toBe('read')
    expect(options.get(RPC_CHANNELS.projects.SAVE_OKR)?.nativeAction).toBe('write')

    await expect(invoke(
      RPC_CHANNELS.projects.GET_OKR,
      { ...caller, workspaceId: 'other-workspace' },
      'ws1',
      'quarterly-goals',
    )).rejects.toThrow('Workspace access denied')
    await expect(invoke(
      RPC_CHANNELS.projects.SAVE_OKR,
      { ...caller, workspaceId: 'other-workspace' },
      'ws1',
      'quarterly-goals',
      0,
      { cycles: [] },
    )).rejects.toThrow('Workspace access denied')
  })
})
