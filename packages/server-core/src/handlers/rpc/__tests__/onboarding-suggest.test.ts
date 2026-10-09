/**
 * onboarding:suggestPreferences handler.
 *
 * The one-shot provider seam is mocked per case; the handler must never invent
 * text and must report `no-provider` when no usable path exists.
 */
import { describe, expect, it, mock } from 'bun:test'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'

let workspaces: Array<{ id: string }> = []
let runOneShot: ((workspaceId: string, prompt: string, owner?: unknown) => Promise<string>) | undefined

mock.module('@rox/shared/config', () => ({
  getWorkspaces: () => workspaces,
}))

mock.module('@rox/shared/auth', () => ({
  LOCAL_ROX_CALLER: { issuer: 'rox:local-electron', subject: 'installation' },
  peekRoxAccountAuthority: () => ({ capture: async () => undefined }),
}))

type Handler = (ctx: unknown, ...args: unknown[]) => unknown | Promise<unknown>

async function createHarness(sessionManager: HandlerDeps['sessionManager']) {
  const { registerOnboardingSuggestHandlers } = await import('../onboarding-suggest')
  const handlers = new Map<string, Handler>()
  const server = {
    handle(channel: string, handler: Handler) {
      handlers.set(channel, handler)
    },
  } as unknown as RpcServer
  const deps = {
    sessionManager,
    platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
  } as unknown as HandlerDeps
  registerOnboardingSuggestHandlers(server, deps)
  const invoke = (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`missing handler for ${channel}`)
    return handler({}, ...args)
  }
  return { invoke }
}

describe('onboarding:suggestPreferences', () => {
  it('reports no-provider when the provider seam is absent', async () => {
    const { invoke } = await createHarness({} as HandlerDeps['sessionManager'])
    expect(await invoke(RPC_CHANNELS.onboarding.SUGGEST_PREFERENCES, { name: 'A' }))
      .toEqual({ ok: false, reason: 'no-provider' })
  })

  it('reports no-provider when no workspace is configured', async () => {
    workspaces = []
    runOneShot = async () => 'unused'
    const { invoke } = await createHarness({ runDistillOneShot: runOneShot } as unknown as HandlerDeps['sessionManager'])
    expect(await invoke(RPC_CHANNELS.onboarding.SUGGEST_PREFERENCES, { name: 'A' }))
      .toEqual({ ok: false, reason: 'no-provider' })
  })

  it('returns trimmed provider text when a workspace and runner exist', async () => {
    workspaces = [{ id: 'ws-1' }]
    runOneShot = async () => '  Черновик предпочтений.  '
    const { invoke } = await createHarness({ runDistillOneShot: runOneShot } as unknown as HandlerDeps['sessionManager'])
    expect(await invoke(RPC_CHANNELS.onboarding.SUGGEST_PREFERENCES, { name: 'Алиса' }))
      .toEqual({ ok: true, text: 'Черновик предпочтений.' })
  })

  it('classifies an auth/model failure as no-provider', async () => {
    workspaces = [{ id: 'ws-1' }]
    runOneShot = async () => { throw new Error('No authentication configured for call_llm') }
    const { invoke } = await createHarness({ runDistillOneShot: runOneShot } as unknown as HandlerDeps['sessionManager'])
    expect(await invoke(RPC_CHANNELS.onboarding.SUGGEST_PREFERENCES, {}))
      .toEqual({ ok: false, reason: 'no-provider' })
  })

  it('reports a generic failure as error, empty text never becomes ok', async () => {
    workspaces = [{ id: 'ws-1' }]
    runOneShot = async () => { throw new Error('boom') }
    const broken = await createHarness({ runDistillOneShot: runOneShot } as unknown as HandlerDeps['sessionManager'])
    expect(await broken.invoke(RPC_CHANNELS.onboarding.SUGGEST_PREFERENCES, {}))
      .toEqual({ ok: false, reason: 'error' })

    runOneShot = async () => '   '
    const empty = await createHarness({ runDistillOneShot: runOneShot } as unknown as HandlerDeps['sessionManager'])
    expect(await empty.invoke(RPC_CHANNELS.onboarding.SUGGEST_PREFERENCES, {}))
      .toEqual({ ok: false, reason: 'error' })
  })
})

describe('buildPreferencePrompt', () => {
  it('builds a Russian prompt from untrusted input', async () => {
    const { buildPreferencePrompt } = await import('../onboarding-suggest')
    const prompt = buildPreferencePrompt({
      name: 'Алиса',
      city: 'Москва',
      bubbleLabels: ['Дизайн', 'AI'],
      preferences: 'люблю краткость',
    })
    expect(prompt).toContain('Ты помогаешь пользователю заполнить профиль.')
    expect(prompt).toContain('Имя: Алиса')
    expect(prompt).toContain('Выбранные темы: Дизайн, AI')
    expect(prompt).toContain('Уже написанные предпочтения: люблю краткость')
  })

  it('tolerates non-object input', async () => {
    const { buildPreferencePrompt } = await import('../onboarding-suggest')
    expect(buildPreferencePrompt(null)).toContain('Имя: —')
  })
})