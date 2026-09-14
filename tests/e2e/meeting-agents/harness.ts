/**
 * RMA-I029 / #385 — E2E harness.
 * Env flags do not enable fake transport. Fixture entrypoint is tests-only.
 */

import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startFixtureGateway, type FixtureGateway } from './fixture-gateway.ts'

export const PLAYWRIGHT_VERSION_PIN = '1.56.1'

export type EvidenceLevel = 'U1' | 'C2' | 'E3' | 'L4' | 'N5'
export type EvidenceStatus = 'passed' | 'failed' | 'blocked' | 'not_run'

export type EvidenceRow = {
  caseId: string
  result: EvidenceStatus
  level: EvidenceLevel
  commitSha: string | null
  platform: string
  appVersion: string | null
  modelRoute: string | null
  schemaHash: string | null
  command: string
  startedAt: string
  finishedAt: string
  artifacts: string[]
  blocker: string | null
}

export type MeetingAppHandles = {
  readonly caseId: string
  readonly profileDir: string
  readonly gateway: FixtureGateway
}

export type MeetingPageHandle = {
  getByTestId(testId: string): { click(): Promise<void>; count(): Promise<number>; text(): Promise<string> }
}

export type BootMeetingAppResult = {
  readonly app: MeetingAppHandles
  page: MeetingPageHandle
  readonly profileDir: string
  readonly gateway: FixtureGateway
  restart: () => Promise<void>
  dispose: () => Promise<void>
}

export type BootMeetingApp = (input: {
  readonly caseId: string
  readonly profileDir?: string
}) => Promise<BootMeetingAppResult>

const PRODUCTION_SCAN_ROOTS = [
  'apps/electron/src/main',
  'apps/electron/src/preload',
  'apps/electron/src/renderer',
  'packages/shared/src/voice',
  'packages/shared/src/meeting-agents',
  'packages/server-core/src/meetings',
  'packages/core/src/meetings',
]

const FORBIDDEN_FIXTURE_ENV = [
  'CRAFT_MEETING_FIXTURE',
  'ROX_MEETING_FIXTURE',
  'MEETING_USE_FIXTURE',
  'MEETING_FAKE_TRANSPORT',
]

export function repoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '../../..')
}

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

export function productionSourcesForbidFixtureEnv(root = repoRoot()): string[] {
  const hits: string[] = []
  for (const rel of PRODUCTION_SCAN_ROOTS) {
    scanDir(join(root, rel), hits)
  }
  return hits
}

function scanDir(dir: string, hits: string[]): void {
  if (!existsSync(dir)) return
  walk(dir, hits)
}

function walk(dir: string, hits: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '__tests__') continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      walk(full, hits)
      continue
    }
    if (!name.endsWith('.ts') && !name.endsWith('.tsx') && !name.endsWith('.cjs')) continue
    const text = readFileSync(full, 'utf8')
    for (const flag of FORBIDDEN_FIXTURE_ENV) {
      if (text.includes(flag)) hits.push(`${full}:${flag}`)
    }
  }
}

export function evidenceRow(
  level: EvidenceLevel,
  status: EvidenceStatus,
  extra: Partial<EvidenceRow> = {},
): EvidenceRow {
  const now = new Date().toISOString()
  return {
    caseId: extra.caseId ?? 'unknown',
    result: status,
    level,
    commitSha: extra.commitSha ?? null,
    platform: `${process.platform}-${process.arch}`,
    appVersion: extra.appVersion ?? null,
    modelRoute: extra.modelRoute ?? null,
    schemaHash: extra.schemaHash ?? null,
    command: extra.command ?? 'bun run test:meetings:e2e',
    startedAt: extra.startedAt ?? now,
    finishedAt: extra.finishedAt ?? now,
    artifacts: extra.artifacts ?? [],
    blocker: extra.blocker ?? null,
  }
}

export function writeEvidence(row: EvidenceRow): string {
  const dir = join(repoRoot(), 'tests/e2e/meeting-agents/evidence')
  mkdirp(dir)
  const path = join(dir, `${row.caseId}.json`)
  writeFileSync(path, `${JSON.stringify(row, null, 2)}\n`)
  return path
}

export function seedIsolatedProfile(profileDir: string): void {
  mkdirp(join(profileDir, 'home'))
  mkdirp(join(profileDir, 'config'))
  mkdirp(join(profileDir, 'userData'))
  mkdirp(join(profileDir, 'workspace', 'meetings'))
  writeFileSync(join(profileDir, 'config', 'config.json'), `${JSON.stringify({
    workspaces: [],
    activeWorkspaceId: null,
    activeSessionId: null,
    setupDeferred: true,
  }, null, 2)}\n`)
}

export function isolatedEnv(profileDir: string, _gatewayUrl: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: join(profileDir, 'home'),
    ROX_CONFIG_DIR: join(profileDir, 'config'),
    CRAFT_CONFIG_DIR: join(profileDir, 'config'),
    ROX_USER_DATA_DIR: join(profileDir, 'userData'),
    CRAFT_USER_DATA_DIR: join(profileDir, 'userData'),
    ELECTRON_ENABLE_LOGGING: '1',
  }
}

export type MeetingElectronFactory = {
  launch(input: {
    profileDir: string
    env: NodeJS.ProcessEnv
  }): Promise<{ page: MeetingPageHandle; close(): Promise<void> }>
}

let electronFactory: MeetingElectronFactory | null = null

export function setMeetingElectronFactory(factory: MeetingElectronFactory | null): void {
  electronFactory = factory
}

export const bootMeetingApp: BootMeetingApp = async (input) => {
  const profileDir = input.profileDir ?? mkdtempSync(join(tmpdir(), `rox-meeting-e2e-${input.caseId}-`))
  seedIsolatedProfile(profileDir)
  const gateway = await startFixtureGateway()
  gateway.reset(input.caseId)

  const factory = electronFactory ?? await loadDefaultElectronFactory()
  if (!factory) {
    await gateway.close()
    throw new Error('bootMeetingApp requires a real Electron factory; default is fail-closed')
  }

  let launched = await factory.launch({
    profileDir,
    env: isolatedEnv(profileDir, gateway.url),
  })

  const handles: MeetingAppHandles = {
    caseId: input.caseId,
    profileDir,
    gateway,
  }

  const result: BootMeetingAppResult = {
    app: handles,
    page: launched.page,
    profileDir,
    gateway,
    restart: async () => {
      await launched.close()
      launched = await factory.launch({
        profileDir,
        env: isolatedEnv(profileDir, gateway.url),
      })
      result.page = launched.page
    },
    dispose: async () => {
      await launched.close()
      await gateway.close()
      rmSync(profileDir, { recursive: true, force: true })
    },
  }
  return result
}

async function loadDefaultElectronFactory(): Promise<MeetingElectronFactory | null> {
  try {
    const mod = await import('./electron-factory.ts')
    if (mod.isElectronAppBuilt()) return mod.createPlaywrightElectronFactory()
  } catch {
    /* playwright or dist missing — fail closed */
  }
  return null
}

export function schemaHashFor(relPath: string): string {
  const raw = readFileSync(join(repoRoot(), relPath))
  return createHash('sha256').update(raw).digest('hex')
}

export function randomId(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString('hex')}`
}

function mkdirp(dir: string): void {
  mkdirSync(dir, { recursive: true })
}
