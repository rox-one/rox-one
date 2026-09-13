/**
 * RMA-I029 / #385 — E2E harness.
 * Boots a real Electron process with temp HOME / ROX_CONFIG_DIR / CRAFT_CONFIG_DIR
 * and a loopback fixture gateway. Env flags do not enable fake transport.
 * Fixture entrypoint cannot ship as production success.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFixtureGateway, type FixtureGateway } from './gateway.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '../../..')
const FIXTURE_ENTRYPOINT = join(HERE, 'fixture-entrypoint.cjs')
const APPS_ELECTRON_MAIN = join(REPO_ROOT, 'apps/electron/dist/main.cjs')
const ELECTRON_BIN = join(REPO_ROOT, 'node_modules/electron/dist/electron')
const HOST_HOME = process.env.HOME ?? ''
const HOST_DISPLAY = process.env.DISPLAY || ':1'
const HOST_XAUTHORITY =
  process.env.XAUTHORITY || (HOST_HOME ? join(HOST_HOME, '.Xauthority') : '')

export type MeetingAppHandles = {
  readonly caseId: string
  readonly profileDir: string
  readonly gateway: 'loopback-fixture' | 'production'
  readonly pid: number
  readonly entrypoint: 'apps-electron' | 'test-fixture'
}

export type EvidenceLevel = 'U1' | 'C2' | 'E3' | 'L4' | 'N5'
export type EvidenceStatus = 'passed' | 'failed' | 'blocked' | 'not_run'

export type HarnessEvidence = {
  readonly level: EvidenceLevel
  readonly status: EvidenceStatus
  readonly packaged: 'not_run'
  readonly entrypoint: MeetingAppHandles['entrypoint']
  readonly commitSha: string | null
}

export type BootMeetingAppResult = {
  readonly app: MeetingAppHandles
  page: unknown
  readonly profileDir: string
  readonly gateway: FixtureGateway
  pid: number
  readonly entrypoint: MeetingAppHandles['entrypoint']
  readonly evidence: HarnessEvidence
  restart: () => Promise<void>
  dispose: () => Promise<void>
}

export type BootMeetingApp = (input: {
  readonly caseId: string
  readonly profileDir?: string
}) => Promise<BootMeetingAppResult>

export function productionFixtureGuard(input: {
  readonly nodeEnv?: string
  readonly fixtureEntrypoint: boolean
  readonly fakeTransportEnv?: string
}): { ok: true } | { ok: false; reason: string } {
  if (input.fixtureEntrypoint && input.nodeEnv === 'production') {
    return { ok: false, reason: 'production-fixture-entrypoint' }
  }
  if (input.fakeTransportEnv === '1') {
    return { ok: false, reason: 'env-flag-is-not-transport' }
  }
  return { ok: true }
}

export function evidenceRow(
  level: EvidenceLevel,
  status: EvidenceStatus,
): { level: EvidenceLevel; status: EvidenceStatus } {
  return { level, status }
}

/**
 * Honesty stamp for I029 / #385.
 * Fixture HTML (`fixture-entrypoint.cjs` / `data:text/html`) is U1 / test-fixture.
 * E3 `passed` only when the packaged-or-dist Electron entrypoint actually
 * exercised product state (UI → RPC → storage → readback). Boot alone is not that.
 */
export function stampHarnessEvidence(input: {
  readonly entrypoint: MeetingAppHandles['entrypoint']
  readonly productStateExercised?: boolean
}): HarnessEvidence {
  const commitSha = process.env.GITHUB_SHA ?? null
  const packaged = 'not_run' as const

  if (input.entrypoint !== 'apps-electron') {
    return {
      level: 'U1',
      status: 'passed',
      packaged,
      entrypoint: 'test-fixture',
      commitSha,
    }
  }

  if (input.productStateExercised === true) {
    return {
      level: 'E3',
      status: 'passed',
      packaged,
      entrypoint: 'apps-electron',
      commitSha,
    }
  }

  return {
    level: 'E3',
    status: 'not_run',
    packaged,
    entrypoint: 'apps-electron',
    commitSha,
  }
}

export class BootMeetingAppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'BootMeetingAppError'
  }
}

type ElectronSession = {
  child: ChildProcess
  pid: number
  page: unknown
  cdpPort: number
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForFile(path: string, timeoutMs: number): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (existsSync(path)) {
      return await readFile(path, 'utf8')
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new BootMeetingAppError('electron-ready-timeout', `ready file not written: ${path}`)
}

async function pickPort(): Promise<number> {
  const { createServer } = await import('node:net')
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        server.close()
        reject(new Error('failed to allocate loopback port'))
        return
      }
      const port = addr.port
      server.close((err) => (err ? reject(err) : resolve(port)))
    })
  })
}

async function stopChild(
  child: ChildProcess | undefined,
  pid: number | undefined,
  userDataDir?: string,
): Promise<void> {
  const target = pid ?? child?.pid
  if (target && pidAlive(target)) {
    try {
      process.kill(target, 'SIGTERM')
    } catch {
      // already gone
    }
    const start = Date.now()
    while (Date.now() - start < 4000) {
      if (!pidAlive(target)) break
      await new Promise((r) => setTimeout(r, 50))
    }
    if (pidAlive(target)) {
      try {
        process.kill(target, 'SIGKILL')
      } catch {
        // already gone
      }
    }
  }
  if (!userDataDir) return
  for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'lockfile']) {
    await rm(join(userDataDir, name), { force: true }).catch(() => undefined)
  }
}

function resolveEntrypoint(): { path: string; kind: MeetingAppHandles['entrypoint'] } {
  const wantPackaged = process.env.ROX_MEETING_USE_PACKAGED_APP === '1'
  if (wantPackaged) {
    if (!existsSync(APPS_ELECTRON_MAIN)) {
      throw new BootMeetingAppError(
        'electron-dist-missing',
        `apps/electron dist is not built (${APPS_ELECTRON_MAIN}); packaged E3/N5 stay not_run`,
      )
    }
    return { path: APPS_ELECTRON_MAIN, kind: 'apps-electron' }
  }
  return { path: FIXTURE_ENTRYPOINT, kind: 'test-fixture' }
}

function isolatedEnv(input: {
  profileDir: string
  caseId: string
  gateway: FixtureGateway
  readyFile: string
  storeFile: string
}): NodeJS.ProcessEnv {
  const home = join(input.profileDir, 'home')
  const config = join(input.profileDir, 'config')
  const userData = join(input.profileDir, 'userData')
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_CACHE_HOME: join(home, '.cache'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    TMPDIR: join(input.profileDir, 'tmp'),
    DISPLAY: process.env.DISPLAY || HOST_DISPLAY,
    XAUTHORITY: process.env.XAUTHORITY || (existsSync(HOST_XAUTHORITY) ? HOST_XAUTHORITY : undefined),
    ROX_CONFIG_DIR: config,
    CRAFT_CONFIG_DIR: config,
    ROX_USER_DATA_DIR: userData,
    CRAFT_USER_DATA_DIR: userData,
    ROX_MEETING_FIXTURE_ORIGIN: input.gateway.origin,
    ROX_MEETING_FIXTURE_TOKEN: input.gateway.token,
    HARNESS_READY_FILE: input.readyFile,
    HARNESS_STORE_FILE: input.storeFile,
    HARNESS_CASE_ID: input.caseId,
    ELECTRON_DISABLE_SANDBOX: '1',
    CRAFT_INSTANCE_NUMBER: `e2e-${process.pid}`,
    // Never treat an env flag as a fake transport.
    ROX_FAKE_TRANSPORT: '',
  }
}

async function readCdpPage(port: number): Promise<unknown> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`)
    if (!res.ok) return { kind: 'cdp', reachable: false as const, port }
    const body = (await res.json()) as { webSocketDebuggerUrl?: string; Browser?: string }
    return {
      kind: 'cdp',
      reachable: true as const,
      port,
      browser: body.Browser ?? null,
      webSocketDebuggerUrl: body.webSocketDebuggerUrl ?? null,
    }
  } catch {
    return { kind: 'cdp', reachable: false as const, port }
  }
}

async function spawnElectron(input: {
  entry: { path: string; kind: MeetingAppHandles['entrypoint'] }
  env: NodeJS.ProcessEnv
  readyFile: string
  userDataDir: string
}): Promise<ElectronSession> {
  if (!existsSync(ELECTRON_BIN)) {
    throw new BootMeetingAppError(
      'electron-binary-missing',
      `electron binary not found at ${ELECTRON_BIN}`,
    )
  }
  if (!existsSync(input.entry.path)) {
    throw new BootMeetingAppError(
      'electron-entrypoint-missing',
      `electron entrypoint not found at ${input.entry.path}`,
    )
  }

  const cdpPort = await pickPort()
  const stderrChunks: string[] = []
  const child = spawn(
    ELECTRON_BIN,
    [
      input.entry.path,
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${cdpPort}`,
    ],
    {
      env: input.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  child.stderr?.on('data', (buf) => {
    stderrChunks.push(String(buf))
  })

  const pid = child.pid
  if (!pid) {
    throw new BootMeetingAppError('electron-spawn-failed', 'electron spawned without pid')
  }

  try {
    await waitForFile(input.readyFile, 20_000)
  } catch (err) {
    await stopChild(child, pid, input.userDataDir)
    throw new BootMeetingAppError(
      'electron-ready-timeout',
      `Electron did not become ready. stderr=${stderrChunks.join('').slice(-4000)}`,
      err,
    )
  }

  if (!pidAlive(pid)) {
    throw new BootMeetingAppError(
      'electron-exited',
      `Electron exited before ready. stderr=${stderrChunks.join('').slice(-4000)}`,
    )
  }

  const page = await readCdpPage(cdpPort)
  return { child, pid, page, cdpPort }
}

export const bootMeetingApp: BootMeetingApp = async (input) => {
  const entry = resolveEntrypoint()
  const guard = productionFixtureGuard({
    nodeEnv: process.env.NODE_ENV,
    fixtureEntrypoint: entry.kind === 'test-fixture',
    fakeTransportEnv: process.env.ROX_FAKE_TRANSPORT,
  })
  if (!guard.ok) {
    throw new BootMeetingAppError('fail-closed', `fail-closed: ${guard.reason}`)
  }

  const ownedProfile = !input.profileDir
  const profileDir = input.profileDir ?? (await mkdtemp(join(tmpdir(), 'meeting-agents-')))
  const home = join(profileDir, 'home')
  const config = join(profileDir, 'config')
  const userData = join(profileDir, 'userData')
  const tmp = join(profileDir, 'tmp')
  await mkdir(home, { recursive: true })
  await mkdir(config, { recursive: true })
  await mkdir(userData, { recursive: true })
  await mkdir(tmp, { recursive: true })
  await mkdir(join(config, 'meeting-agents'), { recursive: true })

  const readyFile = join(userData, 'harness-ready.json')
  const storeFile = join(config, 'meeting-agents', 'store.json')
  const gateway = await createFixtureGateway()
  await gateway.reset(input.caseId)

  let session: ElectronSession | undefined
  let disposed = false

  const envFor = () =>
    isolatedEnv({
      profileDir,
      caseId: input.caseId,
      gateway,
      readyFile,
      storeFile,
    })

  try {
    session = await spawnElectron({ entry, env: envFor(), readyFile, userDataDir: userData })
  } catch (err) {
    await gateway.close().catch(() => undefined)
    if (ownedProfile) await rm(profileDir, { recursive: true, force: true }).catch(() => undefined)
    throw err
  }

  // Boot of fixture HTML is not product E3. Product state is not exercised here.
  const evidence = stampHarnessEvidence({
    entrypoint: entry.kind,
    productStateExercised: false,
  })

  const result: BootMeetingAppResult = {
    app: {
      caseId: input.caseId,
      profileDir,
      gateway: 'loopback-fixture',
      pid: session.pid,
      entrypoint: entry.kind,
    },
    page: session.page,
    profileDir,
    gateway,
    pid: session.pid,
    entrypoint: entry.kind,
    evidence,
    async restart() {
      if (disposed) throw new BootMeetingAppError('disposed', 'restart after dispose')
      await stopChild(session?.child, session?.pid, userData)
      if (existsSync(readyFile)) await rm(readyFile, { force: true })
      session = await spawnElectron({ entry, env: envFor(), readyFile, userDataDir: userData })
      result.pid = session.pid
      result.page = session.page
      ;(result.app as { pid: number }).pid = session.pid
    },
    async dispose() {
      if (disposed) return
      disposed = true
      await stopChild(session?.child, session?.pid, userData)
      await gateway.close().catch(() => undefined)
      if (ownedProfile) await rm(profileDir, { recursive: true, force: true }).catch(() => undefined)
    },
  }

  await writeFile(join(profileDir, 'harness-evidence.json'), JSON.stringify(evidence, null, 2), 'utf8')
  return result
}
