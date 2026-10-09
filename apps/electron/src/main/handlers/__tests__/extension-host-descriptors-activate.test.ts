/**
 * Wave-3 extensionHost descriptor/activate handlers.
 *
 * Proves: `listDescriptors` returns descriptors + plan + loaded WITHOUT forking
 * the host; `activate` loads exactly one extension (one fork) with namespaced
 * commands; and the typed refusals (EXTENSION_DISABLED | DESCRIPTOR_INVALID |
 * EXTENSION_NOT_EXECUTABLE | HOST_UNAVAILABLE) fire before any load.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RpcServer } from '@rox/server-core/transport'
import { RPC_CHANNELS } from '@rox/shared/protocol'

const workspaceRoots = new Map<string, string>()
const actualConfigExports = await import('@rox/shared/config')

mock.module('@rox/shared/config', () => ({
  ...actualConfigExports,
  getWorkspaceByNameOrId: (id: string) => {
    const root = workspaceRoots.get(id)
    return root ? { id, name: id, rootPath: root } : null
  },
}))

const { registerExtensionHostHandlers } = await import('../extension-host')
const {
  ExtensionHostManager,
  resetExtensionHostManagers,
  setExtensionHostManagerForTests,
} = await import('../../extension-host-manager')
const { CapabilityBroker } = await import('../../extension-host/capability-broker')
const { startWorker } = await import('../../extension-host/worker')
const { getExtensionStateStore } = await import('@rox/shared/extensions')

import type { ExtensionHostChild, ExtensionHostForkFn } from '../../extension-host-manager'

class FakeChild extends EventEmitter implements ExtensionHostChild {
  pid = 9001
  killed = false
  postMessage(message: unknown): void {
    this.messages.push(message)
  }
  messages: unknown[] = []
  kill(): void {
    this.killed = true
  }
}

/** Fork spy + in-process worker bridge (mirrors extension-host-load-grants). */
function createSpyFork(configDir: string): { forkFn: ExtensionHostForkFn; count: () => number } {
  let forks = 0
  const forkFn: ExtensionHostForkFn = () => {
    forks += 1
    const child = new FakeChild()
    const toWorker = new EventEmitter()
    const originalPost = child.postMessage.bind(child)
    child.postMessage = (message: unknown) => {
      originalPost(message)
      queueMicrotask(() => toWorker.emit('message', message))
    }
    startWorker({
      port: {
        postMessage: (msg: unknown) => {
          queueMicrotask(() => child.emit('message', msg))
        },
        on: (event: string, handler: (data: unknown) => void) => {
          if (event === 'message') toWorker.on('message', handler)
        },
        addListener: (event: string, handler: (data: unknown) => void) => {
          if (event === 'message') toWorker.on('message', handler)
        },
        removeListener: (event: string, handler: (data: unknown) => void) => {
          if (event === 'message') toWorker.off('message', handler)
        },
        once: (event: string, handler: (data: unknown) => void) => {
          if (event === 'message') toWorker.once('message', handler)
        },
      } as never,
      configDir,
      importFn: async (url: string) => import(url),
    })
    return child
  }
  return { forkFn, count: () => forks }
}

type HandlerFn = (...args: unknown[]) => unknown

function makeServer(): { server: RpcServer; handlers: Map<string, HandlerFn> } {
  const handlers = new Map<string, HandlerFn>()
  const server = {
    handle: (channel: string, fn: HandlerFn) => {
      handlers.set(channel, fn)
    },
  } as unknown as RpcServer
  return { server, handlers }
}

const CTX = {} as never

const ENTRY = 'export const commands = [\n' +
  "  { id: 'open', title: 'Open' },\n" +
  "  { id: 'close', title: 'Close', when: 'editing' },\n" +
  ']\n'

let tmp: string
let sandboxRoot: string
let configDir: string
let workspaceRoot: string
let handlers: Map<string, HandlerFn>
let forkCount: () => number
const previousSandboxRoot = process.env.CRAFT_EXTENSION_SANDBOX_ROOT
const previousConfigDir = process.env.ROX_CONFIG_DIR

function writePackage(name: string, manifest: unknown, entry = ENTRY): void {
  const dir = join(sandboxRoot, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))
  if (entry) writeFileSync(join(dir, 'index.mjs'), entry)
}

const manifest = (id: string, runtime = 'craft-sandbox') => ({
  id,
  name: id,
  version: '1.0.0',
  runtime,
  permissions: [],
})

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'eh-desc-act-'))
  sandboxRoot = join(tmp, 'sandbox')
  configDir = join(tmp, 'config')
  workspaceRoot = join(tmp, 'workspace')
  mkdirSync(sandboxRoot, { recursive: true })
  mkdirSync(configDir, { recursive: true })
  mkdirSync(workspaceRoot, { recursive: true })

  process.env.CRAFT_EXTENSION_SANDBOX_ROOT = sandboxRoot
  process.env.ROX_CONFIG_DIR = configDir

  writePackage('ok-ext', manifest('ok-ext'))
  writePackage('disabled-ext', manifest('disabled-ext'))
  writePackage('nonhost-ext', manifest('nonhost-ext', 'siyuan-plugin'))
  writePackage('bad-ext', { id: 'bad-ext', name: 'bad', version: '1', runtime: 'nope', permissions: [] })

  getExtensionStateStore(configDir).setEnabled('disabled-ext', false)

  workspaceRoots.clear()
  workspaceRoots.set('ws-act', workspaceRoot)
  resetExtensionHostManagers()

  const spy = createSpyFork(configDir)
  forkCount = spy.count
  const manager = new ExtensionHostManager({
    forkFn: spy.forkFn,
    configDir,
    workerPath: '/virtual/worker.cjs',
    broker: new CapabilityBroker(),
    getCredential: async () => null,
    messageTimeoutMs: 3000,
  })
  setExtensionHostManagerForTests(manager, 'ws-act')

  const rec = makeServer()
  registerExtensionHostHandlers(rec.server, {} as never)
  handlers = rec.handlers
})

afterEach(() => {
  resetExtensionHostManagers()
  if (previousSandboxRoot === undefined) delete process.env.CRAFT_EXTENSION_SANDBOX_ROOT
  else process.env.CRAFT_EXTENSION_SANDBOX_ROOT = previousSandboxRoot
  if (previousConfigDir === undefined) delete process.env.ROX_CONFIG_DIR
  else process.env.ROX_CONFIG_DIR = previousConfigDir
  workspaceRoots.clear()
  rmSync(tmp, { recursive: true, force: true })
})

describe('extensionHost:listDescriptors', () => {
  it('returns descriptors + plan + loaded without forking the host', async () => {
    const list = handlers.get(RPC_CHANNELS.extensionHost.LIST_DESCRIPTORS)!
    const result = (await list(CTX, { workspaceId: 'ws-act' })) as {
      descriptors: Array<{ extensionId: string; entryPath: string; active: boolean }>
      plan: Array<{ extensionId: string; reason: string }>
      loaded: string[]
    }

    expect(forkCount()).toBe(0)
    expect(result.loaded).toEqual([])

    const ids = result.descriptors.map((d) => d.extensionId)
    expect(ids).toContain('ok-ext')
    expect(ids).toContain('nonhost-ext')
    // Invalid manifest packages are not handed out as loadable descriptors.
    expect(ids).not.toContain('bad-ext')

    const reasonFor = (id: string) => result.plan.find((p) => p.extensionId === id)?.reason
    expect(reasonFor('ok-ext')).toBe('activation-all')
    expect(reasonFor('disabled-ext')).toBe('disabled')
    expect(reasonFor('nonhost-ext')).toBe('not-host-executable')
    expect(reasonFor('bad-ext')).toBe('descriptor-invalid')
    expect(result.descriptors.every((d) => d.active === false)).toBe(true)
  })
})

describe('extensionHost:activate', () => {
  it('loads exactly one extension (single fork) and returns namespaced commands', async () => {
    const activate = handlers.get(RPC_CHANNELS.extensionHost.ACTIVATE)!
    const result = (await activate(CTX, {
      extensionId: 'ok-ext',
      workspaceId: 'ws-act',
    })) as { commands: Array<{ id: string; title: string }> }

    expect(forkCount()).toBe(1)
    expect(result.commands.map((c) => c.id)).toEqual([
      'extension:ok-ext:open',
      'extension:ok-ext:close',
    ])
    expect(result.commands.map((c) => c.title)).toEqual(['Open', 'Close'])

    // Idempotent: a second activate does not fork again.
    await activate(CTX, { extensionId: 'ok-ext', workspaceId: 'ws-act' })
    expect(forkCount()).toBe(1)
  })

  it('refuses a disabled extension (EXTENSION_DISABLED)', async () => {
    const activate = handlers.get(RPC_CHANNELS.extensionHost.ACTIVATE)!
    await expect(
      activate(CTX, { extensionId: 'disabled-ext', workspaceId: 'ws-act' }),
    ).rejects.toThrow(/EXTENSION_DISABLED/)
    expect(forkCount()).toBe(0)
  })

  it('refuses an invalid/unknown descriptor (DESCRIPTOR_INVALID)', async () => {
    const activate = handlers.get(RPC_CHANNELS.extensionHost.ACTIVATE)!
    await expect(
      activate(CTX, { extensionId: 'bad-ext', workspaceId: 'ws-act' }),
    ).rejects.toThrow(/DESCRIPTOR_INVALID/)
    await expect(
      activate(CTX, { extensionId: 'ghost', workspaceId: 'ws-act' }),
    ).rejects.toThrow(/DESCRIPTOR_INVALID/)
    expect(forkCount()).toBe(0)
  })

  it('refuses a non-sandbox runtime (EXTENSION_NOT_EXECUTABLE)', async () => {
    const activate = handlers.get(RPC_CHANNELS.extensionHost.ACTIVATE)!
    await expect(
      activate(CTX, { extensionId: 'nonhost-ext', workspaceId: 'ws-act' }),
    ).rejects.toThrow(/EXTENSION_NOT_EXECUTABLE/)
    expect(forkCount()).toBe(0)
  })

  it('refuses when the host cannot start (HOST_UNAVAILABLE)', async () => {
    const broken = new ExtensionHostManager({
      forkFn: () => {
        throw new Error('no utilityProcess available')
      },
      configDir,
      workerPath: '/virtual/worker.cjs',
      broker: new CapabilityBroker(),
      getCredential: async () => null,
    })
    setExtensionHostManagerForTests(broken, 'ws-broken')

    const activate = handlers.get(RPC_CHANNELS.extensionHost.ACTIVATE)!
    await expect(
      activate(CTX, { extensionId: 'ok-ext', workspaceId: 'ws-broken' }),
    ).rejects.toThrow(/HOST_UNAVAILABLE/)
  })
})