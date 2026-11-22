/**
 * HTTP client for the Rox Cloud public API.
 *
 * The client holds exactly one bearer key (`rox_sk_…`) and knows nothing about
 * sandbox providers: the API owns those credentials. Every method maps one to
 * one onto a route under `/v1`, so there is no hidden retry, no cache and no
 * fallback that could turn a refusal into a fake success.
 */

export type SandboxOs = 'linux' | 'windows' | 'macos'

export interface Sandbox {
  readonly id: string
  readonly object: string
  readonly provider: string
  readonly state: string
  readonly created_at: string
  readonly expires_at: string | null
  readonly cost_so_far_cents: number
  readonly cost_so_far_usd: string
  readonly routing_reason: string | null
}

export interface SandboxList {
  readonly object: string
  readonly data: Sandbox[]
  readonly has_more: boolean
  readonly next_cursor: string | null
}

export interface CreateSandboxInput {
  readonly os: SandboxOs
  readonly cpu: number
  readonly memoryGb: number
  readonly ttlSec?: number
  readonly provider?: string
}

export interface ExecInput {
  readonly command: string
  readonly timeoutSec?: number
}

export interface ExecResult {
  readonly stdout: string
  readonly stderr: string
  readonly exit_code: number
}

/** The shape a fake or a wrapped `fetch` has to satisfy. */
export interface CloudRequestInit {
  readonly method: string
  readonly headers: Record<string, string>
  readonly body?: BodyInit
}

export type FetchLike = (url: string, init: CloudRequestInit) => Promise<Response>

/**
 * A refusal from Rox Cloud, either the documented error envelope or a network
 * failure (`status: 0`). `message` is already safe to show: the API key is
 * redacted before the error object is built.
 */
export class CloudApiError extends Error {
  readonly code: string
  readonly status: number
  readonly requestId: string | undefined

  constructor(code: string, message: string, status: number, requestId?: string) {
    super(message)
    this.name = 'CloudApiError'
    this.code = code
    this.status = status
    this.requestId = requestId
  }
}

export interface CloudClientOptions {
  readonly baseUrl: string
  readonly apiKey: string
  readonly fetch?: FetchLike
}

export interface CreateSandboxOptions {
  readonly idempotencyKey?: string
}

export interface CloudClient {
  createSandbox(input: CreateSandboxInput, options?: CreateSandboxOptions): Promise<Sandbox>
  listSandboxes(): Promise<SandboxList>
  getSandbox(sandboxId: string): Promise<Sandbox>
  exec(sandboxId: string, input: ExecInput): Promise<ExecResult>
  readFile(sandboxId: string, path: string): Promise<Uint8Array>
  writeFile(sandboxId: string, path: string, content: Uint8Array): Promise<void>
  stopSandbox(sandboxId: string): Promise<Sandbox>
  deleteSandbox(sandboxId: string): Promise<void>
}

const JSON_ACCEPT = 'application/json'

export function createCloudClient(options: CloudClientOptions): CloudClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const apiKey = options.apiKey
  const fetchImpl: FetchLike =
    options.fetch ?? ((url, init) => globalThis.fetch(url, init as RequestInit))

  /** Nothing that leaves this module may contain the key. */
  function sanitize(text: string): string {
    if (apiKey.length === 0) return text
    return text.split(apiKey).join('***')
  }

  async function send(
    method: string,
    path: string,
    extra?: { body?: BodyInit; headers?: Record<string, string> },
  ): Promise<Response> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${apiKey}`,
      accept: JSON_ACCEPT,
      ...extra?.headers,
    }
    const body = extra?.body
    const init: CloudRequestInit =
      body === undefined ? { method, headers } : { method, headers, body }

    try {
      return await fetchImpl(`${baseUrl}${path}`, init)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new CloudApiError(
        'network_error',
        `Не удалось связаться с Rox Cloud: ${sanitize(detail)}`,
        0,
      )
    }
  }

  async function toError(res: Response): Promise<CloudApiError> {
    let raw = ''
    try {
      raw = await res.text()
    } catch {
      raw = ''
    }

    let code = `http_${res.status}`
    let message = `Rox Cloud ответил HTTP ${res.status}`
    let requestId = res.headers.get('x-request-id') ?? undefined

    const trimmed = raw.trim()
    if (trimmed.length > 0) {
      message = trimmed.slice(0, 2000)
      try {
        const parsed: unknown = JSON.parse(trimmed)
        if (parsed !== null && typeof parsed === 'object' && 'error' in parsed) {
          const envelope = parsed.error
          if (envelope !== null && typeof envelope === 'object') {
            if ('code' in envelope && typeof envelope.code === 'string' && envelope.code.length > 0) {
              code = envelope.code
            }
            if ('message' in envelope && typeof envelope.message === 'string' && envelope.message.length > 0) {
              message = envelope.message
            }
            if ('request_id' in envelope && typeof envelope.request_id === 'string') {
              requestId = envelope.request_id
            }
          }
        }
      } catch {
        // A non-JSON body (proxy page, empty envelope) keeps the raw text.
      }
    }

    return new CloudApiError(code, sanitize(message), res.status, requestId)
  }

  async function json<T>(res: Response): Promise<T> {
    if (!res.ok) throw await toError(res)
    return (await res.json()) as T
  }

  return {
    async createSandbox(input, opts) {
      const idempotencyKey = opts?.idempotencyKey ?? globalThis.crypto.randomUUID()
      const body: Record<string, unknown> = {
        os: input.os,
        cpu: input.cpu,
        memoryGb: input.memoryGb,
      }
      if (input.ttlSec !== undefined) body.ttlSec = input.ttlSec
      if (input.provider !== undefined) body.provider = input.provider

      const res = await send('POST', '/v1/sandboxes', {
        body: JSON.stringify(body),
        headers: { 'content-type': JSON_ACCEPT, 'idempotency-key': idempotencyKey },
      })
      return json<Sandbox>(res)
    },

    async listSandboxes() {
      const res = await send('GET', '/v1/sandboxes')
      return json<SandboxList>(res)
    },

    async getSandbox(sandboxId) {
      const res = await send('GET', `/v1/sandboxes/${encodeURIComponent(sandboxId)}`)
      return json<Sandbox>(res)
    },

    async exec(sandboxId, input) {
      const body: Record<string, unknown> = { command: input.command }
      if (input.timeoutSec !== undefined) body.timeoutSec = input.timeoutSec
      const res = await send('POST', `/v1/sandboxes/${encodeURIComponent(sandboxId)}/exec`, {
        body: JSON.stringify(body),
        headers: { 'content-type': JSON_ACCEPT },
      })
      return json<ExecResult>(res)
    },

    async readFile(sandboxId, path) {
      const res = await send('GET', `/v1/sandboxes/${encodeURIComponent(sandboxId)}/files?path=${encodeURIComponent(path)}`)
      if (!res.ok) throw await toError(res)
      return new Uint8Array(await res.arrayBuffer())
    },

    async writeFile(sandboxId, path, content) {
      const res = await send('PUT', `/v1/sandboxes/${encodeURIComponent(sandboxId)}/files?path=${encodeURIComponent(path)}`, {
        body: content.slice().buffer,
        headers: { 'content-type': 'application/octet-stream' },
      })
      // Documented answer is 204 No Content, so there is nothing to parse.
      if (res.status === 204) return
      if (!res.ok) throw await toError(res)
    },

    async stopSandbox(sandboxId) {
      const res = await send('POST', `/v1/sandboxes/${encodeURIComponent(sandboxId)}/stop`)
      return json<Sandbox>(res)
    },

    async deleteSandbox(sandboxId) {
      const res = await send('DELETE', `/v1/sandboxes/${encodeURIComponent(sandboxId)}`)
      if (res.status === 204) return
      if (!res.ok) throw await toError(res)
    },
  }
}
