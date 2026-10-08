/** W1-10 self-test: v2.1 chrome/dock gates + agent-panel privacy gate. */
import { describe, expect, test } from 'bun:test'
import {
  lintChromeSchemas,
  checkOneRailGate,
  checkDockLayoutGate,
} from '../src/gates/chrome-dock.ts'
import { referenceDockMode } from '../src/fixtures/dock.ts'
import { checkAgentPrivacy } from '../src/gates/agent-privacy.ts'
import { PRIVACY_EXPECTATIONS } from '../src/fixtures/privacy.ts'

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
  test('fails against a broken implementation', async () => {
    const res = await checkDockLayoutGate({ computeMode: () => 'overlay' })
    expect(res.status).toBe('fail')
  })
})

describe('agent-panel privacy gate', () => {
  test('passes when §18.3 negatives hold', () => {
    const want = new Map(PRIVACY_EXPECTATIONS.map((e) => [e.ref, e]))
    const res = checkAgentPrivacy((ref) => {
      const e = want.get(ref)
      if (!e) throw new Error(`unexpected ref ${ref}`)
      return { attach: e.autoAttach, redacted: e.redacted }
    })
    expect(res.status).toBe('pass')
  })
  test('fails when a private note is auto-attached', () => {
    const res = checkAgentPrivacy(() => ({ attach: true, redacted: false }))
    expect(res.status).toBe('fail')
    expect(res.violations?.join(' ')).toContain('note:private-diary')
  })
})
