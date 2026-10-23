import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { SE_SPRING_MODAL } from '../../lib/motion/super-engineering-springs'

const root = join(import.meta.dir, '../../../../../..')
const ui = readFileSync(join(root, 'packages/ui/src/styles/index.css'), 'utf8')
const motion = readFileSync(join(root, 'packages/ui/src/styles/tokens/motion.css'), 'utf8')
const dialog = readFileSync(
  join(root, 'apps/electron/src/renderer/components/ui/dialog.tsx'),
  'utf8',
)
const popover = readFileSync(
  join(root, 'apps/electron/src/renderer/components/ui/popover.tsx'),
  'utf8',
)

const marker = '/* Rox Engineering: Dialog / Popover enter'
const start = ui.indexOf(marker)
const nextTour = ui.indexOf('/* Product tour demo mode', start)
const seBlock = start < 0 ? '' : ui.slice(start, nextTour < 0 ? undefined : nextTour)
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

describe('SE Dialog / Popover spring enter–exit', () => {
  it('declares an SE-scoped overlay spring block after the shared overlay rules', () => {
    expect(start).toBeGreaterThanOrEqual(0)
    expect(seBlock).toContain('html[data-ui-profile="super-engineering"]')
    expect(seBare).toContain('[data-slot="dialog-content"]')
    expect(seBare).toContain('[data-slot="popover-content"]')
    expect(seBare).toContain('[data-slot="dialog-overlay"]')
    // Tooltips stay on the shared --motion-fast path (not this SE block).
    expect(seBare).not.toContain('tooltip-content')
  })

  it('wires enter to --motion-spring / --ease-spring and exit to --motion-spring-exit', () => {
    expect(seBare).toContain('animation: rox-overlay-in var(--motion-spring) var(--ease-spring) both')
    expect(seBare).toContain('animation: rox-overlay-out var(--motion-spring-exit) var(--ease-exit) both')
    expect(seBare).toContain('animation: rox-opacity-in var(--motion-spring) var(--ease-spring) both')
    expect(seBare).not.toMatch(/\b\d+ms\b/)
    expect(seBare).not.toContain('var(--motion-fast)')
  })

  it('keyframes stay transform/opacity only (no layout or blur)', () => {
    const keyIn = ui.slice(ui.indexOf('@keyframes rox-overlay-in'), ui.indexOf('@keyframes rox-overlay-out'))
    const keyOut = ui.slice(ui.indexOf('@keyframes rox-overlay-out'), ui.indexOf('@keyframes rox-opacity-in'))
    const keyOp = ui.slice(ui.indexOf('@keyframes rox-opacity-in'), ui.indexOf('[data-overlay-motion="true"]'))
    for (const block of [keyIn, keyOut, keyOp]) {
      const props = new Set(declProps(block))
      for (const forbidden of [
        'width',
        'height',
        'top',
        'left',
        'right',
        'bottom',
        'margin',
        'padding',
        'backdrop-filter',
        'filter',
      ]) {
        expect(props.has(forbidden)).toBe(false)
      }
      expect([...props].every((p) => ['opacity', 'transform'].includes(p))).toBe(true)
    }
  })

  it('spring tokens zero under reduced-motion and html[data-resizing]', () => {
    expect(motion).toContain('--motion-spring:')
    expect(motion).toContain('--motion-spring-exit:')
    expect(motion).toContain('--ease-spring:')
    expect(motion).toMatch(/html\[data-resizing\][\s\S]*--motion-spring-scale:\s*0/)
    expect(motion).toMatch(/html\[data-resizing\][\s\S]*--motion-slow:\s*0ms/)
    expect(motion).toMatch(/prefers-reduced-motion: reduce[\s\S]*--motion-spring-scale:\s*0/)
    expect(motion).toMatch(/prefers-reduced-motion: reduce[\s\S]*--motion-slow:\s*0ms/)
  })

  it('shared Dialog and Popover still opt into overlay motion', () => {
    expect(dialog).toContain('data-overlay-motion="true"')
    expect(dialog).toContain('data-slot="dialog-content"')
    expect(dialog).toContain('data-slot="dialog-overlay"')
    expect(popover).toContain('data-overlay-motion="true"')
    expect(popover).toContain('data-slot="popover-content"')
  })

  it('keeps SE_SPRING_MODAL as the JS mirror of the CSS modal spring (~0.35s)', () => {
    expect(SE_SPRING_MODAL.type).toBe('spring')
    expect(SE_SPRING_MODAL.stiffness).toBe(520)
    expect(SE_SPRING_MODAL.damping).toBe(38)
    // CSS --motion-spring ≈ motion-slow(240) + 110 = 350ms ≈ parity modal response.
    expect(motion).toMatch(/--motion-spring:\s*calc\(var\(--motion-slow\) \+ 110ms \* var\(--motion-spring-scale/)
  })
})
