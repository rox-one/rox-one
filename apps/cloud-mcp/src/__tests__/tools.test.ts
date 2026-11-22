/**
 * Tool-level contract tests.
 *
 * Every test talks to a fake `fetch`, so no network and no real key is used.
 * The fake records exactly what the client put on the wire, which is the only
 * thing the Rox Cloud API can see.
 */

import { describe, expect, test } from 'bun:test'

import { CloudApiError, createCloudClient } from '../client.ts'
import type { CloudClient, CloudRequestInit, FetchLike } from '../client.ts'
import { callTool, listTools, McpProtocolError } from '../tools.ts'

const API_KEY = 'rox_sk_test_0123456789abcdef'
const BASE_URL = 'https://cloud.example.test'

const SANDBOX = {
  id: 'sbx_1',
  object: 'sandbox',
  provider: 'daytona',
  state: 'started',
  created_at: '2026-11-19T12:00:00.000Z',
  expires_at: null,
  cost_so_far_cents: 0,
  cost_so_far_usd: '0.00',
  routing_reason: null,
}

interface RecordedCall {
  readonly url: string
  readonly method: string
  readonly headers: Record<string, string>
  readonly body: BodyInit | undefined
}

function jsonResponse(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** A `fetch` that records the request and answers from `handler`. */
function makeClient(handler: (call: RecordedCall) => Response): {
  client: CloudClient
  calls: RecordedCall[]
} {
  const calls: RecordedCall[] = []
  const fakeFetch: FetchLike = async (url: string, init: CloudRequestInit) => {
    const call: RecordedCall = {
      url,
      method: init.method,
      headers: init.headers,
      body: init.body,
    }
    calls.push(call)
    return handler(call)
  }
  return {
    client: createCloudClient({ baseUrl: BASE_URL, apiKey: API_KEY, fetch: fakeFetch }),
    calls,
  }
}

function parseObject(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`ожидался объект JSON, получено: ${text}`)
  }
  return parsed as Record<string, unknown>
}

function asProtocolError(caught: unknown): McpProtocolError {
  if (!(caught instanceof McpProtocolError)) {
    throw new Error(`ожидалась ошибка протокола, получено: ${String(caught)}`)
  }
  return caught
}

describe('rox cloud mcp tools', () => {
  test('create_sandbox sends the bearer key, an idempotency header and safe defaults', async () => {
    const { client, calls } = makeClient(() => jsonResponse(201, SANDBOX))

    const result = await callTool('create_sandbox', {}, client)

    expect(result.isError).toBeUndefined()
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${BASE_URL}/v1/sandboxes`)
    expect(calls[0].method).toBe('POST')
    expect(calls[0].headers['authorization']).toBe(`Bearer ${API_KEY}`)
    const idempotencyKey = calls[0].headers['idempotency-key']
    expect(idempotencyKey).toBeDefined()
    expect(String(idempotencyKey).length).toBeGreaterThan(10)
    expect(JSON.parse(String(calls[0].body))).toEqual({ os: 'linux', cpu: 2, memoryGb: 4 })
    expect(parseObject(result.content[0].text)).toMatchObject({ id: 'sbx_1', state: 'started' })
  })

  test('create_sandbox keeps an explicitly supplied idempotency key', async () => {
    const { client, calls } = makeClient(() => jsonResponse(201, SANDBOX))

    await client.createSandbox(
      { os: 'windows', cpu: 1, memoryGb: 2 },
      { idempotencyKey: 'agent-run-42' },
    )

    expect(calls[0].headers['idempotency-key']).toBe('agent-run-42')
    expect(calls[0].url).toBe(`${BASE_URL}/v1/sandboxes`)
  })

  test('exec parses stdout, stderr and the exit code', async () => {
    const { client, calls } = makeClient(() =>
      jsonResponse(200, { stdout: 'hello\n', stderr: 'warn\n', exit_code: 3 }),
    )

    const result = await callTool('exec', { sandboxId: 'sbx_1', command: 'echo hello' }, client)

    expect(calls[0].url).toBe(`${BASE_URL}/v1/sandboxes/sbx_1/exec`)
    expect(calls[0].method).toBe('POST')
    expect(JSON.parse(String(calls[0].body))).toEqual({ command: 'echo hello' })
    expect(parseObject(result.content[0].text)).toMatchObject({
      stdout: 'hello\n',
      stderr: 'warn\n',
      exit_code: 3,
    })
  })

  test('read_file returns the file text', async () => {
    const { client, calls } = makeClient(
      () => new Response('line one\nline two\n', { status: 200 }),
    )

    const result = await callTool(
      'read_file',
      { sandboxId: 'sbx_1', path: '/tmp/notes.txt' },
      client,
    )

    expect(calls[0].url).toBe(`${BASE_URL}/v1/sandboxes/sbx_1/files?path=%2Ftmp%2Fnotes.txt`)
    expect(result.content[0].text).toBe('line one\nline two\n')
    expect(result.isError).toBeUndefined()
  })

  test('read_file warns when the bytes are not UTF-8', async () => {
    const { client } = makeClient(
      () => new Response(new Uint8Array([0x68, 0x69, 0xff, 0x0a])),
    )

    const result = await callTool(
      'read_file',
      { sandboxId: 'sbx_1', path: '/tmp/blob.bin' },
      client,
    )

    expect(result.content[0].text).toContain('Файл не в UTF-8')
    expect(result.isError).toBeUndefined()
  })

  test('write_file puts the raw bytes of the content', async () => {
    const { client, calls } = makeClient(() => new Response(null, { status: 204 }))

    const result = await callTool(
      'write_file',
      { sandboxId: 'sbx_1', path: '/tmp/greeting.txt', content: 'привет' },
      client,
    )

    expect(calls[0].method).toBe('PUT')
    expect(calls[0].url).toBe(`${BASE_URL}/v1/sandboxes/sbx_1/files?path=%2Ftmp%2Fgreeting.txt`)
    expect(calls[0].headers['content-type']).toBe('application/octet-stream')
    const payload = calls[0].body
    if (!(payload instanceof Uint8Array) && !(payload instanceof ArrayBuffer)) {
      throw new Error('write_file must send raw bytes')
    }
    const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload)
    expect(new TextDecoder().decode(bytes)).toBe('привет')
    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain('/tmp/greeting.txt')
  })

  test('list_sandboxes returns the sandbox list', async () => {
    const { client, calls } = makeClient(() =>
      jsonResponse(200, {
        object: 'list',
        data: [SANDBOX, { ...SANDBOX, id: 'sbx_2', state: 'stopped' }],
        has_more: false,
        next_cursor: null,
      }),
    )

    const result = await callTool('list_sandboxes', {}, client)

    expect(calls[0].method).toBe('GET')
    expect(calls[0].url).toBe(`${BASE_URL}/v1/sandboxes`)
    const parsed = parseObject(result.content[0].text)
    expect(parsed['has_more']).toBe(false)
    expect(parsed['next_cursor']).toBeNull()
    const data = parsed['data']
    if (!Array.isArray(data)) throw new Error('list result must carry a data array')
    expect(data).toHaveLength(2)
    expect(data[0]).toMatchObject({ id: 'sbx_1' })
  })

  test('stop_sandbox returns the stopped sandbox', async () => {
    const { client, calls } = makeClient(() =>
      jsonResponse(200, { ...SANDBOX, state: 'stopped' }),
    )

    const result = await callTool('stop_sandbox', { sandboxId: 'sbx_1' }, client)

    expect(calls[0].method).toBe('POST')
    expect(calls[0].url).toBe(`${BASE_URL}/v1/sandboxes/sbx_1/stop`)
    expect(parseObject(result.content[0].text)).toMatchObject({ id: 'sbx_1', state: 'stopped' })
  })

  test('an error envelope becomes an isError result carrying the request id', async () => {
    const { client } = makeClient(() =>
      jsonResponse(404, {
        error: {
          type: 'not_found_error',
          code: 'not_found',
          message: 'Песочница не найдена',
          request_id: 'req_9',
        },
      }),
    )

    const result = await callTool('stop_sandbox', { sandboxId: 'sbx_missing' }, client)

    expect(result.isError).toBe(true)
    expect(parseObject(result.content[0].text)).toMatchObject({
      code: 'not_found',
      message: 'Песочница не найдена',
      request_id: 'req_9',
    })
    expect(result.content[0].text).toContain('request_id')
  })

  test('an unknown tool throws a protocol error', async () => {
    const { client } = makeClient(() => {
      throw new Error('fetch must not be called for an unknown tool')
    })

    let caught: unknown
    try {
      await callTool('drop_everything', {}, client)
    } catch (err) {
      caught = err
    }

    expect(asProtocolError(caught).code).toBe(-32602)
  })

  test('a missing required argument throws a protocol error', async () => {
    const { client } = makeClient(() => jsonResponse(200, { stdout: '', stderr: '', exit_code: 0 }))

    let caught: unknown
    try {
      await callTool('exec', { sandboxId: 'sbx_1' }, client)
    } catch (err) {
      caught = err
    }

    expect(asProtocolError(caught).code).toBe(-32602)
  })

  test('listTools exposes six unique tools with object schemas', () => {
    const tools = listTools()

    expect(tools).toHaveLength(6)
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(6)
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'create_sandbox',
      'exec',
      'list_sandboxes',
      'read_file',
      'stop_sandbox',
      'write_file',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema['type']).toBe('object')
      expect(tool.description.length).toBeGreaterThan(0)
    }
  })

  test('the API key never appears in a tool result', async () => {
    const { client } = makeClient(() =>
      jsonResponse(502, {
        error: {
          type: 'provider_error',
          code: 'provider_error',
          message: `Провайдер отклонил ключ ${API_KEY}`,
          request_id: 'req_77',
        },
      }),
    )

    const result = await callTool('list_sandboxes', {}, client)

    expect(result.isError).toBe(true)
    expect(result.content[0].text.includes(API_KEY)).toBe(false)
    expect(result.content[0].text).toContain('***')
    expect(parseObject(result.content[0].text)).toMatchObject({
      code: 'provider_error',
      request_id: 'req_77',
    })
  })

  test('the client reports a refusal as CloudApiError with status and request id', async () => {
    const { client } = makeClient(() =>
      jsonResponse(404, {
        error: {
          type: 'not_found_error',
          code: 'not_found',
          message: 'Нет такой машины',
          request_id: 'req_5',
        },
      }),
    )

    let caught: unknown
    try {
      await client.getSandbox('sbx_missing')
    } catch (err) {
      caught = err
    }

    if (!(caught instanceof CloudApiError)) throw new Error('expected CloudApiError')
    expect(caught.code).toBe('not_found')
    expect(caught.status).toBe(404)
    expect(caught.requestId).toBe('req_5')
    expect(caught.message).toBe('Нет такой машины')
  })
})
