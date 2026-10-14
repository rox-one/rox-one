/**
 * M1-B4 finding F3 acceptance harness — `command`/`entrypoint` really reach the
 * container, over the Engine API and **no user-installed `docker` CLI**.
 *
 * The M1-B4 lifecycle proof had to use nginx with its *default* command, because
 * `RoversContainerSpec` could not express `Cmd`/`Entrypoint` at all. Any catalog
 * template whose compose carries `command:` was therefore undeployable. This
 * script is the end-to-end half of the fix; `container-client.test.ts` pins the
 * request-shape half.
 *
 * Three containers, each falsifiable on its own:
 *
 *   A. `entrypoint` **and** `command` set → the container prints the proof token.
 *      Proves both fields cross, and that `command` is passed as arguments to the
 *      overridden `entrypoint` (`/bin/sh -c <command>`).
 *   B. `command` only → the **image** entrypoint is retained and receives it
 *      (`/docker-entrypoint.sh nginx -v` prints the nginx version). Proves the
 *      override does not clobber the entrypoint when only `command` is set.
 *   C. neither set → the image default runs unchanged and the container stays
 *      up. This is a **container-level** control: the image `Cmd`/`Entrypoint`
 *      survive and the container does not exit. It cannot by itself distinguish
 *      "field absent" from "field sent as `null`/`[]`", because the daemon
 *      re-adopts the image config in both cases — that distinction is pinned at
 *      the request level by `container-client.test.ts` ("omits Cmd and
 *      Entrypoint entirely").
 *
 *   bun run scripts/e2e-container-command.ts
 *
 * Environment:
 *   ROVERS_E2E_SOCKET   `unix://` endpoint. Default `unix:///var/run/docker.sock`.
 *   ROVERS_E2E_IMAGE    Digest-pinned image. Default `library/nginx:1.27-alpine`
 *                       (manifest-list digest resolved 2026-10-14); its default
 *                       command keeps the container up, and it ships `/bin/sh`.
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
const PROOF_TOKEN = 'ROVERS-EP-CMD-PROOF'
/** How long a container may take to run to completion before we call it stuck. */
const EXIT_TIMEOUT_MS = 30_000

function log(line: string): void {
  process.stdout.write(`${line}\n`)
}

function step(name: string): void {
  process.stdout.write(`\n▸ ${name}\n`)
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

/** The proof is void on a host that resolves `docker`, so refuse instead. */
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
        'The proof requires a host with no user-installed docker CLI.',
    )
  }
  log('  ✓ `command -v docker` is empty — the proof premise holds')
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

  log('M1-B4 / F3 — `command` and `entrypoint` reach the container over the Engine API')
  log(`  endpoint: ${uri}`)
  log(`  image:    ${image}`)

  step('premise')
  assertNoDockerCli()

  step('socket pinning')
  const endpoint = pinRoversDockerEndpoint(uri)
  log(`  resolved: ${endpoint.socket}`)
  log(`  dev=${endpoint.device} ino=${endpoint.inode}`)
  assertRoversEndpointPinned(endpoint)

  const client = createDockerEngineClient({ endpoint })
  /** Raw transport: used only to read `Config.Cmd`/`Config.Entrypoint` back. */
  const raw = createUnixSocketRequest(endpoint)

  const runId = randomUUID()
  const serviceId = `e2e-cmd-${runId.slice(0, 8)}`
  const created: string[] = []

  /** Read `Config.Cmd` / `Config.Entrypoint` straight off the Engine. */
  async function engineCommand(id: string): Promise<{ cmd: string[] | null; entrypoint: string[] | null }> {
    return commandFrom(await raw({ method: 'GET', path: `/containers/${encodeURIComponent(id)}/json` }))
  }

  /** The image's own `Cmd`/`Entrypoint` — the defaults a spec may override. */
  async function imageCommand(): Promise<{ cmd: string[] | null; entrypoint: string[] | null }> {
    return commandFrom(await raw({ method: 'GET', path: `/images/${encodeURIComponent(image)}/json` }))
  }

  function commandFrom(response: { body: string }): { cmd: string[] | null; entrypoint: string[] | null } {
    const parsed: unknown = JSON.parse(response.body)
    const config =
      typeof parsed === 'object' && parsed !== null && 'Config' in parsed
        ? (parsed as { Config?: unknown }).Config
        : undefined
    const record = typeof config === 'object' && config !== null ? (config as Record<string, unknown>) : {}
    const asArray = (value: unknown): string[] | null =>
      Array.isArray(value) ? value.filter((part): part is string => typeof part === 'string') : null
    return { cmd: asArray(record.Cmd), entrypoint: asArray(record.Entrypoint) }
  }

  /** Deep-compare two `Cmd`/`Entrypoint` values (`null` = "not set"). */
  function sameArgs(actual: string[] | null, expected: string[] | null): boolean {
    return JSON.stringify(actual) === JSON.stringify(expected)
  }

  /** Poll until the container stops running (or give up and fail loudly). */
  async function waitForExit(id: string): Promise<string> {
    const deadline = Date.now() + EXIT_TIMEOUT_MS
    while (Date.now() < deadline) {
      const state = await client.inspect(id)
      if (!state.state.running) return state.state.status
      await sleep(200)
    }
    throw new Error(`container ${id.slice(0, 12)} was still running after ${EXIT_TIMEOUT_MS} ms`)
  }

  async function deploy(spec: RoversContainerSpec): Promise<string> {
    authorizeRoversAction({ tool: 'rovers_deploy', action: 'create', confirmed: true })
    const result = await client.create(spec)
    created.push(result.id)
    return result.id
  }

  try {
    step('health — ping the engine')
    await client.ping()
    log('  ✓ engine reachable')

    step('pull strictly by digest')
    const pulled = await client.pull(image)
    log(`  ✓ pulled ${pulled.digest} (id ${pulled.id.slice(0, 12)})`)

    const imageDefaults = await imageCommand()
    log(
      `  image defaults: Entrypoint=${JSON.stringify(imageDefaults.entrypoint)} Cmd=${JSON.stringify(imageDefaults.cmd)}`,
    )

    /* ── A: entrypoint + command, both overridden ─────────────────────────── */
    step('A — entrypoint + command override the image; command is argv to the entrypoint')
    const idA = await deploy({
      serviceId,
      runId,
      name: `rox-cmd-a-${runId.slice(0, 8)}`,
      image,
      entrypoint: ['/bin/sh', '-c'],
      command: [`echo ${PROOF_TOKEN}`],
      restartPolicy: 'no',
    })
    const apiA = await engineCommand(idA)
    if (JSON.stringify(apiA.entrypoint) !== JSON.stringify(['/bin/sh', '-c'])) {
      throw new Error(`A: Engine saw Entrypoint=${JSON.stringify(apiA.entrypoint)}, expected ["/bin/sh","-c"]`)
    }
    if (JSON.stringify(apiA.cmd) !== JSON.stringify([`echo ${PROOF_TOKEN}`])) {
      throw new Error(`A: Engine saw Cmd=${JSON.stringify(apiA.cmd)}, expected ["echo ${PROOF_TOKEN}"]`)
    }
    log(`  ✓ Engine stored Entrypoint=${JSON.stringify(apiA.entrypoint)} Cmd=${JSON.stringify(apiA.cmd)}`)

    authorizeRoversAction({ tool: 'rovers_deploy', action: 'write', confirmed: true, labels: (await client.inspect(idA)).config.labels })
    await client.start(idA)
    const statusA = await waitForExit(idA)
    const logsA = await client.logs(idA, { tail: 50, maxBytes: 4096 })
    if (!logsA.includes(PROOF_TOKEN)) {
      throw new Error(`A: container output did not contain ${PROOF_TOKEN}; got: ${logsA.slice(0, 300)}`)
    }
    log(`  ✓ exited (${statusA}) and printed ${PROOF_TOKEN} — both fields took effect`)

    /* ── B: command only, image entrypoint retained ───────────────────────── */
    step('B — command only: the image entrypoint is retained and receives it')
    const idB = await deploy({
      serviceId,
      runId,
      name: `rox-cmd-b-${runId.slice(0, 8)}`,
      image,
      command: ['nginx', '-v'],
      restartPolicy: 'no',
    })
    const apiB = await engineCommand(idB)
    if (!sameArgs(apiB.entrypoint, imageDefaults.entrypoint)) {
      throw new Error(
        `B: Engine saw Entrypoint=${JSON.stringify(apiB.entrypoint)}, expected the image default ${JSON.stringify(imageDefaults.entrypoint)}`,
      )
    }
    if (!sameArgs(apiB.cmd, ['nginx', '-v'])) {
      throw new Error(`B: Engine saw Cmd=${JSON.stringify(apiB.cmd)}, expected ["nginx","-v"]`)
    }
    log(`  ✓ Entrypoint untouched (${JSON.stringify(apiB.entrypoint)}); Cmd overridden`)

    authorizeRoversAction({ tool: 'rovers_deploy', action: 'write', confirmed: true, labels: (await client.inspect(idB)).config.labels })
    await client.start(idB)
    const statusB = await waitForExit(idB)
    const logsB = await client.logs(idB, { tail: 50, maxBytes: 4096 })
    if (!/nginx version/i.test(logsB)) {
      throw new Error(`B: container output did not report the nginx version; got: ${logsB.slice(0, 300)}`)
    }
    log(`  ✓ exited (${statusB}) and reported the nginx version — command reached the image entrypoint`)

    /* ── C: neither set — container-level negative control ────────────────── */
    step('C — neither field set: the image default runs and nothing is cleared')
    const idC = await deploy({
      serviceId,
      runId,
      name: `rox-cmd-c-${runId.slice(0, 8)}`,
      image,
      restartPolicy: 'no',
    })
    const apiC = await engineCommand(idC)
    if (!sameArgs(apiC.entrypoint, imageDefaults.entrypoint) || !sameArgs(apiC.cmd, imageDefaults.cmd)) {
      throw new Error(
        `C: Engine saw Entrypoint=${JSON.stringify(apiC.entrypoint)} Cmd=${JSON.stringify(apiC.cmd)}; ` +
          `expected the image defaults Entrypoint=${JSON.stringify(imageDefaults.entrypoint)} Cmd=${JSON.stringify(imageDefaults.cmd)}`,
      )
    }
    log(
      `  ✓ image defaults survived untouched (Entrypoint=${JSON.stringify(apiC.entrypoint)} Cmd=${JSON.stringify(apiC.cmd)})`,
    )

    authorizeRoversAction({ tool: 'rovers_deploy', action: 'write', confirmed: true, labels: (await client.inspect(idC)).config.labels })
    await client.start(idC)
    await sleep(2000)
    const stateC = await client.inspect(idC)
    if (!stateC.state.running) {
      throw new Error(`C: the default-command container exited (${stateC.state.status}); it should stay up`)
    }
    const logsC = await client.logs(idC, { tail: 50, maxBytes: 8192 })
    if (logsC.includes(PROOF_TOKEN) || /nginx version/i.test(logsC)) {
      throw new Error('C: the default-command container produced overridden-command output — the fields leaked')
    }
    log(`  ✓ still running (${stateC.state.status}) on the image default; no override output`)

    process.stdout.write('\nPASS — command/entrypoint cross to the Engine API, and only when set\n')
  } catch (cause) {
    fail('command/entrypoint proof', cause)
  } finally {
    for (const id of created) {
      try {
        await client.remove(id, { force: true })
      } catch {
        // Best-effort cleanup: a leftover container is reported by the run id.
      }
    }
    const leftovers = await client.listByRun(runId).catch(() => [])
    if (leftovers.length > 0) {
      process.stderr.write(`\n⚠ ${leftovers.length} container(s) left behind for run ${runId}\n`)
      process.exit(1)
    }
  }
}

await main()
