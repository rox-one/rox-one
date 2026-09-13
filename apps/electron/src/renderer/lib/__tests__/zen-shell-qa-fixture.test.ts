import { describe, expect, it } from 'bun:test'
import { buildZenShellQaFixture, ZEN_SHELL_QA_LONG_RU_TITLE, ZEN_SHELL_QA_MIN_ROWS, ZEN_SHELL_QA_PANEL_COUNT } from '../zen-shell-qa-fixture'

describe('Zen Shell QA fixture (ZS-08)', () => {
  const fixture = buildZenShellQaFixture()

  it('contains at least 500 sidebar rows', () => {
    expect(fixture.rows.length).toBeGreaterThanOrEqual(ZEN_SHELL_QA_MIN_ROWS)
  })

  it('nests expandable sections under Russian roots with depth 2 leaves', () => {
    expect(fixture.nestedSectionCount).toBeGreaterThan(0)
    expect(fixture.rows.some((row) => row.depth === 0 && row.title === 'Проекты')).toBe(true)
    expect(fixture.rows.some((row) => row.depth === 2 && !row.expandable)).toBe(true)
    expect(fixture.rows.filter((row) => row.expandable).every((row) => row.childIds.length >= 0)).toBe(true)
  })

  it('uses long Russian titles and two content panels', () => {
    expect(fixture.longTitle).toBe(ZEN_SHELL_QA_LONG_RU_TITLE)
    expect(fixture.longTitle.length).toBeGreaterThan(80)
    expect(fixture.rows.some((row) => row.title.includes(ZEN_SHELL_QA_LONG_RU_TITLE))).toBe(true)
    expect(fixture.panelCount).toBe(ZEN_SHELL_QA_PANEL_COUNT)
  })
})
