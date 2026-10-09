/**
 * createNativeSkillsToolRuntime — the SHIPPED skills tool runtime. This is the
 * would-fail-before proof for the escaping-symlink defect: discovery follows
 * directory symlinks, so a link under `{workspace}/skills` pointing outside the
 * root used to appear in the eligible catalog and `read()` returned the outside
 * body. The runtime must realpath-confine every advertised/readable skill to
 * the root it was discovered under.
 *
 * Runs against REAL filesystem fixtures and the production runtime (no double).
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildAvailableSkillsBlock, buildSkillEligibilityReport, invalidateSkillsCache } from '@rox/shared/skills'
import { createNativeSkillsToolRuntime } from '../skills-tool-runtime'

// Each case resolves the runtime's real root plan over the host's skill store, so wall time is
// dominated by filesystem walks and grows with machine load (measured 200-240 s per case while
// other jobs were in flight, vs ~30 s idle). Budgets only - no assertion was relaxed.

// Unique slugs so a real ~/.agents/skills entry can never satisfy the assertions.
const REAL_SLUG = 'fix6-contained-skill-7q'
const ESCAPING_SLUG = 'fix6-escaping-link-7q'

let workspaceRoot = ''
let outsideRoot = ''

const runtime = createNativeSkillsToolRuntime()

function writeSkill(dir: string, slug: string, body: string): void {
  mkdirSync(join(dir, slug), { recursive: true })
  writeFileSync(join(dir, slug, 'SKILL.md'), `---\nname: ${slug}\ndescription: ${slug} skill\n---\n${body}`)
}

beforeAll(() => {
  workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'skills-runtime-')))
  outsideRoot = realpathSync(mkdtempSync(join(tmpdir(), 'skills-runtime-outside-')))
  writeSkill(join(workspaceRoot, 'skills'), REAL_SLUG, 'CONTAINED BODY')
  writeSkill(outsideRoot, ESCAPING_SLUG, 'OUTSIDE SECRET')
  symlinkSync(join(outsideRoot, ESCAPING_SLUG), join(workspaceRoot, 'skills', ESCAPING_SLUG), 'dir')
})

afterAll(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
  rmSync(outsideRoot, { recursive: true, force: true })
})

describe('createNativeSkillsToolRuntime containment', () => {
  it('advertises a contained skill but drops a symlink that escapes its root', async () => {
    const scope = { workspaceRoot }

    const listed = await runtime.list(scope)
    const slugs = listed.map(entry => entry.slug)
    expect(slugs).toContain(REAL_SLUG)
    expect(slugs).not.toContain(ESCAPING_SLUG)

    const searched = await runtime.search({ ...scope, query: ESCAPING_SLUG })
    expect(searched.some(hit => hit.slug === ESCAPING_SLUG)).toBe(false)
  }, 600_000)

  it('refuses to read through the escaping symlink but reads the contained skill', async () => {
    const scope = { workspaceRoot }

    expect(await runtime.read({ ...scope, slug: ESCAPING_SLUG })).toBeNull()

    const real = await runtime.read({ ...scope, slug: REAL_SLUG })
    expect(real?.content).toContain('CONTAINED BODY')
  }, 600_000)

  it('advertised implies readable: the escaping symlink is neither advertised nor readable', async () => {
    invalidateSkillsCache()
    const report = await buildSkillEligibilityReport({ workspaceRoot, includeOmp: false, disabledPackSlugs: [] })
    const block = buildAvailableSkillsBlock(report.eligible) ?? ''

    // The report (single source of truth for the prompt block) admits the
    // contained skill and drops the escaping link BEFORE it can be advertised.
    expect(report.eligible.some(skill => skill.slug === REAL_SLUG)).toBe(true)
    expect(report.eligible.some(skill => skill.slug === ESCAPING_SLUG)).toBe(false)
    expect(block).toContain(REAL_SLUG)
    expect(block).not.toContain(ESCAPING_SLUG)

    // And every advertised slug resolves through the real read path.
    expect(await runtime.read({ workspaceRoot, slug: REAL_SLUG })).not.toBeNull()
    expect(await runtime.read({ workspaceRoot, slug: ESCAPING_SLUG })).toBeNull()
  }, 600_000)
})