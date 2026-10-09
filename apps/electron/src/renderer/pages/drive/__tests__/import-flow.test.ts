import { describe, test, expect } from 'bun:test'
import type { ImportJob } from '@rox/shared/drive/importers/types'
import { ICLOUD_UNSUPPORTED_MESSAGE } from '@rox/shared/drive/importers/providers/icloud'
import {
  IMPORT_PROVIDERS,
  DriveImportFlowError,
  createDriveImportAuthClient,
  type DriveImportAuthClient,
  type DriveImportBrokerTransport,
} from '../import-flow'
import { createDriveImportController, type DriveImportApi } from '../import-controller'

function job(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    id: 'job-1',
    provider: 'google-drive',
    status: 'running',
    plan: [],
    progress: { filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0 },
    ...overrides,
  }
}

/** Steps `schedule` callbacks by hand so controller polling is deterministic. */
function manualScheduler() {
  let next = 0
  const tasks = new Map<number, () => void>()
  return {
    schedule: (callback: () => void) => {
      const id = ++next
      tasks.set(id, callback)
      return id
    },
    cancelSchedule: (handle: unknown) => {
      tasks.delete(handle as number)
    },
    async run(): Promise<void> {
      const pending = [...tasks.values()]
      tasks.clear()
      for (const callback of pending) await callback()
    },
    /** Fire callbacks without awaiting them (for tests that suspend mid-tick). */
    fire(): void {
      const pending = [...tasks.values()]
      tasks.clear()
      for (const callback of pending) void callback()
    },
    pending: () => tasks.size,
  }
}

async function flush(): Promise<void> {
  for (let index = 0; index < 16; index += 1) await Promise.resolve()
}

function fakeTransport(overrides: Partial<DriveImportBrokerTransport> = {}): DriveImportBrokerTransport {
  return {
    start: async () => ({ ok: true, status: 'authorized' }),
    complete: async () => ({ ok: true }),
    beginLoopback: async () => ({ handle: 'loop-1', callbackUrl: 'http://127.0.0.1:9/callback' }),
    openUrl: async () => {},
    awaitLoopback: async () => ({ code: 'auth-code-1' }),
    cancelLoopback: async () => {},
    ...overrides,
  }
}

function fakeAuth(overrides: Partial<DriveImportAuthClient> = {}): DriveImportAuthClient {
  return {
    start: async () => ({
      status: 'device-code',
      flowId: 'flow-1',
      deviceCode: { userCode: 'ABCD-1234', verificationUri: 'https://example.test/device', intervalSeconds: 5, expiresInSeconds: 900 },
    }),
    complete: async () => {},
    abort: () => {},
    ...overrides,
  }
}

function fakeApi(calls: string[], statuses: ImportJob[] = []): DriveImportApi {
  let statusIndex = 0
  return {
    async driveImportPlan(provider) {
      calls.push(`plan:${provider}`)
      return job({ provider, status: 'idle' })
    },
    async driveImportStart(jobId) {
      calls.push(`start:${jobId}`)
      return job({ id: jobId, status: 'running' })
    },
    async driveImportPause(jobId) {
      calls.push(`pause:${jobId}`)
      return job({ id: jobId, status: 'paused' })
    },
    async driveImportResume(jobId) {
      calls.push(`resume:${jobId}`)
      return job({ id: jobId, status: 'running' })
    },
    async driveImportStatus(jobId) {
      calls.push(`status:${jobId}`)
      const next = statuses[Math.min(statusIndex, statuses.length - 1)]
      statusIndex += 1
      return next ?? job({ id: jobId })
    },
  }
}

describe('import provider descriptors', () => {
  test('google uses the PKCE browser broker; onedrive device code; yandex pasted code', () => {
    const byId = Object.fromEntries(IMPORT_PROVIDERS.map(provider => [provider.id, provider]))
    expect(byId['google-drive'].authKind).toBe('browser')
    expect(byId['google-drive'].clientIdEnv).toBe('GOOGLE_OAUTH_CLIENT_ID')
    expect(byId.onedrive.authKind).toBe('device-code')
    expect(byId.onedrive.clientIdEnv).toBe('ROX_MS_CLIENT_ID')
    expect(byId['yandex-disk'].authKind).toBe('pasted-code')
    expect(byId['yandex-disk'].clientIdEnv).toBe('ROX_YANDEX_CLIENT_ID')
  })

  test('icloud stays explicitly unsupported with the shared honest message', () => {
    const icloud = IMPORT_PROVIDERS.find(provider => provider.id === 'icloud')
    expect(icloud?.authKind).toBe('unsupported')
    expect(icloud?.unsupportedMessage).toBe(ICLOUD_UNSUPPORTED_MESSAGE)
  })
})

describe('createDriveImportAuthClient', () => {
  test('reports not-configured with the host message when no OAuth client is set', async () => {
    const client = createDriveImportAuthClient(fakeTransport({
      start: async () => ({ ok: false, code: 'no-oauth-client', error: 'Google-доступ не настроен' }),
    }))
    await expect(client.start('google-drive')).rejects.toBeInstanceOf(DriveImportFlowError)
    await expect(client.start('google-drive')).rejects.toThrow('Google-доступ не настроен')
  })

  test('skips auth when the host reports stored tokens', async () => {
    const client = createDriveImportAuthClient(fakeTransport({ start: async () => ({ ok: true, status: 'authorized' }) }))
    expect(await client.start('google-drive')).toEqual({ status: 'authorized' })
  })

  test('surface a device code and complete the poll host-side', async () => {
    const completed: Array<string | undefined> = []
    const client = createDriveImportAuthClient(fakeTransport({
      start: async () => ({
        ok: true,
        status: 'pending',
        flowId: 'flow-9',
        deviceCode: { userCode: 'MS-1', verificationUri: 'https://microsoft.test/devicelogin', intervalSeconds: 5, expiresInSeconds: 900 },
      }),
      complete: async (flowId, code) => { completed.push(`${flowId}:${code ?? ''}`); return { ok: true } },
    }))
    const begun = await client.start('onedrive')
    expect(begun).toMatchObject({ status: 'device-code', flowId: 'flow-9' })
    await client.complete('onedrive', 'flow-9')
    expect(completed).toEqual(['flow-9:'])
  })

  test('google binds the loopback, opens the URL and completes with the returned code', async () => {
    const opened: string[] = []
    const callbackUrls: string[] = []
    const completed: Array<string | undefined> = []
    const client = createDriveImportAuthClient(fakeTransport({
      beginLoopback: async () => ({ handle: 'loop-42', callbackUrl: 'http://127.0.0.1:5555/callback' }),
      start: async (_provider, options) => {
        callbackUrls.push(options?.callbackUrl ?? '')
        return { ok: true, status: 'pending', flowId: 'flow-42', authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' }
      },
      openUrl: async url => { opened.push(url) },
      awaitLoopback: async handle => ({ code: `code-for-${handle}` }),
      complete: async (flowId, code) => { completed.push(`${flowId}:${code ?? ''}`); return { ok: true } },
    }))
    const begun = await client.start('google-drive')
    expect(begun.status).toBe('auth-url')
    expect(callbackUrls).toEqual(['http://127.0.0.1:5555/callback'])
    expect(opened).toEqual(['https://accounts.google.com/o/oauth2/v2/auth?x=1'])
    await client.complete('google-drive', 'flow-42')
    expect(completed).toEqual(['flow-42:code-for-loop-42'])
  })

  test('a loopback redirect error becomes a typed auth failure', async () => {
    const client = createDriveImportAuthClient(fakeTransport({
      start: async () => ({ ok: true, status: 'pending', flowId: 'flow-err', authUrl: 'https://accounts.google.com/o/oauth2/v2/auth' }),
      awaitLoopback: async () => ({ error: 'access_denied', error_description: 'Пользователь отклонил доступ' }),
    }))
    await client.start('google-drive')
    await expect(client.complete('google-drive', 'flow-err')).rejects.toThrow('Пользователь отклонил доступ')
  })
})

describe('drive import controller', () => {
  test('runs google: broker → plan → start → polling → done', async () => {
    const scheduler = manualScheduler()
    const calls: string[] = []
    const controller = createDriveImportController({
      auth: fakeAuth(),
      api: fakeApi(calls, [job({ id: 'job-1', status: 'done', progress: { filesDone: 3, filesTotal: 3, bytesDone: 30, bytesTotal: 30 } })]),
      schedule: scheduler.schedule,
      cancelSchedule: scheduler.cancelSchedule,
    })
    controller.start('google-drive')
    expect(controller.getState().phase).toBe('authorizing')
    await flush()
    expect(controller.getState().deviceCode?.userCode).toBe('ABCD-1234')
    expect(controller.getState().phase).toBe('job')
    expect(calls).toEqual(['plan:google-drive', 'start:job-1'])
    expect(scheduler.pending()).toBe(1)

    await scheduler.run()
    const final = controller.getState()
    expect(calls.at(-1)).toBe('status:job-1')
    expect(final.phase).toBe('done')
    expect(final.job?.progress.filesDone).toBe(3)
  })

  test('stored tokens skip auth and go straight to planning', async () => {
    const calls: string[] = []
    let authCalls = 0
    const controller = createDriveImportController({
      auth: fakeAuth({ start: async () => { authCalls += 1; return { status: 'authorized' } } }),
      api: fakeApi(calls),
    })
    controller.start('google-drive')
    await flush()
    const state = controller.getState()
    expect(authCalls).toBe(1)
    expect(state.phase).toBe('job')
    expect(calls).toEqual(['plan:google-drive', 'start:job-1'])
    controller.dispose()
  })

  test('pause and resume call the matching RPCs and update the job', async () => {
    const scheduler = manualScheduler()
    const calls: string[] = []
    const controller = createDriveImportController({
      auth: fakeAuth(),
      api: fakeApi(calls, [job({ id: 'job-1', status: 'running' })]),
      schedule: scheduler.schedule,
      cancelSchedule: scheduler.cancelSchedule,
    })
    controller.start('google-drive')
    await flush()
    controller.pause()
    await flush()
    expect(controller.getState().job?.status).toBe('paused')
    controller.resume()
    await flush()
    expect(controller.getState().job?.status).toBe('running')
    expect(calls).toContain('pause:job-1')
    expect(calls).toContain('resume:job-1')
    controller.dispose()
  })

  test('a failed pause surfaces the RPC message in the job phase', async () => {
    const api: DriveImportApi = {
      ...fakeApi([]),
      async driveImportPause() {
        throw { code: 'UNSUPPORTED_OPERATION', message: 'Drive operations are unavailable on this host' }
      },
    }
    const controller = createDriveImportController({ auth: fakeAuth(), api })
    controller.start('google-drive')
    await flush()
    expect(controller.getState().phase).toBe('job')
    controller.pause()
    await flush()
    expect(controller.getState().phase).toBe('job')
    expect(controller.getState().error).toBe('Drive operations are unavailable on this host')
    controller.dispose()
  })

  test('cancel invalidates an in-flight status poll and re-arms nothing', async () => {
    const scheduler = manualScheduler()
    let resolveStatus: (value: ImportJob) => void = () => {}
    const api: DriveImportApi = {
      ...fakeApi([]),
      driveImportStatus: () => new Promise<ImportJob>(resolve => { resolveStatus = resolve }),
    }
    const controller = createDriveImportController({
      auth: fakeAuth(),
      api,
      schedule: scheduler.schedule,
      cancelSchedule: scheduler.cancelSchedule,
    })
    controller.start('google-drive')
    await flush()
    expect(controller.getState().phase).toBe('job')
    expect(scheduler.pending()).toBe(1)

    scheduler.fire() // starts the poll, which now awaits an unresolved status
    await flush()
    controller.cancel()
    await flush()
    expect(controller.getState().phase).toBe('choose')
    expect(controller.getState().job).toBeNull()

    // The late status resolves after cancel: the stale poll must not resurrect.
    resolveStatus(job({ id: 'job-1', status: 'running' }))
    await flush()
    expect(controller.getState().phase).toBe('choose')
    expect(controller.getState().job).toBeNull()
    expect(scheduler.pending()).toBe(0)
    controller.dispose()
  })

  test('cancel pauses the running job and returns to the picker', async () => {
    const scheduler = manualScheduler()
    const calls: string[] = []
    const controller = createDriveImportController({
      auth: fakeAuth(),
      api: fakeApi(calls),
      schedule: scheduler.schedule,
      cancelSchedule: scheduler.cancelSchedule,
    })
    controller.start('google-drive')
    await flush()
    controller.cancel()
    await flush()
    expect(calls).toContain('pause:job-1')
    expect(controller.getState().phase).toBe('choose')
    expect(controller.getState().job).toBeNull()
    controller.dispose()
  })

  test('a not-configured broker failure is honest and not retryable', async () => {
    const calls: string[] = []
    const controller = createDriveImportController({
      auth: fakeAuth({ start: async () => { throw new DriveImportFlowError('not-configured', 'Google-доступ не настроен', 'google-drive') } }),
      api: fakeApi(calls),
    })
    controller.start('google-drive')
    await flush()
    const state = controller.getState()
    expect(state.phase).toBe('error')
    expect(state.error).toBe('Google-доступ не настроен')
    expect(state.retryable).toBe(false)
    expect(calls).toEqual([])
  })

  test('iCloud renders the shared unsupported message and never calls an RPC', async () => {
    const calls: string[] = []
    const controller = createDriveImportController({ auth: fakeAuth(), api: fakeApi(calls) })
    controller.start('icloud')
    await flush()
    const state = controller.getState()
    expect(state.phase).toBe('unsupported')
    expect(state.error).toBe(ICLOUD_UNSUPPORTED_MESSAGE)
    expect(calls).toEqual([])
  })

  test('denied authorization surfaces the provider message', async () => {
    const controller = createDriveImportController({
      auth: fakeAuth({
        complete: async () => {
          throw new DriveImportFlowError('auth-failed', 'Пользователь отклонил доступ к Google Drive', 'google-drive')
        },
      }),
      api: fakeApi([]),
    })
    controller.start('google-drive')
    await flush()
    const state = controller.getState()
    expect(state.phase).toBe('error')
    expect(state.error).toBe('Пользователь отклонил доступ к Google Drive')
  })

  test('a coded RPC failure to plan is surfaced verbatim, with no fake progress', async () => {
    const api: DriveImportApi = {
      ...fakeApi([]),
      async driveImportPlan() {
        throw { code: 'UNSUPPORTED_OPERATION', message: 'Drive import target is not configured (set ROX_DRIVE_S3_* or pass target)' }
      },
    }
    const controller = createDriveImportController({ auth: fakeAuth(), api })
    controller.start('google-drive')
    await flush()
    const state = controller.getState()
    expect(state.phase).toBe('error')
    expect(state.error).toBe('Drive import target is not configured (set ROX_DRIVE_S3_* or pass target)')
    expect(state.job).toBeNull()
  })

  test('yandex pastes a code, then plans the job', async () => {
    const scheduler = manualScheduler()
    const calls: string[] = []
    const submitted: Array<string | undefined> = []
    const controller = createDriveImportController({
      auth: fakeAuth({
        start: async () => ({ status: 'auth-url', flowId: 'ya-flow-1', authUrl: 'https://oauth.yandex.ru/authorize?client_id=ya-1' }),
        complete: async (_provider, _flowId, options) => { submitted.push(options?.code) },
      }),
      api: fakeApi(calls),
      schedule: scheduler.schedule,
      cancelSchedule: scheduler.cancelSchedule,
    })
    controller.start('yandex-disk')
    await flush()
    expect(controller.getState().phase).toBe('yandex-code')
    expect(controller.getState().yandexUrl).toContain('oauth.yandex.ru')
    controller.submitYandexCode('  ya-code-1 ')
    await flush()
    expect(submitted).toEqual(['ya-code-1'])
    expect(calls).toEqual(['plan:yandex-disk', 'start:job-1'])
    controller.dispose()
  })
})