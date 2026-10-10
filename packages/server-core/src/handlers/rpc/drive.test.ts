import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { DriveUploadTarget, ImportProvider, ImportSourceEntry, MirrorQueueStatus, MirrorRunResult } from '@rox/shared/drive'
import type { HandlerDeps } from '../handler-deps'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport'
import {
  configureDriveImport,
  configureDriveMirror,
  resetDriveImport,
  resetDriveMirror,
  registerDriveHandlers,
  registerImportProvider,
  HANDLED_CHANNELS,
  type DriveMirrorEngine,
} from './drive'

class StubProvider implements ImportProvider {
  readonly id = 'google-drive' as const

  async list(folderId?: string): Promise<ImportSourceEntry[]> {
    // `folderId` is the entry's `id` (the walker recurses on ids), so the
    // child listing is keyed on `dir` — the folder's name is only used for paths.
    if (folderId === 'dir') return [{ id: 'b', name: 'b.txt', kind: 'file', sizeBytes: 4 }]
    return [
      { id: 'a', name: 'a.txt', kind: 'file', sizeBytes: 3 },
      { id: 'dir', name: 'sub', kind: 'folder' },
    ]
  }

  async stream(sourceId: string): Promise<ReadableStream<Uint8Array>> {
    const bytes = new Uint8Array(sourceId === 'a' ? [1, 1, 1] : [2, 2, 2, 2])
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes)
        controller.close()
      },
    })
  }
}

function harness() {
  const handlers = new Map<string, HandlerFn>()
  const server = {
    handle(channel: string, handler: HandlerFn) { handlers.set(channel, handler) },
    push() {}, async invokeClient() {}, hasClientCapability() { return false },
    findClientsWithCapability() { return [] }, isRequestContextCurrent() { return true },
  } as unknown as RpcServer
  registerDriveHandlers(server, { platform: { logger: { error() {}, warn() {}, info() {}, debug() {} } } } as unknown as HandlerDeps)
  const invoke = (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`channel not registered: ${channel}`)
    return handler(context, ...args)
  }
  return { handlers, invoke }
}

const context: RequestContext = { clientId: 'client', workspaceId: 'workspace', webContentsId: null }

describe('drive import RPC handlers', () => {
  let stateDir: string
  let provider: StubProvider
  let puts: string[]

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'rox-drive-import-rpc-'))
    provider = new StubProvider()
    puts = []
    const target: DriveUploadTarget = {
      async put(key, body) {
        await (body instanceof Uint8Array ? Promise.resolve() : new Response(body).arrayBuffer())
        puts.push(key)
      },
    }
    configureDriveImport({ stateDir, target, providers: [provider], concurrency: 1, sleep: async () => {} })
  })

  afterEach(async () => {
    resetDriveImport()
    resetDriveMirror()
    await rm(stateDir, { recursive: true, force: true })
  })

  test('registers every HANDLED_CHANNELS entry', () => {
    const { handlers } = harness()
    for (const channel of HANDLED_CHANNELS) expect(handlers.has(channel)).toBe(true)
    expect(handlers.size).toBe(HANDLED_CHANNELS.length)
  })

  test('plans, starts and reports a job', async () => {
    const { invoke } = harness()
    const job = await invoke(RPC_CHANNELS.drive.IMPORT_PLAN, 'google-drive') as { id: string; status: string; plan: unknown[] }
    expect(job.status).toBe('idle')
    expect(job.plan).toHaveLength(2)

    const started = await invoke(RPC_CHANNELS.drive.IMPORT_START, job.id) as { status: string }
    expect(started.status).toBe('done')
    expect(puts).toEqual([`${job.id}/a.txt`, `${job.id}/sub/b.txt`])

    const status = await invoke(RPC_CHANNELS.drive.IMPORT_STATUS, job.id) as { status: string }
    expect(status.status).toBe('done')
  })

  test('pause and resume round-trip through the RPC surface', async () => {
    const { invoke } = harness()
    const job = await invoke(RPC_CHANNELS.drive.IMPORT_PLAN, 'google-drive') as { id: string }
    await invoke(RPC_CHANNELS.drive.IMPORT_START, job.id)
    await invoke(RPC_CHANNELS.drive.IMPORT_PAUSE, job.id)
    const resumed = await invoke(RPC_CHANNELS.drive.IMPORT_RESUME, job.id) as { status: string }
    expect(resumed.status).toBe('done')
  })

  test('cancels a running job: the in-flight file settles and no further files start', async () => {
    resetDriveImport()
    const firstPut = Promise.withResolvers<void>()
    const gate = Promise.withResolvers<void>()
    const cancelledKeys: string[] = []
    const target: DriveUploadTarget = {
      async put(key, body) {
        await (body instanceof Uint8Array ? Promise.resolve() : new Response(body).arrayBuffer())
        cancelledKeys.push(key)
        if (cancelledKeys.length === 1) {
          firstPut.resolve()
          await gate.promise
        }
      },
    }
    configureDriveImport({ stateDir, target, providers: [provider], concurrency: 1, sleep: async () => {} })

    const { invoke } = harness()
    const job = await invoke(RPC_CHANNELS.drive.IMPORT_PLAN, 'google-drive') as { id: string }
    const startPromise = invoke(RPC_CHANNELS.drive.IMPORT_START, job.id)
    await firstPut.promise
    const cancelPromise = invoke(RPC_CHANNELS.drive.IMPORT_CANCEL, job.id)
    gate.resolve()
    await startPromise

    const cancelled = await cancelPromise as { status: string; error?: string }
    expect(cancelled.status).toBe('cancelled')
    // The blocked file committed; the queued sibling never started.
    expect(cancelledKeys).toEqual([`${job.id}/a.txt`])

    const status = await invoke(RPC_CHANNELS.drive.IMPORT_STATUS, job.id) as { status: string }
    expect(status.status).toBe('cancelled')
  })

  test('cancelling an unknown job is a typed error', async () => {
    const { invoke } = harness()
    await expect(invoke(RPC_CHANNELS.drive.IMPORT_CANCEL, 'missing')).rejects.toMatchObject({
      code: 'DRIVE_IMPORT_NOT_FOUND',
    })
  })

  test('cancelling a finished job is a typed error', async () => {
    const { invoke } = harness()
    const job = await invoke(RPC_CHANNELS.drive.IMPORT_PLAN, 'google-drive') as { id: string }
    await invoke(RPC_CHANNELS.drive.IMPORT_START, job.id)
    await expect(invoke(RPC_CHANNELS.drive.IMPORT_CANCEL, job.id)).rejects.toMatchObject({
      code: 'DRIVE_IMPORT_NOT_CANCELLABLE',
    })
  })

  test('status without an id lists known jobs', async () => {
    const { invoke } = harness()
    const job = await invoke(RPC_CHANNELS.drive.IMPORT_PLAN, 'google-drive') as { id: string }
    const list = await invoke(RPC_CHANNELS.drive.IMPORT_STATUS) as Array<{ id: string }>
    expect(list.map(entry => entry.id)).toEqual([job.id])
  })

  test('rejects an unknown provider id', async () => {
    const { invoke } = harness()
    await expect(invoke(RPC_CHANNELS.drive.IMPORT_PLAN, 'dropbox')).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
  })

  test('answers UNSUPPORTED_OPERATION when the host did not compose imports', async () => {
    resetDriveImport()
    const { invoke } = harness()
    await expect(invoke(RPC_CHANNELS.drive.IMPORT_PLAN, 'google-drive')).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
    })
  })

  test('host composition: registerImportProvider + configureDriveImport serves importPlan', async () => {
    resetDriveImport()
    const target: DriveUploadTarget = { async put() {} }
    // The host composition path registers adapters first and then composes the
    // runner without an explicit provider list (as apps/electron does).
    registerImportProvider(provider)
    configureDriveImport({ stateDir, target, concurrency: 1, sleep: async () => {} })

    const { invoke } = harness()
    const job = await invoke(RPC_CHANNELS.drive.IMPORT_PLAN, 'google-drive') as { status: string; plan: unknown[] }
    expect(job.status).toBe('idle')
    expect(job.plan).toHaveLength(2)
  })
})

describe('drive mirror RPC handlers', () => {
  const MIRROR_CHANNELS = [
    RPC_CHANNELS.drive.MIRROR_STATUS,
    RPC_CHANNELS.drive.MIRROR_START,
    RPC_CHANNELS.drive.MIRROR_PAUSE,
    RPC_CHANNELS.drive.MIRROR_CANCEL,
  ] as const

  function invokeMirror(channel: string): Promise<unknown> {
    return harness().invoke(channel)
  }

  /** Spy engine: records every call and reports a status it can be told to hold. */
  function spyEngine() {
    const calls: string[] = []
    const result: MirrorRunResult = { added: 0, changed: 0, removed: 0, bytesUploaded: 0, paused: false, cancelled: false, errors: [] }
    const runGate = Promise.withResolvers<MirrorRunResult>()
    let status: MirrorQueueStatus = { state: 'idle', filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0 }
    const engine: DriveMirrorEngine = {
      run: () => { calls.push('run'); return runGate.promise },
      pause: () => { calls.push('pause'); status = { ...status, state: 'paused' } },
      cancel: () => { calls.push('cancel'); status = { ...status, state: 'cancelled' } },
      status: () => status,
      lastResult: () => null,
    }
    return {
      engine,
      calls,
      resolveRun: () => runGate.resolve(result),
      setStatus: (next: MirrorQueueStatus) => { status = next },
    }
  }

  test('answers UNSUPPORTED_OPERATION on every mirror channel without a composed engine', async () => {
    resetDriveMirror()
    for (const channel of MIRROR_CHANNELS) {
      await expect(invokeMirror(channel)).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
    }
  })

  test('status returns the engine snapshot and the last run result once there is one', async () => {
    const spy = spyEngine()
    configureDriveMirror(spy.engine)
    spy.setStatus({ state: 'running', filesDone: 2, filesTotal: 5, bytesDone: 10, bytesTotal: 40 })

    const status = await invokeMirror(RPC_CHANNELS.drive.MIRROR_STATUS) as { configured: boolean; status: { state: string; filesDone: number }; lastResult?: unknown }
    expect(status.configured).toBe(true)
    expect(status.status.state).toBe('running')
    expect(status.status.filesDone).toBe(2)
    expect(status.lastResult).toBeUndefined()
  })

  test('start kicks the run without awaiting it and returns the current status', async () => {
    const spy = spyEngine()
    configureDriveMirror(spy.engine)

    // The engine's run() never settles, so START may not block on it.
    const started = await invokeMirror(RPC_CHANNELS.drive.MIRROR_START) as { configured: boolean; started: boolean; status: { state: string } }
    expect(started.configured).toBe(true)
    expect(started.started).toBe(true)
    expect(spy.calls).toEqual(['run'])
    expect(started.status.state).toBe('idle')
    spy.resolveRun()
  })

  test('pause and cancel are idempotent and report the engine status', async () => {
    const spy = spyEngine()
    configureDriveMirror(spy.engine)

    const firstPause = await invokeMirror(RPC_CHANNELS.drive.MIRROR_PAUSE) as { status: { state: string } }
    const secondPause = await invokeMirror(RPC_CHANNELS.drive.MIRROR_PAUSE) as { status: { state: string } }
    expect(firstPause.status.state).toBe('paused')
    expect(secondPause.status.state).toBe('paused')

    const firstCancel = await invokeMirror(RPC_CHANNELS.drive.MIRROR_CANCEL) as { status: { state: string } }
    const secondCancel = await invokeMirror(RPC_CHANNELS.drive.MIRROR_CANCEL) as { status: { state: string } }
    expect(firstCancel.status.state).toBe('cancelled')
    expect(secondCancel.status.state).toBe('cancelled')
    expect(spy.calls).toEqual(['pause', 'pause', 'cancel', 'cancel'])
  })
})