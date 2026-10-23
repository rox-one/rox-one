import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  SE_SPRING_MODAL,
  SE_SPRING_PANEL,
  SE_SPRING_TAGLINE,
} from '../../lib/motion/super-engineering-springs'

const root = join(import.meta.dir, '../../../../../..')
const css = readFileSync(join(root, 'apps/electron/src/renderer/index.css'), 'utf8')
const motion = readFileSync(join(root, 'packages/ui/src/styles/tokens/motion.css'), 'utf8')
const marker = '/* Rox Engineering shell micro-interactions'
const microStart = css.indexOf(marker)
const ultraStart = css.indexOf('/* Rox Engineering ultra-wide / fluid shell.')
const seBlock = css.slice(microStart, ultraStart < 0 ? undefined : ultraStart)
const seBare = seBlock.replace(/\/\*[\s\S]*?\*\//g, '')

/** Property names inside `{ ... }` declaration blocks only. */
function declProps(block: string): string[] {
  const bare = block.replace(/\/\*[\s\S]*?\*\//g, '')
  const props: string[] = []
  for (const body of bare.matchAll(/\{([^{}]*)\}/g)) {
    for (const m of body[1].matchAll(/(?:^|;)\s*([a-z-]+)\s*:/g)) props.push(m[1])
  }
  return props
}

describe('SE shell micro-interactions', () => {
  it('is scoped to Rox Engineering only', () => {
    expect(seBlock).toContain('html[data-ui-profile="super-engineering"]')
    expect(seBlock).toContain('.rox-rail-row')
    expect(seBlock).toContain('.rox-mode-pill-item')
    expect(seBlock).toContain('.panel-header-btn')
    expect(seBare).not.toMatch(/(^|\n)\s*\.rox-rail-row\s*\{/)
    expect(seBare).not.toMatch(/(^|\n)\s*\.rox-mode-pill-item\s*\{/)
    expect(seBare).not.toMatch(/(^|\n)\s*\.panel-header-btn\s*\{/)
    expect(seBare).not.toContain('translateZ')
    expect(seBare).not.toMatch(/\.rox-rail-row[^\{]*:hover/)
    expect(seBare).not.toMatch(/\.rox-mode-pill-item[^\{]*:hover/)
  })

  it('uses motion tokens (spring + fast) that zero under reduced-motion and resizing', () => {
    expect(seBlock).toContain('var(--motion-spring)')
    expect(seBlock).toContain('var(--ease-spring)')
    expect(seBlock).toContain('var(--motion-fast)')
    expect(seBlock).toContain('var(--ease-standard)')
    expect(seBare).not.toMatch(/\b\d+ms\b/)
    expect(motion).toContain('html[data-resizing]')
    expect(motion).toContain('@media (prefers-reduced-motion: reduce)')
    expect(motion).toMatch(/html\[data-resizing\][\s\S]*--motion-fast:\s*0ms/)
    expect(motion).toMatch(/prefers-reduced-motion: reduce[\s\S]*--motion-fast:\s*0ms/)
    expect(motion).toMatch(/html\[data-resizing\][\s\S]*--motion-spring-scale:\s*0/)
  })

  it('press/hover only touch transform and opacity (plus state-layer colour on the shared transition)', () => {
    const hoverPress = seBlock
      .split(/html\[data-ui-profile="super-engineering"\]/)
      .filter((chunk) => /:(hover|active|focus-visible)/.test(chunk))
      .join('\n')
    const props = new Set(declProps(hoverPress))
    for (const forbidden of ['width', 'height', 'top', 'left', 'right', 'bottom', 'margin', 'padding', 'backdrop-filter', 'filter']) {
      expect(props.has(forbidden)).toBe(false)
    }
    expect(props.has('transform')).toBe(true)
    expect([...props].every((p) => ['transform', 'opacity'].includes(p))).toBe(true)

    const shared = seBare.slice(0, seBare.indexOf('.rox-rail-row:not'))
    expect(shared).toContain('transition:')
    expect(shared).toContain('transform var(--motion-spring)')
    expect(shared).toContain('opacity var(--motion-fast)')
    expect(shared).toContain('color var(--motion-fast)')
    expect(shared).toContain('background-color var(--motion-fast)')
  })

  it('does not animate pill indicator width (layout thrash)', () => {
    expect(seBlock).not.toContain('rox-mode-pill-indicator')
  })

  it('keeps SE springs available for JS motion (panel/modal/tagline)', () => {
    expect(SE_SPRING_PANEL.type).toBe('spring')
    expect(SE_SPRING_PANEL.stiffness).toBe(380)
    expect(SE_SPRING_MODAL.stiffness).toBe(520)
    expect(SE_SPRING_TAGLINE.damping).toBe(40)
  })
})
