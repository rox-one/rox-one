/** W1-10 self-test: v2.1 chrome/dock gates + agent-panel privacy gate. */
import { describe, expect, test } from 'bun:test'
import {
  lintChromeSchemas,
  checkOneRailGate,
  checkDockLayoutGate,
} from '../src/gates/chrome-dock.ts'
import { buildDockTable, referenceDockMode, resolveReferenceDock, dockTableInvariantHolds } from '../src/fixtures/dock.ts'
import { checkAgentPrivacy } from '../src/gates/agent-privacy.ts'
import { PRIVACY_ACTOR, PRIVACY_FIXTURES, referencePrivacyDecision, type PrivacyCandidate } from '../src/fixtures/privacy.ts'

describe('chrome-schema lint', () => {
  test('passes on a clean surface schema', () => {
    const res = lintChromeSchemas([{ surface: 'tasks', rightZone: ['filter', 'share', '@rox'], centerControls: 1 }])
    expect(res.status).toBe('pass')
  })
  test('fails on two center controls and a misplaced @rox', () => {
    const res = lintChromeSchemas(
      [{ surface: 'tasks', rightZone: ['@rox', 'share'], centerControls: 2 }],
      { expectedSurfaces: ['tasks', 'goals'] },
    )
    expect(res.status).toBe('fail')
    expect(res.violations?.length).toBe(3)
  })
})

describe('one-rail DOM gate', () => {
  test('passes with exactly one rail', () => {
    const html = `<div><nav role="navigation" data-rail="true">rail</nav><main>app</main></div>`
    expect(checkOneRailGate(html).status).toBe('pass')
  })
  test('fails with zero or two rails', () => {
    expect(checkOneRailGate('<main>app</main>').status).toBe('fail')
    const two = `<nav role="navigation" data-rail="a"></nav><nav role="navigation" data-rail="b"></nav>`
    expect(checkOneRailGate(two).status).toBe('fail')
  })
})

describe('dock-layout gate', () => {
  test('passes against the §18.4 reference formula', async () => {
    const res = await checkDockLayoutGate({ computeMode: referenceDockMode })
    expect(res.status).toBe('pass')
  })
  test('accepts an engine that returns { mode, … }', async () => {
    const res = await checkDockLayoutGate({ computeMode: (w, s, i, a) => resolveReferenceDock(w, s, i, a) })
    expect(res.status).toBe('pass')
  })
  test('fails against a broken implementation', async () => {
    const res = await checkDockLayoutGate({ computeMode: () => 'overlay' })
    expect(res.status).toBe('fail')
  })
  test('`sidebar` is the pre-collapse width: auto-collapse is tried first (§18.4)', () => {
    // Expanded: 48+280+640+328+0+44 = 1340 > 1280; collapsed: 48+56+640+328+44 = 1116 ≤ 1280.
    expect(resolveReferenceDock(1280, 280, 328, 0)).toEqual({ mode: 'sideBySide', autoCollapsed: true, sidebarUsed: 56 })
    expect(referenceDockMode(1440, 280, 328, 0)).toBe('sideBySide')
    expect(resolveReferenceDock(1440, 280, 328, 0).autoCollapsed).toBe(false)
    // Even collapsed it does not fit: shared dock at ≥ 1280, overlay below.
    expect(referenceDockMode(1280, 280, 560, 360)).toBe('sharedDock')
    expect(referenceDockMode(1100, 280, 560, 0)).toBe('overlay')
    const rows = buildDockTable()
    expect(rows.some((r) => r.autoCollapsed)).toBe(true)
    expect(rows.find((r) => r.width === 1280 && r.sidebar === 280 && r.inspector === 328 && r.agent === 0)?.expected).toBe('sideBySide')
    expect(dockTableInvariantHolds()).toBe(true)
  })
})

describe('agent-panel privacy gate', () => {
  test('passes for a provider that decides from the candidate + actor (no fixture ids)', () => {
    const seen: Array<[PrivacyCandidate, unknown]> = []
    const res = checkAgentPrivacy((candidate, actor) => {
      seen.push([candidate, actor])
      return referencePrivacyDecision(candidate)
    })
    expect(res.status).toBe('pass')
    expect(seen).toHaveLength(PRIVACY_FIXTURES.length)
    for (const [candidate, actor] of seen) {
      expect(actor).toEqual(PRIVACY_ACTOR)
      expect(typeof candidate.canRead).toBe('boolean')
      expect(typeof candidate.entityKind).toBe('string')
    }
  })
  test('the deciding facts are on the candidate: open vs other DM differ only by isOpenDm', () => {
    const other = PRIVACY_FIXTURES.find((c) => c.ref === 'channel-message:other-dm-1')!
    const open = PRIVACY_FIXTURES.find((c) => c.ref === 'channel-message:open-dm-1')!
    expect({ ...other, ref: '', kind: '', isOpenDm: undefined }).toEqual({ ...open, ref: '', kind: '', isOpenDm: undefined })
    expect(referencePrivacyDecision(other).attach).toBe(false)
    expect(referencePrivacyDecision(open).attach).toBe(true)
  })
  test('a provider cannot corrupt the shared fixtures', () => {
    checkAgentPrivacy((candidate) => {
      candidate.canRead = true
      candidate.authority = 'workspace'
      return { attach: true, redacted: false }
    })
    expect(referencePrivacyDecision(PRIVACY_FIXTURES.find((c) => c.ref === 'goal:secret-goal')!).attach).toBe(false)
    expect(checkAgentPrivacy((c) => referencePrivacyDecision(c)).status).toBe('pass')
  })
  test('fails when a private note is auto-attached', () => {
    const res = checkAgentPrivacy(() => ({ attach: true, redacted: false }))
    expect(res.status).toBe('fail')
    expect(res.violations?.join(' ')).toContain('note:private-diary')
  })
})
