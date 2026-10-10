/**
 * W1-10 (#1507) — self-test: the visual / axe / one-rail gates consume the
 * wave-2 browser-driver capture artifacts (src/capture.ts). Each gate must
 * pass on matching hashes, fail (closed) on a changed or missing baseline,
 * and stay pending when no artifacts exist (default CI).
 */
import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { planVisualSnapshots } from '../src/visual.ts'
import {
  snapshotKey,
  VISUAL_ARTIFACTS_DIR,
  CAPTURE_FILE,
  VISUAL_BASELINES_FILE,
  type CaptureArtifacts,
  type VisualBaselines,
} from '../src/capture.ts'
import { checkVisualGate, checkAxeGate } from '../src/gates/visual-axe.ts'
import { checkOneRailGateAll } from '../src/gates/chrome-dock.ts'
import { runAllGates } from '../src/gates/run-all.ts'

const CLEAN_HTML = '<html lang="en"><body><main><button>Save</button></main></body></html>'
const DIRTY_HTML = '<html lang="en"><body><main><img src="a.png"></main></body></html>'
const RAIL = '<div role="navigation" data-rail>'
const ONE_RAIL = `<body>${RAIL}</body>`
const TWO_RAILS = `<body>${RAIL}${RAIL}</body>`

const emptyRoot = mkdtempSync(join(tmpdir(), 'w1-10-driver-empty-'))

interface ScreenFixture {
  id: string
  html?: string
  shellHtml?: string
  hasAppShell?: boolean
}

/** Build a capture + baseline pair; `breakHash` / `dropHash` corrupt one key. */
function captureFor(screens: ScreenFixture[], opts: { breakHash?: string; dropHash?: string } = {}) {
  const plan = planVisualSnapshots(screens.map((s) => s.id))
  const hashOf = (key: string) => `hash:${key}`
  const snapshots = plan.map((p) => {
    const key = snapshotKey(p)
    return { key, plan: p, png: `${key}.png`, pixelHash: opts.breakHash === key ? 'changed-hash' : hashOf(key) }
  })
  const hashes: Record<string, string> = {}
  for (const s of snapshots) if (s.key !== opts.dropHash) hashes[s.key] = hashOf(s.key)
  const artifacts: CaptureArtifacts = {
    schemaVersion: 1,
    capturedAt: '2026-10-09T00:00:00.000Z',
    notes: [],
    screens: screens.map((s) => ({
      id: s.id,
      html: s.html ?? CLEAN_HTML,
      shellHtml: s.shellHtml ?? ONE_RAIL,
      hasAppShell: s.hasAppShell ?? true,
    })),
    snapshots,
  }
  const baselines: VisualBaselines = { schemaVersion: 1, environment: 'test', hashes }
  return { artifacts, baselines, plan }
}

/** Persist a capture + baselines under a temp repo root (as the driver would). */
function writeFixture(root: string, artifacts: CaptureArtifacts, baselines?: VisualBaselines) {
  const dir = join(root, VISUAL_ARTIFACTS_DIR)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, CAPTURE_FILE), JSON.stringify(artifacts, null, '\t'))
  if (baselines) {
    const path = join(root, VISUAL_BASELINES_FILE)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(baselines, null, '\t'))
  }
}

describe('visual-snapshots against capture artifacts', () => {
  test('passes when every planned key matches the committed baselines', () => {
    const { artifacts, baselines } = captureFor([{ id: 'inbox' }])
    const res = checkVisualGate({ artifacts, baselines, env: {} })
    expect(res.status).toBe('pass')
    expect(res.summary).toContain('match the committed baselines')
  })

  test('fails on one changed hash and one missing baseline, naming both and pointing at --update-baselines', () => {
    const plan = planVisualSnapshots(['inbox'])
    const changed = snapshotKey(plan[0]!)
    const dropped = snapshotKey(plan[1]!)
    const { artifacts, baselines } = captureFor([{ id: 'inbox' }], { breakHash: changed, dropHash: dropped })
    const res = checkVisualGate({ artifacts, baselines, env: {} })
    expect(res.status).toBe('fail')
    expect(res.summary).toContain('bun run visual:capture --update-baselines')
    const listed = res.violations!.join('\n')
    expect(listed).toContain(`${changed} (hash changed)`)
    expect(listed).toContain(`${dropped} (no baseline)`)
  })

  test('fails naming the captured-absent key, and lists at most five keys', () => {
    const { artifacts, plan } = captureFor([{ id: 'inbox' }])
    artifacts.snapshots = artifacts.snapshots.slice(0, 3)
    const res = checkVisualGate({ artifacts, baselines: captureFor([{ id: 'inbox' }]).baselines, env: {} })
    expect(res.status).toBe('fail')
    expect(res.violations!.some((v) => v.includes(snapshotKey(plan[3]!) + ' (not captured)'))).toBe(true)
    expect(res.summary).toContain(`${plan.length - 3} of ${plan.length}`)

    const many = captureFor([{ id: 'inbox' }], { breakHash: snapshotKey(plan[0]!) })
    for (let i = 1; i < 7; i += 1) many.baselines.hashes[snapshotKey(plan[i]!)] = 'other'
    const seven = checkVisualGate({ artifacts: many.artifacts, baselines: many.baselines, env: {} })
    expect(seven.status).toBe('fail')
    expect(seven.violations!).toHaveLength(6)
    expect(seven.violations![5]).toContain('2 more')
  })

  test('stays pending with no artifacts (default CI) and names the driver command', () => {
    const res = checkVisualGate({ repoRoot: emptyRoot, env: {} })
    expect(res.status).toBe('pending')
    expect(res.summary).toContain('wave-2 browser driver')
    expect(res.summary).toContain('bun run visual:capture')
  })

  test('ROX_VISUAL_DRIVER=1 fails (no vacuous pass) when artifacts or baselines are absent', () => {
    const noArtifacts = checkVisualGate({ repoRoot: emptyRoot, env: { ROX_VISUAL_DRIVER: '1' } })
    expect(noArtifacts.status).toBe('fail')
    expect(noArtifacts.violations!.join(' ')).toContain('bun run visual:capture')

    const { artifacts } = captureFor([{ id: 'inbox' }])
    const noBaselines = checkVisualGate({ artifacts, baselines: null, env: { ROX_VISUAL_DRIVER: '1' } })
    expect(noBaselines.status).toBe('fail')
    expect(noBaselines.summary).toContain('committed baselines')
  })

  test('ROX_VISUAL_DRIVER=1 passes once artifacts and baselines are present and match', () => {
    const { artifacts, baselines } = captureFor([{ id: 'inbox' }])
    expect(checkVisualGate({ artifacts, baselines, env: { ROX_VISUAL_DRIVER: '1' } }).status).toBe('pass')
  })
})

describe('axe against capture artifacts', () => {
  test('passes when every captured document is clean, fails naming the dirty screen', async () => {
    const clean = captureFor([{ id: 'inbox' }, { id: 'tasks' }])
    expect((await checkAxeGate({ artifacts: clean.artifacts })).status).toBe('pass')

    const dirty = captureFor([{ id: 'inbox' }, { id: 'tasks', html: DIRTY_HTML }])
    const res = await checkAxeGate({ artifacts: dirty.artifacts })
    expect(res.status).toBe('fail')
    expect(res.violations!.join('\n')).toContain('tasks: [image-alt]')
    expect(res.violations!.join('\n')).not.toContain('inbox:')
  })

  test('audits a surface fragment: element rules apply, the document lang rule does not', async () => {
    // The driver captures the preview-frame subtree — a fragment with no <html>.
    const fragment = '<div class="preview-frame"><button>Save</button></div>'
    const clean = await checkAxeGate({ artifacts: captureFor([{ id: 'inbox', html: fragment }]).artifacts })
    expect(clean.status).toBe('pass')

    const dirty = await checkAxeGate({
      artifacts: captureFor([{ id: 'inbox', html: '<div class="preview-frame"><img src="a.png"></div>' }]).artifacts,
    })
    expect(dirty.status).toBe('fail')
    expect(dirty.violations!.join('\n')).toContain('inbox: [image-alt]')
  })

  test('still enforces html-lang when the audited HTML is a whole document', async () => {
    const res = await checkAxeGate({ artifacts: captureFor([{ id: 'inbox', html: '<html><body></body></html>' }]).artifacts })
    expect(res.status).toBe('fail')
    expect(res.violations!.join('\n')).toContain('inbox: [html-lang]')
  })

  test('stays pending with no artifacts', async () => {
    const res = await checkAxeGate({ repoRoot: emptyRoot })
    expect(res.status).toBe('pending')
    expect(res.summary).toContain('wave-2 browser driver')
  })
})

describe('one-rail-dom against capture artifacts', () => {
  test('passes when every shell screen carries one rail, fails naming the offending screen id', () => {
    const good = captureFor([{ id: 'inbox' }, { id: 'tasks' }])
    expect(checkOneRailGateAll(good.artifacts).status).toBe('pass')

    const bad = captureFor([{ id: 'inbox' }, { id: 'tasks', shellHtml: TWO_RAILS }])
    const res = checkOneRailGateAll(bad.artifacts)
    expect(res.status).toBe('fail')
    expect(res.violations!.join('\n')).toContain('tasks:')
    expect(res.violations!.join('\n')).toContain('exactly one rail')
  })

  test('stays pending (never a vacuous pass) when no captured surface has an app shell', () => {
    const previews = captureFor([
      { id: 'inbox', shellHtml: '', hasAppShell: false },
      { id: 'tasks', shellHtml: '', hasAppShell: false },
    ])
    const res = checkOneRailGateAll(previews.artifacts)
    expect(res.status).toBe('pending')
    expect(res.summary).toContain('component-preview surfaces')
    expect(res.summary).toContain('no shell surface is captured yet')
    expect(res.summary).toContain('role="navigation"')
  })

  test('ignores shell-less screens but still fails a shell screen with the wrong rail count', () => {
    const mixed = captureFor([
      { id: 'inbox', shellHtml: '', hasAppShell: false },
      { id: 'tasks', shellHtml: TWO_RAILS },
    ])
    const res = checkOneRailGateAll(mixed.artifacts)
    expect(res.status).toBe('fail')
    expect(res.violations!.join('\n')).toContain('tasks:')
    expect(res.violations!.join('\n')).not.toContain('inbox:')
  })

  test('stays pending without artifacts', () => {
    const res = checkOneRailGateAll(null)
    expect(res.status).toBe('pending')
    expect(res.summary).toContain('wave-2 browser driver')
  })
})

describe('runAllGates consumes the artifacts directory once per run', () => {
  const only = ['visual-snapshots', 'axe', 'one-rail-dom'] as const

  test('reads artifacts + baselines from repoRoot and passes all three gates', async () => {
    const root = mkdtempSync(join(tmpdir(), 'w1-10-driver-live-'))
    const { artifacts, baselines } = captureFor([{ id: 'inbox' }])
    writeFixture(root, artifacts, baselines)
    const results = await runAllGates({ repoRoot: root, only, env: {} })
    expect(results.map((r) => [r.gate, r.status])).toEqual([
      ['visual-snapshots', 'pass'],
      ['axe', 'pass'],
      ['one-rail-dom', 'pass'],
    ])
  })

  test('without an artifacts directory all three are pending with the driver wording', async () => {
    const results = await runAllGates({ repoRoot: emptyRoot, only, env: {} })
    for (const res of results) {
      expect(res.status).toBe('pending')
      expect(res.summary).toContain('wave-2 browser driver')
      expect(res.summary).toContain('README')
    }
  })
})