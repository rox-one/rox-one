import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * SE optional glass accent skin invariants (chrome only).
 * Arc Glass content surfaces CSS was removed — Mark retired Arc Glass Design.
 */

const dir = join(import.meta.dir, '..')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const SKIN = strip(readFileSync(join(dir, 'arc-glass-skin.css'), 'utf8'))
const MATERIAL = strip(readFileSync(join(dir, '../../styles/tokens/material.css'), 'utf8'))
const INSTALL = readFileSync(join(dir, 'install-glass-skin.ts'), 'utf8')

/** Drops @keyframes blocks, inlines @media/@supports bodies, keeps everything else. */
function flatten(css: string): string {
  let out = ''
  let index = 0
  while (index < css.length) {
    const at = css.indexOf('@', index)
    if (at === -1) {
      out += css.slice(index)
      break
    }
    out += css.slice(index, at)
    const open = css.indexOf('{', at)
    const prelude = css.slice(at, open).trim()
    let depth = 0
    let end = open
    for (; end < css.length; end++) {
      if (css[end] === '{') depth++
      else if (css[end] === '}' && --depth === 0) break
    }
    if (/^@(-\w+-)?keyframes\b/.test(prelude)) {
      // drop
    } else if (/^@(media|supports|container|layer)\b/.test(prelude)) {
      out += ` ${css.slice(open + 1, end)} `
    } else {
      out += css.slice(at, end + 1)
    }
    index = end + 1
  }
  return out
}

type Block = { selector: string; body: string }
function ruleBlocks(css: string): Block[] {
  const flat = flatten(css)
  const out: Block[] = []
  let index = 0
  while (index < flat.length) {
    const open = flat.indexOf('{', index)
    if (open === -1) break
    const selector = flat.slice(index, open).trim()
    let depth = 0
    let end = open
    for (; end < flat.length; end++) {
      if (flat[end] === '{') depth++
      else if (flat[end] === '}' && --depth === 0) break
    }
    if (selector && !selector.startsWith('@')) {
      out.push({ selector, body: flat.slice(open + 1, end) })
    }
    index = end + 1
  }
  return out
}

function atRule(css: string, prelude: string): string {
  const at = css.indexOf(prelude)
  if (at === -1) return ''
  const open = css.indexOf('{', at)
  let depth = 0
  let end = open
  for (; end < css.length; end++) {
    if (css[end] === '{') depth++
    else if (css[end] === '}' && --depth === 0) break
  }
  return css.slice(at, end + 1)
}

describe('scoping', () => {
  it('arc-glass-skin.css: base paint lists only chrome slots', () => {
    expect(SKIN).toMatch(
      /:is\(\.rox-mode-pill,\s*\[data-glass-slot="popover"\],\s*\[data-glass-slot="mini-button"\]\)/,
    )
    expect(SKIN).toContain('[data-glass-slot="composer"]')
    for (const slot of ['panel', 'card', 'table', 'editor', 'dialog', 'toast'])
      expect(SKIN).not.toContain(`[data-glass-slot="${slot}"]`)
  })
})

describe('static blur', () => {
  it('arc-glass-skin.css: backdrop-filter is never transitioned or animated', () => {
    for (const decl of SKIN.matchAll(/(?:transition|animation)(?:-[a-z]+)?\s*:[^;}]*/g)) {
      expect(decl[0]).not.toMatch(/filter|all/)
    }
  })
})

describe('refraction stays on static skin slots at the full tier', () => {
  it('every skinned refraction use is full-tier and never floating content', () => {
    const uses = ruleBlocks(SKIN).filter((b) => b.body.includes('rox-glass-skin-refraction'))
    expect(uses.length).toBeGreaterThan(0)
    for (const use of uses) {
      expect(use.selector).toContain('[data-glass="full"]')
      expect(use.selector).not.toMatch(/composer|popover|menu|card|table|row|empty|editor|dialog|sheet|toast/)
    }
  })
})

describe('derived tokens', () => {
  const derived = MATERIAL.slice(MATERIAL.indexOf('.glass-surface'))

  it('declares the content-layer tokens (retained for GlassSurface; surfaces CSS gone)', () => {
    for (const token of [
      '--glass-blur-tight',
      '--glass-hairline',
      '--glass-sheen',
      '--glass-card-shadow',
      '--glass-overlay-shadow',
      '--glass-card-fill',
      '--glass-overlay-fill',
      '--glass-panel-mix',
      '--glass-toolbar-mix',
      '--glass-card-mix',
      '--glass-table-mix',
      '--glass-empty-mix',
      '--glass-editor-mix',
      '--glass-overlay-mix',
    ]) {
      expect(derived).toContain(`${token}:`)
    }
  })

  it('derives the tight blur, sheen and every fill mix from --glass-intensity', () => {
    for (const token of [
      '--glass-blur-tight',
      '--glass-sheen',
      '--glass-panel-mix',
      '--glass-toolbar-mix',
      '--glass-card-mix',
      '--glass-table-mix',
      '--glass-empty-mix',
      '--glass-editor-mix',
      '--glass-overlay-mix',
    ]) {
      expect(derived).toMatch(new RegExp(`${token}:\\s*(?:calc|max|color-mix)\\([^;]*var\\(--glass-intensity\\)`))
    }
  })

  it('builds the hairline on the intensity-scaled edge token', () => {
    expect(derived).toMatch(/--glass-hairline:\s*color-mix\([^;]*var\(--glass-edge-alpha\)/)
  })

  it('keeps reading surfaces at or above 80%', () => {
    expect(derived).toMatch(/--glass-editor-mix:\s*max\(80%/)
    expect(derived).toMatch(/--glass-overlay-mix:\s*max\(84%/)
  })
})

describe('degradations', () => {
  it('arc-glass-skin.css: high contrast goes solid with no blur', () => {
    const blocks = ruleBlocks(SKIN).filter(
      (b) => b.selector.includes('data-contrast="high"') && (b.selector.includes('[data-glass-slot') || b.selector.includes('.rox-mode-pill')),
    )
    expect(blocks.length).toBeGreaterThan(0)
    const body = blocks.map((b) => b.body).join('\n')
    expect(body).toMatch(/--glass-fill-mix:\s*100%/)
    expect(body).toMatch(/--glass-blur:\s*0px/)
    expect(body).toMatch(/backdrop-filter:\s*none/)
    expect(body).toMatch(/--glass-hairline:\s*var\(--border-strong\)/)
  })

  it('arc-glass-skin.css: the basic tier renders the solid, blur-free material', () => {
    const blocks = ruleBlocks(SKIN).filter((b) => b.selector.includes('data-glass="basic"'))
    expect(blocks.length).toBeGreaterThan(0)
    const body = blocks.map((b) => b.body).join('\n')
    expect(body).toMatch(/--glass-fill-mix:\s*100%/)
    expect(body).toMatch(/--glass-blur:\s*0px/)
    expect(body).toMatch(/backdrop-filter:\s*none/)
  })

  it('arc-glass-skin.css: reduced transparency goes solid with no blur', () => {
    const block = atRule(SKIN, '@media (prefers-reduced-transparency: reduce)')
    expect(block).toContain('html[data-ui-profile="super-engineering"][data-glass-accents]')
    expect(block).not.toContain('data-theme="arc-glass"')
    expect(block).toMatch(/--glass-fill-mix:\s*100%/)
    expect(block).toMatch(/--glass-blur:\s*0px/)
    expect(block).toMatch(/backdrop-filter:\s*none/)
  })

  it('arc-glass-skin.css: the low-power profile drops blur only', () => {
    const blocks = ruleBlocks(SKIN).filter((b) => b.selector.includes('data-render-profile="performance"'))
    expect(blocks.length).toBeGreaterThan(0)
    for (const block of blocks) {
      expect(block.body).toMatch(/--glass-blur:\s*0px/)
      expect(block.body).toMatch(/backdrop-filter:\s*none/)
      expect(block.body).not.toMatch(/--glass-fill-mix/)
      expect(block.selector).not.toContain('[data-glass-slot="composer"]')
    }
  })

  it('arc-glass-skin.css: composer never appears in backdrop-filter:none :is()', () => {
    for (const block of ruleBlocks(SKIN)) {
      if (!/backdrop-filter:\s*none/.test(block.body)) continue
      expect(block.selector).not.toContain('[data-glass-slot="composer"]')
    }
  })
})

describe('install', () => {
  it('loads SE accent skin only; surfaces CSS file is gone', () => {
    expect(INSTALL).toContain("import('./arc-glass-skin.css')")
    expect(INSTALL).not.toContain('arc-glass-surfaces')
    expect(INSTALL.match(/if \(installed\) return installed/g)?.length).toBe(1)
  })

  it('arc-glass-surfaces.css is deleted', () => {
    expect(existsSync(join(dir, 'arc-glass-surfaces.css'))).toBe(false)
  })
})
