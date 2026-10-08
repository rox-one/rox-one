/**
 * W1-10 self-test: owner decision — a gate is pending only while its input is
 * absent; an input that exists but cannot be wired/evaluated FAILS.
 */
import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { checkChromeLintGate, checkDockLayoutGate, CHROME_PATH, RIGHT_DOCK_PATH } from '../src/gates/chrome-dock.ts'
import { checkAgentPrivacyGate, AGENT_CONTEXT_PATH } from '../src/gates/agent-privacy.ts'
import { runPermissionMatrixGate } from '../src/gates/permission-matrix.ts'
import { checkVisualGate } from '../src/gates/visual-axe.ts'

const PERMISSIONS_PATH = join('packages', 'core', 'src', 'entities', 'permissions.ts')

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'w1-10-failclosed-'))
  for (const [path, src] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), src)
  }
  return root
}

const THROWS = `throw new Error('module init exploded')\nexport {}\n`

describe('chrome-schema-lint: present input must be evaluated', () => {
  test('import error fails', async () => {
    const res = await checkChromeLintGate({ repoRoot: repo({ [CHROME_PATH]: THROWS }) })
    expect(res.status).toBe('fail')
    expect(res.violations?.join(' ')).toContain('module init exploded')
  })
  test('no recognised export fails with the expected names', async () => {
    const res = await checkChromeLintGate({ repoRoot: repo({ [CHROME_PATH]: `export const somethingElse = 1\n` }) })
    expect(res.status).toBe('fail')
    expect(res.violations?.join(' ')).toContain('CHROME_SCHEMAS')
  })
  test('wrong shape fails', async () => {
    const res = await checkChromeLintGate({ repoRoot: repo({ [CHROME_PATH]: `export const CHROME_SCHEMAS = [{ surface: 'tasks' }]\n` }) })
    expect(res.status).toBe('fail')
    expect(res.violations?.join(' ')).toContain('rightZone')
  })
  test('wired schemas are linted: clean passes, violations fail, CHROME_SURFACES enforced', async () => {
    const clean = `export const CHROME_SCHEMAS = [{ surface: 'tasks', right: [{ id: 'share' }, '@rox'], center: ['views'] }]\n`
    expect((await checkChromeLintGate({ repoRoot: repo({ [CHROME_PATH]: clean }) })).status).toBe('pass')
    const bad = `export function listChromeSchemas() { return [{ surface: 'tasks', rightZone: ['@rox', 'share'], centerControls: 2 }] }\nexport const CHROME_SURFACES = ['tasks', 'goals']\n`
    const res = await checkChromeLintGate({ repoRoot: repo({ [CHROME_PATH]: bad }) })
    expect(res.status).toBe('fail')
    expect(res.violations?.length).toBe(3)
  })
})

describe('dock-layout: present input must be evaluated', () => {
  test('an import that throws fails (no longer swallowed into pending)', async () => {
    const res = await checkDockLayoutGate({ repoRoot: repo({ [RIGHT_DOCK_PATH]: THROWS }) })
    expect(res.status).toBe('fail')
    expect(res.violations?.join(' ')).toContain('module init exploded')
  })
  test('a module without a dock function fails', async () => {
    const res = await checkDockLayoutGate({ repoRoot: repo({ [RIGHT_DOCK_PATH]: `export const layout = 1\n` }) })
    expect(res.status).toBe('fail')
    expect(res.violations?.join(' ')).toContain('computeDockMode')
  })
  test('a correct exported function passes the table (self-contained §18.4 engine with auto-collapse first)', async () => {
    const src = `
const fits = (w, s, i, a) => w >= 48 + s + 640 + i + a + 44
export function computeDockMode(width, sidebar, inspector, agent) {
  if (fits(width, sidebar, inspector, agent)) return { mode: 'sideBySide', sidebar }
  if (sidebar > 56 && fits(width, 56, inspector, agent)) return { mode: 'sideBySide', sidebar: 56 }
  return { mode: width >= 1280 ? 'sharedDock' : 'overlay', sidebar }
}
`
    expect((await checkDockLayoutGate({ repoRoot: repo({ [RIGHT_DOCK_PATH]: src }) })).status).toBe('pass')
  })
  test('an engine that never auto-collapses the sidebar fails on the collapse rows', async () => {
    const src = `export function computeDockMode(w, s, i, a) { return w >= 48 + s + 640 + i + a + 44 ? 'sideBySide' : w >= 1280 ? 'sharedDock' : 'overlay' }\n`
    const res = await checkDockLayoutGate({ repoRoot: repo({ [RIGHT_DOCK_PATH]: src }) })
    expect(res.status).toBe('fail')
    expect(res.violations?.join('\n')).toContain('W=1280 S=280 I=328 A=0: got sharedDock, want sideBySide (sidebar auto-collapsed first)')
  })
})

describe('agent-panel-privacy: present input must be evaluated', () => {
  test('context.ts without a decision export fails', async () => {
    const res = await checkAgentPrivacyGate({ repoRoot: repo({ [AGENT_CONTEXT_PATH]: `export interface SurfaceContext { id: string }\nexport const x = 1\n` }) })
    expect(res.status).toBe('fail')
    expect(res.violations?.join(' ')).toContain('decideAttach')
  })
  test('context.ts that throws on import fails', async () => {
    expect((await checkAgentPrivacyGate({ repoRoot: repo({ [AGENT_CONTEXT_PATH]: THROWS }) })).status).toBe('fail')
  })
  test('a wired decideAttach(candidate, actor) runs the §18.3 fixtures, deciding from candidate facts only', async () => {
    const good = `export function decideAttach(c, actor) {
  if (!actor || typeof actor.principalId !== 'string') throw new Error('actor missing')
  const hidden = !c.canRead || (c.authority === 'local' && !c.isFocus) || (c.isDm === true && !c.isOpenDm)
  return { attach: !hidden, redacted: hidden }
}
`
    expect((await checkAgentPrivacyGate({ repoRoot: repo({ [AGENT_CONTEXT_PATH]: good }) })).status).toBe('pass')
    const leaky = `export function decideAutoAttach() { return { attach: true, redacted: false } }\n`
    expect((await checkAgentPrivacyGate({ repoRoot: repo({ [AGENT_CONTEXT_PATH]: leaky }) })).status).toBe('fail')
    const wrongShape = `export function decideAttach() { return 'yes' }\n`
    expect((await checkAgentPrivacyGate({ repoRoot: repo({ [AGENT_CONTEXT_PATH]: wrongShape }) })).status).toBe('fail')
  })
})

describe('permission-matrix: present input must be evaluated', () => {
  test('import error and throwing generator fail instead of crashing the run', async () => {
    expect((await runPermissionMatrixGate({ repoRoot: repo({ [PERMISSIONS_PATH]: THROWS }) })).status).toBe('fail')
    const throwing = `export function generatePermissionMatrix() { throw new Error('no rules') }\n`
    const res = await runPermissionMatrixGate({ repoRoot: repo({ [PERMISSIONS_PATH]: throwing }) })
    expect(res.status).toBe('fail')
    expect(res.violations?.join(' ')).toContain('no rules')
  })
})

describe('visual gate never passes vacuously', () => {
  test('ROX_VISUAL_DRIVER=1 without a driver fails', () => {
    const res = checkVisualGate({ screenIds: ['inbox'], env: { ROX_VISUAL_DRIVER: '1' } })
    expect(res.status).toBe('fail')
  })
  test('a ready plan without a driver is still pending', () => {
    const res = checkVisualGate({ screenIds: ['inbox'], env: {} })
    expect(res.status).toBe('pending')
    expect(res.summary).toContain('wave-2 browser driver')
  })
})
