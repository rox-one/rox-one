/**
 * @rox/rovers-core — failure-taxonomy conformance (M1-B4).
 *
 * `mapDockerError` is the frozen bridge between Docker Engine statuses and the
 * 14-code enum (`errors.ts`, `spec.md` §5.5). This suite drives every branch the
 * container client can actually reach and asserts the code, the Russian message
 * and the Russian repair action. Codes the client can never produce are
 * documented, not faked — see `CLIENT_UNREACHABLE_CODES`.
 */

import { describe, expect, it } from 'bun:test'

import { ROVERS_ERROR_CODES, ROVERS_M3_LIFECYCLE_CODES, RoversError, isRoversErrorCode } from '../errors.ts'
import type { RoversErrorCode } from '../errors.ts'
import { createDockerEngineClient, mapDockerError } from '../engines/local/container-client.ts'
import type { RoversDockerResponse } from '../engines/local/container-client.ts'
import type { RoversContainerClient, RoversDockerEndpoint } from '../types.ts'

const ENDPOINT: RoversDockerEndpoint = {
  uri: 'unix:///var/run/docker.sock',
  socket: '/var/run/docker.sock',
  device: 3,
  inode: 17,
}

const CYRILLIC = /[А-Яа-яЁё]/

/**
 * Every status/body branch of `mapDockerError`, in the order the function tests
 * them. A body in `errorDetail`/`message` shape is used where the branch keys on
 * the text (port conflict, OOM).
 */
const TAXONOMY: ReadonlyArray<{ label: string; status: number; body: string; code: RoversErrorCode }> = [
  { label: '401 rejects the socket', status: 401, body: 'permission denied while connecting to the socket', code: 'socket_denied' },
  { label: '403 rejects the socket', status: 403, body: 'forbidden', code: 'socket_denied' },
  { label: '404 misses the object', status: 404, body: 'no such image', code: 'image_unavailable' },
  { label: '409 conflicts with a live container', status: 409, body: 'Conflict. The container name "/rox" is already in use', code: 'vm_start_failed' },
  { label: '400 with port is already allocated', status: 400, body: '{"message":"port is already allocated"}', code: 'port_conflict' },
  { label: '400 with address already in use', status: 400, body: 'bind: address already in use', code: 'port_conflict' },
  { label: '400 without a port hint', status: 400, body: 'bad parameter: invalid image reference', code: 'image_unavailable' },
  { label: '422 without a port hint', status: 422, body: 'unprocessable entity', code: 'image_unavailable' },
  { label: '500 with out of memory', status: 500, body: '{"message":"cannot allocate memory: out of memory"}', code: 'oom_at_start' },
  { label: '500 with no space left', status: 500, body: 'no space left on device', code: 'oom_at_start' },
  { label: '500 plain', status: 500, body: 'internal server error', code: 'vm_start_failed' },
  { label: '502 plain', status: 502, body: 'bad gateway', code: 'vm_start_failed' },
  { label: '503 plain', status: 503, body: 'service unavailable', code: 'vm_start_failed' },
]

describe('mapDockerError — reachable taxonomy branches', () => {
  for (const branch of TAXONOMY) {
    it(`${branch.status} — ${branch.label}`, () => {
      const error = mapDockerError(branch.status, branch.body)

      expect(error).toBeInstanceOf(RoversError)
      expect(error.code).toBe(branch.code)
      expect(error.message).toContain(String(branch.status))
      expect(error.message.length).toBeGreaterThan(0)
      expect(CYRILLIC.test(error.message)).toBe(true)

      const repair = error.repairAction
      expect(typeof repair).toBe('string')
      expect((repair ?? '').length).toBeGreaterThan(0)
      expect(CYRILLIC.test(repair ?? '')).toBe(true)
    })
  }

  it('keeps the excerpt bounded and collapses control characters', () => {
    const error = mapDockerError(500, `boom\u0000${'x'.repeat(1000)}`)

    expect(error.message).toContain('boom')
    expect(error.message.includes('\u0000')).toBe(false)
    expect(error.message.length).toBeLessThan(400)
  })

  it('renders an empty body as a placeholder rather than an empty excerpt', () => {
    expect(mapDockerError(500, '   ').message).toContain('(пустой ответ)')
  })

  it('maps a 300-range status through the fallback (only >= 400 is reached in practice)', () => {
    // `ensureOk` never calls mapDockerError below 400; the fallback still yields
    // a valid code rather than throwing.
    expect(mapDockerError(304, '').code).toBe('image_unavailable')
  })
})

describe('mapDockerError — taxonomy closure', () => {
  it('only ever produces codes from the frozen 14-code enum, all with Russian copy', () => {
    const statuses = [200, 201, 204, 301, 400, 401, 402, 403, 404, 405, 409, 410, 422, 429, 499, 500, 501, 502, 503, 504, 599]
    const bodies = [
      '',
      'port is already allocated',
      'address already in use',
      'no space left on device',
      'out of memory',
      'oom',
      '{"errorDetail":{"code":409}}',
      'x'.repeat(500),
    ]

    for (const status of statuses) {
      for (const body of bodies) {
        const error = mapDockerError(status, body)
        expect(isRoversErrorCode(error.code)).toBe(true)
        expect(ROVERS_ERROR_CODES).toContain(error.code)
        expect(error.message.length).toBeGreaterThan(0)
        expect(CYRILLIC.test(error.message)).toBe(true)
        expect((error.repairAction ?? '').length).toBeGreaterThan(0)
        expect(CYRILLIC.test(error.repairAction ?? '')).toBe(true)
        expect(error.toJSON().code).toBe(error.code)
      }
    }
  })
})

/** The 7 codes this client can produce; each is driven by a real client call. */
const CLIENT_REACHABLE_CODES: ReadonlyArray<RoversErrorCode> = [
  'no_runtime',
  'vm_start_failed',
  'socket_denied',
  'image_unavailable',
  'digest_mismatch',
  'port_conflict',
  'oom_at_start',
]

/**
 * The 7 codes `container-client.ts` can NEVER produce. They are documented here
 * instead of being faked, so the taxonomy stays honest about ownership:
 *   • proxy_unavailable          — local proxy surface (M1-C), not the Engine API client.
 *   • healthcheck_timeout        — the healthcheck watcher (M1-C) turns `State.Health` into it.
 *   • signature_invalid          — catalog/artifact signature check (host-side, M1-A/M3).
 *   • backup_failed              — M3 lifecycle: backup (`spec.md` §8 A2).
 *   • restore_failed             — M3 lifecycle: restore.
 *   • update_failed_rolled_back  — M3 lifecycle: update + automatic rollback.
 *   • engine_removed             — M0 Q8 negative control («Убрать движок»).
 */
const CLIENT_UNREACHABLE_CODES: ReadonlyArray<RoversErrorCode> = [
  'proxy_unavailable',
  'healthcheck_timeout',
  'signature_invalid',
  'backup_failed',
  'restore_failed',
  'update_failed_rolled_back',
  'engine_removed',
]

const REACHABILITY_CASES: ReadonlyArray<{
  code: RoversErrorCode
  response: RoversDockerResponse
  call: (client: RoversContainerClient) => Promise<unknown>
}> = [
  { code: 'no_runtime', response: { status: 503, headers: {}, body: 'engine down' }, call: (client) => client.ping() },
  { code: 'socket_denied', response: { status: 403, headers: {}, body: 'permission denied' }, call: (client) => client.start('c1') },
  {
    code: 'image_unavailable',
    response: { status: 404, headers: {}, body: 'no such image' },
    call: (client) => client.pull(`library/nginx@sha256:${'0'.repeat(64)}`),
  },
  { code: 'digest_mismatch', response: { status: 200, headers: {}, body: '' }, call: (client) => client.pull('nginx:latest') },
  { code: 'port_conflict', response: { status: 400, headers: {}, body: 'port is already allocated' }, call: (client) => client.start('c1') },
  { code: 'oom_at_start', response: { status: 500, headers: {}, body: 'out of memory' }, call: (client) => client.start('c1') },
  { code: 'vm_start_failed', response: { status: 500, headers: {}, body: 'internal error' }, call: (client) => client.start('c1') },
]

describe('createDockerEngineClient — code reachability', () => {
  for (const branch of REACHABILITY_CASES) {
    it(`produces ${branch.code} from a real client call`, async () => {
      const client = createDockerEngineClient({
        endpoint: ENDPOINT,
        requestImpl: async () => branch.response,
      })

      const rejection = await branch.call(client).then(
        () => null,
        (error: unknown) => error,
      )

      expect(rejection).toBeInstanceOf(RoversError)
      expect((rejection as RoversError).code).toBe(branch.code)
      expect(ROVERS_ERROR_CODES).toContain(branch.code)
    })
  }

  it('accounts for exactly the 14 frozen codes across reachable + unreachable', () => {
    expect(CLIENT_REACHABLE_CODES.length + CLIENT_UNREACHABLE_CODES.length).toBe(ROVERS_ERROR_CODES.length)

    // Reachable and unreachable must be a strict partition of the frozen enum:
    // every code lands in exactly one list, and no code is unknown.
    for (const code of ROVERS_ERROR_CODES) {
      const reachable = CLIENT_REACHABLE_CODES.includes(code)
      const unreachable = CLIENT_UNREACHABLE_CODES.includes(code)
      expect(reachable !== unreachable).toBe(true)
    }
    for (const code of ROVERS_M3_LIFECYCLE_CODES) expect(CLIENT_UNREACHABLE_CODES).toContain(code)
  })
})
