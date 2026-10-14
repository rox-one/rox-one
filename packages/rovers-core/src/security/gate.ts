/**
 * @rox/rovers-core — container-socket authorization gate (M1-B5).
 *
 * `spec.md` §6.5:258 treats the container socket as **root-equivalent** and
 * mandates an authorization gate plus label-based ownership. This module is that
 * gate: the container client (`engines/local/container-client.ts`) is reachable
 * only through the 12 published Rovers host tools (`spec.md` §6.4 table,
 * ratified 2026-10-09/C2), never as a raw `docker` exec (`q7-client-decision`
 * §5). Three refusals are structural here:
 *
 *   1. **Permission classes.** `ROVERS_TOOL_ACCESS` fixes the access class of
 *      every published tool. A tool outside the table is refused — never
 *      defaulted — and a tool may only run actions at or below its own class
 *      (`read` < `write` < `destructive`). The action `create` — the birth of a
 *      container — ranks equal to `write`, so a `write`-class tool such as
 *      `rovers_deploy` may create while a `read` tool may not.
 *   2. **Double-gating.** A mutating action that addresses an EXISTING container
 *      (`write`, `destructive`) needs BOTH a tool whose class allows it AND a
 *      target that carries both Rox ownership labels (`ROVERS_LABEL_SERVICE`,
 *      `ROVERS_LABEL_RUN`). A missing, partial or foreign label set is refused.
 *      A `create` action is exempt from the label gate by construction: at
 *      deploy time no container exists yet to carry the labels, and the client
 *      force-stamps both on `/containers/create` while forbidding a spec from
 *      re-pointing them (`engines/local/container-client.ts`, `create()` →
 *      `buildContainerBody()`), so ownership of a newly created container is
 *      guaranteed, not something the gate has to check — the gate authorizes the
 *      creation, it cannot attest to a label set that does not exist yet.
 *   3. **Socket pinning.** The endpoint must be a `unix://` socket; the file is
 *      resolved, `stat`-ed and pinned by `{dev, ino}`, and re-asserted per
 *      operation so a socket swap (TOCTOU) is refused.
 *
 * Every refusal leaves through the frozen taxonomy as `socket_denied` — "no
 * access to the engine socket" is exactly what the gate enforces — with a
 * Russian repair action (`spec.md` §5.2 step 4). This module imports no
 * `@rox/*` package: the config dir is injected by the host.
 *
 * The socket is resolved by hand (`lstat` + `readlink`) rather than with
 * `realpath`/`realpathSync`: on macOS `realpath` fails with `EOPNOTSUPP` on
 * Unix sockets (reached through at least one symlink on a real host), which
 * would turn a healthy engine into a spurious refusal.
 */

import { lstatSync, readlinkSync, statSync, type Stats } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { RoversError } from '../errors.ts'
import { ROVERS_LABEL_RUN, ROVERS_LABEL_SERVICE } from '../types.ts'
import type { RoversDockerEndpoint } from '../types.ts'

/* ─────────────────────────── permission classes ─────────────────────────── */

/**
 * The 12 published Rovers host tools and their access class (`spec.md` §6.4,
 * ratified 2026-10-09/C2). Frozen on purpose: the renderer, the ledger and the
 * agent tools all switch on it, so an accidental `default` is a security bug,
 * not a convenience.
 *
 *   • `read`        — no state change, no agent confirmation;
 *   • `write`       — reversible change, requires agent confirmation;
 *   • `destructive` — overwrites/removes data, requires agent confirmation.
 */
export const ROVERS_TOOL_ACCESS = Object.freeze({
  rovers_list: { access: 'read', confirmation: false, promptRu: 'Покажи сервисы роверов' },
  rovers_status: { access: 'read', confirmation: false, promptRu: 'Каково состояние сервиса?' },
  rovers_logs: { access: 'read', confirmation: false, promptRu: 'Покажи журнал сервиса' },
  rovers_monitor: { access: 'read', confirmation: false, promptRu: 'Покажи метрики и расходы' },
  rovers_deploy: { access: 'write', confirmation: true, promptRu: 'Разверни сервис' },
  rovers_stop: { access: 'write', confirmation: true, promptRu: 'Останови сервис' },
  rovers_backup: { access: 'write', confirmation: true, promptRu: 'Сделай резервную копию' },
  rovers_init_backup: { access: 'write', confirmation: true, promptRu: 'Инициализируй резервное копирование' },
  rovers_backup_scope: { access: 'write', confirmation: true, promptRu: 'Настрой область резервного копирования' },
  rovers_schedule: { access: 'write', confirmation: true, promptRu: 'Запланируй резервное копирование' },
  rovers_offsite_sync: { access: 'write', confirmation: true, promptRu: 'Настрой выгрузку копий вне площадки' },
  rovers_restore: { access: 'destructive', confirmation: true, promptRu: 'Восстанови сервис из копии' },
} as const)

/** One of the 12 published tool names. */
export type RoversToolName = keyof typeof ROVERS_TOOL_ACCESS

/** One table row: the access class, the confirmation rule and the RU prompt. */
export type RoversToolAccessEntry = (typeof ROVERS_TOOL_ACCESS)[RoversToolName]

/** The three access classes (`spec.md` §6.4). */
export type RoversAccessClass = RoversToolAccessEntry['access']

/**
 * The action a tool asks the gate to authorize. `read`/`write`/`destructive`
 * address an EXISTING container; `create` is the birth of one and so carries no
 * ownership labels to check. `create` ranks equal to `write`: a tool may run an
 * action when its own class ranks at or above the action's, so `read` tools
 * never mutate and `write` tools never run a destructive action.
 */
export type RoversGateAction = RoversAccessClass | 'create'

/** Monotone ordering: a higher class may run every lower-class action. */
const ACCESS_RANK: Record<RoversAccessClass, number> = { read: 0, write: 1, destructive: 2 }

/** Action ranks: `create` sits equal to `write` — both are reversible changes. */
const ACTION_RANK: Record<RoversGateAction, number> = { read: 0, write: 1, create: 1, destructive: 2 }

export function isRoversToolName(value: unknown): value is RoversToolName {
  return typeof value === 'string' && Object.hasOwn(ROVERS_TOOL_ACCESS, value)
}

/** The table row for a published tool, or `undefined` for an unknown tool. */
export function roversToolAccess(tool: string): RoversToolAccessEntry | undefined {
  return isRoversToolName(tool) ? ROVERS_TOOL_ACCESS[tool] : undefined
}

/**
 * Whether a tool needs agent confirmation. Fail-closed: an unknown tool returns
 * `true`, so a name that escaped the table can never be treated as read-only.
 */
export function requiresConfirmation(tool: string): boolean {
  return roversToolAccess(tool)?.confirmation ?? true
}

/** Whether a tool's class permits an action of the given class. */
export function toolAllowsAction(tool: string, action: RoversGateAction): boolean {
  const entry = roversToolAccess(tool)
  if (entry === undefined) return false
  return ACCESS_RANK[entry.access] >= ACTION_RANK[action]
}

/* ──────────────────────────────── the gate ─────────────────────────────── */

/** A container action the caller wants the gate to authorize. */
export interface RoversGateRequest {
  /** The published host tool invoking the action. */
  readonly tool: string
  /** The access class the action demands. */
  readonly action: RoversGateAction
  /**
   * Labels of the target container (from `inspect`/summary). Omit for a
   * `create` action (no container exists yet) or for a run-scoped aggregate read
   * (then `runId` is required).
   */
  readonly labels?: Record<string, string> | undefined
  /** Run id for a run-scoped aggregate read (`rovers_list`/`rovers_monitor`). */
  readonly runId?: string | undefined
  /** Whether the agent obtained the user confirmation the tool requires. */
  readonly confirmed?: boolean
}

/** A permitted action, with the ownership the gate verified. */
export interface RoversGateAllowance {
  readonly tool: RoversToolName
  readonly access: RoversAccessClass
  readonly action: RoversGateAction
  /** `serviceId` from `ROVERS_LABEL_SERVICE`; empty for `create` or a run-scoped read. */
  readonly serviceId: string
  /** `runId` from `ROVERS_LABEL_RUN` (or the run-scoped request); empty for `create`. */
  readonly runId: string
  /** True only when the caller asserted the confirmation the tool requires. */
  readonly confirmed: boolean
}

const REPAIR_TOOL = 'Запросите действие через опубликованный инструмент Rovers и повторите попытку.'
const REPAIR_CONFIRM = 'Подтвердите действие в Rox и повторите попытку.'
const REPAIR_LABEL = `Действуйте только с контейнерами Rox, помеченными ${ROVERS_LABEL_SERVICE} и ${ROVERS_LABEL_RUN}.`
const REPAIR_SCOPE = 'Укажите контейнер или запуск Rox, к которому относится действие.'
const REPAIR_ENDPOINT = 'Проверьте путь к сокету движка контейнеров в Rox и повторите попытку.'

/**
 * Authorize one container action, or throw a typed `socket_denied` refusal.
 *
 * The order is deliberate: an unpublished tool is refused before anything else,
 * a class mismatch before confirmation, and — for an action that names an
 * existing container — the label ownership (the double-gate) before the action
 * is allowed. `write`/`destructive` are only ever permitted against a container
 * carrying BOTH Rox labels. A `create` authorizes the birth of a container and
 * therefore checks tool class + confirmation only: there is no target yet whose
 * labels could be verified, and the client force-stamps both labels on create
 * (`container-client.ts`), so its allowance is returned with empty ownership. A
 * read may be container-scoped (both labels) or run-scoped (`runId`), so
 * aggregate listing stays label-filtered by the caller rather than unscoped.
 */
export function authorizeRoversAction(request: RoversGateRequest): RoversGateAllowance {
  const tool = request.tool
  if (!isRoversToolName(tool)) {
    throw refusal(`Инструмент «${tool}» не опубликован Rovers — доступ к сокету движка запрещён.`, REPAIR_TOOL)
  }
  const entry = ROVERS_TOOL_ACCESS[tool]
  if (ACCESS_RANK[entry.access] < ACTION_RANK[request.action]) {
    throw refusal(
      `Инструменту «${tool}» (класс ${entry.access}) запрещено действие класса ${request.action}.`,
      REPAIR_TOOL,
    )
  }

  const mutating = request.action !== 'read'
  if (mutating && entry.confirmation && request.confirmed !== true) {
    throw refusal(
      `Действие «${tool}» изменяет контейнеры и требует подтверждения пользователя.`,
      REPAIR_CONFIRM,
    )
  }

  // `create` births a container: no target exists yet to carry the ownership
  // labels, and the client stamps both on create and forbids a spec override
  // (`container-client.ts`), so ownership is guaranteed by construction. The
  // gate authorizes the creation on class + confirmation alone, with no
  // ownership to report.
  if (request.action === 'create') {
    return {
      tool,
      access: entry.access,
      action: request.action,
      serviceId: '',
      runId: '',
      confirmed: request.confirmed === true,
    }
  }

  if (request.labels !== undefined) {
    const serviceIdLabel = request.labels[ROVERS_LABEL_SERVICE]
    const runIdLabel = request.labels[ROVERS_LABEL_RUN]
    const serviceId = typeof serviceIdLabel === 'string' && serviceIdLabel.length > 0 ? serviceIdLabel : undefined
    const runId = typeof runIdLabel === 'string' && runIdLabel.length > 0 ? runIdLabel : undefined
    if (serviceId === undefined || runId === undefined) {
      throw refusal(
        `Контейнер не принадлежит Rovers: метки ${ROVERS_LABEL_SERVICE} и ${ROVERS_LABEL_RUN} должны присутствовать вместе.`,
        REPAIR_LABEL,
      )
    }
    return {
      tool,
      access: entry.access,
      action: request.action,
      serviceId,
      runId,
      confirmed: request.confirmed === true,
    }
  }

  if (mutating) {
    throw refusal(
      `Мутирующее действие «${tool}» разрешено только для контейнера с обеими метками Rovers.`,
      REPAIR_LABEL,
    )
  }
  const runId = request.runId?.trim()
  if (runId === undefined || runId.length === 0) {
    throw refusal(`Действие «${tool}» не ограничено контейнером или запуском Rovers.`, REPAIR_SCOPE)
  }
  return {
    tool,
    access: entry.access,
    action: request.action,
    serviceId: '',
    runId,
    confirmed: false,
  }
}

/* ─────────────────────────────── pinning ─────────────────────────────── */

const UNIX_SCHEME = 'unix://'
/** A pathological symlink chain is refused rather than followed forever. */
const MAX_SYMLINK_HOPS = 40

/**
 * Validate and pin a Docker endpoint before any use.
 *
 * Anything that is not a `unix://` socket with an absolute path is refused; the
 * path is resolved through its symlinks, `stat`-ed and pinned as
 * `{dev, ino}`. The returned `RoversDockerEndpoint` is what the container client
 * is constructed with.
 */
export function pinRoversDockerEndpoint(uri: string): RoversDockerEndpoint {
  const socket = resolveSocketPath(unixSocketPath(uri))
  const stats = statSocket(socket)
  return { uri: `${UNIX_SCHEME}${socket}`, socket, device: stats.dev, inode: stats.ino }
}

/**
 * Re-assert a pinned endpoint immediately before an operation. Fails with
 * `socket_denied` if the path now resolves elsewhere or the file's device/inode
 * changed — a socket swap between pin and use (TOCTOU).
 */
export function assertRoversEndpointPinned(endpoint: RoversDockerEndpoint): void {
  const resolved = resolveSocketPath(endpoint.socket)
  if (resolved !== endpoint.socket) {
    throw refusal(
      `Путь сокета изменился: ожидался «${endpoint.socket}», получен «${resolved}».`,
      REPAIR_ENDPOINT,
    )
  }
  const stats = statSocket(resolved)
  if (stats.dev !== endpoint.device || stats.ino !== endpoint.inode) {
    throw refusal(`Сокет «${endpoint.socket}» был подменён (изменились device/inode).`, REPAIR_ENDPOINT)
  }
}

/** Extract the absolute socket path from a `unix://` URI, or refuse. */
function unixSocketPath(uri: string): string {
  if (typeof uri !== 'string' || !uri.startsWith(UNIX_SCHEME)) {
    throw refusal(`Эндпоинт «${String(uri)}» не является unix:// сокетом.`, REPAIR_ENDPOINT)
  }
  const path = uri.slice(UNIX_SCHEME.length)
  if (!path.startsWith('/') || path.length <= 1) {
    throw refusal(`Эндпоинт «${uri}» не содержит абсолютного пути к сокету.`, REPAIR_ENDPOINT)
  }
  return path
}

/**
 * Resolve a path through its symlink chain by hand.
 *
 * `realpath` is avoided on purpose: it throws `EOPNOTSUPP` on Unix sockets on
 * macOS, so a healthy engine reached through `/var/run/docker.sock` would look
 * like a denial. Each hop is `lstat`-ed (so a symlink is detected) and
 * `readlink`-ed; the cap turns a symlink cycle into a typed refusal.
 */
function resolveSocketPath(raw: string): string {
  let current = resolve(raw)
  for (let hop = 0; hop < MAX_SYMLINK_HOPS; hop += 1) {
    let stats: Stats
    try {
      stats = lstatSync(current)
    } catch (cause) {
      throw refusal(`Сокет «${current}» недоступен.`, REPAIR_ENDPOINT, cause)
    }
    if (!stats.isSymbolicLink()) return current
    let target: string
    try {
      target = readlinkSync(current)
    } catch (cause) {
      throw refusal(`Не удалось разрешить символическую ссылку «${current}».`, REPAIR_ENDPOINT, cause)
    }
    current = resolve(dirname(current), target)
  }
  throw refusal(`Слишком много символических ссылок при разрешении «${raw}».`, REPAIR_ENDPOINT)
}

/** `stat` the resolved path (following any final link) and require a socket. */
function statSocket(socket: string): Stats {
  let stats: Stats
  try {
    stats = statSync(socket)
  } catch (cause) {
    throw refusal(`Сокет «${socket}» недоступен.`, REPAIR_ENDPOINT, cause)
  }
  if (!stats.isSocket()) {
    throw refusal(`«${socket}» не является unix-сокетом.`, REPAIR_ENDPOINT)
  }
  return stats
}

function refusal(message: string, repairAction: string, cause?: unknown): RoversError {
  return new RoversError('socket_denied', message, { repairAction, cause })
}
