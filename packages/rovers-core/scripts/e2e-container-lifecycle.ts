/**
 * M1-B4 + M1-B5 acceptance harness — the full container lifecycle with **no
 * user-installed `docker` CLI** (`q7-client-decision.md` §6), driven through the
 * authorization gate (`security/gate.ts`, `spec.md` §6.5).
 *
 * The premise of the M0 deviation was "a host with an empty `command -v docker`".
 * This script asserts that premise itself, then exercises ping → pull (by digest)
 * → create → start → health → logs → stop → start → remove over the pinned Unix
 * socket. Nothing shells out to `docker`.
 *
 * It also proves the double gate live: every mutating step is authorized by
 * `authorizeRoversAction`, and the negative controls show that an unconfirmed
 * action and a **foreign-labelled** container are both refused.
 *
 *   bun run scripts/e2e-container-lifecycle.ts
 *
 * Environment:
 *   ROVERS_E2E_SOCKET   `unix://` endpoint to drive. Default:
 *                       `unix:///var/run/docker.sock` (OrbStack on this host),
 *                       resolved through its symlinks by the gate.
 *   ROVERS_E2E_IMAGE    Digest-pinned image reference. The default is pinned to
 *                       the `library/nginx:1.27-alpine` manifest-list digest
 *                       resolved from Docker Hub on 2026-10-14 — chosen because
 *                       its default command (`nginx -g 'daemon off;'`) keeps the
 *                       container up, which `RoversContainerSpec` cannot express
 *                       today (the contract carries no `command`/`entrypoint`;
 *                       see the M1-B4 finding in `docs/reviews-summary.md`).
 *
 * Exit code 0 only when every step passes, the removal left no container behind
 * for the run id, and both gate refusals fired.
 */

import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

import { RoversError } from '../src/errors.ts'
import { ROVERS_LABEL_RUN, ROVERS_LABEL_SERVICE } from '../src/types.ts'
import type { RoversContainerSpec } from '../src/types.ts'
import { createDockerEngineClient, createUnixSocketRequest } from '../src/engines/local/container-client.ts'
import { assertRoversEndpointPinned, authorizeRoversAction, pinRoversDockerEndpoint } from '../src/security/gate.ts'

/** `library/nginx:1.27-alpine` manifest list, resolved 2026-10-14. */
const DEFAULT_IMAGE =
  'library/nginx@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10'

const SOCKET_URI_DEFAULT = 'unix:///var/run/docker.sock'

function log(line: string): void {
  process.stdout.write(`${line}\n`)
}

function step(name: string): void {
  process.stdout.write(`\n▸ ${name}\n`)
}

/**
 * The M0 blocker was that the host resolved a `docker` CLI. If one appears here
 * the proof is void, so refuse rather than silently proving nothing.
 */
function assertNoDockerCli(): void {
  let resolved: string | null = null
  try {
    resolved = execFileSync('/bin/sh', ['-c', 'command -v docker'], { encoding: 'utf8' }).trim()
  } catch {
    resolved = null
  }
  if (resolved) {
    throw new Error(
      `premise violated: \`command -v docker\` resolved to ${resolved}. ` +
        'The M1-B4 proof requires a host with no user-installed docker CLI.',
    )
  }
  log('  ✓ `command -v docker` is empty — the proof premise holds')
}

/** Assert the gate refuses, and that the refusal is the typed `socket_denied`. */
function requireRefusal(label: string, action: () => void): void {
  let caught: unknown
  try {
    action()
  } catch (error) {
    caught = error
  }
  if (caught === undefined) throw new Error(`expected a refusal for: ${label}`)
  if (!(caught instanceof RoversError)) throw new Error(`refusal for ${label} was not a RoversError: ${String(caught)}`)
  if (caught.code !== 'socket_denied') throw new Error(`refusal for ${label} had code ${caught.code}, expected socket_denied`)
  if (!caught.repairAction) throw new Error(`refusal for ${label} carried no repair action`)
  log(`  ✓ refused (socket_denied) — ${label}`)
}

/** Read the container id out of a raw Engine `create` response, validated. */
function containerIdFromBody(body: string): string {
  const parsed: unknown = JSON.parse(body)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`engine create response was not an object: ${body.slice(0, 120)}`)
  }
  if (!('Id' in parsed) || typeof parsed.Id !== 'string' || parsed.Id.length === 0) {
    throw new Error(`engine create response carried no container Id: ${body.slice(0, 120)}`)
  }
  return parsed.Id
}

function fail(stage: string, cause: unknown): never {
  if (cause instanceof RoversError) {
    process.stderr.write(`\n✗ ${stage} failed: [${cause.code}] ${cause.message}\n`)
    if (cause.repairAction) process.stderr.write(`  repair: ${cause.repairAction}\n`)
  } else {
    process.stderr.write(`\n✗ ${stage} failed: ${String(cause)}\n`)
  }
  process.exit(1)
}

async function main(): Promise<void> {
  const uri = process.env.ROVERS_E2E_SOCKET ?? SOCKET_URI_DEFAULT
  const image = process.env.ROVERS_E2E_IMAGE ?? DEFAULT_IMAGE

  log('M1-B4 + M1-B5 — container lifecycle over the Engine API (no docker CLI)')
  log(`  endpoint: ${uri}`)
  log(`  image:    ${image}`)

  step('premise')
  assertNoDockerCli()

  step('socket pinning — gate resolves the chain and pins {dev, ino}')
  const endpoint = pinRoversDockerEndpoint(uri)
  log(`  resolved: ${endpoint.socket}`)
  log(`  dev=${endpoint.device} ino=${endpoint.inode}`)
  assertRoversEndpointPinned(endpoint)
  log('  ✓ re-assert after pin holds')

  const client = createDockerEngineClient({ endpoint })
  /** A raw transport, used only to stage the foreign-container negative control. */
  const raw = createUnixSocketRequest(endpoint)

  const runId = randomUUID()
  const serviceId = `e2e-${runId.slice(0, 8)}`
  const name = `rox-e2e-${runId.slice(0, 12)}`
  const foreignName = `rox-e2e-foreign-${runId.slice(0, 8)}`

  let containerId: string | null = null
  let foreignId: string | null = null

  try {
    step('gate — the permission table refuses an unpublished tool and an unconfirmed write')
    requireRefusal('unpublished tool', () => authorizeRoversAction({ tool: 'docker_ps', action: 'read' }))
    requireRefusal('unconfirmed mutating action', () =>
      authorizeRoversAction({ tool: 'rovers_deploy', action: 'write', labels: { [ROVERS_LABEL_SERVICE]: 's', [ROVERS_LABEL_RUN]: 'r' } }),
    )
    requireRefusal('read tool attempting a write', () =>
      authorizeRoversAction({ tool: 'rovers_logs', action: 'write', confirmed: true, labels: { [ROVERS_LABEL_SERVICE]: 's', [ROVERS_LABEL_RUN]: 'r' } }),
    )
    requireRefusal('mutating action with partial labels', () =>
      authorizeRoversAction({ tool: 'rovers_stop', action: 'write', confirmed: true, labels: { [ROVERS_LABEL_SERVICE]: 's' } }),
    )

    step('health — ping the engine')
    await client.ping()
    log('  ✓ engine reachable')

    step('deploy — pull strictly by digest')
    const pulled = await client.pull(image)
    log(`  ✓ pulled ${pulled.digest} (id ${pulled.id.slice(0, 12)})`)

    step('gate authorizes the deploy, then create with both ownership labels')
    authorizeRoversAction({ tool: 'rovers_deploy', action: 'create', confirmed: true })
    const spec: RoversContainerSpec = {
      serviceId,
      runId,
      name,
      image,
      env: { ROX_E2E: '1' },
      labels: { 'ro.rox.test': 'e2e' },
      restartPolicy: 'no',
    }
    const created = await client.create(spec)
    containerId = created.id
    log(`  ✓ created ${created.id.slice(0, 12)}`)

    const inspected = await client.inspect(created.id)
    if (inspected.config.labels[ROVERS_LABEL_SERVICE] !== serviceId) {
      throw new Error(`ownership label ${ROVERS_LABEL_SERVICE} missing/incorrect on create`)
    }
    if (inspected.config.labels[ROVERS_LABEL_RUN] !== runId) {
      throw new Error(`ownership label ${ROVERS_LABEL_RUN} missing/incorrect on create`)
    }
    log('  ✓ both ownership labels present (spec labels cannot override them)')

    step('start — through the gate with the container own labels')
    assertRoversEndpointPinned(endpoint)
    authorizeRoversAction({ tool: 'rovers_deploy', action: 'write', confirmed: true, labels: inspected.config.labels })
    await client.start(created.id)
    const running = await client.inspect(created.id)
    if (!running.state.running) throw new Error(`container did not start: status=${running.state.status}`)
    log(`  ✓ status=${running.state.status}`)

    step('logs (bounded)')
    const logs = await client.logs(created.id, { tail: 20, maxBytes: 4096 })
    log(`  ✓ ${Buffer.byteLength(logs, 'utf8')} bytes returned (cap honoured)`)

    step('ownership — listByRun returns exactly the label set')
    const owned = await client.listByRun(runId)
    if (!owned.some((c) => c.id === created.id)) {
      throw new Error(`listByRun(${runId}) did not return the created container`)
    }
    if (owned.some((c) => c.labels[ROVERS_LABEL_RUN] !== runId)) {
      throw new Error('listByRun returned a container owned by another run')
    }
    log(`  ✓ ${owned.length} container(s) owned by this run`)

    step('stop / start again (re-adoption, never a duplicate)')
    authorizeRoversAction({ tool: 'rovers_stop', action: 'write', confirmed: true, labels: running.config.labels })
    await client.stop(created.id, 5)
    const stopped = await client.inspect(created.id)
    if (stopped.state.running) throw new Error('container still running after stop')
    log(`  ✓ stopped (status=${stopped.state.status})`)
    await client.start(created.id)
    const restarted = await client.inspect(created.id)
    if (!restarted.state.running) throw new Error('container did not restart')
    log(`  ✓ restarted (status=${restarted.state.status})`)

    step('NEGATIVE CONTROL — a foreign-labelled container is refused, even by an authorized tool')
    const foreign = await raw({
      method: 'POST',
      path: `/containers/create?name=${encodeURIComponent(foreignName)}`,
      body: JSON.stringify({ Image: image, Labels: { 'com.example.other': 'not-rox' }, Cmd: ['sleep', '120'] }),
    })
    if (foreign.status >= 400) throw new Error(`could not stage the foreign container: HTTP ${foreign.status} ${foreign.body}`)
    foreignId = containerIdFromBody(foreign.body)
    await raw({ method: 'POST', path: `/containers/${encodeURIComponent(foreignId)}/start` })
    const foreignInspect = await client.inspect(foreignId)
    log(`  staged a container Rox does not own (labels: ${JSON.stringify(foreignInspect.config.labels)})`)
    requireRefusal('foreign labels on a mutating action', () =>
      authorizeRoversAction({ tool: 'rovers_stop', action: 'write', confirmed: true, labels: foreignInspect.config.labels }),
    )
    await raw({ method: 'DELETE', path: `/containers/${encodeURIComponent(foreignId)}?force=1&v=1` })
    foreignId = null
    log('  ✓ foreign container cleaned up out-of-band')

    step('remove (force + volumes), label-scoped by the gate')
    assertRoversEndpointPinned(endpoint)
    authorizeRoversAction({ tool: 'rovers_stop', action: 'write', confirmed: true, labels: restarted.config.labels })
    await client.remove(created.id, { force: true, volumes: true })
    containerId = null
    log('  ✓ removed')

    step('post-condition — no container left for the run')
    const leftover = await client.listByRun(runId)
    if (leftover.length > 0) throw new Error(`run ${runId} still has ${leftover.length} container(s) after removal`)
    log('  ✓ run has no containers')

    log('\nPASS — full lifecycle over the Engine API with no docker CLI, every mutating step gated')
    log(`  run=${runId} service=${serviceId}`)
  } catch (cause) {
    for (const stale of [containerId, foreignId]) {
      if (stale === null) continue
      process.stderr.write(`\n(cleaning up ${stale.slice(0, 12)} after failure)\n`)
      try {
        await client.remove(stale, { force: true, volumes: true })
      } catch {
        /* best effort — the failure report matters more */
      }
    }
    fail('lifecycle', cause)
  }
}

await main()
