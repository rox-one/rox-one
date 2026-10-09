/**
 * Wave-3 c2.6 — `extensionHost:reload` handler.
 *
 * Proves: grants come only from the workspace permissions.json (caller-supplied
 * grants are ignored), a manifest identity/runtime mismatch rejects with
 * MANIFEST_MISMATCH, an unknown id rejects with EXTENSION_NOT_LOADED, and the
 * frozen `ExtensionHostReloadResult` shape carries swap provenance vs a
 * restartRequired reason.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
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

import type { ExtensionHostChild, ExtensionHostForkFn } from '../../extension-host-manager'

class FakeChild extends EventEmitter implements ExtensionHostChild {
  pid = 9301
  killed = false
  messages: unknown[] = []
  postMessage(message: unknown): void {
    this.messages.push(message)
  }
  kill(): void {
    this.killed = true
  }
}

/** In-process worker bridge whose importFn re-reads the entry bytes each time. */
function createFork(configDir: string, sandboxRootEnv: string): ExtensionHostForkFn {
  return () => {
    const child = new FakeChild()
    const toWorker = new EventEmitter()
    child.postMessage = (message: unknown) => {
      child.messages.push(message)
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
      } as never,
      configDir,
      sandboxRootEnv,
      importFn: async (url: string) => {
        const source = readFileSync(fileURLToPath(url.split('?')[0]!), 'utf8')
        return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
      },
    })
    return child
  }
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
const WORKSPACE = 'ws-reload'

let tmp: string
let sandboxRoot: string
let workspaceRoot: string
let entry: string
let handlers: Map<string, HandlerFn>
const previousSandboxRoot = process.env.CRAFT_EXTENSION_SANDBOX_ROOT
const previousConfigDir = process.env.ROX_CONFIG_DIR

function writePermissions(granted: string[], revoked: string[] = []): void {
  writeFileSync(
    join(workspaceRoot, 'permissions.json'),
    JSON.stringify({
      version: '2026-08-08',
      extensions: {
        'reload-ext': { granted, grantedAt: new Date().toISOString(), ...(revoked.length ? { revoked } : {}) },
      },
    }) + '\n',
  )
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'eh-reload-handler-'))
  sandboxRoot = join(tmp, 'sandbox')
  workspaceRoot = join(tmp, 'workspace')
  mkdirSync(sandboxRoot, { recursive: true })
  mkdirSync(workspaceRoot, { recursive: true })

  process.env.CRAFT_EXTENSION_SANDBOX_ROOT = sandboxRoot
  process.env.ROX_CONFIG_DIR = tmp

  const dir = join(sandboxRoot, 'reload-ext')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      id: 'reload-ext',
      name: 'Reload fixture',
      version: '1.0.0',
      runtime: 'craft-sandbox',
      permissions: ['network.request'],
      operations: { version: [] },
    }),
  )
  entry = join(dir, 'index.mjs')
  writeFileSync(entry, 'export function version() { return "v1" }\n')
  writeFileSync(join(dir, 'helper.mjs'), 'export const helper = 1\n')

  workspaceRoots.clear()
  workspaceRoots.set(WORKSPACE, workspaceRoot)
  resetExtensionHostManagers()

  const manager = new ExtensionHostManager({
    forkFn: createFork(tmp, sandboxRoot),
    configDir: tmp,
    sandboxRootEnv: sandboxRoot,
    workerPath: '/virtual/worker.cjs',
    broker: new CapabilityBroker(),
    getCredential: async () => null,
    messageTimeoutMs: 3000,
  })
  setExtensionHostManagerForTests(manager, WORKSPACE)

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

describe('extensionHost:reload', () => {
  it('swaps and takes grants from permissions.json, not the caller', async () => {
    const load = handlers.get(RPC_CHANNELS.extensionHost.LOAD)!
    const reload = handlers.get(RPC_CHANNELS.extensionHost.RELOAD)!
    const call = handlers.get(RPC_CHANNELS.extensionHost.CALL)!
    const mint = handlers.get(RPC_CHANNELS.extensionHost.MINT_CAPABILITY)!

    writePermissions(['network.request'])
    await load(CTX, { extensionId: 'reload-ext', entryPath: entry, workspaceId: WORKSPACE })
    writeFileSync(entry, 'export function version() { return "v2" }\n')

    const result = (await reload(CTX, {
      extensionId: 'reload-ext',
      entryPath: entry,
      workspaceId: WORKSPACE,
      // Caller-supplied grants must be ignored — permissions.json is authoritative.
      grantedPermissions: ['shell.execute', 'secrets.use:source_bearer::ws::x'],
    })) as { status: string; generation?: number; entryHash?: string; reason?: string }

    expect(result.status).toBe('running')
    expect(result.generation).toBe(1)
    expect(result.entryHash).toMatch(/^[0-9a-f]{64}$/)
    expect(await call(CTX, { extensionId: 'reload-ext', method: 'version', workspaceId: WORKSPACE })).toBe('v2')

    // File grants authorize; the caller's escalation attempt does not.
    const ok = (await mint(CTX, {
      extensionId: 'reload-ext',
      permission: 'network.request',
      workspaceId: WORKSPACE,
    })) as { token: string }
    expect(ok.token).toBeTruthy()
    await expect(
      mint(CTX, { extensionId: 'reload-ext', permission: 'shell.execute', workspaceId: WORKSPACE }),
    ).rejects.toThrow(/not granted/i)
  })

  it('returns a restartRequired reason when a non-entry file changed', async () => {
    const load = handlers.get(RPC_CHANNELS.extensionHost.LOAD)!
    const reload = handlers.get(RPC_CHANNELS.extensionHost.RELOAD)!
    writePermissions([])
    await load(CTX, { extensionId: 'reload-ext', entryPath: entry, workspaceId: WORKSPACE })

    writeFileSync(join(sandboxRoot, 'reload-ext', 'helper.mjs'), 'export const helper = 2\n')
    const result = (await reload(CTX, {
      extensionId: 'reload-ext',
      entryPath: entry,
      workspaceId: WORKSPACE,
    })) as { status: string; reason?: string; entryHash?: string }

    expect(result.status).toBe('running')
    expect(result.reason).toBe('dependency-changed')
    expect(result.entryHash).toBeUndefined()
  })

  it('rejects a manifest identity/runtime mismatch with MANIFEST_MISMATCH', async () => {
    const load = handlers.get(RPC_CHANNELS.extensionHost.LOAD)!
    const reload = handlers.get(RPC_CHANNELS.extensionHost.RELOAD)!
    writePermissions([])
    await load(CTX, { extensionId: 'reload-ext', entryPath: entry, workspaceId: WORKSPACE })

    writeFileSync(
      join(sandboxRoot, 'reload-ext', 'manifest.json'),
      JSON.stringify({
        id: 'reload-ext',
        name: 'Reload fixture',
        version: '2.0.0',
        runtime: 'siyuan-plugin',
        permissions: [],
        operations: {},
      }),
    )
    await expect(
      reload(CTX, { extensionId: 'reload-ext', entryPath: entry, workspaceId: WORKSPACE }),
    ).rejects.toThrow(/MANIFEST_MISMATCH/)
  })

  it('rejects a not-loaded id with EXTENSION_NOT_LOADED', async () => {
    const reload = handlers.get(RPC_CHANNELS.extensionHost.RELOAD)!
    writePermissions([])
    await expect(
      reload(CTX, { extensionId: 'reload-ext', entryPath: entry, workspaceId: WORKSPACE }),
    ).rejects.toThrow(/EXTENSION_NOT_LOADED/)
  })
})