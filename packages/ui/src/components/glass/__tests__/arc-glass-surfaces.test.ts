import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Arc Glass content surfaces (F1 glass-core).
 *
 * The frozen slot vocabulary lives in arc-glass-surfaces.css and shares the
 * derived tokens in styles/tokens/material.css. These are the invariants that
 * must survive every screen adopting `data-glass-slot`.
 */

const dir = join(import.meta.dir, '..')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const SKIN = strip(readFileSync(join(dir, 'arc-glass-skin.css'), 'utf8'))
const SURFACES = strip(readFileSync(join(dir, 'arc-glass-surfaces.css'), 'utf8'))
const MATERIAL = strip(readFileSync(join(dir, '../../styles/tokens/material.css'), 'utf8'))
const INSTALL = readFileSync(join(dir, 'install-glass-skin.ts'), 'utf8')

const SHEETS: ReadonlyArray<readonly [string, string]> = [
  ['arc-glass-skin.css', SKIN],
  ['arc-glass-surfaces.css', SURFACES],
]

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
      // Keyframe steps are not selectors: drop the whole block.
    } else if (/^@(media|supports|container|layer)\b/.test(prelude)) {
      out += ` ${css.slice(open + 1, end)} `
    } else {
      out += css.slice(at, end + 1)
    }
    index = end + 1
  }
  return out
}

function ruleBlocks(css: string): Array<{ selector: string; body: string }> {
  const blocks: Array<{ selector: string; body: string }> = []
  for (const chunk of flatten(css).split('}')) {
    const open = chunk.indexOf('{')
    if (open === -1) continue
    const selector = chunk.slice(0, open).trim()
    if (selector) blocks.push({ selector, body: chunk.slice(open + 1) })
  }
  return blocks
}

/** Body of the first at-rule whose prelude matches. */
function atRule(css: string, prelude: string): string {
  const start = css.indexOf(prelude)
  if (start === -1) return ''
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i)
  }
  return css.slice(open + 1)
}

const SLOT = /\[data-glass-slot="([a-z]+)"\]/g

const FROZEN_SLOTS = ['panel', 'toolbar', 'card', 'table', 'row', 'empty', 'editor', 'dialog', 'sheet', 'toast']
const BLURRED_SLOTS = ['panel', 'toolbar', 'dialog', 'sheet', 'toast']
const SOLID_SLOTS = ['card', 'table', 'row', 'empty', 'editor']

describe('scoping', () => {
  it('arc-glass-skin.css: every rule is scoped to SE optional accents (not arc-glass theme)', () => {
    const blocks = ruleBlocks(SKIN)
    expect(blocks.length).toBeGreaterThan(0)
    for (const block of blocks) {
      expect(block.selector).toContain('html[data-ui-profile="super-engineering"][data-glass-accents]')
      expect(block.selector).not.toContain('data-theme="arc-glass"')
      // Chrome-only: never paint bare [data-glass-slot] (content vocabulary).
      expect(block.selector).not.toMatch(/\[data-glass-slot\](?!=")/)
    }
  })
  it('arc-glass-skin.css: base paint lists only chrome slots', () => {
    expect(SKIN).toMatch(
      /:is\(\.rox-mode-pill,\s*\[data-glass-slot="popover"\],\s*\[data-glass-slot="mini-button"\]\)/,
    )
    expect(SKIN).toContain('[data-glass-slot="composer"]')
    for (const slot of ['panel', 'card', 'table', 'editor', 'dialog', 'toast'])
      expect(SKIN).not.toContain(`[data-glass-slot="${slot}"]`)
  })
  it('arc-glass-surfaces.css: legacy content recipes stay arc-glass-scoped (unused by install)', () => {
    const blocks = ruleBlocks(SURFACES)
    expect(blocks.length).toBeGreaterThan(0)
    for (const block of blocks) expect(block.selector).toContain('html[data-theme="arc-glass"]')
  })
})

describe('static blur', () => {
  for (const [name, css] of SHEETS) {
    it(`${name}: backdrop-filter is never transitioned or animated`, () => {
      for (const decl of css.matchAll(/(?:transition|animation)(?:-[a-z]+)?\s*:[^;}]*/g)) {
        expect(decl[0]).not.toMatch(/filter|all/)
      }
    })
  }

  it('content slots are tint + sheen + hairline, never blur', () => {
    const bySlot = new Map<string, string>()
    for (const block of ruleBlocks(SURFACES)) {
      if (/data-contrast|data-render-profile/.test(block.selector)) continue
      for (const slot of [...block.selector.matchAll(SLOT)].map((m) => m[1]))
        bySlot.set(slot, (bySlot.get(slot) ?? '') + block.body)
    }
    for (const slot of BLURRED_SLOTS) expect(bySlot.get(slot)).toMatch(/backdrop-filter:\s*blur\(var\(--glass-blur/)
    for (const slot of SOLID_SLOTS) expect(bySlot.get(slot)).toMatch(/backdrop-filter:\s*none/)
  })

  it('covers every frozen slot', () => {
    for (const slot of FROZEN_SLOTS) expect(SURFACES).toContain(`[data-glass-slot="${slot}"]`)
  })
})

describe('refraction stays on static skin slots at the full tier', () => {
  it('the content layer never refracts', () => {
    expect(SURFACES).not.toMatch(/rox-glass-skin-refraction|var\(--glass-filter\)/)
  })

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

  it('declares the content-layer tokens', () => {
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

  it('keeps reading surfaces at or above 80% and rows transparent', () => {
    expect(derived).toMatch(/--glass-editor-mix:\s*max\(80%/)
    expect(derived).toMatch(/--glass-overlay-mix:\s*max\(84%/)
    expect(SURFACES).toMatch(
      /\[data-glass-slot="row"\]\s*\{[^}]*--glass-fill:\s*transparent[^}]*background:\s*transparent/,
    )
  })
})

describe('degradations', () => {
  for (const [name, css] of SHEETS) {
    it(`${name}: high contrast goes solid with no blur`, () => {
      const blocks = ruleBlocks(css).filter(
        (b) => b.selector.includes('data-contrast="high"') && (b.selector.includes('[data-glass-slot') || b.selector.includes('.rox-mode-pill')),
      )
      expect(blocks.length).toBeGreaterThan(0)
      const body = blocks.map((b) => b.body).join('\n')
      expect(body).toMatch(/--glass-fill-mix:\s*100%/)
      expect(body).toMatch(/--glass-blur:\s*0px/)
      expect(body).toMatch(/backdrop-filter:\s*none/)
      expect(body).toMatch(/--glass-hairline:\s*var\(--border-strong\)/)
    })

    it(`${name}: the basic tier renders the solid, blur-free material`, () => {
      const blocks = ruleBlocks(css).filter((b) => b.selector.includes('data-glass="basic"'))
      expect(blocks.length).toBeGreaterThan(0)
      const body = blocks.map((b) => b.body).join('\n')
      expect(body).toMatch(/--glass-fill-mix:\s*100%/)
      expect(body).toMatch(/--glass-blur:\s*0px/)
      expect(body).toMatch(/backdrop-filter:\s*none/)
    })

    it(`${name}: reduced transparency goes solid with no blur`, () => {
      const block = atRule(css, '@media (prefers-reduced-transparency: reduce)')
      if (name === 'arc-glass-skin.css') {
        expect(block).toContain('html[data-ui-profile="super-engineering"][data-glass-accents]')
        expect(block).not.toContain('data-theme="arc-glass"')
      } else {
        expect(block).toContain('html[data-theme="arc-glass"]')
      }
      expect(block).toMatch(/--glass-fill-mix:\s*100%/)
      expect(block).toMatch(/--glass-blur:\s*0px/)
      expect(block).toMatch(/backdrop-filter:\s*none/)
    })

    it(`${name}: the low-power profile drops blur only`, () => {
      const blocks = ruleBlocks(css).filter((b) => b.selector.includes('data-render-profile="performance"'))
      expect(blocks.length).toBeGreaterThan(0)
      for (const block of blocks) {
        expect(block.body).toMatch(/--glass-blur:\s*0px/)
        expect(block.body).toMatch(/backdrop-filter:\s*none/)
        expect(block.body).not.toMatch(/--glass-fill-mix/)
      }
    })
  }

  it('flattens the float content-card edge under the degradations', () => {
    const join = ruleBlocks(SURFACES).filter((b) => b.selector.includes('[data-content-join="float"]'))
    expect(join.length).toBe(3)
    expect(join.some((b) => /inset 0 1px 0 var\(--glass-hairline\)/.test(b.body))).toBe(true)
    expect(join.filter((b) => /box-shadow:\s*var\(--content-shadow\)/.test(b.body)).length).toBe(2)
  })
})

describe('install', () => {
  it('loads SE accent skin only (no Arc Glass content surfaces), idempotent', () => {
    expect(INSTALL).toContain("import('./arc-glass-skin.css')")
    expect(INSTALL).not.toContain("import('./arc-glass-surfaces.css')")
    expect(INSTALL.match(/if \(installed\) return installed/g)?.length).toBe(1)
    for (const call of INSTALL.matchAll(/import\('\.\/[\w-]+\.css'\)/g)) expect(call[0]).toBeTruthy()
  })
})
