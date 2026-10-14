/**
 * @rox/rovers-core — the frozen Rovers failure taxonomy (`spec.md` §5.5).
 *
 * The M0 verdict froze the 14-code enum. M1 acceptance covers the runtime
 * subset (A2), M3 the three lifecycle codes, and `engine_removed` is the Q8
 * negative control («Убрать движок»). The codes are the contract: the renderer,
 * the ledger and the agent tools all switch on them, so they are exported as a
 * literal union (checked at runtime by `isRoversErrorCode`) plus the two
 * milestone subsets.
 *
 * Every user-visible failure carries a typed code, a Russian message and a
 * repair action (`spec.md` §5.2 step 4). The code and the repair action are
 * machine-readable; the Russian copy is authored per surface and injected here
 * so the message never drifts from the code.
 */

/** The 14 frozen codes, in `spec.md` §5.5 order. */
export const ROVERS_ERROR_CODES = [
  // M1 runtime subset (A2 at M1)
  'no_runtime',
  'vm_start_failed',
  'socket_denied',
  'image_unavailable',
  'digest_mismatch',
  'port_conflict',
  'proxy_unavailable',
  'oom_at_start',
  'healthcheck_timeout',
  'signature_invalid',
  // M3 lifecycle subset
  'backup_failed',
  'restore_failed',
  'update_failed_rolled_back',
  // M0 Q8 negative control
  'engine_removed',
] as const

export type RoversErrorCode = (typeof ROVERS_ERROR_CODES)[number]

/** The runtime codes M1 acceptance exercises (`spec.md` §8 A2). */
export const ROVERS_M1_RUNTIME_CODES = [
  'no_runtime',
  'vm_start_failed',
  'socket_denied',
  'image_unavailable',
  'digest_mismatch',
  'port_conflict',
  'proxy_unavailable',
  'oom_at_start',
  'healthcheck_timeout',
  'signature_invalid',
] as const satisfies readonly RoversErrorCode[]

/** The lifecycle codes deferred to M3 acceptance (`spec.md` §8 A2). */
export const ROVERS_M3_LIFECYCLE_CODES = [
  'backup_failed',
  'restore_failed',
  'update_failed_rolled_back',
] as const satisfies readonly RoversErrorCode[]

/** The Q8 negative control code. */
export const ROVERS_NEGATIVE_CONTROL_CODES = ['engine_removed'] as const satisfies readonly RoversErrorCode[]

/** Russian copy for each code (product copy; W3/W5 may refine, never recode). */
export const ROVERS_ERROR_MESSAGES_RU: Record<RoversErrorCode, string> = {
  no_runtime: 'Не найден движок контейнеров — Rox не может запускать сервисы на этом Mac.',
  vm_start_failed: 'Не удалось запустить виртуальную машину движка.',
  socket_denied: 'Нет доступа к сокету движка контейнеров.',
  image_unavailable: 'Образ сервиса недоступен для загрузки.',
  digest_mismatch: 'Загруженный образ не совпал с закреплённым дайджестом.',
  port_conflict: 'Порт уже занят другим процессом.',
  proxy_unavailable: 'Локальный прокси Rox недоступен — имя .rovers.localhost не отвечает.',
  oom_at_start: 'Сервису не хватило памяти при запуске.',
  healthcheck_timeout: 'Сервис не прошёл проверку здоровья за отведённое время.',
  signature_invalid: 'Подпись каталога или артефакта недействительна.',
  backup_failed: 'Не удалось создать резервную копию.',
  restore_failed: 'Не удалось восстановить сервис из копии.',
  update_failed_rolled_back: 'Обновление не удалось; выполнена автоматическая откатка.',
  engine_removed: 'Движок этого сервиса был удалён.',
}

export function isRoversErrorCode(value: unknown): value is RoversErrorCode {
  return typeof value === 'string' && (ROVERS_ERROR_CODES as readonly string[]).includes(value)
}

export interface RoversErrorOptions {
  /** A concrete, user-actionable repair step (`spec.md` §5.2 step 4). */
  repairAction?: string
  /** The underlying cause, preserved for logs (never shown raw to the user). */
  cause?: unknown
}

export interface RoversErrorJson {
  code: RoversErrorCode
  message: string
  repairAction?: string
}

/**
 * A typed Rovers failure. `message` defaults to the Russian copy for the code;
 * callers may pass a more specific message but the `code` is authoritative.
 */
export class RoversError extends Error {
  override readonly name = 'RoversError'
  readonly code: RoversErrorCode
  readonly repairAction?: string

  constructor(code: RoversErrorCode, message?: string, options: RoversErrorOptions = {}) {
    super(message ?? ROVERS_ERROR_MESSAGES_RU[code], { cause: options.cause })
    this.code = code
    this.repairAction = options.repairAction
  }

  toJSON(): RoversErrorJson {
    return {
      code: this.code,
      message: this.message,
      ...(this.repairAction ? { repairAction: this.repairAction } : {}),
    }
  }
}

/** Narrow an unknown throwable to a typed code, defaulting to a generic failure. */
export function roversErrorCodeOf(error: unknown, fallback: RoversErrorCode = 'vm_start_failed'): RoversErrorCode {
  return error instanceof RoversError ? error.code : fallback
}
