/**
 * @rox/rovers-core — Docker Engine API container client (M1-B4).
 *
 * The only way Rox talks to a container engine: a pinned Unix-socket endpoint
 * (`RoversDockerEndpoint`, validated by the M1-B5 gate) driven over `node:http`.
 * No `docker` exec is ever spawned (q7-client-decision §6). The client is
 * deliberately narrow — it implements exactly the `RoversContainerClient`
 * contract — and every failure leaves through the frozen taxonomy
 * (`mapDockerError`) or the invalid-spec refusal (`RoversContainerSpecError`),
 * so callers never see a raw transport error.
 *
 * Two invariants are enforced here rather than by the caller:
 *   • images are digest-pinned (`ROVERS_DIGEST_IMAGE_RE`): a tag is refused, and
 *     a pull whose resolved digest differs from the requested one is refused
 *     (`digest_mismatch`) — the resolved digest is what the caller records;
 *   • every created container carries both ownership labels, overriding any
 *     value the spec tried to set, so `listByRun` and removal can never touch a
 *     foreign container (`types.ts`, `spec.md` §6.5).
 *
 * The transport reads response bodies byte-for-byte (`latin1`) because
 * `/containers/<id>/logs` is a binary multiplexed stream; JSON responses are
 * re-decoded as UTF-8 before parsing.
 */

import { request as httpRequest } from 'node:http'
import type { IncomingHttpHeaders } from 'node:http'

import { RoversError } from '../../errors.ts'
import { ROVERS_DIGEST_IMAGE_RE, ROVERS_LABEL_RUN, ROVERS_LABEL_SERVICE } from '../../types.ts'
import type {
  RoversContainerClient,
  RoversContainerInspect,
  RoversContainerSpec,
  RoversContainerSummary,
  RoversDockerEndpoint,
  RoversLogOptions,
  RoversPullResult,
} from '../../types.ts'

/** One request to the Docker Engine API over the pinned socket. */
export interface RoversDockerRequest {
  method: string
  path: string
  /** JSON request body; omitted for body-less verbs (start/stop/remove). */
  body?: string
}

/**
 * A raw engine response. `body` is byte-exact (`latin1`) on purpose: the logs
 * endpoint is a binary multiplexed stream, so the transport must not mangle it.
 */
export interface RoversDockerResponse {
  status: number
  headers: Record<string, string>
  body: string
}

export type DockerRequestFn = (req: RoversDockerRequest) => Promise<RoversDockerResponse>

/** A container started outside Rox is never adopted; the spec is Rox-internal. */
export class RoversContainerSpecError extends Error {
  override readonly name = 'RoversContainerSpecError'
  /** The offending spec field, e.g. `serviceId`. */
  readonly field: string

  constructor(field: string, message: string) {
    super(message)
    this.field = field
  }
}

const NO_RUNTIME_REPAIR = 'Установите или запустите движок контейнеров в Rox.'
const INVALID_RESPONSE_REPAIR = 'Перезапустите движок контейнеров в Rox и повторите попытку.'
const DIGEST_REPAIR = 'Укажите образ, закреплённый дайджестом: repo@sha256:<64 hex>.'
/** Local services bind loopback only; the Rox proxy reaches them from the host. */
const LOOPBACK_HOST = '127.0.0.1'
const DEFAULT_RESTART_POLICY = 'unless-stopped'
const DEFAULT_LOG_TAIL = 200
const DEFAULT_LOG_MAX_BYTES = 65536
const LOG_TRUNCATION_MARKER = '…[обрезано начало]\n'
const BODY_EXCERPT_LIMIT = 200
/** Docker writes a pull/stream error either as `error` or inside `errorDetail`. */
const PORT_CONFLICT_RE = /port is already allocated|address already in use/i
const OOM_RE = /no space|out of memory|oom/i

/* ───────────────────────────── transport ───────────────────────────── */

/**
 * The real transport: one HTTP request per call over the pinned Unix socket,
 * reading the whole response body. Bodies are decoded `latin1` (byte-exact) so
 * the binary log multiplexing survives the round trip.
 */
export function createUnixSocketRequest(endpoint: RoversDockerEndpoint): DockerRequestFn {
  return (req) => {
    const { promise, resolve, reject } = Promise.withResolvers<RoversDockerResponse>()
    const payload = req.body ?? ''
    const headers: Record<string, string> = {
      host: 'localhost',
      'content-length': String(Buffer.byteLength(payload, 'utf8')),
    }
    if (req.body !== undefined) headers['content-type'] = 'application/json'

    const clientRequest = httpRequest(
      { socketPath: endpoint.socket, method: req.method, path: req.path, headers },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('error', reject)
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: normalizeHeaders(response.headers),
            body: Buffer.concat(chunks).toString('latin1'),
          })
        })
      },
    )
    clientRequest.on('error', reject)
    if (req.body !== undefined) clientRequest.write(req.body)
    clientRequest.end()
    return promise
  }
}

function normalizeHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') normalized[key] = value
    else if (Array.isArray(value)) normalized[key] = value.join(', ')
  }
  return normalized
}

/* ──────────────────────────── error mapping ─────────────────────────── */

/**
 * Translate a Docker Engine API rejection into the frozen taxonomy (`spec.md`
 * §5.5). The code is the contract; the message carries the status plus a short
 * body excerpt so logs stay diagnostic, and every branch is repairable.
 */
export function mapDockerError(status: number, body: string): RoversError {
  const excerpt = excerptOf(body)
  if (status === 401 || status === 403) {
    return new RoversError('socket_denied', `Движок контейнеров отклонил доступ к сокету (HTTP ${status}): ${excerpt}`, {
      repairAction: 'Разрешите Rox доступ к сокету движка контейнеров и повторите попытку.',
    })
  }
  if (status === 404) {
    return new RoversError('image_unavailable', `Движок контейнеров не нашёл объект (HTTP 404): ${excerpt}`, {
      repairAction: 'Проверьте имя и дайджест образа, затем повторите загрузку.',
    })
  }
  if (status === 409) {
    return new RoversError(
      'vm_start_failed',
      `Конфликт с уже существующим контейнером (HTTP 409): ${excerpt}`,
      { repairAction: 'Остановите или удалите конфликтующий контейнер и повторите запуск сервиса.' },
    )
  }
  if (status === 400 && PORT_CONFLICT_RE.test(body)) {
    return new RoversError('port_conflict', `Порт уже занят другим процессом (HTTP 400): ${excerpt}`, {
      repairAction: 'Освободите порт или измените проброс портов сервиса и повторите попытку.',
    })
  }
  if (status === 500 && OOM_RE.test(body)) {
    return new RoversError('oom_at_start', `Сервису не хватило ресурсов при запуске (HTTP 500): ${excerpt}`, {
      repairAction: 'Увеличьте лимит памяти сервиса или освободите место на диске и повторите попытку.',
    })
  }
  if (status >= 500) {
    return new RoversError('vm_start_failed', `Движок контейнеров сообщил о сбое (HTTP ${status}): ${excerpt}`, {
      repairAction: 'Перезапустите движок контейнеров в Rox и повторите попытку.',
    })
  }
  return new RoversError('image_unavailable', `Движок контейнеров отклонил запрос (HTTP ${status}): ${excerpt}`, {
    repairAction: 'Проверьте образ и параметры запроса, затем повторите попытку.',
  })
}

function excerptOf(body: string): string {
  const collapsed = utf8Text(body)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
  if (collapsed.length === 0) return '(пустой ответ)'
  return collapsed.length > BODY_EXCERPT_LIMIT ? `${collapsed.slice(0, BODY_EXCERPT_LIMIT)}…` : collapsed
}

/* ─────────────────────────────── client ─────────────────────────────── */

export function createDockerEngineClient(options: {
  endpoint: RoversDockerEndpoint
  requestImpl?: DockerRequestFn
}): RoversContainerClient {
  const send: DockerRequestFn = options.requestImpl ?? createUnixSocketRequest(options.endpoint)

  const ensureOk = (response: RoversDockerResponse): void => {
    if (response.status >= 400) throw mapDockerError(response.status, response.body)
  }

  return {
    async ping(): Promise<void> {
      let response: RoversDockerResponse
      try {
        response = await send({ method: 'GET', path: '/version' })
      } catch (cause) {
        throw new RoversError('no_runtime', `Движок контейнеров недоступен: ${describeCause(cause)}`, {
          repairAction: NO_RUNTIME_REPAIR,
          cause,
        })
      }
      if (response.status < 200 || response.status >= 300) {
        throw new RoversError('no_runtime', `Движок контейнеров не ответил на проверку (HTTP ${response.status}): ${excerptOf(response.body)}`, {
          repairAction: NO_RUNTIME_REPAIR,
        })
      }
    },

    async pull(imageRef: string): Promise<RoversPullResult> {
      assertDigestImage(imageRef)
      const created = await send({
        method: 'POST',
        path: `/images/create?fromImage=${encodeURIComponent(imageRef)}`,
      })
      ensureOk(created)
      const streamError = firstStreamError(created.body)
      if (streamError) throw mapDockerError(streamError.status, streamError.line)

      const inspected = await send({ method: 'GET', path: `/images/${imageRef}/json` })
      ensureOk(inspected)
      const info = asJsonObject(inspected.body)
      const id = typeof info.Id === 'string' && info.Id.length > 0 ? info.Id : undefined
      const requested = imageRef.slice(imageRef.indexOf('@') + 1)
      const resolved = resolveImageDigest(info)
      if (id === undefined || resolved !== requested) {
        throw new RoversError(
          'digest_mismatch',
          `Загруженный образ не совпал с закреплённым дайджестом: запрошен ${requested}, движок вернул ${resolved ?? 'ничего'}.`,
          { repairAction: DIGEST_REPAIR },
        )
      }
      return { id, digest: resolved }
    },

    async create(spec: RoversContainerSpec): Promise<{ id: string }> {
      assertDigestImage(spec.image)
      if (typeof spec.serviceId !== 'string' || spec.serviceId.length === 0) {
        throw new RoversContainerSpecError('serviceId', 'Спецификация контейнера без serviceId — контейнер не был бы привязан к сервису Rox.')
      }
      if (typeof spec.runId !== 'string' || spec.runId.length === 0) {
        throw new RoversContainerSpecError('runId', 'Спецификация контейнера без runId — развёртывание нельзя было бы сопоставить с запуском.')
      }
      assertStringArrayField('entrypoint', spec.entrypoint)
      assertStringArrayField('command', spec.command)

      const response = await send({
        method: 'POST',
        path: `/containers/create?name=${encodeURIComponent(spec.name)}`,
        body: JSON.stringify(buildContainerBody(spec)),
      })
      ensureOk(response)
      const created = asJsonObject(response.body)
      const id = typeof created.Id === 'string' ? created.Id : ''
      if (id.length === 0) throw invalidResponse(response.body)
      return { id }
    },

    async start(containerId: string): Promise<void> {
      const response = await send({ method: 'POST', path: `/containers/${encodeURIComponent(containerId)}/start` })
      ensureOk(response)
    },

    async inspect(containerId: string): Promise<RoversContainerInspect> {
      const response = await send({ method: 'GET', path: `/containers/${encodeURIComponent(containerId)}/json` })
      ensureOk(response)
      const raw = asJsonObject(response.body)
      const state = asRecord(raw.State)
      const config = asRecord(raw.Config)
      const exitCode = typeof state.ExitCode === 'number' ? state.ExitCode : undefined
      return {
        id: typeof raw.Id === 'string' ? raw.Id : containerId,
        state: {
          status: typeof state.Status === 'string' ? state.Status : 'unknown',
          running: state.Running === true,
          ...(exitCode === undefined ? {} : { exitCode }),
          health: normalizeHealth(state.Health),
        },
        config: {
          image: typeof config.Image === 'string' ? config.Image : '',
          labels: isStringRecord(config.Labels) ? config.Labels : {},
        },
      }
    },

    async logs(containerId: string, logOptions?: RoversLogOptions): Promise<string> {
      const tail = logOptions?.tail ?? DEFAULT_LOG_TAIL
      const response = await send({
        method: 'GET',
        path: `/containers/${encodeURIComponent(containerId)}/logs?stdout=1&stderr=1&tail=${tail}`,
      })
      ensureOk(response)
      return capLogBytes(decodeLogStream(response.body), logOptions?.maxBytes)
    },

    async stop(containerId: string, timeoutSec = 10): Promise<void> {
      const response = await send({
        method: 'POST',
        path: `/containers/${encodeURIComponent(containerId)}/stop?t=${timeoutSec}`,
      })
      // 304 means the container was already stopped — success for a reconciler.
      ensureOk(response)
    },

    async remove(containerId: string, removeOptions?: { force?: boolean; volumes?: boolean }): Promise<void> {
      const force = removeOptions?.force === true ? 1 : 0
      const volumes = removeOptions?.volumes === true ? 1 : 0
      const response = await send({
        method: 'DELETE',
        path: `/containers/${encodeURIComponent(containerId)}?force=${force}&v=${volumes}`,
      })
      ensureOk(response)
    },

    async listByRun(runId: string): Promise<RoversContainerSummary[]> {
      // Label filter only: a name prefix would also match containers Rox did not create.
      const filters = encodeURIComponent(JSON.stringify({ label: [`${ROVERS_LABEL_RUN}=${runId}`] }))
      const response = await send({ method: 'GET', path: `/containers/json?all=1&filters=${filters}` })
      ensureOk(response)
      return asJsonArray(response.body).map(toContainerSummary)
    },
  }
}

function assertDigestImage(image: string): void {
  if (!ROVERS_DIGEST_IMAGE_RE.test(image)) {
    throw new RoversError(
      'digest_mismatch',
      `Образ «${image}» не закреплён дайджестом — теги и latest не принимаются.`,
      { repairAction: DIGEST_REPAIR },
    )
  }
}

/**
 * `entrypoint`/`command` cross to the Engine API untouched (`Entrypoint`/`Cmd`).
 * A non-string element would come back as an opaque daemon 400 naming neither
 * the field nor the spec, so it is refused here with the field name. `null` is
 * refused too: the TypeScript type is `string[]`, so a `null` can only come from
 * hand-written or untyped JSON, and naming it beats an Engine decode error.
 *
 * A **sparse** array is refused as well: `Array.prototype.some` skips holes, so
 * `new Array(2)` would slip through a `some`-based check and then serialize to
 * `[null,null]` — the exact opaque failure this guard exists to prevent.
 */
function assertStringArrayField(field: 'entrypoint' | 'command', value: unknown): void {
  if (value === undefined) return
  const isDenseArray = Array.isArray(value) && Object.keys(value).length === value.length
  if (!isDenseArray || !(value as unknown[]).every((part) => typeof part === 'string')) {
    throw new RoversContainerSpecError(
      field,
      `Поле «${field}» должно быть массивом строк (как Docker Entrypoint/Cmd), получено ${describeCause(value)}.`,
    )
  }
}

/**
 * Build the `/containers/create` body from a Rox spec.
 *
 * Ownership labels are written last on purpose: a spec can add labels but can
 * never re-point a container at another service or run. Durations cross from
 * milliseconds (Rox) to nanoseconds (Docker).
 */
function buildContainerBody(spec: RoversContainerSpec): Record<string, unknown> {
  const exposedPorts: Record<string, Record<string, never>> = {}
  const portBindings: Record<string, Array<{ HostIp: string; HostPort: string }>> = {}
  for (const port of spec.ports ?? []) {
    const key = `${port.container}/${port.protocol ?? 'tcp'}`
    exposedPorts[key] = {}
    portBindings[key] = [{ HostIp: LOOPBACK_HOST, HostPort: String(port.host) }]
  }

  let healthcheck: Record<string, unknown> | undefined
  if (spec.healthcheck) {
    healthcheck = {
      Test: spec.healthcheck.test,
      ...(spec.healthcheck.intervalMs === undefined ? {} : { Interval: millisToNanos(spec.healthcheck.intervalMs) }),
      ...(spec.healthcheck.timeoutMs === undefined ? {} : { Timeout: millisToNanos(spec.healthcheck.timeoutMs) }),
      ...(spec.healthcheck.retries === undefined ? {} : { Retries: spec.healthcheck.retries }),
      ...(spec.healthcheck.startPeriodMs === undefined
        ? {}
        : { StartPeriod: millisToNanos(spec.healthcheck.startPeriodMs) }),
    }
  }

  return {
    Image: spec.image,
    name: spec.name,
    ...(spec.entrypoint === undefined ? {} : { Entrypoint: spec.entrypoint }),
    ...(spec.command === undefined ? {} : { Cmd: spec.command }),
    Env: Object.entries(spec.env ?? {}).map(([key, value]) => `${key}=${value}`),
    Labels: {
      ...(spec.labels ?? {}),
      [ROVERS_LABEL_SERVICE]: spec.serviceId,
      [ROVERS_LABEL_RUN]: spec.runId,
    },
    ExposedPorts: exposedPorts,
    ...(healthcheck === undefined ? {} : { Healthcheck: healthcheck }),
    HostConfig: {
      PortBindings: portBindings,
      Binds: (spec.volumes ?? []).map(
        (volume) => `${volume.hostPath}:${volume.containerPath}${volume.readOnly === true ? ':ro' : ''}`,
      ),
      ...(spec.memoryBytes === undefined ? {} : { Memory: spec.memoryBytes }),
      ...(spec.cpus === undefined ? {} : { NanoCpus: Math.round(spec.cpus * 1e9) }),
      RestartPolicy: { Name: spec.restartPolicy ?? DEFAULT_RESTART_POLICY },
    },
  }
}

function millisToNanos(millis: number): number {
  return Math.round(millis * 1e6)
}

function toContainerSummary(entry: unknown): RoversContainerSummary {
  const container = asRecord(entry)
  return {
    id: typeof container.Id === 'string' ? container.Id : '',
    names: Array.isArray(container.Names) ? container.Names.filter((name): name is string => typeof name === 'string') : [],
    image: typeof container.Image === 'string' ? container.Image : '',
    state: typeof container.State === 'string' ? container.State : '',
    labels: isStringRecord(container.Labels) ? container.Labels : {},
  }
}

/* ──────────────────────────── logs decoding ─────────────────────────── */

/**
 * Decode a Docker log response.
 *
 * Without a TTY the engine multiplexes stdout/stderr into 8-byte framed chunks
 * (byte 0 = stream id 1|2, bytes 4–7 = big-endian payload length). With a TTY —
 * or from a stub — the payload is plain text and is returned untouched.
 */
function decodeLogStream(raw: string): string {
  const bytes = Buffer.from(raw, 'latin1')
  if (bytes.length < 8) return raw
  const first = bytes[0]
  if (first !== 1 && first !== 2) return raw

  const payloads: Buffer[] = []
  let offset = 0
  while (offset + 8 <= bytes.length) {
    const streamId = bytes[offset]
    if (streamId !== 1 && streamId !== 2) break
    const length = bytes.readUInt32BE(offset + 4)
    if (offset + 8 + length > bytes.length) break
    payloads.push(bytes.subarray(offset + 8, offset + 8 + length))
    offset += 8 + length
  }
  if (offset < 8) return raw
  // A tail cut can leave a partial frame; keep its bytes rather than dropping them.
  if (offset < bytes.length) payloads.push(bytes.subarray(offset))
  return Buffer.concat(payloads).toString('utf8')
}

/**
 * Cap the log payload at `maxBytes` bytes by dropping from the FRONT, so the
 * newest lines survive: the returned string always ends with the real tail and
 * starts with a marker when anything was cut.
 */
function capLogBytes(text: string, maxBytes: number | undefined): string {
  const limit =
    maxBytes === undefined || !Number.isFinite(maxBytes) || maxBytes < 0 ? DEFAULT_LOG_MAX_BYTES : Math.floor(maxBytes)
  if (limit === 0) return ''
  const bytes = Buffer.from(text, 'utf8')
  if (bytes.length <= limit) return text

  const markerLength = Buffer.byteLength(LOG_TRUNCATION_MARKER, 'utf8')
  if (limit <= markerLength) return Buffer.from(LOG_TRUNCATION_MARKER, 'utf8').subarray(0, limit).toString('utf8')

  let start = bytes.length - (limit - markerLength)
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start += 1
  return LOG_TRUNCATION_MARKER + bytes.subarray(start).toString('utf8')
}

function normalizeHealth(health: unknown): { status: 'starting' | 'healthy' | 'unhealthy' | 'none' } {
  const status = asRecord(health).Status
  if (status === 'starting' || status === 'healthy' || status === 'unhealthy') return { status }
  return { status: 'none' }
}

/* ──────────────────────────── response parsing ──────────────────────── */

/**
 * The transport is byte-exact (`latin1`); Docker's JSON responses are UTF-8
 * text. Re-decode only strings made of single-byte code units — a no-op for
 * ASCII and for callers that hand us already-decoded text.
 */
function utf8Text(body: string): string {
  for (let index = 0; index < body.length; index += 1) {
    if (body.charCodeAt(index) > 0xff) return body
  }
  return Buffer.from(body, 'latin1').toString('utf8')
}

function parseJsonResponse(body: string): unknown {
  try {
    return JSON.parse(utf8Text(body))
  } catch (cause) {
    throw invalidResponse(body, cause)
  }
}

function asJsonObject(body: string): Record<string, unknown> {
  const parsed = parseJsonResponse(body)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalidResponse(body)
  return parsed as Record<string, unknown>
}

function asJsonArray(body: string): unknown[] {
  const parsed = parseJsonResponse(body)
  if (!Array.isArray(parsed)) throw invalidResponse(body)
  return parsed
}

function invalidResponse(body: string, cause?: unknown): RoversError {
  return new RoversError('vm_start_failed', `Движок контейнеров вернул некорректный ответ: ${excerptOf(body)}`, {
    repairAction: INVALID_RESPONSE_REPAIR,
    cause,
  })
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every((entry) => typeof entry === 'string')
}

/**
 * The manifest digest the engine actually stored: the API's own `Descriptor`
 * when present, otherwise the `repo@sha256:…` entry of `RepoDigests`.
 */
function resolveImageDigest(info: Record<string, unknown>): string | undefined {
  const descriptor = asRecord(info.Descriptor).digest
  if (typeof descriptor === 'string' && /^sha256:[a-f0-9]{64}$/.test(descriptor)) return descriptor
  const repoDigests = info.RepoDigests
  if (!Array.isArray(repoDigests)) return undefined
  for (const entry of repoDigests) {
    if (typeof entry !== 'string') continue
    const at = entry.indexOf('@')
    if (at === -1) continue
    const digest = entry.slice(at + 1)
    if (/^sha256:[a-f0-9]{64}$/.test(digest)) return digest
  }
  return undefined
}

/**
 * A streaming pull reports failure inside a JSON line rather than in the HTTP
 * status. There is no status on that line, so it maps as 404 (`image_unavailable`)
 * unless the engine supplied a numeric `errorDetail.code`.
 */
function firstStreamError(body: string): { status: number; line: string } | undefined {
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    const record = asRecord(parsed)
    if (typeof record.error !== 'string' || record.error.length === 0) continue
    const code = asRecord(record.errorDetail).code
    return { status: typeof code === 'number' ? code : 404, line: trimmed }
  }
  return undefined
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  return String(cause)
}
