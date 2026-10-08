/**
 * Custom stylelint rules for the UI lint ratchet (UI-A2, #1568): scripts/stylelint/*.mjs.
 */
import { describe, expect, it } from 'bun:test'
import { resolve } from 'node:path'
import stylelint from 'stylelint'

const ROOT = resolve(import.meta.dir, '..', '..')

async function warnings(rule: string, code: string) {
  const { results } = await stylelint.lint({
    code,
    codeFilename: resolve(ROOT, 'packages/ui/src/fixture.css'),
    config: { plugins: [resolve(ROOT, 'scripts/stylelint/no-apply-numeric-z.mjs'), resolve(ROOT, 'scripts/stylelint/no-theme-self-reference.mjs')], rules: { [rule]: true } },
  })
  return results.flatMap((result) => result.warnings.filter((warning) => warning.rule === rule).map((warning) => warning.text))
}

describe('rox-css/no-apply-numeric-z', () => {
  const rule = 'rox-css/no-apply-numeric-z'

  it('flags numeric and arbitrary z utilities in @apply, with any variants', async () => {
    const found = await warnings(rule, `
      .a { @apply relative z-50; }
      .b { @apply md:z-[60] !-z-10; }
      .c { @apply data-[state=open]:z-50; }
      .d { @apply [&>*]:z-10 group-hover/name:z-20; }
    `)
    expect(found).toHaveLength(6)
    for (const token of ['z-50', 'md:z-[60]', '!-z-10', 'data-[state=open]:z-50', '[&>*]:z-10', 'group-hover/name:z-20']) {
      expect(found.some((text) => text.includes(`"@apply ${token}"`)), token).toBe(true)
    }
  })

  it('allows layer utilities, layer-based arbitrary values and non-z tokens', async () => {
    const found = await warnings(rule, `
      .a { @apply z-popover md:z-auto data-[state=open]:z-[calc(var(--z-chrome)+1)]; }
      .b { @apply data-[z-10]:flex mz-10 z-10px !important; }
      .c { z-index: var(--z-popover); }
    `)
    expect(found).toEqual([])
  })
})

describe('rox-css/no-theme-self-reference', () => {
  it('flags `--x: var(--x)` inside @theme only', async () => {
    const found = await warnings('rox-css/no-theme-self-reference', `
      @theme { --color-accent: var(--color-accent); --radius: var(--radius-md); }
      :root { --color-accent: var(--color-accent); }
    `)
    expect(found).toHaveLength(1)
  })
})
