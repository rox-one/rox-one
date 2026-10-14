import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const css = readFileSync(join(import.meta.dir, '../../../index.css'), 'utf8')
const motion = readFileSync(join(import.meta.dir, '../../../../../../../packages/ui/src/styles/tokens/motion.css'), 'utf8')

describe('fluid shell: narrow secondary-sidebar overlay', () => {
  it('enters with a token-driven animation', () => {
    const rule = css.slice(css.indexOf('[data-secondary-overlay="true"] {'))
    expect(rule.slice(0, rule.indexOf('}'))).toContain('var(--motion-disclosure) var(--ease-emphasis)')
  })
  it('animates transform and opacity only', () => {
    const kf = css.slice(css.indexOf('@keyframes rox-shell-overlay-in'))
    const body = kf.slice(0, kf.indexOf('}\n}') + 1)
    const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1])
    expect(new Set(props)).toEqual(new Set(['opacity', 'transform']))
  })
  it('collapses to 0ms under reduced motion and while resizing (disclosure aliases base)', () => {
    expect(motion).toContain('--motion-disclosure: var(--motion-base)')
    for (const sel of ['html[data-resizing] {', '@media (prefers-reduced-motion: reduce)']) {
      const at = motion.indexOf(sel)
      expect(motion.slice(at, motion.indexOf('}', at))).toContain('--motion-base: 0ms')
    }
  })
})
