/** W1-10 self-test: the string axe runner never touches axe-core (it needs a DOM). */
import { describe, expect, mock, test } from 'bun:test'

describe('axe runner without a DOM', () => {
  test('stays on the built-in rules even when axe-core is resolvable', async () => {
    let touched = false
    mock.module('axe-core', () => {
      touched = true
      return { default: { run: async () => { throw new Error('axe.run needs a DOM context') } } }
    })
    const { runAxeAudit } = await import('../src/axe.ts')
    const clean = await runAxeAudit(`<html lang="en"><body><main><button>Save</button></main></body></html>`)
    expect(clean).toEqual({ engine: 'builtin', violations: [], pass: true })
    const dirty = await runAxeAudit(`<html><body><img src="a.png"><button></button></body></html>`)
    expect(dirty.pass).toBe(false)
    expect(dirty.violations.map((v) => v.rule).sort()).toEqual(['button-name', 'html-lang', 'image-alt'])
    expect(touched).toBe(false)
  })
})
