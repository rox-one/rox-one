/**
 * @rox/rovers-core — Docker Engine API container client (M1-B4) tests.
 *
 * Every case drives `createDockerEngineClient` with an injected in-memory
 * `requestImpl`: no Unix socket, no `docker` CLI and no network are touched
 * (q7-client-decision §6). The assertions pin the transport contract (method,
 * path, JSON body), the digest/ownership invariants and every failure branch the
 * client can reach, so a raw transport error can never leak to a caller.
 */

import { describe, expect, it } from 'bun:test'

import { RoversError } from '../../../errors.ts'
import { ROVERS_DIGEST_IMAGE_RE, ROVERS_LABEL_RUN, ROVERS_LABEL_SERVICE } from '../../../types.ts'
import type { RoversContainerClient, RoversContainerSpec, RoversDockerEndpoint } from '../../../types.ts'
import { createDockerEngineClient, RoversContainerSpecError } from '../container-client.ts'
import type { RoversDockerRequest, RoversDockerResponse } from '../container-client.ts'

/* ───────────────────────────── fixtures ───────────────────────────── */

const ENDPOINT: RoversDockerEndpoint = {
  uri: 'unix:///var/run/docker.sock',
  socket: '/var/run/docker.sock',
  device: 3,
  inode: 17,
}

const DIGEST = `sha256:${'0123456789abcdef'.repeat(4)}`
const OTHER_DIGEST = `sha256:${'fedcba9876543210'.repeat(4)}`
const IMAGE = `library/nginx@${DIGEST}`
const SERVICE_ID = 'svc-rag'
const RUN_ID = '6f1a1f6e-3a2b-4c5d-8e9f-0a1b2c3d4e5f'
const LOG_TRUNCATION_MARKER = '…[обрезано начало]\n'

function baseSpec(overrides: Partial<RoversContainerSpec> = {}): RoversContainerSpec {
  return { serviceId: SERVICE_ID, runId: RUN_ID, name: 'rox-rag-1', image: IMAGE, ...overrides }
}

interface RecordedRequest {
  method: string
  path: string
  body?: string
}

type EngineHandler = (req: RoversDockerRequest, index: number) => RoversDockerResponse

/** Build a client whose transport is an in-memory handler that records calls. */
function createClient(handler: EngineHandler): { client: RoversContainerClient; calls: RecordedRequest[] } {
  const calls: RecordedRequest[] = []
  const client = createDockerEngineClient({
    endpoint: ENDPOINT,
    requestImpl: async (req) => {
      calls.push({ method: req.method, path: req.path, ...(req.body === undefined ? {} : { body: req.body }) })
      return handler(req, calls.length - 1)
    },
  })
  return { client, calls }
}

/** A handler that answers every request with the same canned response. */
function always(response: RoversDockerResponse): EngineHandler {
  return () => response
}

function ok(body = ''): RoversDockerResponse {
  return { status: 200, headers: {}, body }
}

function okJson(value: unknown): RoversDockerResponse {
  return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }
}

/** Capture the typed `RoversError` a call rejects with (fails on success). */
async function roversErrorOf(promise: Promise<unknown>): Promise<RoversError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof RoversError) return error
    throw error
  }
  throw new Error('Ожидался отказ RoversError, но вызов завершился успешно')
}

/** Capture the invalid-spec refusal (fails on success or on another type). */
async function specErrorOf(promise: Promise<unknown>): Promise<RoversContainerSpecError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof RoversContainerSpecError) return error
    throw error
  }
  throw new Error('Ожидался отказ RoversContainerSpecError, но вызов завершился успешно')
}

/** One Docker multiplexed log frame: stream id byte + 3 pad + big-endian length. */
function frame(streamId: 1 | 2, payload: string): Buffer {
  const bytes = Buffer.from(payload, 'utf8')
  const header = Buffer.alloc(8)
  header.writeUInt8(streamId, 0)
  header.writeUInt32BE(bytes.length, 4)
  return Buffer.concat([header, bytes])
}

/* ─────────────────────────────── ping ─────────────────────────────── */

describe('createDockerEngineClient › ping', () => {
  it('resolves on a 200 /version response and probes the engine version path', async () => {
    const { client, calls } = createClient(always(ok('{"Version":"29.4.0"}')))

    await expect(client.ping()).resolves.toBeUndefined()
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('GET')
    expect(calls[0].path).toBe('/version')
    expect(calls[0].body).toBeUndefined()
  })

  it('maps a 500 response to a typed no_runtime failure', async () => {
    // The client treats any status >= 400 as unreachable; a 3xx is not an error.
    const { client } = createClient(always({ status: 500, headers: {}, body: 'engine down' }))

    const error = await roversErrorOf(client.ping())
    expect(error.code).toBe('no_runtime')
    expect(error.message).toContain('500')
    expect(error.repairAction).toBeTruthy()
  })

  it('maps a 404 response to no_runtime (not image_unavailable)', async () => {
    const { client } = createClient(always({ status: 404, headers: {}, body: 'not found' }))

    expect((await roversErrorOf(client.ping())).code).toBe('no_runtime')
  })

  it('wraps a transport rejection in no_runtime and preserves the cause', async () => {
    const boom = new Error('connect ENOENT /var/run/docker.sock')
    const { client } = createClient(() => {
      throw boom
    })

    const error = await roversErrorOf(client.ping())
    expect(error.code).toBe('no_runtime')
    expect(error.cause).toBe(boom)
    expect(error.message).toContain(boom.message)
  })
})

/* ─────────────────────────────── pull ─────────────────────────────── */

describe('createDockerEngineClient › pull', () => {
  it('refuses a tag-only reference with digest_mismatch (no request is sent)', async () => {
    const { client, calls } = createClient(always(okJson({ Id: 'sha256:x' })))

    const error = await roversErrorOf(client.pull('nginx:latest'))
    expect(error.code).toBe('digest_mismatch')
    expect(error.repairAction).toContain('sha256')
    expect(calls).toHaveLength(0)
  })

  it('accepts a digest-pinned reference and resolves the stored manifest digest', async () => {
    expect(ROVERS_DIGEST_IMAGE_RE.test(IMAGE)).toBe(true)
    const { client, calls } = createClient((req) => {
      if (req.method === 'POST') return ok('{"status":"Downloaded newer image"}\n')
      return okJson({ Id: `sha256:${'a'.repeat(64)}`, Descriptor: { digest: DIGEST } })
    })

    expect(await client.pull(IMAGE)).toEqual({ id: `sha256:${'a'.repeat(64)}`, digest: DIGEST })
    expect(calls.map((call) => call.method)).toEqual(['POST', 'GET'])
    expect(calls[0].path).toBe(`/images/create?fromImage=${encodeURIComponent(IMAGE)}`)
    expect(calls[1].path).toBe(`/images/${IMAGE}/json`)
  })

  it('falls back to the RepoDigests entry when the engine omits Descriptor', async () => {
    const { client } = createClient((req) => {
      if (req.method === 'POST') return ok('')
      return okJson({ Id: `sha256:${'b'.repeat(64)}`, RepoDigests: [`library/nginx@${DIGEST}`] })
    })

    expect(await client.pull(IMAGE)).toEqual({ id: `sha256:${'b'.repeat(64)}`, digest: DIGEST })
  })

  it('refuses a pull whose stored digest differs from the requested one', async () => {
    const { client } = createClient((req) => {
      if (req.method === 'POST') return ok('')
      return okJson({ Id: `sha256:${'c'.repeat(64)}`, Descriptor: { digest: OTHER_DIGEST } })
    })

    const error = await roversErrorOf(client.pull(IMAGE))
    expect(error.code).toBe('digest_mismatch')
    expect(error.message).toContain(OTHER_DIGEST)
  })

  it('refuses a pull whose inspect response has no id at all', async () => {
    const { client } = createClient((req) => {
      if (req.method === 'POST') return ok('')
      return okJson({ Descriptor: { digest: DIGEST } })
    })

    expect((await roversErrorOf(client.pull(IMAGE))).code).toBe('digest_mismatch')
  })

  it('maps a stream-level error line through mapDockerError using its embedded code', async () => {
    // Docker reports a pull failure inside the 200 body; errorDetail.code carries
    // the real status, so a 400 port conflict maps to port_conflict.
    const line = JSON.stringify({
      errorDetail: { message: 'port is already allocated', code: 400 },
      error: 'port is already allocated',
    })
    const { client } = createClient(always(ok(line)))

    const error = await roversErrorOf(client.pull(IMAGE))
    expect(error.code).toBe('port_conflict')
  })

  it('defaults a stream error line without errorDetail.code to image_unavailable', async () => {
    const { client } = createClient(always(ok('{"error":"manifest unknown"}\n')))

    expect((await roversErrorOf(client.pull(IMAGE))).code).toBe('image_unavailable')
  })

  it('maps a 404 on /images/create to image_unavailable', async () => {
    const { client } = createClient(always({ status: 404, headers: {}, body: 'no such image' }))

    const error = await roversErrorOf(client.pull(IMAGE))
    expect(error.code).toBe('image_unavailable')
  })
})

/* ────────────────────────────── create ────────────────────────────── */

describe('createDockerEngineClient › create', () => {
  it('rejects a spec with no serviceId using RoversContainerSpecError(field=serviceId)', async () => {
    const spec: Partial<RoversContainerSpec> = baseSpec()
    delete spec.serviceId
    const { client, calls } = createClient(always(okJson({ Id: 'never' })))

    const error = await specErrorOf(client.create(spec as RoversContainerSpec))
    expect(error.name).toBe('RoversContainerSpecError')
    expect(error.field).toBe('serviceId')
    expect(calls).toHaveLength(0)
  })

  it('rejects a spec with no runId using RoversContainerSpecError(field=runId)', async () => {
    const spec: Partial<RoversContainerSpec> = baseSpec()
    delete spec.runId
    const { client, calls } = createClient(always(okJson({ Id: 'never' })))

    const error = await specErrorOf(client.create(spec as RoversContainerSpec))
    expect(error.field).toBe('runId')
    expect(calls).toHaveLength(0)
  })

  it('rejects a non-digest image before any spec check', async () => {
    const { client, calls } = createClient(always(okJson({ Id: 'never' })))

    const error = await roversErrorOf(client.create(baseSpec({ image: 'nginx:1.27' })))
    expect(error.code).toBe('digest_mismatch')
    expect(calls).toHaveLength(0)
  })

  it('returns the container id parsed from the Engine response JSON', async () => {
    const { client, calls } = createClient(always(okJson({ Id: 'c0ffee', Warnings: [] })))

    expect(await client.create(baseSpec())).toEqual({ id: 'c0ffee' })
    expect(calls[0].method).toBe('POST')
  })

  it('sends the name as a query parameter on /containers/create', async () => {
    const name = 'rox rag/1'
    const { client, calls } = createClient(always(okJson({ Id: 'c1' })))

    await client.create(baseSpec({ name }))
    expect(calls[0].path).toBe(`/containers/create?name=${encodeURIComponent(name)}`)
  })

  it('stamps both ownership labels and lets no spec label override them', async () => {
    const { client, calls } = createClient(always(okJson({ Id: 'c1' })))

    await client.create(
      baseSpec({
        labels: {
          [ROVERS_LABEL_SERVICE]: 'foreign-service',
          [ROVERS_LABEL_RUN]: 'foreign-run',
          'com.example.keep': 'yes',
        },
      }),
    )

    const sent = JSON.parse(calls[0].body ?? '{}') as { Labels: Record<string, string> }
    expect(sent.Labels[ROVERS_LABEL_SERVICE]).toBe(SERVICE_ID)
    expect(sent.Labels[ROVERS_LABEL_RUN]).toBe(RUN_ID)
    expect(sent.Labels['com.example.keep']).toBe('yes')
  })

  it('maps a 409 create rejection through mapDockerError → vm_start_failed', async () => {
    const { client } = createClient(always({ status: 409, headers: {}, body: 'container name already in use' }))

    expect((await roversErrorOf(client.create(baseSpec()))).code).toBe('vm_start_failed')
  })

  it('omits Cmd and Entrypoint entirely when the spec sets neither', async () => {
    const { client, calls } = createClient(always(okJson({ Id: 'c1' })))

    await client.create(baseSpec())

    // Assert on the RAW body, not the parsed object: `JSON.stringify` drops
    // `undefined`, so parsing would also accept an unconditional `Cmd: undefined`.
    const body = calls[0].body ?? ''
    expect(body).not.toContain('"Cmd"')
    expect(body).not.toContain('"Entrypoint"')
    const sent = JSON.parse(body) as Record<string, unknown>
    expect('Cmd' in sent).toBe(false)
    expect('Entrypoint' in sent).toBe(false)
  })

  it('maps spec.command onto the Engine Cmd array', async () => {
    const { client, calls } = createClient(always(okJson({ Id: 'c1' })))

    await client.create(baseSpec({ command: ['--port', '8080'] }))

    const sent = JSON.parse(calls[0].body ?? '{}') as { Cmd: string[]; Entrypoint?: string[] }
    expect(sent.Cmd).toEqual(['--port', '8080'])
    expect(sent.Entrypoint).toBeUndefined()
  })

  it('maps spec.entrypoint onto the Engine Entrypoint array', async () => {
    const { client, calls } = createClient(always(okJson({ Id: 'c1' })))

    await client.create(baseSpec({ entrypoint: ['/usr/local/bin/entry.sh'] }))

    const sent = JSON.parse(calls[0].body ?? '{}') as { Cmd?: string[]; Entrypoint: string[] }
    expect(sent.Entrypoint).toEqual(['/usr/local/bin/entry.sh'])
    expect(sent.Cmd).toBeUndefined()
  })

  it('carries command and entrypoint together when both are set', async () => {
    const { client, calls } = createClient(always(okJson({ Id: 'c1' })))

    await client.create(baseSpec({ entrypoint: ['/bin/sh', '-c'], command: ['echo hi'] }))

    const sent = JSON.parse(calls[0].body ?? '{}') as { Cmd: string[]; Entrypoint: string[] }
    expect(sent.Entrypoint).toEqual(['/bin/sh', '-c'])
    expect(sent.Cmd).toEqual(['echo hi'])
  })

  it('crosses an explicit empty array verbatim — which the Engine reads as unset, not as a clear', async () => {
    // The Engine's merge (moby daemon/commit.go) tests `len(Cmd) == 0`, not
    // `Cmd == nil`, so an empty `Cmd` is indistinguishable from an omitted one
    // and the image CMD is re-adopted. The client's job is only to cross the
    // value verbatim; clearing a command is not expressible here.
    const { client, calls } = createClient(always(okJson({ Id: 'c1' })))

    await client.create(baseSpec({ command: [] }))

    const sent = JSON.parse(calls[0].body ?? '{}') as { Cmd: string[] }
    expect(sent.Cmd).toEqual([])
  })

  it('refuses a sparse command array (holes serialize to null elements)', async () => {
    const { client, calls } = createClient(always(okJson({ Id: 'c1' })))
    const sparse = new Array(2) as unknown as string[]
    sparse[0] = 'ok'

    const error = await specErrorOf(client.create(baseSpec({ command: sparse })))

    expect(error.field).toBe('command')
    expect(calls).toHaveLength(0)
  })

  it('refuses an explicit null command with the field name', async () => {
    const { client, calls } = createClient(always(okJson({ Id: 'c1' })))

    const error = await specErrorOf(client.create(baseSpec({ command: null as unknown as string[] })))

    expect(error.field).toBe('command')
    expect(calls).toHaveLength(0)
  })

  it('refuses a non-string-array command before any request is sent', async () => {
    const { client, calls } = createClient(always(okJson({ Id: 'c1' })))

    const error = await specErrorOf(client.create(baseSpec({ command: 'echo hi' as unknown as string[] })))

    expect(error.field).toBe('command')
    expect(calls).toHaveLength(0)
  })

  it('refuses a command array holding a non-string element', async () => {
    const { client, calls } = createClient(always(okJson({ Id: 'c1' })))

    const error = await specErrorOf(client.create(baseSpec({ command: ['ok', 7 as unknown as string] })))

    expect(error.field).toBe('command')
    expect(calls).toHaveLength(0)
  })

  it('refuses a non-string-array entrypoint under its own field name', async () => {
    const { client, calls } = createClient(always(okJson({ Id: 'c1' })))

    const error = await specErrorOf(client.create(baseSpec({ entrypoint: [1, 2] as unknown as string[] })))

    expect(error.field).toBe('entrypoint')
    expect(calls).toHaveLength(0)
  })

  it('maps a 200 response without an Id to a typed vm_start_failed failure', async () => {
    const { client } = createClient(always(ok('{"Warnings":[]}')))

    expect((await roversErrorOf(client.create(baseSpec()))).code).toBe('vm_start_failed')
  })
})

/* ────────────────────────────── inspect ───────────────────────────── */

describe('createDockerEngineClient › inspect', () => {
  it('parses state, health and config from the Engine JSON', async () => {
    const { client, calls } = createClient(
      always(
        okJson({
          Id: 'c1',
          State: { Status: 'exited', Running: false, ExitCode: 0, Health: { Status: 'unhealthy' } },
          Config: { Image: IMAGE, Labels: { [ROVERS_LABEL_RUN]: RUN_ID } },
        }),
      ),
    )

    expect(await client.inspect('c1')).toEqual({
      id: 'c1',
      state: { status: 'exited', running: false, exitCode: 0, health: { status: 'unhealthy' } },
      config: { image: IMAGE, labels: { [ROVERS_LABEL_RUN]: RUN_ID } },
    })
    expect(calls[0].path).toBe('/containers/c1/json')
  })

  it('normalizes an unknown health status to none', async () => {
    const { client } = createClient(always(okJson({ State: { Status: 'running', Running: true, Health: { Status: 'weird' } } })))

    const inspected = await client.inspect('c1')
    expect(inspected.state.health).toEqual({ status: 'none' })
    expect(inspected.state.exitCode).toBeUndefined()
  })

  it('is tolerant of an empty response body object', async () => {
    const { client } = createClient(always(okJson({})))

    expect(await client.inspect('c-fallback')).toEqual({
      id: 'c-fallback',
      state: { status: 'unknown', running: false, health: { status: 'none' } },
      config: { image: '', labels: {} },
    })
  })
})

/* ─────────────────────────────── logs ─────────────────────────────── */

describe('createDockerEngineClient › logs', () => {
  it('uses stdout+stderr and the default tail when no options are passed', async () => {
    const { client, calls } = createClient(always(ok('plain text, no framing')))

    expect(await client.logs('c1')).toBe('plain text, no framing')
    expect(calls[0].path).toBe('/containers/c1/logs?stdout=1&stderr=1&tail=200')
  })

  it('passes an explicit tail through the query string', async () => {
    const { client, calls } = createClient(always(ok('x')))

    await client.logs('c1', { tail: 25 })
    expect(calls[0].path).toBe('/containers/c1/logs?stdout=1&stderr=1&tail=25')
  })

  it('decodes the Docker multiplexed stream framing (stdout + stderr, UTF-8)', async () => {
    const multiplexed = Buffer.concat([frame(1, 'hello\n'), frame(2, 'мир\n')]).toString('latin1')
    const { client } = createClient(always(ok(multiplexed)))

    expect(await client.logs('c1')).toBe('hello\nмир\n')
  })

  it('caps the payload at maxBytes, dropping from the front and marking the cut', async () => {
    const text = 'x'.repeat(100)
    const markerBytes = Buffer.byteLength(LOG_TRUNCATION_MARKER, 'utf8')
    const { client } = createClient(always(ok(text)))

    const capped = await client.logs('c1', { maxBytes: 40 })
    expect(Buffer.byteLength(capped, 'utf8')).toBe(40)
    expect(capped.startsWith(LOG_TRUNCATION_MARKER)).toBe(true)
    expect(capped).toBe(LOG_TRUNCATION_MARKER + 'x'.repeat(40 - markerBytes))
  })

  it('returns the payload untouched when it fits under the cap', async () => {
    const { client } = createClient(always(ok('short')))

    expect(await client.logs('c1', { maxBytes: 1024 })).toBe('short')
  })

  it('maps a non-2xx logs response through mapDockerError → image_unavailable', async () => {
    const { client } = createClient(always({ status: 404, headers: {}, body: 'No such container' }))

    expect((await roversErrorOf(client.logs('missing'))).code).toBe('image_unavailable')
  })
})

/* ──────────────────────── start / stop / remove ───────────────────── */

describe('createDockerEngineClient › lifecycle verbs', () => {
  it('POSTs /containers/<id>/start', async () => {
    const { client, calls } = createClient(always({ status: 204, headers: {}, body: '' }))

    await client.start('abc/1')
    expect(calls[0]).toEqual({ method: 'POST', path: '/containers/abc%2F1/start' })
  })

  it('maps a 500 start rejection → vm_start_failed', async () => {
    const { client } = createClient(always({ status: 500, headers: {}, body: 'cannot start' }))

    expect((await roversErrorOf(client.start('c1'))).code).toBe('vm_start_failed')
  })

  it('POSTs /containers/<id>/stop with the default and explicit timeout', async () => {
    const { client, calls } = createClient(always({ status: 204, headers: {}, body: '' }))

    await client.stop('c1')
    await client.stop('c1', 3)
    expect(calls.map((call) => call.path)).toEqual(['/containers/c1/stop?t=10', '/containers/c1/stop?t=3'])
  })

  it('maps a 409 stop rejection → vm_start_failed', async () => {
    const { client } = createClient(always({ status: 409, headers: {}, body: 'conflict' }))

    expect((await roversErrorOf(client.stop('c1'))).code).toBe('vm_start_failed')
  })

  it('DELETEs /containers/<id> with force/volume flags', async () => {
    const { client, calls } = createClient(always({ status: 204, headers: {}, body: '' }))

    await client.remove('c1')
    await client.remove('c1', { force: true, volumes: true })
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'DELETE /containers/c1?force=0&v=0',
      'DELETE /containers/c1?force=1&v=1',
    ])
  })

  it('maps a 403 remove rejection → socket_denied', async () => {
    const { client } = createClient(always({ status: 403, headers: {}, body: 'permission denied' }))

    expect((await roversErrorOf(client.remove('c1'))).code).toBe('socket_denied')
  })
})

/* ──────────────────────────── listByRun ───────────────────────────── */

describe('createDockerEngineClient › listByRun', () => {
  it('emits the run-label filter query and maps the container summaries', async () => {
    const { client, calls } = createClient(
      always(
        okJson([
          { Id: 'c1', Names: ['/rox-rag-1'], Image: IMAGE, State: 'running', Labels: { [ROVERS_LABEL_RUN]: RUN_ID } },
          { Id: 'c2' },
        ]),
      ),
    )

    expect(await client.listByRun(RUN_ID)).toEqual([
      { id: 'c1', names: ['/rox-rag-1'], image: IMAGE, state: 'running', labels: { [ROVERS_LABEL_RUN]: RUN_ID } },
      { id: 'c2', names: [], image: '', state: '', labels: {} },
    ])

    const url = new URL(`http://localhost${calls[0].path}`)
    expect(url.pathname).toBe('/containers/json')
    expect(url.searchParams.get('all')).toBe('1')
    expect(JSON.parse(url.searchParams.get('filters') ?? 'null')).toEqual({
      label: [`${ROVERS_LABEL_RUN}=${RUN_ID}`],
    })
  })

  it('maps a non-2xx list response through mapDockerError', async () => {
    const { client } = createClient(always({ status: 500, headers: {}, body: 'engine down' }))

    expect((await roversErrorOf(client.listByRun(RUN_ID))).code).toBe('vm_start_failed')
  })
})
