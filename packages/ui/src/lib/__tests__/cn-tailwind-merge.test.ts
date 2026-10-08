import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cn, ROX_TEXT_SIZES, ROX_Z_LAYERS } from '../utils'
import { cn as rendererCn } from '../../../../../apps/electron/src/renderer/lib/utils'

const tokensDir = join(import.meta.dir, '../../styles/tokens')
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

describe('cn(): tailwind-merge knows the Rox token utilities', () => {
  for (const [label, merge] of [['@rox/ui cn', cn], ['renderer cn', rendererCn]] as const) {
    describe(label, () => {
      it('lets the caller override a named z layer', () => {
        expect(merge('z-popover', 'z-island')).toBe('z-island')
        expect(merge('fixed z-island', 'z-popover')).toBe('fixed z-popover')
        expect(merge('z-50', 'z-modal')).toBe('z-modal')
        expect(merge('z-fullscreen', 'z-[5]')).toBe('z-[5]')
        // Tooltip content inside a menu lifts itself above the menu layer.
        expect(merge('popover-styled z-tooltip px-2.5', 'z-island-popover')).toBe('popover-styled px-2.5 z-island-popover')
      })

      it('treats the role text steps as font sizes, not colours', () => {
        // A size never drops a colour…
        expect(merge('text-caption', 'text-foreground')).toBe('text-caption text-foreground')
        expect(merge('text-muted-foreground text-body')).toBe('text-muted-foreground text-body')
        // …and sizes override each other (incl. the Tailwind steps).
        expect(merge('text-body', 'text-caption')).toBe('text-caption')
        expect(merge('text-sm', 'text-title-sm')).toBe('text-title-sm')
        expect(merge('text-display', 'text-[13px]')).toBe('text-[13px]')
        expect(merge('text-title-sm', 'text-title')).toBe('text-title')
      })
    })
  }

  it('registers exactly the z layers and text steps the tokens define', () => {
    const z = stripComments(readFileSync(join(tokensDir, 'z.css'), 'utf8'))
    const layers = [...z.matchAll(/--z-index-([\w-]+)\s*:/g)].map((m) => m[1])
    expect([...ROX_Z_LAYERS].sort()).toEqual(layers.sort())

    const type = stripComments(readFileSync(join(tokensDir, 'type.css'), 'utf8'))
    const steps = [...type.matchAll(/--text-([\w-]+?)\s*:/g)].map((m) => m[1]!)
      .filter((s) => !s.includes('--') && !['xs', 'sm', 'base', 'lg', 'xl'].includes(s))
    expect([...ROX_TEXT_SIZES].sort()).toEqual([...new Set(steps)].sort())
  })
})
