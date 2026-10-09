import { describe, test, expect } from 'bun:test'
import type { ImportJob } from '@rox/shared/drive/importers/types'
import { ICLOUD_UNSUPPORTED_MESSAGE } from '@rox/shared/drive/importers/providers/icloud'
import {
  IMPORT_PROVIDERS,
  DriveImportFlowError,
  createDriveImportAuthClient,
  importProviderName,
  readHostEnv,
  type DriveImportAuthClient,
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function fixedFetch(handler: (url: string) => Response): typeof fetch {
  return (async (input: string | URL | Request) => handler(String(input))) as unknown as typeof fetch
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
      const pending = [...tasks.entries()]
      tasks.clear()
      for (const [, callback] of pending) await callback()
    },
    pending: () => tasks.size,
  }
}

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

function fakeAuth(overrides: Partial<DriveImportAuthClient> = {}): DriveImportAuthClient {
  return {
    isConfigured: () => true,
    startDeviceCode: async () => ({
      deviceCode: 'raw-device-code',
      userCode: 'ABCD-1234',
      verificationUri: 'https://example.test/device',
      intervalSeconds: 5,
      expiresInSeconds: 900,
    }),
    pollDeviceCode: async () => {},
    yandexAuthUrl: async () => 'https://oauth.yandex.ru/authorize?client_id=x',
    completeYandexCode: async () => {},
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
  test('google and onedrive use the device-code flow; yandex uses a pasted code', () => {
    const byId = Object.fromEntries(IMPORT_PROVIDERS.map(provider => [provider.id, provider]))
    expect(byId['google-drive'].authKind).toBe('device-code')
    expect(byId['google-drive'].clientIdEnv).toBe('ROX_GOOGLE_CLIENT_ID')
    expect(byId.onedrive.authKind).toBe('device-code')
    expect(byId.onedrive.clientIdEnv).toBe('ROX_MS_CLIENT_ID')
    expect(byId['yandex-disk'].authKind).toBe('yandex-code')
    expect(byId['yandex-disk'].clientIdEnv).toBe('ROX_YANDEX_CLIENT_ID')
  })

  test('icloud stays explicitly unsupported with the shared honest message', () => {
    const icloud = IMPORT_PROVIDERS.find(provider => provider.id === 'icloud')
    expect(icloud?.authKind).toBe('unsupported')
    expect(icloud?.unsupportedMessage).toBe(ICLOUD_UNSUPPORTED_MESSAGE)
  })

  test('provider names feed the «…-доступ не настроен» message', () => {
    expect(importProviderName('google-drive')).toBe('Google')
    expect(importProviderName('onedrive')).toBe('OneDrive')
    expect(importProviderName('yandex-disk')).toBe('Яндекс')
  })
})

describe('createDriveImportAuthClient', () => {
  test('reports not configured and throws the honest message when the env is unset', async () => {
    const client = createDriveImportAuthClient({ googleClientId: '', msClientId: '', yandexClientId: '' })
    expect(client.isConfigured('google-drive')).toBe(false)
    await expect(client.startDeviceCode('google-drive')).rejects.toThrow('Google-доступ не настроен')
  })

  test('starts and polls a Google device code', async () => {
    const urls: string[] = []
    const fetchImpl = fixedFetch(url => {
      urls.push(url)
      if (url.includes('device/code')) {
        return jsonResponse({ device_code: 'dc-1', user_code: 'WXYZ-9', verification_url: 'https://google.com/device', expires_in: 1800, interval: 5 })
      }
      return jsonResponse({ access_token: 'token-1', expires_in: 3600, refresh_token: 'r-1' })
    })
    const client = createDriveImportAuthClient({ googleClientId: 'client-1', googleClientSecret: '', fetchImpl })
    expect(client.isConfigured('google-drive')).toBe(true)
    const code = await client.startDeviceCode('google-drive')
    expect(code.userCode).toBe('WXYZ-9')
    expect(code.verificationUri).toBe('https://google.com/device')
    expect(code.deviceCode).toBe('dc-1')
    await client.pollDeviceCode('google-drive', code)
    expect(urls.some(url => url.includes('oauth2.googleapis.com/token'))).toBe(true)
  })

  test('starts a OneDrive device code and builds a Yandex consent URL', async () => {
    const fetchImpl = fixedFetch(() => jsonResponse({ device_code: 'dc-2', user_code: 'MS-CODE', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 5 }))
    const client = createDriveImportAuthClient({ msClientId: 'ms-1', yandexClientId: 'ya-1', fetchImpl })
    const code = await client.startDeviceCode('onedrive')
    expect(code.userCode).toBe('MS-CODE')
    const url = await client.yandexAuthUrl('yandex-disk')
    expect(url).toContain('oauth.yandex.ru/authorize')
    expect(url).toContain('client_id=ya-1')
  })

  test('readHostEnv tolerates a missing process global', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'process')
    try {
      // No process → undefined, never a throw.
      Object.defineProperty(globalThis, 'process', { configurable: true, value: undefined })
      expect(readHostEnv('ROX_GOOGLE_CLIENT_ID')).toBeUndefined()
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'process', descriptor)
    }
  })
})

describe('drive import controller', () => {
  test('runs google: device code → plan → start → polling → done', async () => {
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

  test('an unset provider env fails honestly before any RPC', async () => {
    const calls: string[] = []
    const controller = createDriveImportController({
      auth: fakeAuth({ isConfigured: () => false }),
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
        pollDeviceCode: async () => {
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

  test('an RPC failure to plan is surfaced verbatim, with no fake progress', async () => {
    const api: DriveImportApi = {
      ...fakeApi([]),
      async driveImportPlan() {
        throw new Error('Drive import target is not configured (set ROX_DRIVE_S3_* or pass target)')
      },
    }
    const controller = createDriveImportController({ auth: fakeAuth(), api })
    controller.start('google-drive')
    await flush()
    const state = controller.getState()
    expect(state.phase).toBe('error')
    expect(state.error).toContain('ROX_DRIVE_S3_')
    expect(state.job).toBeNull()
  })

  test('yandex pastes a code, then plans the job', async () => {
    const scheduler = manualScheduler()
    const calls: string[] = []
    const submitted: string[] = []
    const controller = createDriveImportController({
      auth: fakeAuth({ completeYandexCode: async (_provider, code) => { submitted.push(code) } }),
      api: fakeApi(calls),
      schedule: scheduler.schedule,
      cancelSchedule: scheduler.cancelSchedule,
    })
    controller.start('yandex-disk')
    await flush()
    expect(controller.getState().phase).toBe('yandex-code')
    controller.submitYandexCode('  ya-code-1 ')
    await flush()
    expect(submitted).toEqual(['ya-code-1'])
    expect(calls).toEqual(['plan:yandex-disk', 'start:job-1'])
    controller.dispose()
  })
})