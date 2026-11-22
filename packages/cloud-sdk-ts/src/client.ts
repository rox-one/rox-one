/**
 * Typed client for the Rox Cloud API.
 *
 * Every method here is a thin, honest mirror of one documented operation: the
 * path, the method, the body shape and the response type come from
 * `apps/cloud-api/openapi.yaml` and nothing is invented on top. The API key is
 * sent in one `Authorization` header and never in a URL, a log line or an error
 * message.
 */

import {
  RoxApiError,
  invalidResponseError,
  networkError,
  redactSecret,
  type RoxErrorCode,
} from './errors.ts'
import type {
  Account,
  ApiKey,
  ApiKeyCreated,
  ExecResult,
  ListResponse,
  ProviderCredential,
  ProviderId,
  Sandbox,
  SandboxList,
  SandboxSpecInput,
  Scope,
} from './types.ts'

/** The one fetch shape the client needs; any WHATWG-compatible fetch fits. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export interface RoxClientOptions {
  /** Origin of the API, e.g. `https://api.rox.one`. A trailing slash is fine. */
  baseUrl: string
  /** The tenant's key, `rox_sk_live_…`. Keep it server-side. */
  apiKey: string
  /** Inject a fetch for tests or for a runtime without a global one. */
  fetch?: FetchLike
  /** Local deadline per request. Omitted means no local deadline. */
  timeoutMs?: number
}

export interface CreateSandboxOptions {
  /** Reuse a key to make a retry return the same sandbox instead of booting another. */
  idempotencyKey?: string
}

export interface ListSandboxesOptions {
  /** Page size, 1 to 100; the API defaults to 20. */
  limit?: number
  /** Id of the last sandbox already seen. */
  startingAfter?: string
}

export interface ExecOptions {
  /** Ceiling for the command, in seconds. */
  timeoutSec?: number
}

export interface SandboxResource {
  create(input: SandboxSpecInput, options?: CreateSandboxOptions): Promise<Sandbox>
  get(id: string): Promise<Sandbox>
  list(options?: ListSandboxesOptions): Promise<SandboxList>
  exec(id: string, command: string, options?: ExecOptions): Promise<ExecResult>
  readFile(id: string, path: string): Promise<Uint8Array>
  writeFile(id: string, path: string, data: Uint8Array | string): Promise<void>
  stop(id: string): Promise<Sandbox>
  delete(id: string): Promise<void>
}

export interface CreateApiKeyInput {
  scopes: Scope[]
}

export interface KeysResource {
  create(input: CreateApiKeyInput): Promise<ApiKeyCreated>
  list(): Promise<ListResponse<ApiKey>>
  revoke(id: string): Promise<void>
}

export interface AccountResource {
  get(): Promise<Account>
  topUp(amountCents: number): Promise<Account>
}

export interface ProviderCredentialInput {
  provider: ProviderId
  /** Tenant-supplied name; the API falls back to the provider id. */
  label: string
  /** The customer's own provider key. Encrypted at rest, never echoed back. */
  secret: string
  /** Per-key ceiling in cents. Required, because zero means "spend nothing". */
  spendCapCents: number
  regions?: string[]
  products?: string[]
}

export interface ProviderCredentialsResource {
  add(input: ProviderCredentialInput): Promise<ProviderCredential>
  list(): Promise<ListResponse<ProviderCredential>>
  promote(id: string): Promise<ProviderCredential>
  disable(id: string): Promise<ProviderCredential>
}

export interface RoxClient {
  readonly sandboxes: SandboxResource
  readonly keys: KeysResource
  readonly account: AccountResource
  readonly providerCredentials: ProviderCredentialsResource
}

type QueryValue = string | number | undefined

interface RequestPlan {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  query?: Record<string, QueryValue>
  /** JSON body, serialized by the client. */
  json?: unknown
  /** Raw body, sent as `application/octet-stream`. */
  bytes?: Uint8Array
  accept?: string
  headers?: Record<string, string>
}

/** Drop undefined query entries so a default page never sends `limit=undefined`. */
function buildUrl(baseUrl: string, path: string, query?: Record<string, QueryValue>): string {
  if (query === undefined) return `${baseUrl}${path}`
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value))
  }
  const search = params.toString()
  return search.length === 0 ? `${baseUrl}${path}` : `${baseUrl}${path}?${search}`
}

export function createRoxClient(options: RoxClientOptions): RoxClient {
  if (options.baseUrl.length === 0) throw new Error('RoxClient: baseUrl is required')
  if (options.apiKey.length === 0) throw new Error('RoxClient: apiKey is required')

  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const apiKey = options.apiKey
  const timeoutMs = options.timeoutMs
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init))

  /**
   * The error envelope is `{error:{type, code, message, request_id}}`. A body
   * that does not carry it cannot name what went wrong, so it becomes
   * `invalid_response` instead of a guessed code.
   */
  async function errorFromResponse(response: Response): Promise<RoxApiError> {
    const headerRequestId = response.headers.get('x-request-id')
    let text = ''
    try {
      text = await response.text()
    } catch {
      text = ''
    }
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      body = undefined
    }
    const envelope = (body as { error?: unknown } | null | undefined)?.error as
      | { type?: unknown; code?: unknown; message?: unknown; request_id?: unknown }
      | undefined
    if (
      envelope === undefined ||
      typeof envelope.code !== 'string' ||
      typeof envelope.message !== 'string'
    ) {
      return invalidResponseError(
        response.status,
        headerRequestId,
        `The API answered ${response.status} without a readable error envelope`,
        apiKey,
      )
    }
    return new RoxApiError({
      status: response.status,
      type: typeof envelope.type === 'string' ? envelope.type : 'api_error',
      code: envelope.code as RoxErrorCode,
      message: redactSecret(envelope.message, apiKey),
      requestId: typeof envelope.request_id === 'string' ? envelope.request_id : headerRequestId,
    })
  }

  async function perform(plan: RequestPlan): Promise<Response> {
    const url = buildUrl(baseUrl, plan.path, plan.query)
    const headers: Record<string, string> = {
      authorization: `Bearer ${apiKey}`,
      accept: plan.accept ?? 'application/json',
      ...plan.headers,
    }
    const init: RequestInit = { method: plan.method, headers }
    if (plan.json !== undefined) {
      headers['content-type'] = 'application/json; charset=utf-8'
      init.body = JSON.stringify(plan.json)
    } else if (plan.bytes !== undefined) {
      headers['content-type'] = 'application/octet-stream'
      init.body = plan.bytes
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    if (timeoutMs !== undefined) {
      const controller = new AbortController()
      init.signal = controller.signal
      // Both a timeout and a caller-side abort land in the same network branch:
      // no answer was read, so no status or request id exists to report.
      timer = setTimeout(() => controller.abort(), timeoutMs)
    }

    let response: Response
    try {
      response = await fetchImpl(url, init)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      const reason =
        err instanceof Error && err.name === 'AbortError'
          ? `request timed out after ${String(timeoutMs ?? 0)} ms`
          : detail
      // The query string can carry a file path; the key is never in the URL.
      const target = url.split('?')[0] ?? url
      throw networkError(`Network request to ${target} failed: ${reason}`, apiKey)
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) throw await errorFromResponse(response)
    return response
  }

  async function jsonResponse<T>(plan: RequestPlan): Promise<T> {
    const response = await perform(plan)
    const text = await response.text()
    try {
      return JSON.parse(text) as T
    } catch {
      throw invalidResponseError(
        response.status,
        response.headers.get('x-request-id'),
        `The API answered ${response.status} with a body that is not JSON`,
        apiKey,
      )
    }
  }

  async function voidResponse(plan: RequestPlan): Promise<void> {
    await perform(plan)
  }

  async function bytesResponse(plan: RequestPlan): Promise<Uint8Array> {
    const response = await perform(plan)
    let buffer: ArrayBuffer
    try {
      buffer = await response.arrayBuffer()
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw invalidResponseError(
        response.status,
        response.headers.get('x-request-id'),
        `The API answered ${response.status} without a readable body: ${detail}`,
        apiKey,
      )
    }
    return new Uint8Array(buffer)
  }

  const sandboxes: SandboxResource = {
    create(input, createOptions = {}) {
      // The header is mandatory on the wire, so it is always sent; a caller
      // that supplies a key keeps control over retries.
      const idempotencyKey = createOptions.idempotencyKey ?? crypto.randomUUID()
      return jsonResponse<Sandbox>({
        method: 'POST',
        path: '/v1/sandboxes',
        json: input,
        headers: { 'idempotency-key': idempotencyKey },
      })
    },

    get(id) {
      return jsonResponse<Sandbox>({ method: 'GET', path: `/v1/sandboxes/${encodeURIComponent(id)}` })
    },

    list(listOptions = {}) {
      return jsonResponse<SandboxList>({
        method: 'GET',
        path: '/v1/sandboxes',
        query: { limit: listOptions.limit, starting_after: listOptions.startingAfter },
      })
    },

    exec(id, command, execOptions = {}) {
      const body: { command: string; timeoutSec?: number } = { command }
      if (execOptions.timeoutSec !== undefined) body.timeoutSec = execOptions.timeoutSec
      return jsonResponse<ExecResult>({
        method: 'POST',
        path: `/v1/sandboxes/${encodeURIComponent(id)}/exec`,
        json: body,
      })
    },

    readFile(id, path) {
      return bytesResponse({
        method: 'GET',
        path: `/v1/sandboxes/${encodeURIComponent(id)}/files`,
        query: { path },
        accept: 'application/octet-stream',
      })
    },

    async writeFile(id, path, data) {
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
      await voidResponse({
        method: 'PUT',
        path: `/v1/sandboxes/${encodeURIComponent(id)}/files`,
        query: { path },
        bytes,
      })
    },

    stop(id) {
      return jsonResponse<Sandbox>({
        method: 'POST',
        path: `/v1/sandboxes/${encodeURIComponent(id)}/stop`,
      })
    },

    async delete(id) {
      await voidResponse({ method: 'DELETE', path: `/v1/sandboxes/${encodeURIComponent(id)}` })
    },
  }

  const keys: KeysResource = {
    create(input) {
      return jsonResponse<ApiKeyCreated>({ method: 'POST', path: '/v1/keys', json: input })
    },

    list() {
      return jsonResponse<ListResponse<ApiKey>>({ method: 'GET', path: '/v1/keys' })
    },

    async revoke(id) {
      await voidResponse({ method: 'DELETE', path: `/v1/keys/${encodeURIComponent(id)}` })
    },
  }

  const account: AccountResource = {
    get() {
      return jsonResponse<Account>({ method: 'GET', path: '/v1/account' })
    },

    topUp(amountCents) {
      return jsonResponse<Account>({
        method: 'POST',
        path: '/v1/account/topup',
        json: { amountCents },
      })
    },
  }

  const providerCredentials: ProviderCredentialsResource = {
    add(input) {
      return jsonResponse<ProviderCredential>({
        method: 'POST',
        path: '/v1/provider-credentials',
        json: input,
      })
    },

    list() {
      return jsonResponse<ListResponse<ProviderCredential>>({
        method: 'GET',
        path: '/v1/provider-credentials',
      })
    },

    promote(id) {
      return jsonResponse<ProviderCredential>({
        method: 'POST',
        path: `/v1/provider-credentials/${encodeURIComponent(id)}/promote`,
      })
    },

    disable(id) {
      return jsonResponse<ProviderCredential>({
        method: 'DELETE',
        path: `/v1/provider-credentials/${encodeURIComponent(id)}`,
      })
    },
  }

  return { sandboxes, keys, account, providerCredentials }
}
