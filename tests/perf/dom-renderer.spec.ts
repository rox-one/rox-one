import { expect, test } from '@playwright/test'
import { DOM_PERF_FIXTURE } from '../../apps/electron/src/renderer/perf/dom-budgets'
import { domGatedFailures, evaluateDomAll, formatDomReport } from '../../apps/electron/src/renderer/perf/dom-evaluate'
import type { RoxPerfDomProbe } from '../../apps/electron/src/renderer/perf/dom-probe'

interface CollectedSamples {
  sessions: number[]
  sessionsUnvirtualized: number
  notes: number[]
  scroll: number[]
  switching: number[]
  fixture: { sessionRows: number; vaultNotes: number }
}

const SCROLL_STEPS = 24
const SWITCH_STEPS = 24

/**
 * Real-DOM gate: mounts the production session-list and notes-navigator
 * primitives against large fixtures in Chromium and enforces the `ciGate: true`
 * rows of `DOM_PERF_BUDGETS`. See `apps/electron/src/renderer/perf/dom-budgets.ts`
 * for what each mark measures and why its threshold was chosen.
 */
test('large volume list primitives meet DOM budgets', async ({ page }) => {
  test.setTimeout(600_000)

  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/perf-dom.html', { waitUntil: 'commit' })
  await page.waitForFunction(
    () => {
      const probe = window.__ROX_PERF_DOM__
      return Boolean(probe && probe.warmup.sessions > 0 && probe.warmup.notes > 0)
    },
    undefined,
    { timeout: 300_000 },
  )

  const samples = await page.evaluate(
    async ({ iterations, scrollSteps, switchSteps }): Promise<CollectedSamples> => {
      const probe: RoxPerfDomProbe | undefined = window.__ROX_PERF_DOM__
      if (!probe) throw new Error('perf DOM probe missing')
      const warm = await probe.remount(iterations)
      const scroll = await probe.scrollSessions(scrollSteps)
      const switching = await probe.switchNotes(switchSteps)
      // "Before" reference last so its large heap does not perturb the gated samples.
      const sessionsUnvirtualized = await probe.measureUnvirtualizedSessions()
      return { sessions: warm.sessions, notes: warm.notes, scroll, switching, sessionsUnvirtualized, fixture: probe.fixture }
    },
    { iterations: DOM_PERF_FIXTURE.iterations, scrollSteps: SCROLL_STEPS, switchSteps: SWITCH_STEPS },
  )

  // Keep the observed numbers in the test log for baseline/regression review.
  const { stats, verdicts } = evaluateDomAll({
    dom_session_list_first_render: samples.sessions,
    dom_session_list_unvirtualized_first_render: [samples.sessionsUnvirtualized],
    dom_session_list_scroll: samples.scroll,
    dom_notes_navigator_first_render: samples.notes,
    dom_notes_navigator_switch: samples.switching,
  })
  console.log(`\n[perf-dom] fixture ${JSON.stringify(samples.fixture)}`)
  console.log(`[perf-dom] before (unvirtualized)     = ${samples.sessionsUnvirtualized.toFixed(1)}ms`)
  console.log(`[perf-dom] first render samples (sessions) = ${samples.sessions.map((ms) => ms.toFixed(1)).join(', ')}`)
  console.log(`[perf-dom] first render samples (notes)    = ${samples.notes.map((ms) => ms.toFixed(1)).join(', ')}`)
  console.log(`[perf-dom] scroll samples (p95 over ${samples.scroll.length}) = ${samples.scroll.map((ms) => ms.toFixed(1)).join(', ')}`)
  console.log('\n' + formatDomReport({ stats, verdicts }))

  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])

  const failures = domGatedFailures(verdicts)
  expect(
    failures.map((failure) => `${failure.name}: ${failure.reasons.join('; ')}`),
    'gated DOM budgets must pass',
  ).toEqual([])
})