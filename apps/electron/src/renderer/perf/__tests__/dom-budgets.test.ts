import { describe, expect, it } from 'bun:test'
import { DOM_PERF_BUDGETS, DOM_PERF_MARK_NAMES } from '../dom-budgets'
import { domGatedFailures, evaluateDomAll, formatDomReport } from '../dom-evaluate'

describe('DOM perf budgets', () => {
  it('declares a gate for large-volume first render and keeps interaction marks informational', () => {
    expect(DOM_PERF_BUDGETS.dom_session_list_first_render.ciGate).toBe(true)
    expect(DOM_PERF_BUDGETS.dom_notes_navigator_first_render.ciGate).toBe(true)
    expect(DOM_PERF_BUDGETS.dom_session_list_scroll.ciGate).toBe(false)
    expect(DOM_PERF_BUDGETS.dom_notes_navigator_switch.ciGate).toBe(false)
    for (const name of DOM_PERF_MARK_NAMES) {
      expect(DOM_PERF_BUDGETS[name].p95Ms).toBeGreaterThan(0)
      expect(DOM_PERF_BUDGETS[name].thresholdNote.length).toBeGreaterThan(0)
    }
  })

  it('passes samples under budget and flags samples over budget', () => {
    const under = evaluateDomAll({
      dom_session_list_first_render: [400, 450, 470],
      dom_notes_navigator_first_render: [250, 260, 270],
      dom_session_list_scroll: [16, 17, 16],
      dom_notes_navigator_switch: [15, 18, 17],
    })
    expect(domGatedFailures(under.verdicts)).toEqual([])

    const over = evaluateDomAll({
      dom_session_list_first_render: [400, 450, 4000],
      dom_notes_navigator_first_render: [250, 260, 270],
    })
    const failures = domGatedFailures(over.verdicts)
    expect(failures.map((failure) => failure.name)).toEqual(['dom_session_list_first_render'])
    expect(failures[0]?.reasons[0]).toContain('>')
  })

  it('fails a gated mark that produced no samples', () => {
    const empty = evaluateDomAll({})
    const failures = domGatedFailures(empty.verdicts)
    expect(failures.map((failure) => failure.name).sort()).toEqual([
      'dom_notes_navigator_first_render',
      'dom_session_list_first_render',
    ])
    expect(formatDomReport(empty)).toContain('CI gates')
  })
})