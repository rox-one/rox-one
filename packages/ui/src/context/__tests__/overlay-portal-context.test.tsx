import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  OverlayPortalContainerProvider,
  OverlayPortalRoot,
  useOverlayPortalContainer,
  useOverlayPortalTarget,
} from '../OverlayPortalContext'

/**
 * UI-A1 review4: fullscreen overlays sit at 350, above the dialog scrim/modal.
 * Dialogs and drawers opened from inside an overlay portal into the overlay's
 * own root (provided through this context) instead of <body>, so they stack
 * above it. Outside an overlay they portal to <body> as before.
 *
 * packages/ui has no DOM harness, so the hooks are exercised through SSR and
 * the wiring through the sources. The real stacking/focus/Escape behaviour is
 * covered by apps/electron/.../overlay-portal.browser.test.ts.
 */
const repoRoot = join(import.meta.dir, '../../../../..')
const src = (f: string) => readFileSync(join(repoRoot, f), 'utf8')

// Stand-in element (SSR has no DOM): identity is all the hooks care about.
const fakeRoot = { id: 'overlay-root' } as unknown as HTMLElement
const fakeExplicit = { id: 'explicit' } as unknown as HTMLElement

function Probe({ explicit }: { explicit?: HTMLElement | null }) {
  const container = useOverlayPortalContainer()
  const target = useOverlayPortalTarget(explicit)
  const id = (el: Element | DocumentFragment | null | undefined) => (el == null ? String(el) : (el as unknown as { id: string }).id)
  return <output data-container={id(container)} data-target={id(target)} />
}

describe('OverlayPortalContext', () => {
  it('outside an overlay: no container, target undefined (the primitive portals to <body>)', () => {
    const html = renderToStaticMarkup(<Probe />)
    expect(html).toContain('data-container="null"')
    expect(html).toContain('data-target="undefined"')
  })

  it('inside an overlay: the overlay root is the portal target', () => {
    const html = renderToStaticMarkup(
      <OverlayPortalContainerProvider container={fakeRoot}>
        <Probe />
      </OverlayPortalContainerProvider>,
    )
    expect(html).toContain('data-container="overlay-root"')
    expect(html).toContain('data-target="overlay-root"')
  })

  it('an explicit container prop wins over the overlay root', () => {
    const html = renderToStaticMarkup(
      <OverlayPortalContainerProvider container={fakeRoot}>
        <Probe explicit={fakeExplicit} />
      </OverlayPortalContainerProvider>,
    )
    expect(html).toContain('data-target="explicit"')
  })

  it('a provider with a null container (root not mounted yet) falls back to <body>', () => {
    const html = renderToStaticMarkup(
      <OverlayPortalContainerProvider container={null}>
        <Probe />
      </OverlayPortalContainerProvider>,
    )
    expect(html).toContain('data-target="undefined"')
  })

  it('OverlayPortalRoot renders its root element after the children', () => {
    const html = renderToStaticMarkup(
      <OverlayPortalRoot>
        <p>content</p>
      </OverlayPortalRoot>,
    )
    expect(html).toBe('<p>content</p><div data-slot="overlay-portal-root"></div>')
  })
})

describe('overlay portal wiring', () => {
  it('FullscreenOverlayBase wraps its content in OverlayPortalRoot inside Dialog.Content, after the header', () => {
    const text = src('packages/ui/src/components/overlay/FullscreenOverlayBase.tsx')
    const content = text.slice(text.indexOf('<Dialog.Content'), text.indexOf('</Dialog.Content>'))
    expect(content).toContain('<OverlayPortalRoot>')
    expect(content.trimEnd().endsWith('</OverlayPortalRoot>')).toBe(true)
    expect(content.indexOf('<FullscreenOverlayBaseHeader')).toBeLessThan(content.indexOf('</OverlayPortalRoot>'))
    expect(text).toContain("const Z_FULLSCREEN = 'var(--z-fullscreen, 350)'")
  })

  for (const [file, portal, content, primitive] of [
    ['packages/ui/src/components/ui/drawer.tsx', 'DrawerPortal', 'DrawerContent', 'DrawerPrimitive.Portal'],
    ['apps/electron/src/renderer/components/ui/dialog.tsx', 'DialogPortal', 'DialogContent', 'DialogPrimitive.Portal'],
  ] as const) {
    it(`${portal} passes the overlay portal target as its container; ${content} portals through it`, () => {
      const text = src(file)
      const fn = text.slice(text.indexOf(`function ${portal}(`), text.indexOf('\n}\n', text.indexOf(`function ${portal}(`)))
      expect(fn).toContain('const target = useOverlayPortalTarget(container)')
      expect(fn).toContain(`<${primitive}`)
      expect(fn).toContain('container={target}')
      // `container` is destructured, so a caller's explicit container reaches the hook, not a raw spread.
      expect(fn).toMatch(new RegExp(`function ${portal}\\(\\{\\s*container,`))
      const contentFn = text.slice(text.indexOf(`function ${content}(`))
      expect(contentFn).toContain(`<${portal} data-slot=`)
      // Only the wrapper touches the primitive portal.
      expect(text.split(`<${primitive}`).length - 1).toBe(1)
    })
  }

  it('no other source portals a Radix dialog or vaul drawer directly (all go through the wrappers)', () => {
    const offenders: string[] = []
    const glob = new Bun.Glob('{apps/electron/src,packages/ui/src}/**/*.tsx')
    const allowed = new Set([
      'packages/ui/src/components/ui/drawer.tsx',
      'apps/electron/src/renderer/components/ui/dialog.tsx',
      'packages/ui/src/components/overlay/FullscreenOverlayBase.tsx',
    ])
    for (const file of glob.scanSync({ cwd: repoRoot })) {
      if (file.includes('__tests__') || allowed.has(file)) continue
      const text = readFileSync(join(repoRoot, file), 'utf8')
      if (/from ['"](vaul|@radix-ui\/react-dialog|@radix-ui\/react-alert-dialog)['"]/.test(text)) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })

  it('the zen mind map (a fullscreen-layer surface) provides a portal root too', () => {
    const text = src('apps/electron/src/renderer/mindmap/MindMapHost.tsx')
    const zen = text.slice(text.indexOf('className="fixed inset-0 z-fullscreen'))
    expect(zen.indexOf('<OverlayPortalRoot>')).toBeGreaterThan(0)
    expect(zen.indexOf('</OverlayPortalRoot>')).toBeGreaterThan(zen.indexOf('{body}'))
  })
})
