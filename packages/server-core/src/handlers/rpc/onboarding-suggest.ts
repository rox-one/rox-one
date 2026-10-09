/**
 * Onboarding «А предложи сам?» handler.
 *
 * One-shot Russian draft of the profile preferences, produced by the existing
 * provider runtime: `SessionManager.runDistillOneShot` spawns a scratch agent
 * on the workspace's default/mini model and runs a single mini completion
 * (`runMiniCompletion`) — the same seam memory distillation uses. The 20 s
 * timeout is enforced here.
 *
 * There is NO fake text: when no usable provider path exists the handler
 * answers `{ ok: false, reason: 'no-provider' }`. This is the only place in the
 * profile flow allowed to touch a model — the renderer never calls one.
 */
import { peekRoxAccountAuthority, LOCAL_ROX_CALLER } from '@rox/shared/auth'
import { getWorkspaces } from '@rox/shared/config'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { SuggestPreferencesInput, SuggestPreferencesResult } from '@rox/shared/protocol'
import type { RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const SUGGEST_PREFERENCES_CHANNEL = RPC_CHANNELS.onboarding.SUGGEST_PREFERENCES

/** Wall-clock budget for the one-shot completion. */
export const SUGGEST_TIMEOUT_MS = 20_000

/** Longest free-form preference text fed to the prompt (chars). */
const MAX_PREFERENCES_CHARS = 2000
/** Longest name / city / label kept from the request (chars). */
const MAX_SHORT_CHARS = 120
/** Cap on bubble labels interpolated into the prompt. */
const MAX_BUBBLE_LABELS = 200

export const HANDLED_CHANNELS = [SUGGEST_PREFERENCES_CHANNEL] as const

class SuggestTimeoutError extends Error {
  constructor() {
    super('onboarding:suggestPreferences timed out')
    this.name = 'SuggestTimeoutError'
  }
}

/** Race a promise against the suggestion deadline. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SuggestTimeoutError()), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function clip(text: unknown, max: number): string | undefined {
  if (typeof text !== 'string') return undefined
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

function clipList(list: unknown, max: number): string[] {
  if (!Array.isArray(list)) return []
  return list.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, max)
}

/** Read one field from an untrusted request object. */
function readField(source: object, key: keyof SuggestPreferencesInput): unknown {
  return Object.getOwnPropertyDescriptor(source, key)?.value
}

/** Build the Russian one-shot prompt from the collected questionnaire fields. */
export function buildPreferencePrompt(input: unknown): string {
  const source: object = input && typeof input === 'object' ? input : {}
  const labels = clipList(readField(source, 'bubbleLabels'), MAX_BUBBLE_LABELS)
  const preferences = clip(readField(source, 'preferences'), MAX_PREFERENCES_CHARS)
  const lines = [
    'Ты помогаешь пользователю заполнить профиль.',
    'Сформулируй по-русски короткий черновик раздела «Ваши предпочтения»: 2–4 предложения от первого лица.',
    'Опирайся только на данные ниже, не выдумывай факты. Без markdown, без заголовков, без пояснений — верни только текст черновика.',
    '',
    `Имя: ${clip(readField(source, 'name'), MAX_SHORT_CHARS) ?? '—'}`,
    `Дата рождения: ${clip(readField(source, 'birthDate'), MAX_SHORT_CHARS) ?? '—'}`,
    `Язык интерфейса: ${clip(readField(source, 'interfaceLanguage'), MAX_SHORT_CHARS) ?? '—'}`,
    `Язык общения: ${clip(readField(source, 'communicationLanguage'), MAX_SHORT_CHARS) ?? '—'}`,
    `Город: ${clip(readField(source, 'city'), MAX_SHORT_CHARS) ?? '—'}`,
    `Часовой пояс: ${clip(readField(source, 'timezone'), MAX_SHORT_CHARS) ?? '—'}`,
    `Выбранные темы: ${labels.length > 0 ? labels.join(', ') : '—'}`,
    `Уже написанные предпочтения: ${preferences ?? '—'}`,
  ]
  return lines.join('\n')
}

/**
 * Decide whether a provider-runtime failure means "no usable provider" (the
 * expected first-run state) or a genuine error worth surfacing as such.
 */
export function classifySuggestionFailure(message: string | undefined): 'no-provider' | 'error' {
  if (!message) return 'error'
  if (/no authentication|not authenticated|not configured|no provider|no credential|api key|missing[\s\S]*?(key|model)|unknown provider|no workspaces/i.test(message)) {
    return 'no-provider'
  }
  return 'error'
}

export function registerOnboardingSuggestHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  server.handle(
    SUGGEST_PREFERENCES_CHANNEL,
    async (_ctx, rawInput: unknown): Promise<SuggestPreferencesResult> => {
      const run = deps.sessionManager?.runDistillOneShot
      if (typeof run !== 'function') return { ok: false, reason: 'no-provider' }
      // First run has no workspace yet; the provider runtime is workspace-scoped.
      const workspaceId = getWorkspaces()[0]?.id
      if (!workspaceId) return { ok: false, reason: 'no-provider' }

      try {
        const owner = await peekRoxAccountAuthority()?.capture(LOCAL_ROX_CALLER)
        const text = await withTimeout(
          run.call(deps.sessionManager, workspaceId, buildPreferencePrompt(rawInput), owner),
          SUGGEST_TIMEOUT_MS,
        )
        const draft = typeof text === 'string' ? text.trim() : ''
        if (draft.length === 0) return { ok: false, reason: 'error' }
        return { ok: true, text: draft }
      } catch (error) {
        if (error instanceof SuggestTimeoutError) return { ok: false, reason: 'timeout' }
        const message = error instanceof Error ? error.message : undefined
        log?.warn?.('onboarding:suggestPreferences failed', message)
        return { ok: false, reason: classifySuggestionFailure(message) }
      }
    },
  )
}