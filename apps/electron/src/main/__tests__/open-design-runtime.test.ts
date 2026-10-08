import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'fs/promises'
import { createServer } from 'net'
import { join } from 'path'
import { tmpdir } from 'os'
import type { IpcMainInvokeEvent, WebContents } from 'electron'

import {
  OpenDesignRuntimeManager,
  buildOpenDesignBootstrapCommand,
  buildToolsDevBuildCommand,
  buildToolsDevStartCommand,
  isTrustedOpenDesignIpcEvent,
  registerOpenDesignIpcHandlers,
  requestOpenDesignSidecar,
  resolveConfiguredOpenDesignRoot,
  resolveOpenDesignIpcPath,
  sanitizeOpenDesignEnv,
  type BufferedCommandRequest,
} from '../open-design-runtime'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
})

async function makeTempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rox-open-design-runtime-test-'))
  tempRoots.push(dir)
  return dir
}

async function makeOpenDesignCheckout(): Promise<string> {
  const root = await makeTempRoot()
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'open-design' }))
  await mkdir(join(root, 'tools/dev'), { recursive: true })
  await writeFile(join(root, 'tools/dev/package.json'), JSON.stringify({ name: '@open-design/tools-dev' }))
  return root
}

describe('Open Design root and command validation', () => {
  it('reports disabled when ROX_OPEN_DESIGN_ROOT is absent', async () => {
    const result = await resolveConfiguredOpenDesignRoot({ env: {} })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('not-configured')
  })

  it('rejects relative or mismatched explicit roots', async () => {
    const relative = await resolveConfiguredOpenDesignRoot({ env: { ROX_OPEN_DESIGN_ROOT: 'open-design' } })
    expect(relative.ok).toBe(false)
    expect(relative.reason).toBe('invalid-root')

    const root = await makeTempRoot()
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'not-open-design' }))
    await mkdir(join(root, 'tools/dev'), { recursive: true })
    await writeFile(join(root, 'tools/dev/package.json'), JSON.stringify({ name: '@open-design/tools-dev' }))
    const mismatch = await resolveConfiguredOpenDesignRoot({ env: { ROX_OPEN_DESIGN_ROOT: root } })
    expect(mismatch.ok).toBe(false)
    expect(mismatch.reason).toBe('invalid-root')
  })

  it('accepts only a real Open Design checkout with tools-dev', async () => {
    const root = await makeOpenDesignCheckout()
    const result = await resolveConfiguredOpenDesignRoot({ env: { ROX_OPEN_DESIGN_ROOT: root } })
    expect(result).toEqual({ ok: true, root: await realpath(root) })
  })

  it('builds shell-free Open Design lifecycle commands with isolated npm config', () => {
    const env = sanitizeOpenDesignEnv({
      ALL_PROXY: 'http://proxy.invalid',
      AWS_ACCESS_KEY_ID: 'secret',
      DATABASE_URL: 'postgres://secret.invalid/db',
      ELECTRON_RUN_AS_NODE: '1',
      HOME: '/Users/tester',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      NODE_AUTH_TOKEN: 'secret',
      NODE_OPTIONS: '--require ./hook',
      NODE_PATH: '/tmp/node',
      NPM_CONFIG_REGISTRY: 'https://registry.invalid',
      NPM_CONFIG_USERCONFIG: '/Users/tester/.npmrc',
      NPM_TOKEN: 'secret',
      OD_DATA_DIR: '/repo/open-design/.od',
      OD_SIDECAR_IPC_BASE: '/tmp/hostile-ipc',
      PATH: '/usr/bin',
      PNPM_CONFIG_STORE_DIR: '/tmp/store',
      ROX_OPEN_DESIGN_ROOT: '/repo/open-design',
      ROX_SECRET: 'secret',
      TMPDIR: '/tmp',
    })
    expect(env).toEqual({
      HOME: '/Users/tester',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      PATH: '/usr/bin',
      TMPDIR: '/tmp',
    })

    const shared = {
      npmUserConfigPath: '/tmp/rox-od/open-design-empty.npmrc',
      parentEnv: {
        AWS_SECRET_ACCESS_KEY: 'secret',
        HOME: '/Users/tester',
        NODE_AUTH_TOKEN: 'secret',
        NPM_CONFIG_USERCONFIG: '/Users/tester/.npmrc',
        NPM_TOKEN: 'secret',
        OD_DATA_DIR: '/repo/open-design/.od',
        PATH: '/usr/bin',
        ROX_OPEN_DESIGN_ROOT: '/repo/open-design',
      },
      root: '/repo/open-design',
    }

    const bootstrap = buildOpenDesignBootstrapCommand(shared)
    expect(bootstrap.command).toBe('mise')
    expect(bootstrap.args).toEqual(['exec', '--', 'corepack', 'pnpm', 'install', '--frozen-lockfile'])
    expect(bootstrap.cwd).toBe('/repo/open-design')
    expect(bootstrap.env.NPM_TOKEN).toBeUndefined()
    expect(bootstrap.env.NPM_CONFIG_USERCONFIG).toBe('/tmp/rox-od/open-design-empty.npmrc')
    expect(bootstrap.env.npm_config_userconfig).toBe('/tmp/rox-od/open-design-empty.npmrc')
    expect(bootstrap.env.npm_config_registry).toBe('https://registry.npmjs.org/')
    expect(bootstrap.env.COREPACK_ENABLE_PROJECT_SPEC).toBe('1')

    const build = buildToolsDevBuildCommand(shared)
    expect(build.command).toBe('mise')
    expect(build.args).toEqual(['exec', '--', 'corepack', 'pnpm', '--filter', '@open-design/tools-dev', 'build'])
    expect(build.cwd).toBe('/repo/open-design')

    const command = buildToolsDevStartCommand({
      dataRoot: '/tmp/rox-od/data',
      ipcBase: '/tmp/rox-od/ipc',
      namespace: 'rox-abc',
      ...shared,
      runtimeRoot: '/tmp/rox-od/sidecar',
    })
    expect(command.command).toBe('mise')
    expect(command.args).toEqual([
      'exec',
      '--',
      'corepack',
      'pnpm',
      'tools-dev',
      'start',
      'web',
      '--namespace',
      'rox-abc',
      '--tools-dev-root',
      '/tmp/rox-od/sidecar',
      '--no-env-file',
      '--json',
    ])
    expect(command.args).not.toContain('--daemon-port')
    expect(command.args).not.toContain('--web-port')
    expect(command.cwd).toBe('/repo/open-design')
    expect(command.env.AWS_SECRET_ACCESS_KEY).toBeUndefined()
    expect(command.env.NODE_OPTIONS).toBeUndefined()
    expect(command.env.NPM_TOKEN).toBeUndefined()
    expect(command.env.NPM_CONFIG_USERCONFIG).toBe('/tmp/rox-od/open-design-empty.npmrc')
    expect(command.env.npm_config_userconfig).toBe('/tmp/rox-od/open-design-empty.npmrc')
    expect(command.env.npm_config_registry).toBe('https://registry.npmjs.org/')
    expect(command.env.COREPACK_ENABLE_PROJECT_SPEC).toBe('1')
    expect(command.env.OD_DATA_DIR).toBe('/tmp/rox-od/data')
    expect(command.env.OD_SIDECAR_BASE).toBe('/tmp/rox-od/sidecar')
    expect(command.env.OD_SIDECAR_IPC_BASE).toBe('/tmp/rox-od/ipc')
    expect(command.env.ROX_OPEN_DESIGN_ROOT).toBeUndefined()
    expect(command.env.HOME).toBe('/Users/tester')
    expect(command.env.PATH).toBe('/usr/bin')
  })

  it('resolves only documented daemon/web IPC paths', () => {
    expect(resolveOpenDesignIpcPath({ app: 'daemon', ipcBase: '/tmp/od-ipc', namespace: 'rox-ns' }))
      .toBe('/tmp/od-ipc/rox-ns/daemon.sock')
    expect(resolveOpenDesignIpcPath({ app: 'web', ipcBase: 'tmp/od-ipc', namespace: 'rox-ns' }))
      .toBe(`${process.cwd()}/tmp/od-ipc/rox-ns/web.sock`)
    expect(resolveOpenDesignIpcPath({ app: 'web', ipcBase: '/tmp/od-ipc', namespace: 'rox-ns', platform: 'win32' }))
      .toBe('\\\\.\\pipe\\open-design-rox-ns-web')
  })
})

async function withIpcServer(
  handler: (socket: import('net').Socket) => void,
  body: (socketPath: string) => Promise<void>,
): Promise<void> {
  const root = await makeTempRoot()
  const socketPath = join(root, 'ipc.sock')
  const server = createServer(handler)
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(socketPath, () => {
      server.off('error', rejectListen)
      resolveListen()
    })
  })
  try {
    await body(socketPath)
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
  }
}

describe('Open Design JSON IPC client', () => {
  it('returns ok result frames', async () => {
    await withIpcServer((socket) => {
      socket.on('data', () => {
        socket.end(`${JSON.stringify({ ok: true, result: { state: 'running', url: 'http://127.0.0.1:3000/' } })}\n`)
      })
    }, async (socketPath) => {
      const result = await requestOpenDesignSidecar(socketPath, { type: 'status' })
      expect(result).toEqual({ state: 'running', url: 'http://127.0.0.1:3000/' })
    })
  })

  it('rejects error, timeout, invalid, and oversized frames', async () => {
    await withIpcServer((socket) => {
      socket.on('data', () => socket.end(`${JSON.stringify({ ok: false, error: { message: 'denied' } })}\n`))
    }, async (socketPath) => {
      await expect(requestOpenDesignSidecar(socketPath, { type: 'status' })).rejects.toThrow('denied')
    })

    await withIpcServer(() => {}, async (socketPath) => {
      await expect(requestOpenDesignSidecar(socketPath, { type: 'status' }, { timeoutMs: 10 })).rejects.toThrow('timed out')
    })

    await withIpcServer((socket) => {
      socket.on('data', () => socket.end('not-json\n'))
    }, async (socketPath) => {
      await expect(requestOpenDesignSidecar(socketPath, { type: 'status' })).rejects.toThrow('not valid JSON')
    })

    await withIpcServer((socket) => {
      socket.on('data', () => socket.end(`${JSON.stringify({ ok: true, result: { data: 'x'.repeat(64) } })}\n`))
    }, async (socketPath) => {
      await expect(requestOpenDesignSidecar(socketPath, { type: 'status' }, { maxFrameBytes: 32 }))
        .rejects.toThrow('frame limit')
    })
  })
})

function makeManager(overrides: {
  env?: NodeJS.ProcessEnv
  mkdir?: typeof mkdir
  now?: () => number
  requestSidecar?: typeof requestOpenDesignSidecar
  runCommand?: (request: BufferedCommandRequest) => Promise<{ stdout: string; stderr: string }>
  windowController?: { close(): void; hasWindow(): boolean; open(url: string): Promise<void> | void }
  writeFile?: typeof writeFile
} = {}) {
  const env = overrides.env ?? { PATH: '/usr/bin', ROX_OPEN_DESIGN_ROOT: '/od' }
  const readPackageFile = (async (path: unknown) => {
    const text = String(path).includes('/tools/dev/package.json')
      ? JSON.stringify({ name: '@open-design/tools-dev' })
      : JSON.stringify({ name: 'open-design' })
    return text
  }) as unknown as typeof import('fs/promises').readFile
  const resolveRealpath = (async () => '/od') as unknown as typeof import('fs/promises').realpath
  const defaultRequestSidecar = (async <T,>(socketPath: string, payload: unknown): Promise<T> => {
    if ((payload as { type?: string }).type === 'shutdown') {
      return { accepted: true } as T
    }
    return {
      state: 'running',
      url: socketPath.includes('web.sock') ? 'http://127.0.0.1:3456/' : 'http://127.0.0.1:3455/',
    } as T
  }) as typeof requestOpenDesignSidecar
  return new OpenDesignRuntimeManager({
    chmod: async () => undefined,
    env,
    mkdir: overrides.mkdir ?? (async () => undefined),
    now: overrides.now,
    readFile: readPackageFile,
    realpath: resolveRealpath,
    requestSidecar: overrides.requestSidecar ?? defaultRequestSidecar,
    runCommand: overrides.runCommand ?? (async () => ({ stdout: '{}', stderr: '' })),
    userDataDir: '/tmp/rox-open-design',
    windowController: overrides.windowController,
    writeFile: overrides.writeFile ?? (async () => undefined),
  })
}

function commandNamespace(command: BufferedCommandRequest): string {
  const index = command.args.indexOf('--namespace')
  return command.args[index + 1]!
}

function startCommand(commands: BufferedCommandRequest[], index = 0): BufferedCommandRequest {
  const starts = commands.filter((command) => command.args.includes('start'))
  return starts[index]!
}

function socketTarget(socketPath: string): { app: 'daemon' | 'web'; namespace: string } {
  const parts = socketPath.split('/')
  const file = parts.at(-1)
  const app = file === 'web.sock' ? 'web' : 'daemon'
  return { app, namespace: parts.at(-2)! }
}

describe('Open Design runtime lifecycle', () => {
  it('deduplicates concurrent starts and opens the isolated window', async () => {
    const commands: BufferedCommandRequest[] = []
    const mkdirs: string[] = []
    const opened: string[] = []
    const manager = makeManager({
      mkdir: async (dir) => {
        mkdirs.push(String(dir))
        return undefined
      },
      runCommand: async (request) => {
        commands.push(request)
        await new Promise((resolveWait) => setTimeout(resolveWait, 10))
        return { stdout: '{}', stderr: '' }
      },
      windowController: {
        close() {},
        hasWindow: () => opened.length > 0,
        open: (url) => {
          opened.push(url)
        },
      },
    })

    const [first, second] = await Promise.all([manager.open(), manager.open()])
    expect(first.state).toBe('running')
    expect(second.state).toBe('running')
    expect(commands).toHaveLength(2)
    expect(commands[0]!.args).toEqual(['exec', '--', 'corepack', 'pnpm', 'install', '--frozen-lockfile'])
    expect(startCommand(commands).args.some((arg) => arg.startsWith('rox-'))).toBe(true)
    expect(startCommand(commands).env.OD_DATA_DIR).toBe('/tmp/rox-open-design/data')
    expect(startCommand(commands).args).toContain('--no-env-file')
    expect(mkdirs).toEqual([
      '/tmp/rox-open-design',
      '/tmp/rox-open-design/data',
      '/tmp/rox-open-design/sidecar',
      '/tmp/rox-open-design/ipc',
    ])
    expect(opened).toEqual(['http://127.0.0.1:3456/', 'http://127.0.0.1:3456/'])
  })

  it('stops web before daemon through IPC and never asks for process scans', async () => {
    const calls: string[] = []
    const manager = makeManager({
      requestSidecar: (async <T,>(socketPath: string, payload: unknown): Promise<T> => {
        const app = socketPath.includes('web.sock') ? 'web' : 'daemon'
        calls.push(`${(payload as { type?: string }).type}:${app}`)
        if ((payload as { type?: string }).type === 'shutdown') return { accepted: true } as T
        if (calls.filter((call) => call === `status:${app}`).length > 1) throw new Error('closed')
        return { state: 'running', url: app === 'web' ? 'http://127.0.0.1:3456/' : 'http://127.0.0.1:3455/' } as T
      }) as typeof requestOpenDesignSidecar,
      windowController: {
        close: () => calls.push('close:window'),
        hasWindow: () => false,
        open: () => undefined,
      },
    })
    await manager.open()
    calls.length = 0
    const status = await manager.stop()

    expect(status.state).toBe('idle')
    expect(calls.slice(0, 5)).toEqual([
      'close:window',
      'shutdown:web',
      'status:web',
      'status:web',
      'shutdown:daemon',
    ])
    expect(calls).toContain('status:daemon')
  })

  it('shuts down a failed readiness namespace before retrying with a new namespace', async () => {
    const commands: BufferedCommandRequest[] = []
    const shutdowns: string[] = []
    const closedTargets = new Set<string>()
    const opened: string[] = []
    const manager = makeManager({
      requestSidecar: (async <T,>(socketPath: string, payload: unknown): Promise<T> => {
        const { app, namespace } = socketTarget(socketPath)
        const type = (payload as { type?: string }).type
        const target = `${namespace}:${app}`
        if (type === 'shutdown') {
          shutdowns.push(`shutdown:${target}`)
          closedTargets.add(target)
          return { accepted: true } as T
        }
        if (closedTargets.has(target)) throw new Error('closed')
        if (commands.filter((command) => command.args.includes('start')).length === 1) {
          return {
            state: 'running',
            url: app === 'web' ? 'http://localhost:3456/' : 'http://127.0.0.1:3455/',
          } as T
        }
        return {
          state: 'running',
          url: app === 'web' ? 'http://127.0.0.1:4567/' : 'http://127.0.0.1:4566/',
        } as T
      }) as typeof requestOpenDesignSidecar,
      runCommand: async (request) => {
        commands.push(request)
        return { stdout: '{}', stderr: '' }
      },
      windowController: {
        close() {},
        hasWindow: () => opened.length > 0,
        open: (url) => {
          opened.push(url)
        },
      },
    })

    const first = await manager.open()
    const failedNamespace = commandNamespace(startCommand(commands))
    expect(first.state).toBe('error')
    expect(first.reason).toBe('invalid-url')
    expect(shutdowns).toEqual([
      `shutdown:${failedNamespace}:web`,
      `shutdown:${failedNamespace}:daemon`,
    ])

    const second = await manager.open()
    expect(second.state).toBe('running')
    expect(commands).toHaveLength(3)
    expect(commandNamespace(startCommand(commands, 1))).not.toBe(failedNamespace)
    expect(opened).toEqual(['http://127.0.0.1:4567/'])
  })

  it('reports stop timeout as retryable error and clears only after sidecars are unreachable', async () => {
    const commands: BufferedCommandRequest[] = []
    const calls: string[] = []
    let fastTimeout = false
    let stopped = false
    let clock = 0
    const manager = makeManager({
      now: () => fastTimeout ? (clock += 6000) : clock,
      requestSidecar: (async <T,>(socketPath: string, payload: unknown): Promise<T> => {
        const { app, namespace } = socketTarget(socketPath)
        const type = (payload as { type?: string }).type
        calls.push(`${type}:${namespace}:${app}`)
        if (type === 'shutdown') return { accepted: true } as T
        if (stopped) throw new Error('closed')
        return { state: 'running', url: app === 'web' ? 'http://127.0.0.1:3456/' : 'http://127.0.0.1:3455/' } as T
      }) as typeof requestOpenDesignSidecar,
      runCommand: async (request) => {
        commands.push(request)
        return { stdout: '{}', stderr: '' }
      },
      windowController: { close() {}, hasWindow: () => false, open: () => undefined },
    })

    await manager.open()
    calls.length = 0
    const namespace = commandNamespace(startCommand(commands))
    fastTimeout = true
    const failedStop = await manager.stop()
    expect(failedStop.state).toBe('error')
    expect(failedStop.reason).toBe('stop-failed')
    expect(calls).toEqual([
      `shutdown:${namespace}:web`,
      `shutdown:${namespace}:daemon`,
    ])

    calls.length = 0
    fastTimeout = false
    stopped = true
    const retryStop = await manager.stop()
    expect(retryStop.state).toBe('idle')
    expect(calls).toEqual([
      `shutdown:${namespace}:web`,
      `status:${namespace}:web`,
      `shutdown:${namespace}:daemon`,
      `status:${namespace}:daemon`,
    ])
  })

  it('cleans a window-load failure namespace before retrying with a new namespace', async () => {
    const commands: BufferedCommandRequest[] = []
    const shutdowns: string[] = []
    const closedTargets = new Set<string>()
    const opened: string[] = []
    let openAttempts = 0
    const manager = makeManager({
      requestSidecar: (async <T,>(socketPath: string, payload: unknown): Promise<T> => {
        const { app, namespace } = socketTarget(socketPath)
        const type = (payload as { type?: string }).type
        const target = `${namespace}:${app}`
        if (type === 'shutdown') {
          shutdowns.push(`shutdown:${target}`)
          closedTargets.add(target)
          return { accepted: true } as T
        }
        if (closedTargets.has(target)) throw new Error('closed')
        return {
          state: 'running',
          url: app === 'web' ? 'http://127.0.0.1:3456/' : 'http://127.0.0.1:3455/',
        } as T
      }) as typeof requestOpenDesignSidecar,
      runCommand: async (request) => {
        commands.push(request)
        return { stdout: '{}', stderr: '' }
      },
      windowController: {
        close() {},
        hasWindow: () => opened.length > 0,
        open: async (url) => {
          openAttempts += 1
          if (openAttempts === 1) throw new Error('loadURL failed')
          opened.push(url)
        },
      },
    })

    const first = await manager.open()
    const poisonedNamespace = commandNamespace(startCommand(commands))
    expect(first.state).toBe('error')
    expect(commands).toHaveLength(2)

    const second = await manager.open()
    expect(second.state).toBe('running')
    expect(commands).toHaveLength(3)
    expect(commandNamespace(startCommand(commands, 1))).not.toBe(poisonedNamespace)
    expect(shutdowns).toEqual([
      `shutdown:${poisonedNamespace}:web`,
      `shutdown:${poisonedNamespace}:daemon`,
    ])
    expect(opened).toEqual(['http://127.0.0.1:3456/'])
  })

  it('bootstraps once, builds a missing tools-dev command, then retries start once', async () => {
    const commands: BufferedCommandRequest[] = []
    const writes: Array<{ path: string; value: string; mode?: number | string }> = []
    const closedTargets = new Set<string>()
    let startAttempts = 0
    const manager = makeManager({
      requestSidecar: (async <T,>(socketPath: string, payload: unknown): Promise<T> => {
        const { app, namespace } = socketTarget(socketPath)
        const target = `${namespace}:${app}`
        if ((payload as { type?: string }).type === 'shutdown') {
          closedTargets.add(target)
          return { accepted: true } as T
        }
        if (closedTargets.has(target)) throw new Error('closed')
        return {
          state: 'running',
          url: app === 'web' ? 'http://127.0.0.1:3456/' : 'http://127.0.0.1:3455/',
        } as T
      }) as typeof requestOpenDesignSidecar,
      runCommand: async (request) => {
        commands.push(request)
        if (request.args.includes('start')) {
          startAttempts += 1
          if (startAttempts === 1) throw new Error('tools-dev: command not found')
        }
        return { stdout: '{}', stderr: '' }
      },
      writeFile: async (path, value, options) => {
        writes.push({
          path: String(path),
          value: String(value),
          mode: typeof options === 'object' && options != null ? options.mode : undefined,
        })
      },
      windowController: { close() {}, hasWindow: () => false, open: () => undefined },
    })

    await manager.open()
    await manager.stop()
    await manager.open()

    expect(commands.map((command) => command.args)).toEqual([
      ['exec', '--', 'corepack', 'pnpm', 'install', '--frozen-lockfile'],
      expect.arrayContaining(['tools-dev', 'start', 'web']),
      ['exec', '--', 'corepack', 'pnpm', '--filter', '@open-design/tools-dev', 'build'],
      expect.arrayContaining(['tools-dev', 'start', 'web']),
      expect.arrayContaining(['tools-dev', 'start', 'web']),
    ])
    expect(writes).toEqual([
      { path: '/tmp/rox-open-design/open-design-empty.npmrc', value: '', mode: 0o600 },
      { path: '/tmp/rox-open-design/open-design-empty.npmrc', value: '', mode: 0o600 },
    ])
  })

  it('returns a redacted disabled status without exposing root paths', async () => {
    const manager = new OpenDesignRuntimeManager({
      env: {},
      userDataDir: '/tmp/rox-open-design',
      windowController: { close() {}, hasWindow: () => false, open() {} },
    })
    const status = await manager.status()
    expect(status.state).toBe('disabled')
    expect(status.enabled).toBe(false)
    expect(JSON.stringify(status)).not.toContain('/tmp')
  })
})

describe('Open Design IPC handler registration', () => {
  function invokeEvent(sender: WebContents, senderFrame: unknown): IpcMainInvokeEvent {
    return { sender, senderFrame } as unknown as IpcMainInvokeEvent
  }

  it('rejects untrusted senders before invoking the runtime', async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>()
    registerOpenDesignIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler as (...args: any[]) => unknown) },
      isTrustedSender: () => false,
      runtime: {
        open: async () => { throw new Error('must not call') },
        status: async () => { throw new Error('must not call') },
        stop: async () => { throw new Error('must not call') },
      },
    })

    await expect(handlers.get('open-design:open')!({})).rejects.toThrow('Rox renderer')
  })

  it('allows only registered main-frame invoke events', async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>()
    const calls: string[] = []
    const okStatus = {
      canOpen: true,
      enabled: true,
      state: 'idle' as const,
      updatedAt: 1,
      windowOpen: false,
    }
    const mainFrame = { url: 'file:///app/renderer/index.html' }
    const subFrame = { url: 'file:///app/renderer/subframe.html' }
    const sender = { id: 7, mainFrame } as unknown as WebContents
    registerOpenDesignIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler as (...args: any[]) => unknown) },
      isTrustedSender: (event) => isTrustedOpenDesignIpcEvent({
        event,
        isRegisteredRoxWebContents: (candidate) => candidate === sender,
        isTrustedMainFrameUrl: (url) => url === mainFrame.url,
      }),
      runtime: {
        open: async () => { calls.push('open'); return okStatus },
        status: async () => { calls.push('status'); return okStatus },
        stop: async () => { calls.push('stop'); return okStatus },
      },
    })

    await expect(handlers.get('open-design:open')!(invokeEvent(sender, subFrame))).rejects.toThrow('Rox renderer')
    await handlers.get('open-design:open')!(invokeEvent(sender, mainFrame))
    expect(calls).toEqual(['open'])
  })

  it('registers narrow open/status/stop handlers for trusted senders', async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>()
    const calls: string[] = []
    const okStatus = {
      canOpen: true,
      enabled: true,
      state: 'idle' as const,
      updatedAt: 1,
      windowOpen: false,
    }
    registerOpenDesignIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler as (...args: any[]) => unknown) },
      isTrustedSender: () => true,
      runtime: {
        open: async () => { calls.push('open'); return okStatus },
        status: async () => { calls.push('status'); return okStatus },
        stop: async () => { calls.push('stop'); return okStatus },
      },
    })

    expect([...handlers.keys()].sort()).toEqual(['open-design:open', 'open-design:status', 'open-design:stop'])
    await handlers.get('open-design:open')!({})
    await handlers.get('open-design:status')!({})
    await handlers.get('open-design:stop')!({})
    expect(calls).toEqual(['open', 'status', 'stop'])
  })
})
